/**
 * Importe une pièce jointe depuis Gmail (chat : « facture du mail de Olive »).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pool from '../db/pool.js';
import * as gmail from './google-gmail.js';
import { extractAllAttachments, classifyAndStudyAttachments } from './attachment-extract.js';
import { ingestMessage, matchProjectFromRules, extractKeywords } from './invoice-email-router.js';
import { extractAmount } from './skill-actions.js';
import { buildGmailSearchQuery } from './mail-search-query.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const IMPORT_DIR = path.join(__dirname, '../../uploads/mail-import');

function safeName(name) {
  return String(name || 'document')
    .replace(/[/\\?%*:|"<>]/g, '_')
    .slice(0, 120);
}

async function resolveProjectId({ message, pageContext, params, study, keywords }) {
  if (params.project_id) return Number(params.project_id);
  if (pageContext?.type === 'project') return pageContext.id;

  const q = String(params.project_query || study?.suggested_project_query || '').trim();
  if (q) {
    const { rows } = await pool.query(
      `SELECT id FROM projects WHERE status IN ('active','on_hold') AND name ILIKE $1 ORDER BY priority DESC LIMIT 1`,
      [`%${q.split(/\s+/)[0]}%`]
    );
    if (rows[0]) return rows[0].id;
  }

  for (const kw of keywords || []) {
    if (kw.length >= 4) {
      const { rows } = await pool.query(
        `SELECT id FROM projects WHERE status IN ('active','on_hold') AND name ILIKE $1 LIMIT 1`,
        [`%${kw}%`]
      );
      if (rows[0]) return rows[0].id;
    }
  }

  const match = await matchProjectFromRules('any', keywords || []);
  return match?.project_id || null;
}

async function saveGmailAttachment(messageId, att) {
  const downloaded = await gmail.getAttachment(messageId, att.id);
  fs.mkdirSync(IMPORT_DIR, { recursive: true });
  const filename = `${Date.now()}-${safeName(downloaded.filename)}`;
  const fullPath = path.join(IMPORT_DIR, filename);
  fs.writeFileSync(fullPath, downloaded.buffer);
  return {
    name: downloaded.filename,
    url: `/uploads/mail-import/${filename}`,
    type: downloaded.mimeType,
    size: downloaded.size,
  };
}

function pickProcessableAttachment(attachments = []) {
  return attachments.filter(a => {
    const n = `${a.filename} ${a.mimeType}`.toLowerCase();
    return /pdf|image|png|jpe?g|webp/.test(n);
  });
}

/**
 * Cherche un mail, télécharge la PJ, lit/classifie et enregistre (dépense ou file d'attente).
 */
export async function importAttachmentFromEmail(message, pageContext = null, params = {}) {
  let messageId = params.message_id || params.id || null;
  let full = null;

  if (messageId) {
    full = await gmail.getMessage(messageId);
  } else {
    const q = buildGmailSearchQuery(message, params);
    const { messages } = await gmail.searchMessages(q, 8);
    if (!messages?.length) {
      return {
        reply: `Aucun courriel trouvé pour « ${q} ». Précisez l'expéditeur (ex. « facture du mail de Olive ») ou vérifiez Gmail.`,
        actions: [],
      };
    }

    // Préférer un message avec PJ
    for (const m of messages) {
      const candidate = m.attachments?.length ? m : await gmail.getMessage(m.id);
      if (pickProcessableAttachment(candidate.attachments).length) {
        full = candidate;
        messageId = candidate.id;
        break;
      }
    }
    if (!full) {
      full = await gmail.getMessage(messages[0].id);
      messageId = full.id;
    }
  }

  const processable = pickProcessableAttachment(full.attachments || []);
  if (!processable.length) {
    return {
      reply: `Mail trouvé — ${full.from}\nObjet : ${full.subject}\n\nPas de pièce jointe PDF/image. Si la facture est dans le corps du mail, dites-le moi.`,
      actions: [{ type: 'get_email', data: { id: full.id, subject: full.subject, from: full.from } }],
    };
  }

  const savedAttachments = [];
  for (const att of processable.slice(0, 3)) {
    savedAttachments.push(await saveGmailAttachment(messageId, att));
  }

  const extracts = await extractAllAttachments(savedAttachments);
  const projectHint = pageContext?.type === 'project' ? pageContext.label : null;
  const study = await classifyAndStudyAttachments({ message, extracts, projectHint });

  const keywords = extractKeywords(full.subject, full.snippet, full.body || '');
  const projectId = await resolveProjectId({ message, pageContext, params, study, keywords });

  const actions = [{
    type: 'import_email_attachment',
    data: {
      message_id: messageId,
      subject: full.subject,
      from: full.from,
      files: savedAttachments.map(a => a.name),
      doc_type: study.doc_type,
      project_id: projectId,
    },
  }];

  const amount = extractAmount(message) || study.amount || null;
  const lines = [
    `Courriel : ${full.from}`,
    `Objet : ${full.subject}`,
    `Pièce(s) : ${savedAttachments.map(a => a.name).join(', ')}`,
    study.label_fr ? `Type : ${study.label_fr}` : null,
    study.summary ? `\n${study.summary}` : null,
  ].filter(Boolean);

  // Dépense si montant détecté
  if (amount && Number(amount) > 0) {
    let category = 'materiaux';
    if (/outil/i.test(message)) category = 'outils';
    else if (/transport/i.test(message)) category = 'transport';
    const desc = [
      study.label_fr || full.subject,
      study.vendor ? `(${study.vendor})` : '',
      `— mail ${full.from}`,
    ].filter(Boolean).join(' ').slice(0, 300);

    const { normalizePurchaseDate, extractDateFromText, todayISODate } = await import('./expense-date.js');
    const expenseDate = normalizePurchaseDate(study.date)
      || extractDateFromText(`${study.summary || ''} ${full.subject || ''} ${full.snippet || ''}`)
      || todayISODate();

    const { rows } = await pool.query(
      `INSERT INTO expenses (amount, category, description, receipt_url, project_id, date)
       VALUES ($1,$2,$3,$4,$5,$6::date) RETURNING *`,
      [
        amount,
        category,
        desc,
        savedAttachments[0]?.url,
        projectId,
        expenseDate,
      ]
    );
    actions.push({ type: 'create_expense', data: rows[0] });
    lines.push(`\n✓ Dépense enregistrée : ${Number(amount).toFixed(2)} $${projectId ? ` (projet #${projectId})` : ''}`);
  } else if (study.doc_type === 'supplier_invoice' || study.doc_type === 'receipt' || /facture|invoice/i.test(full.subject)) {
    try {
      const ingested = await ingestMessage(full, { autoAssign: true });
      if (ingested) {
        actions.push({ type: 'supplier_invoice_ingested', data: ingested });
        lines.push(`\n✓ Facture ajoutée à la file fournisseurs${ingested.project_id ? ` → projet #${ingested.project_id}` : ' (à assigner sur /mail)'}.`);
      }
    } catch { /* optional */ }
    if (!amount) {
      lines.push('\nMontant non détecté — indiquez « dépense 120$ » ou assignez sur /mail → Factures fournisseurs.');
    }
  }

  if (projectId && savedAttachments[0]) {
    try {
      const { fileAttachmentToProject } = await import('./mail-attachments.js');
      await fileAttachmentToProject({
        messageId,
        attachmentId: processable[0].id,
        projectId,
        uploadDrive: true,
      });
      lines.push(`\n✓ Pièce classée dans le projet #${projectId}.`);
    } catch { /* optional */ }
  }

  return {
    reply: lines.join('\n'),
    actions,
    attachments: savedAttachments,
  };
}

/**
 * Documents d'un projet : devis liés + fichiers classés depuis les mails + plans.
 */
import pool from '../db/pool.js';
import * as gmail from './google-gmail.js';

function parseMeta(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return { ...raw };
  try { return JSON.parse(raw); } catch { return {}; }
}

export async function listProjectQuotes(projectId) {
  const { rows } = await pool.query(`
    SELECT q.*, c.name AS client_name,
           i.id AS invoice_id, i.invoice_number
    FROM quotes q
    LEFT JOIN clients c ON c.id = q.client_id
    LEFT JOIN invoices i ON i.quote_id = q.id
    WHERE q.project_id = $1
    ORDER BY q.created_at DESC
  `, [projectId]);
  return rows;
}

export async function listProjectMailFiles(projectId) {
  const { rows } = await pool.query('SELECT meta FROM projects WHERE id = $1', [projectId]);
  if (!rows[0]) return [];
  const meta = parseMeta(rows[0].meta);
  return Array.isArray(meta.mail_files) ? meta.mail_files : [];
}

export async function listProjectPlans(projectId) {
  const { rows } = await pool.query('SELECT meta FROM projects WHERE id = $1', [projectId]);
  if (!rows[0]) return [];
  const meta = parseMeta(rows[0].meta);
  return Array.isArray(meta.plans) ? meta.plans : [];
}

export async function listLinkedProjectEmails(projectId) {
  const { rows } = await pool.query(`
    SELECT pe.id, pe.gmail_message_id, pe.thread_id, pe.subject, pe.from_email, pe.snippet, pe.linked_at
    FROM project_emails pe
    WHERE pe.project_id = $1
    ORDER BY pe.linked_at DESC
    LIMIT 40
  `, [projectId]);
  return rows;
}

/**
 * Agrégat pour l'onglet Documents du projet.
 */
export async function getProjectDocuments(projectId) {
  const pid = Number(projectId);
  if (!pid) throw new Error('project_id invalide');

  const { rows: proj } = await pool.query(
    'SELECT id, name, client_id, meta FROM projects WHERE id = $1',
    [pid]
  );
  if (!proj[0]) throw new Error('Projet introuvable');

  const [quotes, mail_files, plans, emails, threads] = await Promise.all([
    listProjectQuotes(pid),
    listProjectMailFiles(pid),
    listProjectPlans(pid),
    listLinkedProjectEmails(pid),
    pool.query(`
      SELECT id, gmail_thread_id, subject, last_message_at, message_count, mail_category
      FROM email_threads
      WHERE project_id = $1
      ORDER BY last_message_at DESC NULLS LAST
      LIMIT 30
    `, [pid]).then(r => r.rows).catch(() => []),
  ]);

  const meta = parseMeta(proj[0].meta);
  const sketchup_files = Array.isArray(meta.sketchup_files) ? meta.sketchup_files : [];

  return {
    project: { id: proj[0].id, name: proj[0].name, client_id: proj[0].client_id },
    quotes,
    mail_files,
    plans,
    sketchup_files,
    emails,
    threads,
  };
}

function looksLikeDocument(att) {
  const hay = `${att.filename || ''} ${att.mimeType || ''}`.toLowerCase();
  return /pdf|word|doc|xls|sheet|image|png|jpe?g|webp|devis|facture|quote|invoice|plan|contrat|\.skp|sketchup/.test(hay);
}

/**
 * Parcourt les mails liés au projet, liste les PJ documentaires,
 * et optionnellement les classe automatiquement (file_to_project).
 */
export async function scanProjectMailDocuments(projectId, { autoFile = false } = {}) {
  const pid = Number(projectId);
  if (!pid) throw new Error('project_id invalide');

  const emails = await listLinkedProjectEmails(pid);
  const found = [];
  const filed = [];
  const errors = [];
  const seen = new Set();

  // Aussi chercher dans Gmail via fils liés
  const { rows: threads } = await pool.query(
    `SELECT gmail_thread_id FROM email_threads WHERE project_id = $1 LIMIT 20`,
    [pid]
  );

  const messageIds = new Set(emails.map(e => e.gmail_message_id).filter(Boolean));

  for (const t of threads) {
    if (!t.gmail_thread_id) continue;
    try {
      const thread = await gmail.getThread(t.gmail_thread_id);
      for (const m of thread.messages || []) {
        if (m.id) messageIds.add(m.id);
      }
    } catch (err) {
      errors.push({ thread: t.gmail_thread_id, error: err.message });
    }
  }

  for (const messageId of messageIds) {
    try {
      const msg = await gmail.getMessage(messageId);
      const atts = (msg.attachments || []).filter(looksLikeDocument);
      for (const att of atts) {
        const key = `${messageId}:${att.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const entry = {
          gmail_message_id: messageId,
          gmail_attachment_id: att.id,
          filename: att.filename,
          mimeType: att.mimeType,
          size: att.size,
          subject: msg.subject,
          from: msg.from,
          date: msg.date,
        };
        found.push(entry);

        if (autoFile) {
          try {
            const { fileAttachmentToProject } = await import('./mail-attachments.js');
            const result = await fileAttachmentToProject({
              messageId,
              attachmentId: att.id,
              filename: att.filename,
              projectId: pid,
              uploadDrive: true,
            });
            filed.push(result.file);
          } catch (err) {
            errors.push({ filename: att.filename, error: err.message });
          }
        }
      }
    } catch (err) {
      errors.push({ message_id: messageId, error: err.message });
    }
  }

  const mail_files = await listProjectMailFiles(pid);
  return {
    ok: true,
    scanned_messages: messageIds.size,
    found,
    filed,
    mail_files,
    errors,
  };
}

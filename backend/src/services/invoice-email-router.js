import pool from '../db/pool.js';
import * as gmail from './google-gmail.js';

export const SUPPLIERS = [
  { id: 'home_depot', label: 'Home Depot', patterns: ['homedepot', 'home depot', 'home-depot', 'homedepot.ca'] },
  { id: 'rona', label: 'Rona', patterns: ['rona', 'rona.ca'] },
  { id: 'canac', label: 'Canac', patterns: ['canac'] },
  { id: 'reno_depot', label: 'Reno Depot', patterns: ['renodepot', 'réno-dépôt', 'reno-depot'] },
  { id: 'amazon', label: 'Amazon', patterns: ['amazon'] },
  { id: 'walmart', label: 'Walmart', patterns: ['walmart'] },
  { id: 'lee_valley', label: 'Lee Valley', patterns: ['leevalley', 'lee valley', 'leevalleynews'] },
  { id: 'other', label: 'Fournisseur', patterns: [] },
];

const INVOICE_HINTS = [
  'facture', 'invoice', 'receipt', 'reçu', 'recu', 'order confirmation',
  'confirmation de commande', 'purchase order', 'bon de commande',
];

const KEYWORD_STOP = new Set(['the', 'and', 'for', 'from', 'your', 'order', 'facture', 'invoice', 'receipt', 'home', 'depot', 'neya']);

function norm(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ');
}

export function detectSupplier(from, subject, snippet) {
  const hay = norm(`${from} ${subject}`);
  for (const s of SUPPLIERS) {
    if (s.id === 'other') continue;
    if (s.patterns.some(p => hay.includes(norm(p)))) return s;
  }
  return null;
}

/**
 * Vrai facture/commande fournisseur — pas juste un mail marketing Amazon/Rona.
 * Exige un indice facture clair ; « your order » / « votre commande » seuls ne suffisent plus.
 */
export function looksLikeSupplierInvoice(from, subject, snippet) {
  const hay = norm(`${subject} ${snippet}`);
  const hasHint = INVOICE_HINTS.some(h => hay.includes(norm(h)));
  if (!hasHint) return false;
  const supplier = detectSupplier(from, subject, snippet);
  const hard = /\b(facture|invoice|receipt|recu|reçu|order confirmation|confirmation de commande|purchase order|bon de commande)\b/i
    .test(`${subject} ${snippet}`);
  // Fournisseur connu + indice facture, ou langage facture très explicite
  if (supplier && hard) return true;
  if (supplier && hasHint) return true;
  return hard;
}

export function extractKeywords(subject, snippet, body = '') {
  const words = norm(`${subject} ${snippet} ${body}`).split(/\s+/).filter(w => w.length >= 3 && !KEYWORD_STOP.has(w));
  return [...new Set(words)].slice(0, 12);
}

export async function matchProjectFromRules(supplierId, keywords) {
  const { rows: rules } = await pool.query(
    `SELECT r.*, p.name AS project_name
     FROM invoice_routing_rules r
     JOIN projects p ON p.id = r.project_id
     WHERE r.active = true
       AND (r.supplier_id = $1 OR r.supplier_id = 'any')
     ORDER BY CASE WHEN r.supplier_id = $1 THEN 0 ELSE 1 END, r.hit_count DESC`,
    [supplierId || 'any']
  );

  for (const rule of rules) {
    const pat = norm(rule.keyword_pattern);
    if (!pat) continue;
    const parts = pat.split(/\s+/).filter(Boolean);
    const hay = keywords.join(' ');
    if (parts.every(p => hay.includes(p) || norm(hay).includes(p))) {
      return { project_id: rule.project_id, project_name: rule.project_name, rule_id: rule.id, confidence: 'rule' };
    }
  }

  const { rows: projects } = await pool.query(
    `SELECT id, name FROM projects WHERE status = 'active' ORDER BY priority DESC, created_at DESC`
  );
  for (const p of projects) {
    const pn = norm(p.name);
    const tokens = pn.split(/\s+/).filter(t => t.length >= 4);
    if (tokens.some(t => keywords.some(k => k.includes(t) || t.includes(k)))) {
      return { project_id: p.id, project_name: p.name, confidence: 'project_name' };
    }
  }
  return null;
}

export async function upsertRoutingRule({ supplier_id, keyword_pattern, project_id }) {
  const pat = String(keyword_pattern || '').trim().toLowerCase();
  if (!pat || !project_id) return null;
  const sid = supplier_id && supplier_id !== 'other' ? supplier_id : 'any';
  const { rows } = await pool.query(
    `INSERT INTO invoice_routing_rules (supplier_id, keyword_pattern, project_id, hit_count)
     VALUES ($1, $2, $3, 1)
     ON CONFLICT (supplier_id, keyword_pattern) DO UPDATE SET
       project_id = EXCLUDED.project_id,
       hit_count = invoice_routing_rules.hit_count + 1,
       active = true
     RETURNING *`,
    [sid, pat, project_id]
  );
  return rows[0];
}

export async function ingestMessage(msg, { autoAssign = true } = {}) {
  const from = msg.from || '';
  const subject = msg.subject || '';
  const snippet = msg.snippet || '';
  const body = msg.body || '';

  if (!looksLikeSupplierInvoice(from, subject, snippet)) return null;

  const supplier = detectSupplier(from, subject, snippet);
  const keywords = extractKeywords(subject, snippet, body);
  const supplierId = supplier?.id || 'other';
  const supplierLabel = supplier?.label || 'Fournisseur';

  const existing = await pool.query(
    'SELECT id FROM supplier_invoice_emails WHERE gmail_message_id = $1',
    [msg.id]
  );
  if (existing.rows[0]) return null;

  let match = null;
  if (autoAssign) {
    match = await matchProjectFromRules(supplierId, keywords);
  }

  const status = match?.project_id ? 'assigned' : 'pending';
  const { rows } = await pool.query(
    `INSERT INTO supplier_invoice_emails (
      gmail_message_id, thread_id, subject, from_email, snippet,
      supplier_id, supplier_label, keywords, suggested_project_id,
      project_id, status, assigned_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
    RETURNING *`,
    [
      msg.id,
      msg.threadId || null,
      subject,
      from,
      snippet,
      supplierId,
      supplierLabel,
      JSON.stringify(keywords),
      match?.project_id || null,
      match?.project_id || null,
      status,
      match?.project_id ? new Date() : null,
    ]
  );

  const row = rows[0];
  if (match?.project_id && match.rule_id) {
    await pool.query('UPDATE invoice_routing_rules SET hit_count = hit_count + 1 WHERE id = $1', [match.rule_id]);
    await pool.query(
      `INSERT INTO project_emails (project_id, gmail_message_id, thread_id, subject, from_email, snippet)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (gmail_message_id) DO UPDATE SET project_id = $1`,
      [match.project_id, msg.id, msg.threadId, subject, from, snippet]
    );
  }

  try {
    const { upsertAdminTaskFromMailMessage } = await import('./mail-invoice-todos.js');
    await upsertAdminTaskFromMailMessage(msg);
  } catch {
    /* todos admin optionnels */
  }

  return row;
}

export async function scanInboxForSupplierInvoices({ max = 40, year = null } = {}) {
  let ingested = 0;
  let pending = 0;
  const errors = [];
  const y = year ? Number(year) : null;
  const q = y
    ? `after:${y}/01/01 before:${y + 1}/01/01 (facture OR invoice OR receipt OR "Tri/Compta" OR homedepot OR rona OR canac OR renodepot OR amazon)`
    : [
        'newer_than:30d',
        '(facture OR invoice OR receipt OR homedepot OR rona OR canac OR renodepot OR amazon',
        'OR label:Tri/Compta_Facturation OR label:Tri/Compta_Factu OR label:Tri/Fournisseurs)',
      ].join(' ');
  const { messages } = await gmail.searchMessages(q, max);

  for (const m of messages || []) {
    try {
      const full = m.body ? m : await gmail.getMessage(m.id);
      const row = await ingestMessage(full);
      if (row) {
        ingested++;
        if (row.status === 'pending') pending++;
      }
    } catch (err) {
      errors.push({ message_id: m.id, error: err.message });
    }
  }

  return { ingested, pending, scanned: messages?.length || 0, errors, query: q };
}

export function normalizeAssignProjectId(project_id) {
  if (project_id == null || project_id === '' || project_id === 'null' || project_id === 'none') {
    return null;
  }
  const n = Number(project_id);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export async function assignSupplierInvoice(id, { project_id, amount, category, description, remember_rule, keyword_pattern }) {
  const { rows: existing } = await pool.query('SELECT * FROM supplier_invoice_emails WHERE id = $1', [id]);
  if (!existing[0]) throw new Error('Facture courriel introuvable');
  const inv = existing[0];
  const resolvedProjectId = normalizeAssignProjectId(project_id);

  let expenseId = null;
  if (amount && Number(amount) > 0) {
    const desc = description || `${inv.supplier_label} — ${inv.subject}`;
    let supplierDbId = null;
    try {
      const { resolveSupplierIdFromSlug, ensureKnownSuppliers } = await import('./suppliers-catalog.js');
      supplierDbId = await resolveSupplierIdFromSlug(inv.supplier_id);
      if (!supplierDbId && inv.supplier_id && inv.supplier_id !== 'other') {
        await ensureKnownSuppliers();
        supplierDbId = await resolveSupplierIdFromSlug(inv.supplier_id);
      }
    } catch { /* catalogue optionnel */ }
    const expenseCategory = category || (resolvedProjectId ? 'materiaux' : 'atelier');
    const { rows: exp } = await pool.query(
      `INSERT INTO expenses (project_id, amount, category, description, date, supplier_id)
       VALUES ($1,$2,$3,$4,CURRENT_DATE,$5) RETURNING id`,
      [resolvedProjectId, Number(amount), expenseCategory, desc, supplierDbId]
    );
    expenseId = exp[0].id;
  }

  const { rows } = await pool.query(
    `UPDATE supplier_invoice_emails SET
      project_id = $1, status = 'assigned', assigned_at = NOW(), expense_id = $2
     WHERE id = $3 RETURNING *`,
    [resolvedProjectId, expenseId, id]
  );

  // Pas de lien projet = frais généraux / atelier — ne pas forcer project_emails
  if (resolvedProjectId) {
    await pool.query(
      `INSERT INTO project_emails (project_id, gmail_message_id, thread_id, subject, from_email, snippet)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (gmail_message_id) DO UPDATE SET project_id = $1`,
      [resolvedProjectId, inv.gmail_message_id, inv.thread_id, inv.subject, inv.from_email, inv.snippet]
    );
  }

  if (remember_rule && resolvedProjectId) {
    const kw = keyword_pattern || (inv.keywords?.[0] || norm(inv.subject).split(/\s+/).find(w => w.length >= 4));
    if (kw) {
      await upsertRoutingRule({
        supplier_id: inv.supplier_id,
        keyword_pattern: kw,
        project_id: resolvedProjectId,
      });
    }
  }

  try {
    const { closeMailPayableTodoForMessage } = await import('./mail-invoice-todos.js');
    const reason = resolvedProjectId
      ? 'Facture classée sur un projet'
      : (expenseId ? 'Facture classée en frais atelier' : 'Facture marquée réglée / hors projet');
    await closeMailPayableTodoForMessage(inv.gmail_message_id, reason, {
      supplierLabel: inv.supplier_label,
    });
  } catch { /* todos optionnels */ }

  return rows[0];
}

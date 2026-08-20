import pool from '../db/pool.js';
import * as gmail from './google-gmail.js';
import {
  attachmentNamesText,
  extractMoneyAmount,
  isLikelyPromoMail,
  isOurQuoteOrClientInvoice,
  mailDocKind,
  paymentStatusFromMail,
} from './mail-money.js';

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
  'facture', 'invoice', 'receipt', 'reçu', 'recu', 'ticket',
  'order confirmation', 'confirmation de commande', 'purchase order', 'bon de commande',
];

const DOC_HARD_RE = /\b(facture|invoice|receipt|recu|reçu|ticket|caisse|order confirmation|confirmation de commande|purchase order|bon de commande)\b/i;

const KEYWORD_STOP = new Set(['the', 'and', 'for', 'from', 'your', 'order', 'facture', 'invoice', 'receipt', 'home', 'depot', 'neya']);

function norm(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ');
}

export function detectSupplier(from, subject, snippet) {
  const hay = ` ${norm(`${from} ${subject}`)} `;
  for (const s of SUPPLIERS) {
    if (s.id === 'other') continue;
    if (s.patterns.some(p => {
      const n = norm(p);
      if (!n) return false;
      const token = n.split(/\s+/).filter(Boolean).join('\\s+');
      return new RegExp(`(?:^|[^a-z0-9])${token}(?:[^a-z0-9]|$)`).test(hay);
    })) return s;
  }
  return null;
}

/**
 * Ticket / reçu / facture fournisseur — pas une newsletter, pas notre devis client.
 * Un ticket de dealer (enseigne inconnue) passe : le mot ticket / reçu / PJ suffit.
 * « your order » seul dans un promo Amazon ne suffit plus.
 */
export function looksLikeSupplierInvoice(from, subject, snippet, extras = {}) {
  if (isOurQuoteOrClientInvoice(subject, snippet)) return false;
  if (isLikelyPromoMail(from, subject, snippet)) return false;

  const att = attachmentNamesText(extras.attachments);
  const hay = norm(`${subject} ${snippet} ${att}`);
  const hasHint = INVOICE_HINTS.some(h => hay.includes(norm(h)));
  const hard = DOC_HARD_RE.test(`${subject} ${snippet} ${att}`);
  const attDoc = /\b(facture|invoice|receipt|ticket|recu|reçu)\b/i.test(att);
  const supplier = detectSupplier(from, subject, `${snippet} ${att}`);

  if (hard || attDoc) return true;
  if (supplier && hasHint) return true;
  return false;
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
    if (!tokens.length) continue;
    // Un seul token court / générique : trop risqué (ex. « Anne » dans Pharmacie Anne)
    const PROJECT_TOKEN_STOP = new Set([
      'anne', 'marie', 'jean', 'paul', 'marc', 'lisa', 'john', 'projet', 'devis', 'sauna',
    ]);
    const strong = tokens.filter(t => t.length >= 6 && !PROJECT_TOKEN_STOP.has(t));
    const matchedStrong = strong.filter(t => keywords.some(k => k.includes(t) || t.includes(k)));
    if (matchedStrong.length) {
      return { project_id: p.id, project_name: p.name, confidence: 'project_name' };
    }
    // Multi-tokens : exiger ≥2 tokens matchés (évite anne seul → Pharmacie Anne)
    if (tokens.length >= 2) {
      const matched = tokens.filter(t => keywords.some(k => k.includes(t) || t.includes(k)));
      if (matched.length >= 2) {
        return { project_id: p.id, project_name: p.name, confidence: 'project_name' };
      }
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

let mailExpenseSchemaReady;
export async function ensureMailExpenseSchema() {
  if (!mailExpenseSchemaReady) {
    mailExpenseSchemaReady = (async () => {
      await pool.query(`ALTER TABLE expenses ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'manual'`);
      await pool.query('ALTER TABLE expenses ADD COLUMN IF NOT EXISTS gmail_message_id TEXT');
      await pool.query(`ALTER TABLE expenses ADD COLUMN IF NOT EXISTS payment_status TEXT DEFAULT 'paid'`);
      await pool.query('ALTER TABLE expenses ADD COLUMN IF NOT EXISTS mail_from TEXT');
      await pool.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_expenses_gmail_message
        ON expenses(gmail_message_id) WHERE gmail_message_id IS NOT NULL
      `);
      await pool.query('ALTER TABLE supplier_invoice_emails ADD COLUMN IF NOT EXISTS received_at TIMESTAMPTZ');
      await pool.query('ALTER TABLE supplier_invoice_emails ADD COLUMN IF NOT EXISTS suggested_amount NUMERIC(12,2)');
      await pool.query('ALTER TABLE supplier_invoice_emails ADD COLUMN IF NOT EXISTS doc_kind TEXT');
    })().catch((err) => {
      mailExpenseSchemaReady = null;
      throw err;
    });
  }
  return mailExpenseSchemaReady;
}

async function resolveSupplierDbId(slug) {
  if (!slug || slug === 'other') return null;
  try {
    const { resolveSupplierIdFromSlug, ensureKnownSuppliers } = await import('./suppliers-catalog.js');
    let id = await resolveSupplierIdFromSlug(slug);
    if (!id) {
      await ensureKnownSuppliers();
      id = await resolveSupplierIdFromSlug(slug);
    }
    return id;
  } catch {
    return null;
  }
}

function expenseDateFromMessage(msg) {
  const raw = msg.date || msg.internalDate;
  if (!raw) return new Date().toISOString().slice(0, 10);
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return new Date().toISOString().slice(0, 10);
  return d.toISOString().slice(0, 10);
}

/**
 * Crée (ou relie) une ligne expenses pour un courriel fournisseur.
 * Idempotent via gmail_message_id.
 */
export async function ensureExpenseForSupplierMail({
  gmailMessageId,
  amount,
  description,
  date,
  projectId = null,
  category = 'atelier',
  supplierSlug = null,
  paymentStatus = 'unpaid',
  mailFrom = null,
}) {
  await ensureMailExpenseSchema();
  const amt = Number(amount);
  if (!gmailMessageId || !Number.isFinite(amt) || amt <= 0) return null;

  const { rows: existingExp } = await pool.query(
    'SELECT id FROM expenses WHERE gmail_message_id = $1 LIMIT 1',
    [gmailMessageId]
  );
  if (existingExp[0]) {
    await pool.query(
      `UPDATE expenses SET
         amount = $1,
         description = COALESCE($2, description),
         payment_status = $3,
         project_id = COALESCE($4, project_id),
         mail_from = COALESCE($5, mail_from)
       WHERE id = $6`,
      [amt, description, paymentStatus, projectId, mailFrom, existingExp[0].id]
    );
    return existingExp[0].id;
  }

  const supplierDbId = await resolveSupplierDbId(supplierSlug);
  const { rows } = await pool.query(
    `INSERT INTO expenses (
       project_id, amount, category, description, date,
       source, gmail_message_id, payment_status, mail_from, supplier_id
     ) VALUES ($1,$2,$3,$4,$5::date,'email',$6,$7,$8,$9)
     RETURNING id`,
    [
      projectId,
      amt,
      category,
      description,
      date || new Date().toISOString().slice(0, 10),
      gmailMessageId,
      paymentStatus,
      mailFrom,
      supplierDbId,
    ]
  );
  return rows[0].id;
}

export async function ingestMessage(msg, { autoAssign = true, autoExpense = true } = {}) {
  const from = msg.from || '';
  const subject = msg.subject || '';
  const snippet = msg.snippet || '';
  const body = msg.body || '';
  const attachments = msg.attachments || [];

  if (!msg?.id) return null;
  if (!looksLikeSupplierInvoice(from, subject, snippet, { attachments })) return null;

  await ensureMailExpenseSchema();

  const supplier = detectSupplier(from, subject, snippet);
  const keywords = extractKeywords(subject, snippet, body);
  const supplierId = supplier?.id || 'other';
  const supplierLabel = supplier?.label || (from.split('<')[0].trim() || 'Fournisseur');
  const amount = extractMoneyAmount(subject, snippet, body);
  const docKind = mailDocKind({ subject, snippet, body, attachments });
  const payStatus = paymentStatusFromMail({ subject, snippet, body, attachments });

  const existing = await pool.query(
    'SELECT * FROM supplier_invoice_emails WHERE gmail_message_id = $1',
    [msg.id]
  );

  let match = null;
  if (autoAssign && !existing.rows[0]?.project_id) {
    match = await matchProjectFromRules(supplierId, keywords);
  }

  const suggestedProjectId = existing.rows[0]?.suggested_project_id || match?.project_id || null;
  const projectId = existing.rows[0]?.project_id || match?.project_id || null;
  let created = !existing.rows[0];
  let row = existing.rows[0] || null;

  const receivedAt = (() => {
    const d = msg.date ? new Date(msg.date) : new Date();
    return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
  })();

  if (!row) {
    try {
      const { rows } = await pool.query(
        `INSERT INTO supplier_invoice_emails (
          gmail_message_id, thread_id, subject, from_email, snippet,
          supplier_id, supplier_label, keywords, suggested_project_id,
          project_id, status, assigned_at, received_at, suggested_amount, doc_kind
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pending',NULL,$11,$12,$13)
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
          suggestedProjectId,
          projectId,
          receivedAt,
          amount,
          docKind,
        ]
      );
      row = rows[0];
    } catch (err) {
      if (err.code !== '23505') throw err;
      created = false;
      const again = await pool.query(
        'SELECT * FROM supplier_invoice_emails WHERE gmail_message_id = $1',
        [msg.id]
      );
      row = again.rows[0];
    }
  } else {
    const { rows } = await pool.query(
      `UPDATE supplier_invoice_emails SET
         suggested_amount = COALESCE($1, suggested_amount),
         doc_kind = COALESCE($2, doc_kind),
         suggested_project_id = COALESCE(suggested_project_id, $3),
         project_id = COALESCE(project_id, $4),
         snippet = COALESCE(NULLIF($5, ''), snippet)
       WHERE id = $6
       RETURNING *`,
      [amount, docKind, suggestedProjectId, projectId, snippet, row.id]
    );
    row = rows[0];
  }

  let expenseCreated = false;
  if (autoExpense && amount && !row.expense_id) {
    const expenseId = await ensureExpenseForSupplierMail({
      gmailMessageId: msg.id,
      amount,
      description: `${supplierLabel} — ${subject}`.slice(0, 240),
      date: expenseDateFromMessage(msg),
      projectId: row.project_id || null,
      category: row.project_id ? 'materiaux' : 'atelier',
      supplierSlug: supplierId,
      paymentStatus: payStatus,
      mailFrom: from,
    });
    if (expenseId) {
      expenseCreated = true;
      const nextStatus = row.project_id ? 'assigned' : 'pending';
      const { rows } = await pool.query(
        `UPDATE supplier_invoice_emails SET
           expense_id = $1,
           status = $2,
           assigned_at = CASE WHEN $2 = 'assigned' THEN COALESCE(assigned_at, NOW()) ELSE assigned_at END
         WHERE id = $3
         RETURNING *`,
        [expenseId, nextStatus, row.id]
      );
      row = rows[0];
    }
  } else if (row.expense_id && row.project_id && row.status === 'pending') {
    const { rows } = await pool.query(
      `UPDATE supplier_invoice_emails SET status = 'assigned', assigned_at = COALESCE(assigned_at, NOW())
       WHERE id = $1 RETURNING *`,
      [row.id]
    );
    row = rows[0];
  }

  if (match?.project_id && match.rule_id && created) {
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

  return {
    ...row,
    created,
    expense_created: expenseCreated,
    doc_kind: row.doc_kind || docKind,
    payment_status: payStatus,
  };
}

const SUPPLIER_SCAN_HINTS = [
  'facture', 'invoice', 'receipt', 'ticket', 'reçu', 'recu',
  'homedepot', 'rona', 'canac', 'renodepot', 'amazon', 'walmart', 'leevalley',
  '"order confirmation"', '"confirmation de commande"',
].join(' OR ');

export async function scanInboxForSupplierInvoices({ max = 80, year = null } = {}) {
  let ingested = 0;
  let pending = 0;
  let expensesCreated = 0;
  const errors = [];
  const y = year ? Number(year) : null;
  const q = y
    ? `after:${y}/01/01 before:${y + 1}/01/01 (${SUPPLIER_SCAN_HINTS})`
    : [
        'newer_than:90d',
        `(${SUPPLIER_SCAN_HINTS}`,
        'OR label:Tri/Compta_Facturation OR label:Tri/Compta_Factu OR label:Tri/Fournisseurs)',
      ].join(' ');
  const { messages } = await gmail.searchMessages(q, Math.min(Number(max) || 80, 120));

  for (const m of messages || []) {
    try {
      const full = (m.body || m.bodyHtml) ? m : await gmail.getMessage(m.id);
      const row = await ingestMessage(full);
      if (row) {
        if (row.created) ingested++;
        if (row.expense_created) expensesCreated++;
        if (row.status === 'pending') pending++;
      }
    } catch (err) {
      errors.push({ message_id: m.id, error: err.message });
    }
  }

  return {
    ingested,
    pending,
    expenses_created: expensesCreated,
    scanned: messages?.length || 0,
    errors,
    query: q,
  };
}

export function normalizeAssignProjectId(project_id) {
  if (project_id == null || project_id === '' || project_id === 'null' || project_id === 'none') {
    return null;
  }
  const n = Number(project_id);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export async function assignSupplierInvoice(id, {
  project_id,
  amount,
  category,
  description,
  remember_rule,
  keyword_pattern,
  already_paid,
}) {
  await ensureMailExpenseSchema();
  const { rows: existing } = await pool.query('SELECT * FROM supplier_invoice_emails WHERE id = $1', [id]);
  if (!existing[0]) throw new Error('Facture courriel introuvable');
  const inv = existing[0];
  const resolvedProjectId = normalizeAssignProjectId(project_id);
  const amt = Number(amount) > 0
    ? Number(amount)
    : (Number(inv.suggested_amount) > 0 ? Number(inv.suggested_amount) : null);

  const payStatus = already_paid
    ? 'paid'
    : paymentStatusFromMail({
      subject: inv.subject,
      snippet: inv.snippet,
      attachments: [],
    });

  let expenseId = inv.expense_id || null;
  if (already_paid && !amt && !expenseId) {
    throw new Error('Indiquez le montant pour enregistrer le ticket dans les dépenses.');
  }
  if (amt) {
    const desc = description || `${inv.supplier_label} — ${inv.subject}`;
    const expenseCategory = category || (resolvedProjectId ? 'materiaux' : 'atelier');
    expenseId = await ensureExpenseForSupplierMail({
      gmailMessageId: inv.gmail_message_id,
      amount: amt,
      description: desc,
      date: inv.received_at || new Date().toISOString().slice(0, 10),
      projectId: resolvedProjectId,
      category: expenseCategory,
      supplierSlug: inv.supplier_id,
      paymentStatus: payStatus,
      mailFrom: inv.from_email,
    });
  }

  // Sans montant : on mémorise le projet, mais on ne sort pas de la file
  // (sinon « classée » sans jamais apparaître dans Dépenses).
  const nextStatus = expenseId ? 'assigned' : 'pending';

  const { rows } = await pool.query(
    `UPDATE supplier_invoice_emails SET
      project_id = $1,
      status = $2,
      assigned_at = CASE WHEN $2 = 'assigned' THEN NOW() ELSE assigned_at END,
      expense_id = COALESCE($3, expense_id),
      suggested_amount = COALESCE($4, suggested_amount)
     WHERE id = $5 RETURNING *`,
    [resolvedProjectId, nextStatus, expenseId, amt, id]
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
    if (expenseId) {
      const { closeMailPayableTodoForMessage } = await import('./mail-invoice-todos.js');
      const reason = already_paid
        ? 'Ticket / facture enregistré en dépense (payé)'
        : (resolvedProjectId ? 'Facture classée sur un projet' : 'Facture classée en frais atelier');
      await closeMailPayableTodoForMessage(inv.gmail_message_id, reason, {
        supplierLabel: inv.supplier_label,
      });
    }
  } catch { /* todos optionnels */ }

  return rows[0];
}

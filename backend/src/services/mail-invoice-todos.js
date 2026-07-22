/**
 * Scan Gmail (reçues + envoyées) + factures ERP → todos admin
 * « À payer — facture Olive », « À recevoir — facture Phoenix », etc.
 */
import pool from '../db/pool.js';
import * as gmail from './google-gmail.js';
import { upsertBySource } from './admin-task-sync.js';
import {
  KNOWN_ALIASES,
  looksLikeInvoiceMail,
  classifyInvoiceKind,
  buildInvoiceTaskTitle,
  guessPersonFromMessage,
  matchCounterparty,
  norm,
} from './mail-invoice-classify.js';
import { mailMessageHref, resolveMailTaskHref } from './mail-deep-link.js';

export {
  KNOWN_ALIASES,
  looksLikeInvoiceMail,
  classifyInvoiceKind,
  buildInvoiceTaskTitle,
  guessPersonFromMessage,
  matchCounterparty,
  parseDisplayName,
  parseEmailAddress,
  personSlug,
  norm,
} from './mail-invoice-classify.js';

export { mailMessageHref, resolveMailTaskHref } from './mail-deep-link.js';

async function getOwnEmails() {
  const set = new Set(['neyafurniture@gmail.com', 'facturation@neyafurniture.ca']);
  try {
    const { getGoogleTokenRow } = await import('./google-oauth.js');
    const row = await getGoogleTokenRow();
    if (row?.account_email) set.add(String(row.account_email).toLowerCase());
  } catch { /* optional */ }
  try {
    const { getCompanyConfig } = await import('./company-config.js');
    const company = await getCompanyConfig();
    if (company?.email) set.add(String(company.email).toLowerCase());
  } catch { /* optional */ }
  return set;
}

async function loadPeopleDirectory() {
  const people = [];
  try {
    const { rows } = await pool.query(
      `SELECT name, email FROM employees WHERE active IS DISTINCT FROM false ORDER BY name`
    );
    for (const r of rows) people.push({ name: r.name, email: r.email, type: 'employee' });
  } catch { /* */ }
  try {
    const { rows } = await pool.query(
      `SELECT name, email FROM clients WHERE name IS NOT NULL ORDER BY LENGTH(name) DESC LIMIT 300`
    );
    for (const r of rows) people.push({ name: r.name, email: r.email, type: 'client' });
  } catch { /* */ }
  for (const a of KNOWN_ALIASES) {
    if (!people.some(p => norm(p.name) === norm(a.name))) {
      people.push({ name: a.name, email: null, type: 'alias' });
    }
  }
  return people;
}

function messageDueDate(msg) {
  const d = msg.date ? new Date(msg.date) : null;
  if (!d || Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

/** Corrige les todos mail existantes qui pointent seulement vers `/mail`. */
export async function backfillMailTodoDeepLinks() {
  const { rowCount } = await pool.query(`
    UPDATE admin_tasks
    SET link_href = '/mail?message=' || substring(source_key from '^mail_(?:payable|receivable)_(.+)$')
    WHERE source_key ~ '^mail_(payable|receivable)_'
      AND (
        link_href IS NULL
        OR link_href = '/mail'
        OR link_href NOT LIKE '/mail?message=%'
      )
  `);
  return rowCount || 0;
}

/**
 * Ferme la todo « À payer » liée à un message Gmail (facture fournisseur réglée / classée).
 * Optionnellement ferme aussi les todos ouvertes dont le titre cite le fournisseur.
 */
export async function closeMailPayableTodoForMessage(
  gmailMessageId,
  reason = 'Facture classée / réglée',
  { supplierLabel = null } = {}
) {
  const mid = String(gmailMessageId || '').trim();
  const note = `[auto] ${reason}`;
  const label = String(supplierLabel || '').trim();

  if (mid) {
    await pool.query(
      `UPDATE admin_tasks
       SET status = 'done',
           completed_at = COALESCE(completed_at, NOW()),
           notes = CASE
             WHEN notes IS NULL OR BTRIM(notes) = '' THEN $2
             WHEN notes LIKE '%' || $2 || '%' THEN notes
             ELSE notes || E'\\n' || $2
           END
       WHERE status != 'done'
         AND (
           source_key = $1
           OR source_key = 'mail_payable_' || $3
         )`,
      [`mail_payable_${mid}`, note, mid]
    );
  }

  if (label && !/^(fournisseur|other|autre)$/i.test(label)) {
    await pool.query(
      `UPDATE admin_tasks
       SET status = 'done',
           completed_at = COALESCE(completed_at, NOW()),
           notes = CASE
             WHEN notes IS NULL OR BTRIM(notes) = '' THEN $2
             WHEN notes LIKE '%' || $2 || '%' THEN notes
             ELSE notes || E'\\n' || $2
           END
       WHERE status != 'done'
         AND category = 'a_payer'
         AND title ILIKE $1`,
      [`%facture%${label}%`, note]
    );
  }

  return 1;
}

/**
 * Ferme les todos « À payer » dont la facture fournisseur est déjà classée / ignorée.
 */
export async function cleanupHandledSupplierPayableTodos() {
  const { rows } = await pool.query(`
    SELECT s.gmail_message_id, s.status, s.supplier_label
    FROM supplier_invoice_emails s
    WHERE s.status IN ('assigned', 'dismissed')
      AND s.gmail_message_id IS NOT NULL
  `);
  let closed = 0;
  for (const row of rows) {
    const reason = row.status === 'dismissed'
      ? `Facture ${row.supplier_label || 'fournisseur'} ignorée`
      : `Facture ${row.supplier_label || 'fournisseur'} classée / déjà payée`;
    await closeMailPayableTodoForMessage(row.gmail_message_id, reason, {
      supplierLabel: row.supplier_label,
    });
    closed += 1;
  }
  return closed;
}

/**
 * Ferme les todos « À payer » créées à tort pour des factures clients
 * (ex. DELFINE INVOICE = argent à recevoir, pas à payer).
 */
export async function cleanupClientMailPayableTodos(people = null) {
  const directory = people || await loadPeopleDirectory();
  const clients = directory.filter(p => p.type === 'client');
  if (!clients.length) return 0;

  const { rows } = await pool.query(`
    SELECT id, title, notes, source_key
    FROM admin_tasks
    WHERE status != 'done'
      AND (
        source_key LIKE 'mail_payable_%'
        OR (category = 'a_payer' AND title ILIKE 'À payer — facture%')
      )
  `);

  let closed = 0;
  for (const t of rows) {
    const hit = matchCounterparty({
      haystack: `${t.title || ''} ${t.notes || ''}`,
      people: clients,
      includeAliases: false,
    });
    if (!hit) continue;
    await pool.query(
      `UPDATE admin_tasks
       SET status = 'done',
           notes = CASE
             WHEN notes IS NULL OR BTRIM(notes) = '' THEN $2
             ELSE notes || E'\\n' || $2
           END
       WHERE id = $1`,
      [t.id, `[auto] Fermé : facture client (${hit}) — à recevoir, pas à payer.`]
    );
    closed += 1;
  }
  return closed;
}

/**
 * Crée/met à jour une todo admin pour un message facture Gmail.
 * Ne crée PAS de todo pour les factures clients (argent à recevoir) :
 * elles sont suivies via les factures ERP / revue projets.
 */
export async function upsertAdminTaskFromMailMessage(msg, {
  people = null,
  ownEmails = null,
} = {}) {
  if (!msg?.id) return null;
  if (!looksLikeInvoiceMail(msg)) return null;

  const own = ownEmails || await getOwnEmails();
  const directory = people || await loadPeopleDirectory();
  const kind = classifyInvoiceKind({
    labelIds: msg.labelIds,
    from: msg.from,
    to: msg.to,
    subject: msg.subject,
    snippet: msg.snippet,
    ownEmails: own,
    people: directory,
  });
  if (!kind) return null;

  // Facture fournisseur déjà classée / payée / ignorée → pas de nouvelle todo « À payer »
  if (kind === 'a_payer') {
    try {
      const { rows: handled } = await pool.query(
        `SELECT status FROM supplier_invoice_emails
         WHERE gmail_message_id = $1 AND status IN ('assigned', 'dismissed')
         LIMIT 1`,
        [msg.id]
      );
      if (handled[0]) {
        await closeMailPayableTodoForMessage(
          msg.id,
          handled[0].status === 'dismissed'
            ? 'Facture fournisseur ignorée'
            : 'Facture fournisseur déjà classée / payée'
        );
        return null;
      }
    } catch { /* table optionnelle au boot */ }
  }

  const person = guessPersonFromMessage(msg, kind, directory);
  const title = buildInvoiceTaskTitle(kind, person);
  const source_key = kind === 'a_recevoir'
    ? `mail_receivable_${msg.id}`
    : `mail_payable_${msg.id}`;

  const notes = [
    msg.subject ? `Objet : ${msg.subject}` : null,
    kind === 'a_payer' && msg.from ? `De : ${msg.from}` : null,
    kind === 'a_recevoir' && msg.to ? `À : ${msg.to}` : null,
    `Contrepartie : ${person}`,
  ].filter(Boolean).join('\n');

  const result = await upsertBySource({
    source_key,
    title,
    category: kind,
    link_href: mailMessageHref(msg.id),
    due_date: messageDueDate(msg),
    notes,
    priority_tier: kind === 'a_payer' ? 'p1' : 'p2',
  });

  return {
    ...result,
    kind,
    person,
    title,
    source_key,
    message_id: msg.id,
  };
}

async function syncErpSentInvoices(created) {
  const { rows } = await pool.query(`
    SELECT i.id, i.invoice_number, i.due_date, i.total, i.amount_paid, i.status,
           c.name AS client_name
    FROM invoices i
    LEFT JOIN clients c ON c.id = i.client_id
    WHERE i.status IN ('sent', 'overdue', 'partial')
       OR (
         i.status NOT IN ('draft', 'cancelled', 'paid', 'void')
         AND COALESCE(i.amount_paid, 0) < COALESCE(i.total, 0)
         AND i.status <> 'draft'
       )
    ORDER BY i.created_at DESC
    LIMIT 40
  `);

  for (const inv of rows) {
    const paid = Number(inv.amount_paid) || 0;
    const total = Number(inv.total) || 0;
    if (inv.status === 'paid' || (total > 0 && paid >= total)) continue;
    const who = inv.client_name || inv.invoice_number || `#${inv.id}`;
    const r = await upsertBySource({
      source_key: `invoice_receivable_${inv.id}`,
      title: buildInvoiceTaskTitle('a_recevoir', who),
      category: 'a_recevoir',
      link_href: `/invoices/${inv.id}`,
      due_date: inv.due_date || null,
      notes: `Facture ERP ${inv.invoice_number || `#${inv.id}`} — ${total}$ (payé ${paid}$)`,
      priority_tier: 'p1',
    });
    if (r?.inserted) created.push(r.id);
  }
}

/**
 * Scan Gmail + factures ERP → todos À payer / À recevoir.
 */
export async function scanMailInvoicesToAdminTasks({ days = 30, max = 50 } = {}) {
  const created = [];
  const classified = [];
  const errors = [];
  try {
    await backfillMailTodoDeepLinks();
  } catch (err) {
    errors.push({ stage: 'backfill_links', error: err.message });
  }
  const ownEmails = await getOwnEmails();
  const people = await loadPeopleDirectory();

  let cleaned = 0;
  let cleanedHandled = 0;
  try {
    cleaned = await cleanupClientMailPayableTodos(people);
  } catch (err) {
    errors.push({ stage: 'cleanup_client_payables', error: err.message });
  }
  try {
    cleanedHandled = await cleanupHandledSupplierPayableTodos();
  } catch (err) {
    errors.push({ stage: 'cleanup_handled_supplier_payables', error: err.message });
  }

  const q = `newer_than:${Math.max(1, Number(days) || 30)}d (facture OR invoice OR facturation OR receipt OR reçu OR "à payer")`;
  let messages = [];
  try {
    const result = await gmail.searchMessages(q, Math.min(Number(max) || 50, 80));
    messages = result.messages || [];
  } catch (err) {
    errors.push({ stage: 'search', error: err.message });
  }

  for (const m of messages) {
    try {
      const full = m.body != null || m.labelIds ? m : await gmail.getMessage(m.id);
      const row = await upsertAdminTaskFromMailMessage(full, { people, ownEmails });
      if (row) {
        classified.push(row);
        if (row.inserted) created.push(row.id);
      }
    } catch (err) {
      errors.push({ message_id: m.id, error: err.message });
    }
  }

  try {
    await syncErpSentInvoices(created);
  } catch (err) {
    errors.push({ stage: 'erp_invoices', error: err.message });
  }

  const payable = classified.filter(c => c.kind === 'a_payer').length;
  const receivable = classified.filter(c => c.kind === 'a_recevoir').length;

  return {
    scanned: messages.length,
    classified: classified.length,
    created: created.length,
    cleaned_client_payables: cleaned,
    cleaned_handled_supplier_payables: cleanedHandled,
    payable,
    receivable,
    tasks: classified,
    errors,
  };
}

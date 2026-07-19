import pool from '../db/pool.js';
import * as gmail from './google-gmail.js';
import {
  looksLikeSupplierInvoice,
  detectSupplier,
  extractKeywords,
  matchProjectFromRules,
} from './invoice-email-router.js';

const SUPPLIER_QUERY_HINTS = [
  'facture', 'invoice', 'receipt', 'reçu', 'recu',
  'homedepot', 'rona', 'canac', 'renodepot', 'amazon',
  'order confirmation', 'confirmation de commande',
  'votre commande', 'your order', 'purchase',
].join(' OR ');

/** Extrait un montant CAD approximatif du texte mail. */
export function extractMoneyAmount(...parts) {
  const blob = parts.filter(Boolean).join('\n');
  if (!blob) return null;
  const patterns = [
    /(?:total|montant|amount|grand\s*total|balance\s*due|sous[- ]?total)[^\d]{0,20}(\d{1,3}(?:[ ,]\d{3})*[.,]\d{2}|\d+[.,]\d{2})/i,
    /\$\s*(\d{1,3}(?:[ ,]\d{3})*[.,]\d{2}|\d+[.,]\d{2})/,
    /(\d{1,3}(?:[ ,]\d{3})*[.,]\d{2}|\d+[.,]\d{2})\s*(?:\$|cad|CAD)/,
  ];
  for (const re of patterns) {
    const m = blob.match(re);
    if (!m?.[1]) continue;
    let raw = String(m[1]).replace(/\s/g, '');
    if (/^\d{1,3}(\.\d{3})+(,\d{2})$/.test(raw)) {
      raw = raw.replace(/\./g, '').replace(',', '.');
    } else if (/,\d{2}$/.test(raw) && !raw.includes('.')) {
      raw = raw.replace(',', '.');
    } else {
      raw = raw.replace(/,/g, '');
    }
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0 && n < 500000) return Math.round(n * 100) / 100;
  }
  return null;
}

function parseEmailDate(dateHeader) {
  if (!dateHeader) return null;
  const d = new Date(dateHeader);
  return Number.isNaN(d.getTime()) ? null : d;
}

function toDateOnly(d) {
  if (!d) return new Date().toISOString().slice(0, 10);
  return new Date(d).toISOString().slice(0, 10);
}

async function ensureSupplierInvoiceColumns() {
  await pool.query('ALTER TABLE supplier_invoice_emails ADD COLUMN IF NOT EXISTS received_at TIMESTAMPTZ');
  await pool.query('ALTER TABLE supplier_invoice_emails ADD COLUMN IF NOT EXISTS suggested_amount NUMERIC(12,2)');
}

async function searchGmailPaged(query, max = 80) {
  const all = [];
  let pageToken = null;
  while (all.length < max) {
    const batch = Math.min(40, max - all.length);
    const { messages, nextPageToken } = await gmail.listMessages({
      q: query,
      max: batch,
      label: null,
      pageToken,
    });
    all.push(...(messages || []));
    if (!nextPageToken) break;
    pageToken = nextPageToken;
  }
  return all;
}

/**
 * Scanne Gmail pour les factures fournisseurs d’une année et crée des dépenses
 * quand un montant est détecté.
 */
export async function importSupplierInvoicesForYear({
  year = new Date().getFullYear(),
  max = 80,
  autoExpense = true,
} = {}) {
  await ensureSupplierInvoiceColumns();
  const y = Number(year) || new Date().getFullYear();
  const q = `after:${y}/01/01 before:${y + 1}/01/01 (${SUPPLIER_QUERY_HINTS})`;

  let scanned = 0;
  let ingested = 0;
  let expensesCreated = 0;
  let skipped = 0;
  let withoutAmount = 0;
  const errors = [];
  const created = [];

  let messages = [];
  try {
    messages = await searchGmailPaged(q, Math.min(Number(max) || 80, 150));
  } catch (err) {
    throw new Error(`Gmail indisponible : ${err.message}. Connectez Google dans Paramètres → Intégrations.`);
  }

  for (const m of messages) {
    scanned += 1;
    try {
      const full = m.body || m.bodyHtml ? m : await gmail.getMessage(m.id);
      if (!looksLikeSupplierInvoice(full.from, full.subject, full.snippet)) {
        skipped += 1;
        continue;
      }

      const amount = extractMoneyAmount(full.subject, full.snippet, full.body);
      const receivedAt = parseEmailDate(full.date) || new Date();
      const supplier = detectSupplier(full.from, full.subject, full.snippet);
      const keywords = extractKeywords(full.subject, full.snippet, full.body);

      const existing = await pool.query(
        'SELECT id, expense_id, suggested_amount FROM supplier_invoice_emails WHERE gmail_message_id = $1',
        [full.id]
      );

      let rowId = existing.rows[0]?.id || null;
      let expenseId = existing.rows[0]?.expense_id || null;

      if (!rowId) {
        const match = await matchProjectFromRules(supplier?.id || 'other', keywords);
        const { rows } = await pool.query(
          `INSERT INTO supplier_invoice_emails (
            gmail_message_id, thread_id, subject, from_email, snippet,
            supplier_id, supplier_label, keywords, suggested_project_id,
            project_id, status, assigned_at, received_at, suggested_amount
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
          RETURNING *`,
          [
            full.id,
            full.threadId || null,
            full.subject,
            full.from,
            full.snippet,
            supplier?.id || 'other',
            supplier?.label || 'Fournisseur',
            JSON.stringify(keywords),
            match?.project_id || null,
            match?.project_id || null,
            match?.project_id ? 'assigned' : 'pending',
            match?.project_id ? new Date() : null,
            receivedAt.toISOString(),
            amount,
          ]
        );
        rowId = rows[0].id;
        ingested += 1;
      } else {
        await pool.query(
          `UPDATE supplier_invoice_emails SET
             received_at = COALESCE(received_at, $1),
             suggested_amount = COALESCE($2, suggested_amount)
           WHERE id = $3`,
          [receivedAt.toISOString(), amount, rowId]
        );
        skipped += 1;
      }

      if (expenseId) continue;

      if (!amount || !autoExpense) {
        if (!amount) withoutAmount += 1;
        continue;
      }

      // Anti-doublon : même montant + même jour + même fournisseur déjà en dépense
      const dateOnly = toDateOnly(receivedAt);
      const supplierLabel = supplier?.label || 'Fournisseur';
      const { rows: dup } = await pool.query(
        `SELECT id FROM expenses
         WHERE date = $1::date
           AND ABS(amount - $2) < 0.02
           AND description ILIKE $3
         LIMIT 1`,
        [dateOnly, amount, `%${supplierLabel}%`]
      );
      if (dup[0]) {
        await pool.query(
          `UPDATE supplier_invoice_emails SET expense_id = $1, status = 'assigned', assigned_at = COALESCE(assigned_at, NOW())
           WHERE id = $2`,
          [dup[0].id, rowId]
        );
        continue;
      }

      const desc = `${supplierLabel} — ${full.subject || 'Facture'}`.slice(0, 240);
      const { rows: invRow } = await pool.query(
        'SELECT project_id FROM supplier_invoice_emails WHERE id = $1',
        [rowId]
      );
      const { rows: exp } = await pool.query(
        `INSERT INTO expenses (project_id, amount, category, description, date)
         VALUES ($1,$2,'materiaux',$3,$4::date) RETURNING *`,
        [invRow[0]?.project_id || null, amount, desc, dateOnly]
      );
      expenseId = exp[0].id;
      await pool.query(
        `UPDATE supplier_invoice_emails
         SET expense_id = $1, status = 'assigned', assigned_at = COALESCE(assigned_at, NOW())
         WHERE id = $2`,
        [expenseId, rowId]
      );
      expensesCreated += 1;
      created.push({
        expense_id: expenseId,
        amount,
        date: dateOnly,
        supplier: supplierLabel,
        subject: full.subject,
      });
    } catch (err) {
      errors.push({ message_id: m.id, error: err.message });
    }
  }

  return {
    year: y,
    query: q,
    scanned,
    ingested,
    expenses_created: expensesCreated,
    without_amount: withoutAmount,
    skipped,
    errors,
    created,
  };
}

/**
 * Passe les factures clients émises (non brouillon) en gains Finance,
 * et pousse les brouillons déjà « envoyés » / payés.
 */
export async function syncIssuedInvoicesToGains({ year = new Date().getFullYear() } = {}) {
  const y = Number(year) || new Date().getFullYear();

  // Brouillons avec paiement → paid / partially_paid
  const { rows: draftsWithPay } = await pool.query(
    `UPDATE invoices i SET
       status = CASE
         WHEN COALESCE(i.amount_paid, 0) >= i.total AND i.total > 0 THEN 'paid'
         WHEN COALESCE(i.amount_paid, 0) > 0 THEN 'partially_paid'
         ELSE i.status
       END
     WHERE EXTRACT(YEAR FROM i.created_at) = $1
       AND i.status = 'draft'
       AND COALESCE(i.amount_paid, 0) > 0
     RETURNING i.id, i.invoice_number, i.total, i.amount_paid, i.status`,
    [y]
  );

  // Stats gains (même logique que monthly-pnl)
  const { rows: issued } = await pool.query(
    `SELECT id, invoice_number, status, total::float, amount_paid::float, created_at,
            (SELECT name FROM clients c WHERE c.id = invoices.client_id) AS client_name
     FROM invoices
     WHERE EXTRACT(YEAR FROM created_at) = $1
       AND status != 'draft'
     ORDER BY created_at DESC`,
    [y]
  );

  const { rows: drafts } = await pool.query(
    `SELECT COUNT(*)::int AS c, COALESCE(SUM(total),0)::float AS total
     FROM invoices
     WHERE EXTRACT(YEAR FROM created_at) = $1 AND status = 'draft'`,
    [y]
  );

  const revenueInvoiced = issued.reduce((s, r) => s + Number(r.total || 0), 0);
  const revenueCollected = issued.reduce((s, r) => s + Number(r.amount_paid || 0), 0);

  // Marketplace déjà bookées = déjà des factures payées
  const { rows: mkt } = await pool.query(
    `SELECT COUNT(*)::int AS c, COALESCE(SUM(amount),0)::float AS gross
     FROM marketplace_sales
     WHERE EXTRACT(YEAR FROM sold_at) = $1 AND invoice_id IS NOT NULL`,
    [y]
  );

  return {
    year: y,
    drafts_promoted: draftsWithPay.length,
    promoted: draftsWithPay,
    issued_count: issued.length,
    issued,
    drafts_remaining: drafts[0]?.c || 0,
    drafts_total: drafts[0]?.total || 0,
    revenue_invoiced: Math.round(revenueInvoiced * 100) / 100,
    revenue_collected: Math.round(revenueCollected * 100) / 100,
    marketplace_booked: mkt[0] || { c: 0, gross: 0 },
    note: 'Les factures non-brouillon apparaissent dans Finance (gains facturés / encaissés). Les brouillons restent hors gains jusqu’à envoi ou paiement.',
  };
}

/** Importe les commandes site (web_orders) 2026 en ventes marketplace + compta. */
export async function syncWebOrdersToMarketplace({ year = new Date().getFullYear(), book = true } = {}) {
  const y = Number(year) || new Date().getFullYear();
  const { rows: orders } = await pool.query(
    `SELECT * FROM web_orders
     WHERE EXTRACT(YEAR FROM COALESCE(synced_at, created_at)) = $1
     ORDER BY COALESCE(synced_at, created_at) DESC
     LIMIT 200`
  ).catch(() => ({ rows: [] }));

  const { bookMarketplaceSale } = await import('./marketplace-compta.js');
  let created = 0;
  let booked = 0;
  let skipped = 0;
  const errors = [];

  for (const o of orders) {
    const ref = String(o.order_number || o.wp_order_id || o.id);
    const { rows: existing } = await pool.query(
      `SELECT id, invoice_id FROM marketplace_sales WHERE order_ref = $1 OR order_ref = $2 LIMIT 1`,
      [ref, `woo-${o.wp_order_id}`]
    );
    if (existing[0]) {
      skipped += 1;
      continue;
    }

    const amount = Number(o.total) || 0;
    if (amount <= 0) {
      skipped += 1;
      continue;
    }

    const soldAt = toDateOnly(o.synced_at || o.created_at);
    try {
      const { rows } = await pool.query(
        `INSERT INTO marketplace_sales (
           sold_at, channel, product_name, buyer_name, amount, fees, order_ref, notes, payment_method,
           project_id, client_id
         ) VALUES ($1::date,'site',$2,$3,$4,0,$5,$6,'card',$7,$8)
         RETURNING *`,
        [
          soldAt,
          `Commande web #${ref}`,
          o.customer_name || null,
          amount,
          `woo-${o.wp_order_id || ref}`,
          `Import site — statut ${o.status || '—'}`,
          o.project_id || null,
          o.client_id || null,
        ]
      );
      created += 1;
      if (book) {
        try {
          await bookMarketplaceSale(rows[0].id);
          booked += 1;
        } catch (err) {
          errors.push({ order: ref, error: err.message });
        }
      }
    } catch (err) {
      errors.push({ order: ref, error: err.message });
    }
  }

  return {
    year: y,
    orders_found: orders.length,
    sales_created: created,
    booked,
    skipped,
    errors,
  };
}

// Ré-export utilitaire
export { looksLikeSupplierInvoice };

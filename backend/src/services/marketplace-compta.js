/**
 * Inscription compta d'une vente marketplace → facture payée (+ frais en dépense).
 */
import pool from '../db/pool.js';
import { nextInvoiceNumber } from './invoice-helpers.js';

const CHANNEL_LABELS = {
  etsy: 'Etsy',
  amazon: 'Amazon',
  facebook: 'Facebook Marketplace',
  kijiji: 'Kijiji',
  lespac: 'LesPAC',
  site: 'Site neyafurniture.ca',
  showroom: 'Showroom / atelier',
  autre: 'Autre',
};

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function channelLabel(channel) {
  return CHANNEL_LABELS[channel] || channel || 'Autre';
}

/** Normalise DATE / Date / string → YYYY-MM-DD */
function toDateOnly(value) {
  if (!value) return new Date().toISOString().slice(0, 10);
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const s = String(value);
  const m = s.match(/(\d{4}-\d{2}-\d{2})/);
  if (m) return m[1];
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return new Date().toISOString().slice(0, 10);
}

async function resolveMarketplaceClient(client, { clientId, buyerName, channel }) {
  if (clientId) return Number(clientId);
  const label = channelLabel(channel);
  const name = String(buyerName || '').trim() || `Marketplace — ${label}`;
  const { rows } = await client.query(
    'SELECT id FROM clients WHERE LOWER(name) = LOWER($1) LIMIT 1',
    [name]
  );
  if (rows[0]) return rows[0].id;
  const { rows: created } = await client.query(
    `INSERT INTO clients (name, notes)
     VALUES ($1, $2)
     RETURNING id`,
    [name, `Acheteur marketplace (${label})`]
  );
  return created[0].id;
}

/**
 * Crée facture payée + paiement (+ dépense frais) pour une vente marketplace.
 * @returns {{ invoice, payment, expense, client_id }}
 */
export async function bookMarketplaceSale(sale, opts = {}) {
  const amount = round2(sale.amount);
  if (!(amount > 0)) {
    throw new Error('Montant requis pour inscrire en compta');
  }

  const soldAt = toDateOnly(sale.sold_at);
  const channel = sale.channel || 'autre';
  const product = String(sale.product_name || 'Vente marketplace').trim();
  const fees = round2(sale.fees);
  const paymentMethod = opts.payment_method || sale.payment_method || 'interac';
  const includeFeesExpense = opts.book_fees !== false && fees > 0;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const clientId = await resolveMarketplaceClient(client, {
      clientId: sale.client_id || opts.client_id,
      buyerName: sale.buyer_name,
      channel,
    });

    const invoiceNumber = await nextInvoiceNumber();
    const chLabel = channelLabel(channel);
    const title = `Vente ${chLabel} — ${product}`;
    const notesParts = [
      `Vente marketplace (${chLabel})`,
      sale.order_ref ? `Réf. ${sale.order_ref}` : null,
      sale.notes || null,
    ].filter(Boolean);

    const lines = [{ description: product, qty: 1, price: amount }];
    // Montant encaissé = total (taxes incluses / vente particulière — pas de TPS/TVQ séparées)
    const { rows: invRows } = await client.query(
      `INSERT INTO invoices (
         project_id, client_id, invoice_number, status, lines,
         subtotal, tax_rate, total, amount_paid, due_date, notes, title, terms, reference, created_at
       ) VALUES (
         $1,$2,$3,'paid',$4,
         $5,0,$5,$5,$6,$7,$8,'Payé',$9,$10::timestamptz
       ) RETURNING *`,
      [
        sale.project_id || null,
        clientId,
        invoiceNumber,
        JSON.stringify(lines),
        amount,
        soldAt,
        notesParts.join(' · '),
        title,
        `MP-${channel}`,
        `${soldAt}T12:00:00`,
      ]
    );
    const invoice = invRows[0];

    const { rows: payRows } = await client.query(
      `INSERT INTO payments (invoice_id, amount, method, notes, date)
       VALUES ($1,$2,$3,$4,$5::timestamptz)
       RETURNING *`,
      [
        invoice.id,
        amount,
        paymentMethod,
        `Encaissement marketplace ${chLabel}`,
        `${soldAt}T12:00:00`,
      ]
    );
    const payment = payRows[0];

    let expense = null;
    if (includeFeesExpense) {
      const { rows: expRows } = await client.query(
        `INSERT INTO expenses (project_id, amount, category, description, date)
         VALUES ($1,$2,'frais',$3,$4)
         RETURNING *`,
        [
          sale.project_id || null,
          fees,
          `Frais ${chLabel} — ${product}`,
          soldAt,
        ]
      );
      expense = expRows[0];
    }

    await client.query('COMMIT');
    return { invoice, payment, expense, client_id: clientId };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

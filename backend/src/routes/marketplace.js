import { Router } from 'express';
import pool from '../db/pool.js';
import { bookMarketplaceSale } from '../services/marketplace-compta.js';

const router = Router();

export const MARKETPLACE_CHANNELS = [
  { value: 'etsy', label: 'Etsy' },
  { value: 'amazon', label: 'Amazon' },
  { value: 'facebook', label: 'Facebook Marketplace' },
  { value: 'kijiji', label: 'Kijiji' },
  { value: 'lespac', label: 'LesPAC' },
  { value: 'site', label: 'Site neyafurniture.ca' },
  { value: 'showroom', label: 'Showroom / atelier' },
  { value: 'autre', label: 'Autre' },
];

async function ensureTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS marketplace_sales (
      id SERIAL PRIMARY KEY,
      sold_at DATE NOT NULL DEFAULT CURRENT_DATE,
      channel TEXT NOT NULL DEFAULT 'autre',
      product_name TEXT NOT NULL,
      buyer_name TEXT,
      amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      fees NUMERIC(12,2) NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'CAD',
      order_ref TEXT,
      notes TEXT,
      project_id INT REFERENCES projects(id) ON DELETE SET NULL,
      client_id INT REFERENCES clients(id) ON DELETE SET NULL,
      created_by INT REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_marketplace_sales_sold_at ON marketplace_sales(sold_at DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_marketplace_sales_channel ON marketplace_sales(channel)`);
  await pool.query('ALTER TABLE marketplace_sales ADD COLUMN IF NOT EXISTS invoice_id INT REFERENCES invoices(id) ON DELETE SET NULL');
  await pool.query('ALTER TABLE marketplace_sales ADD COLUMN IF NOT EXISTS payment_id INT REFERENCES payments(id) ON DELETE SET NULL');
  await pool.query('ALTER TABLE marketplace_sales ADD COLUMN IF NOT EXISTS expense_id INT REFERENCES expenses(id) ON DELETE SET NULL');
  await pool.query('ALTER TABLE marketplace_sales ADD COLUMN IF NOT EXISTS payment_method TEXT');
}

let ready;
function readyTables() {
  if (!ready) ready = ensureTables();
  return ready;
}

router.get('/channels', async (_req, res) => {
  res.json(MARKETPLACE_CHANNELS);
});

router.get('/summary', async (req, res) => {
  try {
    await readyTables();
    const { from, to } = req.query;
    const params = [];
    let where = 'WHERE 1=1';
    if (from) { params.push(from); where += ` AND sold_at >= $${params.length}`; }
    if (to) { params.push(to); where += ` AND sold_at <= $${params.length}`; }

    const { rows: byChannel } = await pool.query(
      `SELECT channel,
              COUNT(*)::int AS count,
              COALESCE(SUM(amount), 0)::float AS gross,
              COALESCE(SUM(fees), 0)::float AS fees,
              COALESCE(SUM(amount - fees), 0)::float AS net
       FROM marketplace_sales ${where}
       GROUP BY channel
       ORDER BY gross DESC`,
      params
    );
    const { rows: totals } = await pool.query(
      `SELECT COUNT(*)::int AS count,
              COALESCE(SUM(amount), 0)::float AS gross,
              COALESCE(SUM(fees), 0)::float AS fees,
              COALESCE(SUM(amount - fees), 0)::float AS net
       FROM marketplace_sales ${where}`,
      params
    );
    res.json({ by_channel: byChannel, totals: totals[0] || { count: 0, gross: 0, fees: 0, net: 0 } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/', async (req, res) => {
  try {
    await readyTables();
    const { channel, from, to, limit } = req.query;
    const params = [];
    let where = 'WHERE 1=1';
    if (channel) { params.push(channel); where += ` AND s.channel = $${params.length}`; }
    if (from) { params.push(from); where += ` AND s.sold_at >= $${params.length}`; }
    if (to) { params.push(to); where += ` AND s.sold_at <= $${params.length}`; }
    const lim = Math.min(Number(limit) || 200, 500);
    params.push(lim);

    const { rows } = await pool.query(
      `SELECT s.*, p.name AS project_name, c.name AS client_name,
              i.invoice_number
       FROM marketplace_sales s
       LEFT JOIN projects p ON p.id = s.project_id
       LEFT JOIN clients c ON c.id = s.client_id
       LEFT JOIN invoices i ON i.id = s.invoice_id
       ${where}
       ORDER BY s.sold_at DESC, s.id DESC
       LIMIT $${params.length}`,
      params
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    await readyTables();
    const {
      sold_at, channel, product_name, buyer_name, amount, fees,
      currency, order_ref, notes, project_id, client_id,
      payment_method, book_accounting, book_fees,
    } = req.body || {};
    if (!product_name?.trim()) {
      return res.status(400).json({ error: 'product_name requis' });
    }
    const amt = Number(amount) || 0;
    const feeAmt = Number(fees) || 0;
    const wantCompta = book_accounting !== false && book_accounting !== 'false';

    const { rows } = await pool.query(
      `INSERT INTO marketplace_sales
        (sold_at, channel, product_name, buyer_name, amount, fees, currency, order_ref, notes,
         project_id, client_id, payment_method, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING *`,
      [
        sold_at || new Date().toISOString().slice(0, 10),
        channel || 'autre',
        product_name.trim(),
        buyer_name || null,
        amt,
        feeAmt,
        currency || 'CAD',
        order_ref || null,
        notes || null,
        project_id || null,
        client_id || null,
        payment_method || 'interac',
        req.user?.id || null,
      ]
    );
    let sale = rows[0];

    if (wantCompta && amt > 0) {
      const booked = await bookMarketplaceSale(sale, {
        payment_method: payment_method || 'interac',
        book_fees: book_fees !== false && book_fees !== 'false',
      });
      const { rows: updated } = await pool.query(
        `UPDATE marketplace_sales SET
           invoice_id = $1,
           payment_id = $2,
           expense_id = $3,
           client_id = COALESCE(client_id, $4),
           updated_at = NOW()
         WHERE id = $5
         RETURNING *`,
        [
          booked.invoice.id,
          booked.payment.id,
          booked.expense?.id || null,
          booked.client_id,
          sale.id,
        ]
      );
      sale = updated[0];
      sale.invoice_number = booked.invoice.invoice_number;
      sale.accounting = {
        invoice_id: booked.invoice.id,
        invoice_number: booked.invoice.invoice_number,
        payment_id: booked.payment.id,
        expense_id: booked.expense?.id || null,
      };
    }

    res.status(201).json(sale);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Relancer la compta sur une vente déjà notée sans facture. */
router.post('/:id/book', async (req, res) => {
  try {
    await readyTables();
    const { rows: existing } = await pool.query('SELECT * FROM marketplace_sales WHERE id = $1', [req.params.id]);
    if (!existing[0]) return res.status(404).json({ error: 'Vente introuvable' });
    if (existing[0].invoice_id) {
      return res.status(400).json({ error: 'Cette vente a déjà une facture en compta' });
    }
    const booked = await bookMarketplaceSale(existing[0], {
      payment_method: req.body?.payment_method || existing[0].payment_method || 'interac',
      book_fees: req.body?.book_fees !== false,
    });
    const { rows } = await pool.query(
      `UPDATE marketplace_sales SET
         invoice_id = $1, payment_id = $2, expense_id = $3,
         client_id = COALESCE(client_id, $4), updated_at = NOW()
       WHERE id = $5 RETURNING *`,
      [booked.invoice.id, booked.payment.id, booked.expense?.id || null, booked.client_id, req.params.id]
    );
    res.json({
      ...rows[0],
      invoice_number: booked.invoice.invoice_number,
      accounting: {
        invoice_id: booked.invoice.id,
        invoice_number: booked.invoice.invoice_number,
        payment_id: booked.payment.id,
        expense_id: booked.expense?.id || null,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    await readyTables();
    const { rows: existing } = await pool.query('SELECT * FROM marketplace_sales WHERE id = $1', [req.params.id]);
    if (!existing[0]) return res.status(404).json({ error: 'Vente introuvable' });
    const t = { ...existing[0], ...req.body };
    const { rows } = await pool.query(
      `UPDATE marketplace_sales SET
         sold_at=$1, channel=$2, product_name=$3, buyer_name=$4, amount=$5, fees=$6,
         currency=$7, order_ref=$8, notes=$9, project_id=$10, client_id=$11,
         payment_method=$12, updated_at=NOW()
       WHERE id=$13 RETURNING *`,
      [
        t.sold_at, t.channel, t.product_name, t.buyer_name,
        Number(t.amount) || 0, Number(t.fees) || 0,
        t.currency || 'CAD', t.order_ref, t.notes,
        t.project_id || null, t.client_id || null,
        t.payment_method || null, req.params.id,
      ]
    );
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await readyTables();
    await pool.query('DELETE FROM marketplace_sales WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;

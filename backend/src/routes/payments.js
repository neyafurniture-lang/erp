import { Router } from 'express';
import pool from '../db/pool.js';

const router = Router();

async function updateInvoiceStatus(invoiceId) {
  const { rows } = await pool.query('SELECT total, amount_paid FROM invoices WHERE id = $1', [invoiceId]);
  if (!rows[0]) return;
  const { total, amount_paid } = rows[0];
  let status = 'sent';
  if (amount_paid >= total) status = 'paid';
  else if (amount_paid > 0) status = 'partially_paid';
  const { rows: inv } = await pool.query('SELECT due_date, status FROM invoices WHERE id = $1', [invoiceId]);
  if (inv[0]?.due_date && new Date(inv[0].due_date) < new Date() && status !== 'paid') status = 'overdue';
  await pool.query('UPDATE invoices SET status = $1 WHERE id = $2', [status, invoiceId]);
}

router.get('/', async (req, res) => {
  try {
    const { invoice_id } = req.query;
    let query = 'SELECT p.*, i.invoice_number FROM payments p LEFT JOIN invoices i ON i.id = p.invoice_id';
    const params = [];
    if (invoice_id) { params.push(invoice_id); query += ` WHERE p.invoice_id = $1`; }
    query += ' ORDER BY p.date DESC';
    const { rows } = await pool.query(query, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { invoice_id, amount, method, notes, date } = req.body;
    const { rows } = await client.query(
      'INSERT INTO payments (invoice_id, amount, method, notes, date) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [invoice_id, amount, method || 'transfer', notes, date || new Date()]
    );
    await client.query(
      'UPDATE invoices SET amount_paid = amount_paid + $1 WHERE id = $2',
      [amount, invoice_id]
    );
    await client.query('COMMIT');
    await updateInvoiceStatus(invoice_id);
    res.status(201).json(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

export default router;

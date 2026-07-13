import { Router } from 'express';
import pool from '../db/pool.js';

const router = Router();

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

async function syncInvoicePaid(client, invoiceId) {
  const { rows } = await client.query(
    `UPDATE invoices SET amount_paid = (
       SELECT COALESCE(SUM(amount), 0) FROM payments WHERE invoice_id = $1
     )
     WHERE id = $1
     RETURNING id, total, amount_paid, status, due_date, invoice_number`,
    [invoiceId]
  );
  return rows[0];
}

async function updateInvoiceStatus(invoiceId, client = pool) {
  const { rows } = await client.query(
    'SELECT total, amount_paid, due_date FROM invoices WHERE id = $1',
    [invoiceId]
  );
  if (!rows[0]) return;
  const total = round2(rows[0].total);
  const amount_paid = round2(rows[0].amount_paid);
  let status = 'sent';
  if (amount_paid >= total && total > 0) status = 'paid';
  else if (amount_paid > 0) status = 'partially_paid';
  if (rows[0].due_date && new Date(rows[0].due_date) < new Date() && status !== 'paid') {
    status = 'overdue';
  }
  await client.query('UPDATE invoices SET status = $1 WHERE id = $2', [status, invoiceId]);
}

router.get('/', async (req, res) => {
  try {
    const { invoice_id } = req.query;
    let query = 'SELECT p.*, i.invoice_number FROM payments p LEFT JOIN invoices i ON i.id = p.invoice_id';
    const params = [];
    if (invoice_id) {
      params.push(invoice_id);
      query += ' WHERE p.invoice_id = $1';
    }
    query += ' ORDER BY p.date DESC, p.id DESC';
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
    const amt = round2(amount);
    if (!invoice_id) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'invoice_id requis' });
    }
    if (!(amt > 0)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Montant invalide' });
    }

    const { rows: invRows } = await client.query(
      'SELECT id, total, amount_paid, invoice_number FROM invoices WHERE id = $1 FOR UPDATE',
      [invoice_id]
    );
    if (!invRows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Facture introuvable' });
    }

    const balance = round2(Number(invRows[0].total) - Number(invRows[0].amount_paid));
    if (amt > balance + 0.009) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: `Montant supérieur au solde dû (${balance.toFixed(2)} $)`,
      });
    }

    const { rows } = await client.query(
      `INSERT INTO payments (invoice_id, amount, method, notes, date)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [invoice_id, amt, method || 'interac', notes || null, date || new Date()]
    );

    const invoice = await syncInvoicePaid(client, invoice_id);
    await updateInvoiceStatus(invoice_id, client);
    await client.query('COMMIT');

    const { rows: refreshed } = await pool.query(
      'SELECT id, invoice_number, total, amount_paid, status FROM invoices WHERE id = $1',
      [invoice_id]
    );

    res.status(201).json({
      payment: rows[0],
      invoice: refreshed[0] || invoice,
      balance: round2(Number(refreshed[0]?.total) - Number(refreshed[0]?.amount_paid)),
    });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

router.delete('/:id', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      'DELETE FROM payments WHERE id = $1 RETURNING *',
      [req.params.id]
    );
    if (!rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Paiement introuvable' });
    }
    const invoiceId = rows[0].invoice_id;
    await syncInvoicePaid(client, invoiceId);
    await updateInvoiceStatus(invoiceId, client);
    await client.query('COMMIT');
    res.json({ ok: true, payment: rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

export default router;

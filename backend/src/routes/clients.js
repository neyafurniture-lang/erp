import { Router } from 'express';
import pool from '../db/pool.js';

const router = Router();

router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM clients ORDER BY name');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM clients WHERE id = $1', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Client introuvable' });

    const [projects, quotes, invoices] = await Promise.all([
      pool.query(`
        SELECT p.*,
          (SELECT COUNT(*)::int FROM tasks WHERE project_id = p.id AND status = 'done') AS tasks_done,
          (SELECT COUNT(*)::int FROM tasks WHERE project_id = p.id) AS tasks_total
        FROM projects p
        WHERE p.client_id = $1
        ORDER BY p.created_at DESC
      `, [req.params.id]),
      pool.query(`
        SELECT q.*, p.name AS project_name, i.id AS invoice_id, i.invoice_number
        FROM quotes q
        LEFT JOIN projects p ON p.id = q.project_id
        LEFT JOIN invoices i ON i.quote_id = q.id
        WHERE q.client_id = $1
        ORDER BY q.created_at DESC
      `, [req.params.id]),
      pool.query(`
        SELECT inv.*, p.name AS project_name
        FROM invoices inv
        LEFT JOIN projects p ON p.id = inv.project_id
        WHERE inv.client_id = $1
        ORDER BY inv.created_at DESC
      `, [req.params.id]),
    ]);

    res.json({
      ...rows[0],
      projects: projects.rows,
      quotes: quotes.rows,
      invoices: invoices.rows,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const { name, contact, email, phone, address, city, notes } = req.body;
    const { rows } = await pool.query(
      'INSERT INTO clients (name, contact, email, phone, address, city, notes) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *',
      [name, contact, email, phone, address, city, notes]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const { name, contact, email, phone, address, city, notes } = req.body;
    const { rows } = await pool.query(
      'UPDATE clients SET name=$1, contact=$2, email=$3, phone=$4, address=$5, city=$6, notes=$7 WHERE id=$8 RETURNING *',
      [name, contact, email, phone, address, city, notes, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Client introuvable' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM clients WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;

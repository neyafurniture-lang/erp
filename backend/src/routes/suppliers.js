import { Router } from 'express';
import pool from '../db/pool.js';

const router = Router();

router.get('/', async (_req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM suppliers ORDER BY name');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const b = req.body;
    const { rows } = await pool.query(
      `INSERT INTO suppliers (name, contact, email, phone, lead_days, notes)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [b.name, b.contact, b.email, b.phone, b.lead_days ?? 7, b.notes]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const b = req.body;
    const { rows } = await pool.query(
      `UPDATE suppliers SET name=$1, contact=$2, email=$3, phone=$4, lead_days=$5, notes=$6
       WHERE id=$7 RETURNING *`,
      [b.name, b.contact, b.email, b.phone, b.lead_days, b.notes, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Fournisseur introuvable' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;

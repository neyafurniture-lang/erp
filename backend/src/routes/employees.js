import { Router } from 'express';
import pool from '../db/pool.js';

const router = Router();

router.get('/', async (_req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM employees WHERE active = true ORDER BY name');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const b = req.body;
    const { rows } = await pool.query(
      `INSERT INTO employees (name, email, role, hourly_rate, skills, color)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [b.name, b.email, b.role || 'artisan', b.hourly_rate ?? 25,
        JSON.stringify(b.skills || []), b.color || '#D86B30']
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
      `UPDATE employees SET name=$1, email=$2, role=$3, hourly_rate=$4, skills=$5, active=$6, color=$7
       WHERE id=$8 RETURNING *`,
      [b.name, b.email, b.role, b.hourly_rate, JSON.stringify(b.skills || []), b.active ?? true, b.color, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Employé introuvable' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;

import { Router } from 'express';
import pool from '../db/pool.js';

const router = Router();

router.get('/', async (req, res) => {
  try {
    const { from, to, employee_id } = req.query;
    let q = `
      SELECT sh.*, e.name AS employee_name, e.color, p.name AS project_name
      FROM shifts sh
      JOIN employees e ON e.id = sh.employee_id
      LEFT JOIN projects p ON p.id = sh.project_id
      WHERE 1=1
    `;
    const params = [];
    if (from) { params.push(from); q += ` AND sh.end_at >= $${params.length}`; }
    if (to) { params.push(to); q += ` AND sh.start_at <= $${params.length}`; }
    if (employee_id) { params.push(employee_id); q += ` AND sh.employee_id = $${params.length}`; }
    q += ' ORDER BY sh.start_at';
    const { rows } = await pool.query(q, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT sh.*, e.name AS employee_name, e.color, p.name AS project_name
      FROM shifts sh
      JOIN employees e ON e.id = sh.employee_id
      LEFT JOIN projects p ON p.id = sh.project_id
      WHERE sh.id = $1
    `, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Shift introuvable' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const { employee_id, project_id, start_at, end_at, notes } = req.body;
    if (!employee_id || !start_at || !end_at) {
      return res.status(400).json({ error: 'employee_id, start_at et end_at requis' });
    }
    const { rows } = await pool.query(
      `INSERT INTO shifts (employee_id, project_id, start_at, end_at, notes)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [employee_id, project_id || null, start_at, end_at, notes]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/:id', async (req, res) => {
  try {
    const { rows: existing } = await pool.query('SELECT * FROM shifts WHERE id = $1', [req.params.id]);
    if (!existing[0]) return res.status(404).json({ error: 'Shift introuvable' });
    const s = existing[0];
    const { rows } = await pool.query(
      `UPDATE shifts SET employee_id=$1, project_id=$2, start_at=$3, end_at=$4, notes=$5
       WHERE id=$6 RETURNING *`,
      [
        req.body.employee_id ?? s.employee_id,
        req.body.project_id !== undefined ? req.body.project_id : s.project_id,
        req.body.start_at ?? s.start_at,
        req.body.end_at ?? s.end_at,
        req.body.notes !== undefined ? req.body.notes : s.notes,
        req.params.id,
      ]
    );
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM shifts WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;

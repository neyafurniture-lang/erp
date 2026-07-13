import { Router } from 'express';
import pool from '../db/pool.js';

const router = Router();

router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT p.*, c.name as client_name,
        (SELECT COUNT(*)::int FROM tasks WHERE project_id = p.id AND status = 'done') AS tasks_done,
        (SELECT COUNT(*)::int FROM tasks WHERE project_id = p.id) AS tasks_total
      FROM projects p
      LEFT JOIN clients c ON c.id = p.client_id
      ORDER BY p.created_at DESC
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT p.*, c.name as client_name, s.meta AS standard_meta
      FROM projects p
      LEFT JOIN clients c ON c.id = p.client_id
      LEFT JOIN standards s ON s.id = p.standard_id
      WHERE p.id = $1
    `, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Projet introuvable' });

    const tasks = await pool.query(
      'SELECT * FROM tasks WHERE project_id = $1 ORDER BY sort_order ASC, id ASC',
      [req.params.id]
    );
    const invoices = await pool.query('SELECT * FROM invoices WHERE project_id = $1', [req.params.id]);
    const expenses = await pool.query('SELECT * FROM expenses WHERE project_id = $1', [req.params.id]);

    res.json({ ...rows[0], tasks: tasks.rows, invoices: invoices.rows, expenses: expenses.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const { name, client_id, status, deadline, budget_estimated, notes } = req.body;
    const { rows } = await pool.query(
      `INSERT INTO projects (name, client_id, status, deadline, budget_estimated, notes)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [name, client_id || null, status || 'active', deadline || null, budget_estimated || 0, notes]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/from-standard/:standardId', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: standards } = await client.query('SELECT * FROM standards WHERE id = $1', [req.params.standardId]);
    if (!standards[0]) return res.status(404).json({ error: 'Standard introuvable' });

    const std = standards[0];
    const { client_id, name, deadline } = req.body;
    const projectName = name || `${std.name} — ${new Date().toLocaleDateString('fr-CA')}`;

    const { rows: projects } = await client.query(
      `INSERT INTO projects (name, client_id, status, deadline, standard_id, budget_estimated)
       VALUES ($1,$2,'active',$3,$4,0) RETURNING *`,
      [projectName, client_id || null, deadline || null, std.id]
    );
    const project = projects[0];

    const steps = std.steps || [];
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      await client.query(
        `INSERT INTO tasks (project_id, title, description, type, status, estimated_minutes, sort_order)
         VALUES ($1,$2,$3,$4,'todo',$5,$6)`,
        [project.id, step.description || step.phase, step.instructions, step.phase || 'admin', step.estimated_minutes || 60, i]
      );
    }

    await client.query('COMMIT');
    res.status(201).json(project);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

router.put('/:id', async (req, res) => {
  try {
    const { name, client_id, status, deadline, budget_estimated, budget_real, notes } = req.body;
    const { rows } = await pool.query(
      `UPDATE projects SET name=$1, client_id=$2, status=$3, deadline=$4,
       budget_estimated=$5, budget_real=$6, notes=$7 WHERE id=$8 RETURNING *`,
      [name, client_id, status, deadline, budget_estimated, budget_real, notes, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Projet introuvable' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM projects WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;

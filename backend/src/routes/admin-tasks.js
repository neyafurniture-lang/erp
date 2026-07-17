import { Router } from 'express';
import pool from '../db/pool.js';
import { syncAdminTasksFromModules, ADMIN_CATEGORIES, seedPriorityTasks } from '../services/admin-task-sync.js';

const router = Router();

const VALID_STATUS = ['todo', 'doing', 'done'];

/** Code session admin (notes / suivi). Surcharge possible via ADMIN_SESSION_PIN. */
export const ADMIN_SESSION_PIN = String(process.env.ADMIN_SESSION_PIN || '31250').trim();

router.post('/unlock', async (req, res) => {
  try {
    const code = String(req.body?.code ?? '').trim();
    if (!code || code !== ADMIN_SESSION_PIN) {
      // 403 (pas 401) : sinon le client api() déconnecte toute la session ERP
      return res.status(403).json({ error: 'Code incorrect' });
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/', async (req, res) => {
  try {
    const { category, status } = req.query;
    let query = 'SELECT * FROM admin_tasks WHERE 1=1';
    const params = [];
    if (category) {
      params.push(category);
      query += ` AND category = $${params.length}`;
    }
    if (status) {
      params.push(status);
      query += ` AND status = $${params.length}`;
    }
    query += ` ORDER BY
      CASE priority_tier WHEN 'p1' THEN 0 WHEN 'p2' THEN 1 WHEN 'p3' THEN 2 ELSE 3 END,
      CASE status WHEN 'doing' THEN 0 WHEN 'todo' THEN 1 ELSE 2 END,
      sort_order ASC,
      due_date NULLS LAST,
      created_at ASC`;
    const { rows } = await pool.query(query, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/seed-priorities', async (_req, res) => {
  try {
    await seedPriorityTasks();
    const { rows } = await pool.query('SELECT * FROM admin_tasks ORDER BY sort_order ASC');
    res.json({ ok: true, tasks: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/summary', async (req, res) => {
  try {
    const [byCategory, byStatus, overdue, upcoming] = await Promise.all([
      pool.query(`
        SELECT category, COUNT(*)::int AS count
        FROM admin_tasks WHERE status != 'done'
        GROUP BY category
      `),
      pool.query(`
        SELECT status, COUNT(*)::int AS count
        FROM admin_tasks
        GROUP BY status
      `),
      pool.query(`
        SELECT COUNT(*)::int AS count FROM admin_tasks
        WHERE status != 'done' AND due_date IS NOT NULL AND due_date < CURRENT_DATE
      `),
      pool.query(`
        SELECT * FROM admin_tasks
        WHERE status != 'done'
        ORDER BY due_date NULLS LAST, sort_order ASC
        LIMIT 8
      `),
    ]);
    res.json({
      categories: ADMIN_CATEGORIES,
      byCategory: byCategory.rows,
      byStatus: byStatus.rows,
      overdue: overdue.rows[0].count,
      upcoming: upcoming.rows,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/sync', async (req, res) => {
  try {
    const result = await syncAdminTasksFromModules();
    const { rows } = await pool.query(`
      SELECT * FROM admin_tasks
      ORDER BY
        CASE status WHEN 'doing' THEN 0 WHEN 'todo' THEN 1 ELSE 2 END,
        due_date NULLS LAST, sort_order ASC
    `);
    res.json({ ...result, tasks: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const title = String(req.body.title || '').trim();
    if (!title) return res.status(400).json({ error: 'Titre requis' });
    const category = ADMIN_CATEGORIES.includes(req.body.category) ? req.body.category : 'gestion';
    const status = VALID_STATUS.includes(req.body.status) ? req.body.status : 'todo';
    const { rows } = await pool.query(
      `INSERT INTO admin_tasks (title, category, status, due_date, notes, link_href, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, COALESCE((SELECT MAX(sort_order) + 1 FROM admin_tasks), 0))
       RETURNING *`,
      [
        title,
        category,
        status,
        req.body.due_date || null,
        req.body.notes?.trim() || null,
        req.body.link_href?.trim() || null,
      ]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const fields = [];
    const params = [];

    if (req.body.title !== undefined) {
      const t = String(req.body.title).trim();
      if (!t) return res.status(400).json({ error: 'Titre requis' });
      params.push(t);
      fields.push(`title = $${params.length}`);
    }
    if (req.body.category !== undefined && ADMIN_CATEGORIES.includes(req.body.category)) {
      params.push(req.body.category);
      fields.push(`category = $${params.length}`);
    }
    if (req.body.status !== undefined && VALID_STATUS.includes(req.body.status)) {
      params.push(req.body.status);
      fields.push(`status = $${params.length}`);
      fields.push(`completed_at = CASE WHEN $${params.length} = 'done' THEN NOW() ELSE NULL END`);
    }
    if (req.body.due_date !== undefined) {
      params.push(req.body.due_date || null);
      fields.push(`due_date = $${params.length}`);
    }
    if (req.body.notes !== undefined) {
      params.push(req.body.notes?.trim() || null);
      fields.push(`notes = $${params.length}`);
    }
    if (req.body.link_href !== undefined) {
      params.push(req.body.link_href?.trim() || null);
      fields.push(`link_href = $${params.length}`);
    }
    if (req.body.sort_order !== undefined) {
      params.push(Number(req.body.sort_order));
      fields.push(`sort_order = $${params.length}`);
    }

    if (!fields.length) return res.status(400).json({ error: 'Aucune modification' });

    params.push(id);
    const { rows } = await pool.query(
      `UPDATE admin_tasks SET ${fields.join(', ')} WHERE id = $${params.length} RETURNING *`,
      params
    );
    if (!rows[0]) return res.status(404).json({ error: 'Tâche introuvable' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM admin_tasks WHERE id = $1', [Number(req.params.id)]);
    if (!rowCount) return res.status(404).json({ error: 'Tâche introuvable' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;

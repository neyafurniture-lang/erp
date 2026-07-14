import { Router } from 'express';
import pool from '../db/pool.js';
import { syncProjectStatusFromTasks } from '../services/project-status-sync.js';

const router = Router();

router.get('/', async (req, res) => {
  try {
    const { project_id, from, to } = req.query;
    let query = `
      SELECT t.*, p.name as project_name, p.standard_id as project_standard_id
      FROM tasks t
      LEFT JOIN projects p ON p.id = t.project_id
      WHERE 1=1
    `;
    const params = [];
    if (project_id) { params.push(project_id); query += ` AND t.project_id = $${params.length}`; }
    if (from) { params.push(from); query += ` AND t.start_time >= $${params.length}`; }
    if (to) { params.push(to); query += ` AND t.end_time <= $${params.length}`; }
    query += ' ORDER BY t.sort_order ASC, t.start_time NULLS LAST, t.created_at';
    const { rows } = await pool.query(query, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/calendar', async (req, res) => {
  try {
    const { start, end } = req.query;
    const { rows } = await pool.query(`
      SELECT t.id, t.title, t.type, t.status, t.start_time as start, t.end_time as end,
             t.project_id, p.name as project_name, t.estimated_minutes, p.standard_id
      FROM tasks t
      LEFT JOIN projects p ON p.id = t.project_id
      WHERE t.start_time IS NOT NULL
        AND ($1::timestamptz IS NULL OR t.start_time >= $1)
        AND ($2::timestamptz IS NULL OR t.end_time <= $2)
      ORDER BY t.start_time
    `, [start || null, end || null]);

    const events = rows.map(t => ({
      id: String(t.id),
      title: t.project_name ? `${t.title} (${t.project_name})` : t.title,
      start: t.start,
      end: t.end,
      extendedProps: { taskId: t.id, type: t.type, status: t.status, projectId: t.project_id },
      backgroundColor: typeColor(t.type),
      borderColor: typeColor(t.type),
    }));
    res.json(events);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function typeColor(type) {
  const colors = {
    debitage: '#D86B30',
    usinage: '#b85a28',
    assemblage: '#C4923A',
    finition: '#e88a55',
    admin: '#8A847C',
  };
  return colors[type] || '#D86B30';
}

router.get('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT t.*, p.name as project_name, p.standard_id as project_standard_id
      FROM tasks t
      LEFT JOIN projects p ON p.id = t.project_id
      WHERE t.id = $1
    `, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Tâche introuvable' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const { project_id, title, description, type, status, assigned_to, estimated_minutes, start_time, end_time } = req.body;

    let minutes = estimated_minutes;
    let sortOrder = 0;
    if (project_id) {
      const { rows: proj } = await pool.query('SELECT standard_id FROM projects WHERE id = $1', [project_id]);
      if (proj[0] && !proj[0].standard_id) minutes = null;
      else if (minutes == null) minutes = 60;
      const { rows: ord } = await pool.query(
        'SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM tasks WHERE project_id = $1',
        [project_id]
      );
      sortOrder = ord[0]?.next ?? 0;
    } else if (minutes == null) {
      minutes = 60;
    }

    const { rows } = await pool.query(
      `INSERT INTO tasks (project_id, title, description, type, status, assigned_to, estimated_minutes, start_time, end_time, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [project_id, title, description, type || 'admin', status || 'todo', assigned_to, minutes, start_time, end_time, sortOrder]
    );
    if (project_id) {
      await syncProjectStatusFromTasks(project_id, { fromStatus: 'done', toStatus: status || 'todo' });
    }
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/reorder', async (req, res) => {
  const client = await pool.connect();
  try {
    const { project_id, task_ids } = req.body;
    if (!project_id || !Array.isArray(task_ids) || task_ids.length === 0) {
      return res.status(400).json({ error: 'project_id et task_ids requis' });
    }

    const { rows: existing } = await client.query(
      'SELECT id FROM tasks WHERE project_id = $1 ORDER BY sort_order, id',
      [project_id]
    );
    const existingIds = new Set(existing.map(r => r.id));
    if (task_ids.length !== existing.length || !task_ids.every(id => existingIds.has(Number(id)))) {
      return res.status(400).json({ error: 'Liste de tâches invalide' });
    }

    await client.query('BEGIN');
    for (let i = 0; i < task_ids.length; i++) {
      await client.query(
        'UPDATE tasks SET sort_order = $1 WHERE id = $2 AND project_id = $3',
        [i, task_ids[i], project_id]
      );
    }
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

router.put('/:id', async (req, res) => {
  try {
    const { rows: existing } = await pool.query('SELECT * FROM tasks WHERE id = $1', [req.params.id]);
    if (!existing[0]) return res.status(404).json({ error: 'Tâche introuvable' });
    const t = { ...existing[0], ...req.body };
    const { rows } = await pool.query(
      `UPDATE tasks SET title=$1, description=$2, type=$3, status=$4, assigned_to=$5,
       estimated_minutes=$6, start_time=$7, end_time=$8, project_id=$9, sort_order=$10
       WHERE id=$11 RETURNING *`,
      [t.title, t.description, t.type, t.status, t.assigned_to, t.estimated_minutes, t.start_time, t.end_time, t.project_id, t.sort_order ?? 0, req.params.id]
    );
    const projectIds = new Set([existing[0].project_id, rows[0].project_id].filter(Boolean));
    for (const pid of projectIds) {
      await syncProjectStatusFromTasks(pid, {
        fromStatus: existing[0].status,
        toStatus: rows[0].status,
      });
    }
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/:id/schedule', async (req, res) => {
  try {
    const { start_time, end_time } = req.body;
    const { rows } = await pool.query(
      'UPDATE tasks SET start_time=$1, end_time=$2 WHERE id=$3 RETURNING *',
      [start_time, end_time, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Tâche introuvable' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const { rows: existing } = await pool.query('SELECT project_id, status FROM tasks WHERE id = $1', [req.params.id]);
    await pool.query('DELETE FROM tasks WHERE id = $1', [req.params.id]);
    if (existing[0]?.project_id) {
      await syncProjectStatusFromTasks(existing[0].project_id, {
        deleted: true,
        fromStatus: existing[0].status,
      });
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;

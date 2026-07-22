import { Router } from 'express';
import pool from '../db/pool.js';

const router = Router();

const STAGE_ORDER = ['queued', 'debitage', 'usinage', 'assemblage', 'finition', 'atelier', 'done'];

export function computeStage(tasks = []) {
  if (!tasks.length) return 'queued';
  if (tasks.every(t => t.status === 'done')) return 'done';
  const doing = tasks.find(t => t.status === 'doing');
  if (doing) return doing.type === 'admin' ? 'atelier' : doing.type;
  const firstOpen = tasks.find(t => t.status !== 'done');
  if (!firstOpen) return 'done';
  const anyProgress = tasks.some(t => t.status === 'done');
  if (!anyProgress) return 'queued';
  return firstOpen.type === 'admin' ? 'atelier' : firstOpen.type;
}

function parseMeta(meta) {
  if (!meta) return {};
  return typeof meta === 'string' ? JSON.parse(meta) : meta;
}

function isCatalogStandard(std) {
  if (!std) return false;
  if (std.product_type === 'guide') return false;
  const meta = parseMeta(std.meta);
  return Boolean(meta.source || (meta.sku && meta.sku !== 'GUIDE'));
}

async function fetchProductionItems({ kind = 'all', status = 'active' } = {}) {
  let statusFilter = "p.status = 'active'";
  if (status === 'done') statusFilter = "p.status = 'done'";
  else if (status === 'all') statusFilter = '1=1';

  const { rows } = await pool.query(`
    SELECT p.*, c.name AS client_name,
      s.name AS standard_name, s.meta AS standard_meta, s.product_type,
      (SELECT COUNT(*)::int FROM tasks WHERE project_id = p.id AND status = 'done') AS tasks_done,
      (SELECT COUNT(*)::int FROM tasks WHERE project_id = p.id) AS tasks_total,
      COALESCE(
        (SELECT json_agg(row_to_json(t) ORDER BY t.sort_order, t.id)
         FROM (SELECT * FROM tasks WHERE project_id = p.id ORDER BY sort_order, id) t),
        '[]'::json
      ) AS tasks
    FROM projects p
    LEFT JOIN clients c ON c.id = p.client_id
    LEFT JOIN standards s ON s.id = p.standard_id
    WHERE ${statusFilter}
    ORDER BY p.production_priority DESC, p.deadline NULLS LAST, p.created_at DESC
  `);

  return rows
    .map(row => {
      const tasks = Array.isArray(row.tasks) ? row.tasks : [];
      const catalog = Boolean(row.standard_id && isCatalogStandard({
        product_type: row.product_type,
        meta: row.standard_meta,
      }));
      const itemKind = row.standard_id ? (catalog ? 'catalog' : 'standard') : 'custom';
      const meta = parseMeta(row.standard_meta);
      return {
        ...row,
        tasks,
        kind: itemKind,
        stage: computeStage(tasks),
        sku: meta.sku || row.product_type || null,
        catalog,
      };
    })
    .filter(item => {
      if (kind === 'catalog') return item.catalog;
      if (kind === 'custom') return item.kind === 'custom';
      return true;
    });
}

router.get('/', async (req, res) => {
  try {
    const kind = req.query.kind || 'all';
    const status = req.query.status || 'active';
    const items = await fetchProductionItems({ kind, status });

    const summary = {
      total_active: items.filter(i => i.status === 'active').length,
      catalog: items.filter(i => i.catalog && i.status === 'active').length,
      custom: items.filter(i => i.kind === 'custom' && i.status === 'active').length,
      by_stage: STAGE_ORDER.reduce((acc, s) => {
        acc[s] = items.filter(i => i.stage === s && i.status === 'active').length;
        return acc;
      }, {}),
    };

    res.json({ summary, items });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  const client = await pool.connect();
  try {
    const {
      kind, standard_id, name, client_id, quantity = 1, deadline, notes, priority = 0,
    } = req.body;

    await client.query('BEGIN');

    if (kind === 'catalog' && standard_id) {
      const { rows: standards } = await client.query('SELECT * FROM standards WHERE id = $1', [standard_id]);
      if (!standards[0]) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Fiche introuvable' });
      }
      const std = standards[0];
      const meta = parseMeta(std.meta);
      const qty = Math.max(1, Number(quantity) || 1);
      const projectName = name || `${meta.sku || std.name}${qty > 1 ? ` ×${qty}` : ''} — ${new Date().toLocaleDateString('fr-CA')}`;

      const { rows: projects } = await client.query(
        `INSERT INTO projects (name, client_id, status, deadline, standard_id, budget_estimated, quantity, production_priority, notes)
         VALUES ($1,$2,'active',$3,$4,0,$5,$6,$7) RETURNING *`,
        [projectName, client_id || null, deadline || null, std.id, qty, priority, notes || null]
      );
      const project = projects[0];

      const steps = typeof std.steps === 'string' ? JSON.parse(std.steps) : (std.steps || []);
      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        await client.query(
          `INSERT INTO tasks (project_id, title, description, type, status, estimated_minutes, sort_order)
           VALUES ($1,$2,$3,$4,'todo',$5,$6)`,
          [project.id, step.description || step.phase, step.instructions, step.phase || 'admin', step.estimated_minutes || 60, i]
        );
      }

      await client.query('COMMIT');
      const { tryEnsureProjectFolder } = await import('../services/drive-folders.js');
      const driveFolder = await tryEnsureProjectFolder(project.id);
      if (driveFolder?.folder_id) project.drive_folder_id = driveFolder.folder_id;
      return res.status(201).json(project);
    }

    if (kind === 'custom') {
      if (!name?.trim()) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Nom du meuble requis' });
      }
      const { rows } = await client.query(
        `INSERT INTO projects (name, client_id, status, deadline, budget_estimated, quantity, production_priority, notes)
         VALUES ($1,$2,'active',$3,0,$4,$5,$6) RETURNING *`,
        [name.trim(), client_id || null, deadline || null, Math.max(1, Number(quantity) || 1), priority, notes || null]
      );
      await client.query('COMMIT');
      const project = rows[0];
      const { tryEnsureProjectFolder } = await import('../services/drive-folders.js');
      const driveFolder = await tryEnsureProjectFolder(project.id);
      if (driveFolder?.folder_id) project.drive_folder_id = driveFolder.folder_id;
      return res.status(201).json(project);
    }

    await client.query('ROLLBACK');
    return res.status(400).json({ error: 'Type invalide — catalogue ou sur mesure' });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* */ }
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

router.patch('/:id', async (req, res) => {
  try {
    const { quantity, production_priority, deadline, notes, status, name } = req.body;
    const { rows } = await pool.query(
      `UPDATE projects SET
        quantity = COALESCE($1, quantity),
        production_priority = COALESCE($2, production_priority),
        deadline = COALESCE($3, deadline),
        notes = COALESCE($4, notes),
        status = COALESCE($5, status),
        name = COALESCE($6, name)
       WHERE id = $7 RETURNING *`,
      [
        quantity != null ? Math.max(1, Number(quantity)) : null,
        production_priority != null ? Number(production_priority) : null,
        deadline,
        notes,
        status,
        name,
        req.params.id,
      ]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Production introuvable' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Avance : termine la tâche en cours et démarre la suivante */
router.post('/:id/advance', async (req, res) => {
  const client = await pool.connect();
  try {
    const projectId = Number(req.params.id);
    const { rows: tasks } = await client.query(
      'SELECT * FROM tasks WHERE project_id = $1 ORDER BY sort_order ASC, id ASC',
      [projectId]
    );
    if (!tasks.length) return res.status(400).json({ error: 'Aucune étape de production' });

    await client.query('BEGIN');

    let current = tasks.find(t => t.status === 'doing');
    if (!current) current = tasks.find(t => t.status === 'todo');

    if (current) {
      await client.query('UPDATE tasks SET status = $1 WHERE id = $2', ['done', current.id]);
      const idx = tasks.findIndex(t => t.id === current.id);
      const next = tasks.slice(idx + 1).find(t => t.status !== 'done');
      if (next) {
        await client.query('UPDATE tasks SET status = $1 WHERE id = $2', ['doing', next.id]);
      } else {
        await client.query("UPDATE projects SET status = 'done' WHERE id = $1", [projectId]);
      }
    } else if (tasks.every(t => t.status === 'done')) {
      await client.query("UPDATE projects SET status = 'done' WHERE id = $1", [projectId]);
    }

    await client.query('COMMIT');

    const { rows: updated } = await pool.query(
      'SELECT * FROM tasks WHERE project_id = $1 ORDER BY sort_order ASC, id ASC',
      [projectId]
    );
    res.json({ tasks: updated, stage: computeStage(updated) });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* */ }
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

export default router;

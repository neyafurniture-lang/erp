import { Router } from 'express';
import multer from 'multer';
import pool from '../db/pool.js';
import {
  getInstallationBilling,
  scanProjectInstallationDates,
  saveInstallationBilling,
  syncInstallationInvoice,
} from '../services/installation-billing.js';
import { splitPdfForProject } from '../services/project-plans.js';

const router = Router();

const pdfUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = file.mimetype === 'application/pdf' || /\.pdf$/i.test(file.originalname || '');
    cb(ok ? null : new Error('Fichier PDF uniquement'), ok);
  },
});

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
    const { name, client_id, status, deadline, budget_estimated, budget_real, notes, meta } = req.body;
    let metaClause = '';
    const params = [name, client_id, status, deadline, budget_estimated, budget_real, notes];
    if (meta != null && typeof meta === 'object') {
      metaClause = `, meta = COALESCE(meta, '{}'::jsonb) || $${params.length + 1}::jsonb`;
      params.push(JSON.stringify(meta));
    }
    params.push(req.params.id);
    const { rows } = await pool.query(
      `UPDATE projects SET name=$1, client_id=$2, status=$3, deadline=$4,
       budget_estimated=$5, budget_real=$6, notes=$7${metaClause} WHERE id=$${params.length} RETURNING *`,
      params
    );
    if (!rows[0]) return res.status(404).json({ error: 'Projet introuvable' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id/installation-billing', async (req, res) => {
  try {
    res.json(await getInstallationBilling(req.params.id));
  } catch (err) {
    res.status(err.message === 'Projet introuvable' ? 404 : 500).json({ error: err.message });
  }
});

router.post('/:id/installation-billing/scan', async (req, res) => {
  try {
    res.json(await scanProjectInstallationDates(req.params.id));
  } catch (err) {
    res.status(err.message === 'Projet introuvable' ? 404 : 500).json({ error: err.message });
  }
});

router.put('/:id/installation-billing', async (req, res) => {
  try {
    res.json(await saveInstallationBilling(req.params.id, req.body));
  } catch (err) {
    res.status(err.message === 'Projet introuvable' ? 404 : 500).json({ error: err.message });
  }
});

router.post('/:id/installation-billing/sync-invoice', async (req, res) => {
  try {
    res.json(await syncInstallationInvoice(req.params.id));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/:id/plans/import', pdfUpload.single('pdf'), async (req, res) => {
  try {
    if (!req.file?.buffer?.length) {
      return res.status(400).json({ error: 'Fichier PDF requis' });
    }
    const projectId = Number(req.params.id);
    const { rows: existing } = await pool.query('SELECT id, meta FROM projects WHERE id = $1', [projectId]);
    if (!existing[0]) return res.status(404).json({ error: 'Projet introuvable' });

    const sourceName = req.file.originalname || 'plan.pdf';
    const newPlans = await splitPdfForProject(projectId, req.file.buffer, sourceName);
    const prevMeta = typeof existing[0].meta === 'string'
      ? JSON.parse(existing[0].meta || '{}')
      : (existing[0].meta || {});
    const prevPlans = Array.isArray(prevMeta.plans) ? prevMeta.plans : [];
    const plans = [...prevPlans, ...newPlans];

    const { rows } = await pool.query(
      `UPDATE projects SET meta = COALESCE(meta, '{}'::jsonb) || $1::jsonb WHERE id = $2 RETURNING *`,
      [JSON.stringify({ plans }), projectId]
    );
    res.json({ project: rows[0], plans, imported: newPlans.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Terminer ou rouvrir un projet en un clic */
router.post('/:id/toggle-done', async (req, res) => {
  const client = await pool.connect();
  try {
    const id = Number(req.params.id);
    const { rows: existing } = await client.query('SELECT * FROM projects WHERE id = $1', [id]);
    if (!existing[0]) return res.status(404).json({ error: 'Projet introuvable' });

    const wantDone = existing[0].status !== 'done';
    await client.query('BEGIN');

    if (wantDone) {
      await client.query(
        `UPDATE tasks SET status = 'done' WHERE project_id = $1 AND status != 'done'`,
        [id]
      );
      await client.query(`UPDATE projects SET status = 'done' WHERE id = $1`, [id]);
    } else {
      await client.query(`UPDATE projects SET status = 'active' WHERE id = $1`, [id]);
    }

    await client.query('COMMIT');

    const { rows } = await pool.query(`
      SELECT p.*, c.name AS client_name,
        (SELECT COUNT(*)::int FROM tasks WHERE project_id = p.id AND status = 'done') AS tasks_done,
        (SELECT COUNT(*)::int FROM tasks WHERE project_id = p.id AND status != 'done') AS tasks_open,
        (SELECT COUNT(*)::int FROM tasks WHERE project_id = p.id) AS tasks_total
      FROM projects p
      LEFT JOIN clients c ON c.id = p.client_id
      WHERE p.id = $1
    `, [id]);
    res.json(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
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

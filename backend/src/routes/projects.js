import { Router } from 'express';
import multer from 'multer';
import pool from '../db/pool.js';
import { splitPdfForProject } from '../services/project-plans.js';

const router = Router();
const planUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 40 * 1024 * 1024 },
  fileFilter(_req, file, cb) {
    const ok = file.mimetype === 'application/pdf'
      || /\.pdf$/i.test(file.originalname || '');
    cb(ok ? null : new Error('PDF requis'), ok);
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
    if (!String(name || '').trim()) return res.status(400).json({ error: 'Nom requis' });
    const clientId = client_id === '' || client_id == null ? null : Number(client_id);
    if (clientId != null && Number.isNaN(clientId)) {
      return res.status(400).json({ error: 'client_id invalide' });
    }
    const { rows } = await pool.query(
      `INSERT INTO projects (name, client_id, status, deadline, budget_estimated, notes)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [String(name).trim(), clientId, status || 'active', deadline || null, budget_estimated || 0, notes]
    );
    const { rows: full } = await pool.query(
      `SELECT p.*, c.name as client_name FROM projects p
       LEFT JOIN clients c ON c.id = p.client_id WHERE p.id = $1`,
      [rows[0].id]
    );
    const project = full[0] || rows[0];
    // Dossier Drive sous NEYA ERP / Clients / {client} / {projet}
    const { tryEnsureProjectFolder } = await import('../services/drive-folders.js');
    const driveFolder = await tryEnsureProjectFolder(project.id);
    if (driveFolder?.folder_id) project.drive_folder_id = driveFolder.folder_id;
    res.status(201).json(project);
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
    const { tryEnsureProjectFolder } = await import('../services/drive-folders.js');
    const driveFolder = await tryEnsureProjectFolder(project.id);
    if (driveFolder?.folder_id) project.drive_folder_id = driveFolder.folder_id;
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
    const id = Number(req.params.id);
    const { rows: existing } = await pool.query('SELECT * FROM projects WHERE id = $1', [id]);
    if (!existing[0]) return res.status(404).json({ error: 'Projet introuvable' });
    const cur = existing[0];
    const b = req.body || {};

    const name = b.name !== undefined ? String(b.name).trim() : cur.name;
    if (!name) return res.status(400).json({ error: 'Nom requis' });

    let clientId = cur.client_id;
    if (b.client_id !== undefined) {
      clientId = b.client_id === '' || b.client_id === null ? null : Number(b.client_id);
      if (clientId != null && Number.isNaN(clientId)) {
        return res.status(400).json({ error: 'client_id invalide' });
      }
    }

    const status = b.status !== undefined ? b.status : cur.status;
    const deadline = b.deadline !== undefined ? (b.deadline || null) : cur.deadline;
    const budgetEstimated = b.budget_estimated !== undefined
      ? (Number(b.budget_estimated) || 0)
      : cur.budget_estimated;
    const budgetReal = b.budget_real !== undefined
      ? (Number(b.budget_real) || 0)
      : cur.budget_real;
    const notes = b.notes !== undefined ? b.notes : cur.notes;

    let nextMeta = typeof cur.meta === 'string' ? JSON.parse(cur.meta || '{}') : (cur.meta || {});
    if (b.meta && typeof b.meta === 'object') {
      nextMeta = { ...nextMeta, ...b.meta };
    }
    if (b.hours_logbook && typeof b.hours_logbook === 'object') {
      nextMeta = {
        ...nextMeta,
        hours_logbook: {
          ...(nextMeta.hours_logbook || {}),
          ...b.hours_logbook,
          updated_at: new Date().toISOString(),
        },
      };
    }

    const { rows } = await pool.query(
      `UPDATE projects SET name=$1, client_id=$2, status=$3, deadline=$4,
       budget_estimated=$5, budget_real=$6, notes=$7, meta=$8::jsonb WHERE id=$9 RETURNING *`,
      [name, clientId, status, deadline, budgetEstimated, budgetReal, notes, JSON.stringify(nextMeta), id]
    );

    const { rows: full } = await pool.query(
      `SELECT p.*, c.name as client_name
       FROM projects p
       LEFT JOIN clients c ON c.id = p.client_id
       WHERE p.id = $1`,
      [id]
    );
    res.json(full[0] || rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Lier / délier un client sans écraser le reste du projet */
router.patch('/:id/client', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { rows: existing } = await pool.query('SELECT id FROM projects WHERE id = $1', [id]);
    if (!existing[0]) return res.status(404).json({ error: 'Projet introuvable' });

    let clientId = null;
    if (req.body?.client_id !== undefined && req.body.client_id !== '' && req.body.client_id !== null) {
      clientId = Number(req.body.client_id);
      if (Number.isNaN(clientId)) return res.status(400).json({ error: 'client_id invalide' });
      const { rows: clients } = await pool.query('SELECT id FROM clients WHERE id = $1', [clientId]);
      if (!clients[0]) return res.status(400).json({ error: 'Client introuvable' });
    }

    await pool.query('UPDATE projects SET client_id = $1 WHERE id = $2', [clientId, id]);
    const { rows: full } = await pool.query(
      `SELECT p.*, c.name as client_name
       FROM projects p
       LEFT JOIN clients c ON c.id = p.client_id
       WHERE p.id = $1`,
      [id]
    );
    const project = full[0];
    // Si pas encore de dossier Drive, le créer sous le client
    if (project && !project.drive_folder_id) {
      const { tryEnsureProjectFolder } = await import('../services/drive-folders.js');
      const driveFolder = await tryEnsureProjectFolder(id);
      if (driveFolder?.folder_id) project.drive_folder_id = driveFolder.folder_id;
    }
    res.json(project);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Importer un PDF de plans → pages individuelles dans meta.plans */
router.post('/:id/plans/import', planUpload.single('pdf'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!req.file?.buffer?.length) {
      return res.status(400).json({ error: 'Fichier PDF requis (champ pdf)' });
    }
    const { rows: existing } = await pool.query('SELECT id, meta FROM projects WHERE id = $1', [id]);
    if (!existing[0]) return res.status(404).json({ error: 'Projet introuvable' });

    const pages = await splitPdfForProject(id, req.file.buffer, req.file.originalname || 'plan.pdf');
    const curMeta = typeof existing[0].meta === 'string'
      ? JSON.parse(existing[0].meta || '{}')
      : (existing[0].meta || {});
    const prev = Array.isArray(curMeta.plans) ? curMeta.plans : [];
    const nextMeta = {
      ...curMeta,
      plans: [...prev, ...pages],
      plans_updated_at: new Date().toISOString(),
    };

    const { rows } = await pool.query(
      `UPDATE projects SET meta = $1::jsonb WHERE id = $2
       RETURNING id, meta`,
      [JSON.stringify(nextMeta), id]
    );
    res.status(201).json({ ok: true, plans: rows[0].meta?.plans || nextMeta.plans, added: pages.length });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Import PDF impossible' });
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

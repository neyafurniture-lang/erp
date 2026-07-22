import { Router } from 'express';
import multer from 'multer';
import pool from '../db/pool.js';
import { splitPdfForProject } from '../services/project-plans.js';
import {
  parseProjectMeta,
  applyHoursLogbookToMeta,
  restoreHoursLogbookFromPrev,
  isClearingHoursLogbook,
} from '../services/hours-logbook.js';
import { normalizeProjectStatus, PROJECT_STATUSES } from '../services/project-status.js';

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

const skpUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 80 * 1024 * 1024 },
  fileFilter(_req, file, cb) {
    const name = file.originalname || '';
    const ok = /\.skp$/i.test(name)
      || /sketchup/i.test(file.mimetype || '')
      || file.mimetype === 'application/octet-stream';
    cb(ok && /\.skp$/i.test(name) ? null : new Error('Fichier .skp SketchUp requis'), /\.skp$/i.test(name));
  },
});

async function loadProjectFull(id) {
  const { rows: full } = await pool.query(
    `SELECT p.*, c.name as client_name
     FROM projects p
     LEFT JOIN clients c ON c.id = p.client_id
     WHERE p.id = $1`,
    [id]
  );
  return full[0] || null;
}

router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT p.*, c.name as client_name,
        (SELECT COUNT(*)::int FROM tasks WHERE project_id = p.id AND status = 'done') AS tasks_done,
        (SELECT COUNT(*)::int FROM tasks WHERE project_id = p.id) AS tasks_total
      FROM projects p
      LEFT JOIN clients c ON c.id = p.client_id
      ORDER BY p.priority DESC NULLS LAST, p.created_at DESC
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Revue annuelle : projets + totaux factures liées, pour marquer terminé et voir ce qui est rentré.
 * Doit rester avant GET /:id.
 */
router.get('/year-review', async (req, res) => {
  try {
    const year = Number(req.query.year) || new Date().getFullYear();
    if (!Number.isFinite(year) || year < 2000 || year > 2100) {
      return res.status(400).json({ error: 'Année invalide' });
    }

    const { rows: projects } = await pool.query(
      `
      SELECT p.id, p.name, p.status, p.deadline, p.created_at, p.client_id,
             c.name AS client_name,
             COALESCE(inv.invoice_count, 0)::int AS invoice_count,
             COALESCE(inv.invoiced_total, 0)::float AS invoiced_total,
             COALESCE(inv.collected_total, 0)::float AS collected_total,
             COALESCE(inv.unpaid_total, 0)::float AS unpaid_total
      FROM projects p
      LEFT JOIN clients c ON c.id = p.client_id
      LEFT JOIN LATERAL (
        SELECT
          COUNT(*)::int AS invoice_count,
          COALESCE(SUM(i.total), 0) AS invoiced_total,
          COALESCE(SUM(COALESCE(i.amount_paid, 0)), 0) AS collected_total,
          COALESCE(SUM(GREATEST(COALESCE(i.total, 0) - COALESCE(i.amount_paid, 0), 0)), 0) AS unpaid_total
        FROM invoices i
        WHERE i.project_id = p.id
          AND COALESCE(i.status, '') NOT IN ('draft', 'cancelled', 'void')
          AND EXTRACT(YEAR FROM i.created_at) = $1
      ) inv ON true
      WHERE EXTRACT(YEAR FROM p.created_at) = $1
         OR (p.deadline IS NOT NULL AND EXTRACT(YEAR FROM p.deadline) = $1)
         OR EXISTS (
           SELECT 1 FROM invoices i
           WHERE i.project_id = p.id
             AND EXTRACT(YEAR FROM i.created_at) = $1
         )
      ORDER BY
        CASE WHEN p.status = 'done' THEN 1 ELSE 0 END,
        inv.invoiced_total DESC NULLS LAST,
        p.name ASC
      `,
      [year]
    );

    const { rows: companyRows } = await pool.query(
      `
      SELECT
        COUNT(*)::int AS invoice_count,
        COALESCE(SUM(total), 0)::float AS invoiced_total,
        COALESCE(SUM(COALESCE(amount_paid, 0)), 0)::float AS collected_total,
        COUNT(*) FILTER (WHERE project_id IS NULL)::int AS orphan_count
      FROM invoices
      WHERE COALESCE(status, '') NOT IN ('draft', 'cancelled', 'void')
        AND EXTRACT(YEAR FROM created_at) = $1
      `,
      [year]
    );

    const { rows: orphans } = await pool.query(
      `
      SELECT i.id, i.invoice_number, i.total, i.amount_paid, i.status, i.client_id,
             c.name AS client_name,
             (
               SELECT COUNT(*)::int FROM projects p
               WHERE p.client_id = i.client_id
                 AND (
                   EXTRACT(YEAR FROM p.created_at) = $1
                   OR (p.deadline IS NOT NULL AND EXTRACT(YEAR FROM p.deadline) = $1)
                   OR p.status != 'done'
                 )
             ) AS candidate_projects
      FROM invoices i
      LEFT JOIN clients c ON c.id = i.client_id
      WHERE i.project_id IS NULL
        AND COALESCE(i.status, '') NOT IN ('draft', 'cancelled', 'void')
        AND EXTRACT(YEAR FROM i.created_at) = $1
      ORDER BY i.created_at DESC
      LIMIT 80
      `,
      [year]
    );

    const summary = {
      year,
      projects_count: projects.length,
      active_count: projects.filter(p => p.status !== 'done').length,
      done_count: projects.filter(p => p.status === 'done').length,
      with_invoice: projects.filter(p => Number(p.invoice_count) > 0).length,
      without_invoice: projects.filter(p => !Number(p.invoice_count)).length,
      invoiced_total: projects.reduce((s, p) => s + Number(p.invoiced_total || 0), 0),
      collected_total: projects.reduce((s, p) => s + Number(p.collected_total || 0), 0),
      unpaid_total: projects.reduce((s, p) => s + Number(p.unpaid_total || 0), 0),
    };

    res.json({
      summary,
      company: companyRows[0] || {
        invoice_count: 0,
        invoiced_total: 0,
        collected_total: 0,
        orphan_count: 0,
      },
      projects,
      orphan_invoices: orphans,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Lie les factures sans projet au projet unique du même client (année donnée).
 */
router.post('/year-review/link-orphans', async (req, res) => {
  try {
    const year = Number(req.body?.year) || new Date().getFullYear();
    if (!Number.isFinite(year) || year < 2000 || year > 2100) {
      return res.status(400).json({ error: 'Année invalide' });
    }

    const { rows: orphans } = await pool.query(
      `
      SELECT i.id, i.client_id
      FROM invoices i
      WHERE i.project_id IS NULL
        AND i.client_id IS NOT NULL
        AND COALESCE(i.status, '') NOT IN ('draft', 'cancelled', 'void')
        AND EXTRACT(YEAR FROM i.created_at) = $1
      `,
      [year]
    );

    let linked = 0;
    const details = [];
    for (const inv of orphans) {
      const { rows: candidates } = await pool.query(
        `
        SELECT id, name FROM projects
        WHERE client_id = $1
          AND (
            EXTRACT(YEAR FROM created_at) = $2
            OR (deadline IS NOT NULL AND EXTRACT(YEAR FROM deadline) = $2)
            OR status != 'done'
          )
        ORDER BY
          CASE WHEN status != 'done' THEN 0 ELSE 1 END,
          created_at DESC
        LIMIT 3
        `,
        [inv.client_id, year]
      );
      if (candidates.length !== 1) continue;
      await pool.query('UPDATE invoices SET project_id = $1 WHERE id = $2 AND project_id IS NULL', [
        candidates[0].id,
        inv.id,
      ]);
      linked += 1;
      details.push({ invoice_id: inv.id, project_id: candidates[0].id, project_name: candidates[0].name });
    }

    res.json({ ok: true, year, linked, details });
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
    const { name, client_id, status, deadline, budget_estimated, notes, priority } = req.body;
    if (!String(name || '').trim()) return res.status(400).json({ error: 'Nom requis' });
    const clientId = client_id === '' || client_id == null ? null : Number(client_id);
    if (clientId != null && Number.isNaN(clientId)) {
      return res.status(400).json({ error: 'client_id invalide' });
    }
    const nextStatus = (status == null || status === '')
      ? 'active'
      : normalizeProjectStatus(status);
    if (!nextStatus) {
      return res.status(400).json({ error: `Statut invalide. Valeurs: ${PROJECT_STATUSES.join(', ')}` });
    }
    const nextPriority = priority === true || priority === 'true' || Number(priority) > 0 ? 1 : 0;
    const { rows } = await pool.query(
      `INSERT INTO projects (name, client_id, status, deadline, budget_estimated, notes, priority)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [String(name).trim(), clientId, nextStatus, deadline || null, budget_estimated || 0, notes, nextPriority]
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

    let status = cur.status;
    if (b.status !== undefined) {
      const nextStatus = normalizeProjectStatus(b.status);
      if (!nextStatus) {
        return res.status(400).json({ error: `Statut invalide. Valeurs: ${PROJECT_STATUSES.join(', ')}` });
      }
      status = nextStatus;
    }
    const deadline = b.deadline !== undefined ? (b.deadline || null) : cur.deadline;
    const budgetEstimated = b.budget_estimated !== undefined
      ? (Number(b.budget_estimated) || 0)
      : cur.budget_estimated;
    const budgetReal = b.budget_real !== undefined
      ? (Number(b.budget_real) || 0)
      : cur.budget_real;
    const notes = b.notes !== undefined ? b.notes : cur.notes;
    let priority = cur.priority ?? 0;
    if (b.priority !== undefined) {
      if (b.priority === true || b.priority === 'true') priority = 1;
      else if (b.priority === false || b.priority === 'false') priority = 0;
      else priority = Number(b.priority) > 0 ? 1 : 0;
    }

    let nextMeta = parseProjectMeta(cur.meta);
    if (b.meta && typeof b.meta === 'object') {
      const incomingMeta = { ...b.meta };
      // Empêcher un meta partiel d’effacer le carnet d’heures
      if (
        incomingMeta.hours_logbook
        && isClearingHoursLogbook(nextMeta.hours_logbook, incomingMeta.hours_logbook)
      ) {
        delete incomingMeta.hours_logbook;
      }
      nextMeta = { ...nextMeta, ...incomingMeta };
    }
    if (b.hours_logbook && typeof b.hours_logbook === 'object') {
      const applied = applyHoursLogbookToMeta(nextMeta, b.hours_logbook, {
        allowClear: b.hours_logbook.confirm_clear === true,
      });
      if (applied.blocked) {
        return res.status(409).json({
          error: `Refus d’effacer le carnet d’heures (${applied.existing_count} ligne(s) déjà enregistrées). Rechargez la page ou restaurez la sauvegarde.`,
          code: 'HOURS_CLEAR_BLOCKED',
          existing_count: applied.existing_count,
        });
      }
      nextMeta = applied.meta;
    }

    const { rows } = await pool.query(
      `UPDATE projects SET name=$1, client_id=$2, status=$3, deadline=$4,
       budget_estimated=$5, budget_real=$6, notes=$7, meta=$8::jsonb, priority=$9 WHERE id=$10 RETURNING *`,
      [name, clientId, status, deadline, budgetEstimated, budgetReal, notes, JSON.stringify(nextMeta), priority, id]
    );

    const full = await loadProjectFull(id);
    res.json(full || rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Sauvegarde atomique du carnet d’heures (évite les courses meta). */
router.patch('/:id/hours-logbook', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const incoming = req.body?.hours_logbook || req.body;
    if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) {
      return res.status(400).json({ error: 'hours_logbook requis' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: existing } = await client.query(
        'SELECT id, meta FROM projects WHERE id = $1 FOR UPDATE',
        [id]
      );
      if (!existing[0]) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Projet introuvable' });
      }

      const applied = applyHoursLogbookToMeta(existing[0].meta, incoming, {
        allowClear: incoming.confirm_clear === true,
      });
      if (applied.blocked) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: `Refus d’effacer le carnet d’heures (${applied.existing_count} ligne(s)).`,
          code: 'HOURS_CLEAR_BLOCKED',
          existing_count: applied.existing_count,
        });
      }

      await client.query(
        'UPDATE projects SET meta = $1::jsonb WHERE id = $2',
        [JSON.stringify(applied.meta), id]
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    const full = await loadProjectFull(id);
    res.json({
      ok: true,
      project: full,
      hours_logbook: parseProjectMeta(full?.meta).hours_logbook || null,
      hours_logbook_prev: parseProjectMeta(full?.meta).hours_logbook_prev || null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Restaure la dernière sauvegarde du carnet (si les heures ont disparu). */
router.post('/:id/hours-logbook/restore', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: existing } = await client.query(
        'SELECT id, meta FROM projects WHERE id = $1 FOR UPDATE',
        [id]
      );
      if (!existing[0]) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Projet introuvable' });
      }
      const restored = restoreHoursLogbookFromPrev(existing[0].meta);
      if (!restored.ok) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: restored.error });
      }
      await client.query(
        'UPDATE projects SET meta = $1::jsonb WHERE id = $2',
        [JSON.stringify(restored.meta), id]
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    const full = await loadProjectFull(id);
    res.json({
      ok: true,
      project: full,
      hours_logbook: parseProjectMeta(full?.meta).hours_logbook || null,
    });
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

/** Uploader un fichier SketchUp (.skp) — ouverture via téléchargement / app desktop. */
router.post('/:id/sketchup', skpUpload.single('skp'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!req.file?.buffer?.length) {
      return res.status(400).json({ error: 'Fichier .skp requis (champ skp)' });
    }
    const { storeSketchupFile } = await import('../services/project-sketchup.js');
    const result = await storeSketchupFile(id, req.file.buffer, req.file.originalname || 'modele.skp');
    res.status(201).json({ ok: true, file: result.file, sketchup_files: result.sketchup_files });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Upload SketchUp impossible' });
  }
});

router.delete('/:id/sketchup/:fileId', async (req, res) => {
  try {
    const { removeSketchupFile } = await import('../services/project-sketchup.js');
    const result = await removeSketchupFile(Number(req.params.id), req.params.fileId);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** URL iframe InnerScene (viewer + mesure) pour un .skp du projet. */
router.get('/:id/sketchup/:fileId/embed', async (req, res) => {
  try {
    const { createSketchupEmbed } = await import('../services/project-sketchup.js');
    const result = await createSketchupEmbed(Number(req.params.id), req.params.fileId, req);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** Télécharger / « ouvrir » un .skp (force le téléchargement avec le bon type MIME). */
router.get('/:id/sketchup/:fileId/download', async (req, res) => {
  try {
    const { listSketchupFiles, SKP_MIME } = await import('../services/project-sketchup.js');
    const id = Number(req.params.id);
    const { rows } = await pool.query('SELECT meta FROM projects WHERE id = $1', [id]);
    if (!rows[0]) return res.status(404).json({ error: 'Projet introuvable' });
    const files = listSketchupFiles(rows[0].meta);
    const file = files.find(f => String(f.id) === String(req.params.fileId));
    if (!file?.url) return res.status(404).json({ error: 'Fichier SketchUp introuvable' });

    const fs = await import('fs');
    const path = await import('path');
    const { fileURLToPath } = await import('url');
    const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../uploads');
    const rel = String(file.url).replace(/^\/uploads\//, '');
    const disk = path.join(root, rel);
    if (!fs.existsSync(disk)) return res.status(404).json({ error: 'Fichier absent sur le disque' });

    const safeName = String(file.name || 'modele.skp').replace(/[\\"\r\n]/g, '_');
    res.setHeader('Content-Type', SKP_MIME);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${safeName.replace(/[^\x20-\x7E]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(safeName)}`
    );
    res.setHeader('X-Content-Type-Options', 'nosniff');
    fs.createReadStream(disk).pipe(res);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** Devis + fichiers mails + plans du projet */
router.get('/:id/documents', async (req, res) => {
  try {
    const { getProjectDocuments } = await import('../services/project-documents.js');
    res.json(await getProjectDocuments(req.params.id));
  } catch (err) {
    const code = /introuvable/i.test(err.message) ? 404 : 400;
    res.status(code).json({ error: err.message });
  }
});

/**
 * Cherche devis / PDF / docs dans les mails liés au projet.
 * Body: { auto_file?: boolean } — classe les PJ trouvées dans le projet (défaut true).
 */
router.post('/:id/documents/scan-mail', async (req, res) => {
  try {
    const { scanProjectMailDocuments } = await import('../services/project-documents.js');
    const autoFile = req.body?.auto_file !== false && req.body?.autoFile !== false;
    res.json(await scanProjectMailDocuments(req.params.id, { autoFile }));
  } catch (err) {
    res.status(400).json({ error: err.message });
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

import pool from '../db/pool.js';

export const SAUNA_CLOUD_PROJECT_NAME = 'Sauna Cloud';

/** Catalogue production Sauna Cloud — qty = commande totale */
export const SAUNA_FRAME_CATALOG = [
  { sku: 'H2013', label: '20" × 13" Underbench', qty: 20 },
  { sku: 'H2026', label: '20" × 26" Standard', qty: 20 },
  { sku: 'H2226', label: '22" × 26" Standard', qty: 10 },
  { sku: 'H2626', label: '26" × 26" Standard', qty: 10 },
  { sku: 'H3313', label: '33" × 13" Underbench', qty: 10 },
  { sku: 'H3326', label: '33" × 26" Standard', qty: 10 },
  { sku: 'H3726', label: '37" × 26" Standard', qty: 10 },
  { sku: 'FS750', label: 'Full-spectrum', qty: 10 },
];

/** Étapes atelier (colonnes du tableau) */
export const SAUNA_FRAME_STAGES = [
  { key: 'debited', label: 'Débité' },
  { key: 'in_progress', label: 'En cours' },
  { key: 'done', label: 'Terminé' },
  { key: 'delivered', label: 'Livré' },
];

/** Anciennes tâches checklist (conservées si déjà créées) */
export const DEFAULT_SAUNA_FRAMES = [
  { title: 'Frame base / plancher', type: 'assemblage' },
  { title: 'Frame mur avant', type: 'assemblage' },
  { title: 'Frame mur arrière', type: 'assemblage' },
  { title: 'Frame mur gauche', type: 'assemblage' },
  { title: 'Frame mur droit', type: 'assemblage' },
  { title: 'Frame toit / plafond', type: 'assemblage' },
  { title: 'Frame porte', type: 'assemblage' },
  { title: 'Frame bancs / sièges', type: 'assemblage' },
  { title: 'Assemblage final & contrôle', type: 'finition' },
];

function parseMeta(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return { ...raw };
  try {
    return JSON.parse(raw) || {};
  } catch {
    return {};
  }
}

function clampInt(n, max = 9999) {
  const v = Math.round(Number(n) || 0);
  if (!Number.isFinite(v) || v < 0) return 0;
  return Math.min(v, max);
}

function emptyCounts() {
  const counts = {};
  for (const s of SAUNA_FRAME_STAGES) counts[s.key] = 0;
  return counts;
}

export function defaultTrackerRows() {
  return SAUNA_FRAME_CATALOG.map((row) => ({
    sku: row.sku,
    label: row.label,
    qty: row.qty,
    counts: emptyCounts(),
  }));
}

/** Fusionne catalogue + sauvegarde meta (préserve les compteurs). */
export function normalizeTracker(saved) {
  const bySku = new Map();
  const list = Array.isArray(saved?.frames) ? saved.frames : Array.isArray(saved) ? saved : [];
  for (const row of list) {
    const sku = String(row?.sku || '').trim().toUpperCase();
    if (!sku) continue;
    const counts = emptyCounts();
    const raw = row.counts && typeof row.counts === 'object' ? row.counts : row;
    for (const s of SAUNA_FRAME_STAGES) {
      counts[s.key] = clampInt(raw[s.key]);
    }
    bySku.set(sku, {
      sku,
      label: String(row.label || '').trim(),
      qty: clampInt(row.qty, 99999),
      counts,
    });
  }

  const frames = SAUNA_FRAME_CATALOG.map((cat) => {
    const prev = bySku.get(cat.sku);
    return {
      sku: cat.sku,
      label: prev?.label || cat.label,
      qty: prev?.qty > 0 ? prev.qty : cat.qty,
      counts: prev?.counts || emptyCounts(),
    };
  });

  // SKUs custom ajoutés hors catalogue
  for (const [sku, row] of bySku) {
    if (frames.some((f) => f.sku === sku)) continue;
    frames.push({
      sku,
      label: row.label || sku,
      qty: row.qty || 0,
      counts: row.counts,
    });
  }

  return { frames, stages: SAUNA_FRAME_STAGES };
}

export function enrichTrackerRow(row) {
  const placed = SAUNA_FRAME_STAGES.reduce((s, st) => s + (Number(row.counts?.[st.key]) || 0), 0);
  const remaining = Math.max(0, (Number(row.qty) || 0) - placed);
  return { ...row, remaining, placed };
}

export function summarizeTracker(tracker) {
  const frames = (tracker.frames || []).map(enrichTrackerRow);
  const qty = frames.reduce((s, f) => s + (f.qty || 0), 0);
  const delivered = frames.reduce((s, f) => s + (f.counts?.delivered || 0), 0);
  const done = frames.reduce((s, f) => s + (f.counts?.done || 0), 0);
  const inProgress = frames.reduce((s, f) => s + (f.counts?.in_progress || 0), 0);
  const debited = frames.reduce((s, f) => s + (f.counts?.debited || 0), 0);
  const remaining = frames.reduce((s, f) => s + (f.remaining || 0), 0);
  // 100 % seulement quand TOUTES les frames sont livrées
  const pct = qty ? Math.min(100, Math.round((delivered / qty) * 100)) : 0;
  const complete = qty > 0 && delivered >= qty;
  return {
    frames,
    stages: SAUNA_FRAME_STAGES,
    totals: { qty, remaining, debited, in_progress: inProgress, done, delivered, pct, complete },
  };
}

async function loadProject(projectId = null) {
  if (projectId) {
    const { rows } = await pool.query('SELECT * FROM projects WHERE id = $1', [projectId]);
    return rows[0] || null;
  }
  const { rows } = await pool.query(
    `SELECT * FROM projects
     WHERE LOWER(REPLACE(TRIM(name), ' ', '')) IN ('saunacloud', 'sonacloud')
        OR LOWER(TRIM(name)) LIKE '%sauna%cloud%'
     ORDER BY
       CASE WHEN LOWER(TRIM(name)) = 'sauna cloud' THEN 0 ELSE 1 END,
       id ASC
     LIMIT 1`
  );
  return rows[0] || null;
}

async function writeProjectMeta(projectId, meta) {
  try {
    await pool.query(
      `UPDATE projects SET meta = COALESCE(meta, '{}'::jsonb) || $1::jsonb WHERE id = $2`,
      [JSON.stringify(meta), projectId]
    );
  } catch (err) {
    // Fallback si || jsonb échoue (meta texte / null)
    await pool.query('UPDATE projects SET meta = $1::jsonb WHERE id = $2', [
      JSON.stringify(meta),
      projectId,
    ]);
  }
}

async function ensureTrackerOnProject(project) {
  const meta = parseMeta(project.meta);
  if (meta.sauna_frame_tracker?.frames?.length) {
    return normalizeTracker(meta.sauna_frame_tracker);
  }
  const tracker = normalizeTracker(defaultTrackerRows());
  const nextMeta = {
    ...meta,
    sauna_frame_tracker: { frames: tracker.frames, updated_at: new Date().toISOString() },
  };
  try {
    await writeProjectMeta(project.id, nextMeta);
  } catch (err) {
    console.warn('sauna-cloud tracker seed:', err.message);
  }
  return tracker;
}

async function syncProjectCompleteFromTracker(projectId, tracker) {
  const complete = Boolean(tracker?.totals?.complete);
  await pool.query(
    `UPDATE projects SET status = $1
     WHERE id = $2
       AND (
         ($1 = 'done' AND status IS DISTINCT FROM 'done')
         OR ($1 = 'active' AND status = 'done')
       )`,
    [complete ? 'done' : 'active', projectId]
  );
}

export async function ensureSaunaCloudProject() {
  let project = await loadProject();
  if (!project) {
    const { rows: created } = await pool.query(
      `INSERT INTO projects (name, status, notes, budget_estimated, meta)
       VALUES ($1, 'active', $2, 0, $3::jsonb)
       RETURNING *`,
      [
        SAUNA_CLOUD_PROJECT_NAME,
        'Suivi fabrication Sauna Cloud — tableau frames (débit → livraison).',
        JSON.stringify({
          sauna_frame_tracker: {
            frames: defaultTrackerRows(),
            updated_at: new Date().toISOString(),
          },
        }),
      ]
    );
    project = created[0];
  }

  await ensureTrackerOnProject(project);

  // Checklist tâches optionnelle (ne crée plus les anciennes frames mur si vide)
  const { rows: tasks } = await pool.query(
    `SELECT id FROM tasks WHERE project_id = $1 LIMIT 1`,
    [project.id]
  );
  if (tasks.length === 0) {
    // pas de seed tâches — le tracker quantité est la source de vérité
  }

  return getSaunaCloudBoard(project.id);
}

export async function getSaunaCloudBoard(projectId = null) {
  let project = await loadProject(projectId);
  if (!project) return ensureSaunaCloudProject();

  const trackerRaw = await ensureTrackerOnProject(project);
  const tracker = summarizeTracker(trackerRaw);
  try {
    await syncProjectCompleteFromTracker(project.id, tracker);
  } catch { /* non bloquant */ }

  const { rows: refreshed } = await pool.query(
    'SELECT id, name, status, notes, deadline, client_id FROM projects WHERE id = $1',
    [project.id]
  );
  const proj = refreshed[0] || project;

  const { rows: frames } = await pool.query(
    `SELECT id, project_id, title, description, type, status, sort_order, estimated_minutes,
            start_time, end_time, created_at
     FROM tasks
     WHERE project_id = $1
     ORDER BY sort_order ASC, id ASC`,
    [project.id]
  ).catch(() => ({ rows: [] }));

  const doneTasks = frames.filter((f) => f.status === 'done').length;

  return {
    project: {
      id: proj.id,
      name: proj.name,
      status: proj.status,
      notes: proj.notes || '',
      deadline: proj.deadline,
      client_id: proj.client_id,
    },
    tracker,
    frames,
    progress: {
      done: tracker.totals.delivered,
      total: tracker.totals.qty,
      pct: tracker.totals.pct,
      remaining: tracker.totals.remaining,
      complete: tracker.totals.complete,
      tasks_done: doneTasks,
      tasks_total: frames.length,
    },
  };
}

export async function updateFrameTracker(projectId, payload = {}) {
  const { rows } = await pool.query('SELECT * FROM projects WHERE id = $1', [projectId]);
  if (!rows[0]) throw new Error('Projet Sauna Cloud introuvable');

  const meta = parseMeta(rows[0].meta);
  const current = normalizeTracker(meta.sauna_frame_tracker || defaultTrackerRows());

  let nextFrames = current.frames;

  if (Array.isArray(payload.frames)) {
    nextFrames = normalizeTracker({ frames: payload.frames }).frames;
  } else if (payload.sku) {
    const sku = String(payload.sku).trim().toUpperCase();
    nextFrames = current.frames.map((row) => {
      if (row.sku !== sku) return row;
      const counts = { ...row.counts };
      if (payload.counts && typeof payload.counts === 'object') {
        for (const s of SAUNA_FRAME_STAGES) {
          if (payload.counts[s.key] !== undefined) counts[s.key] = clampInt(payload.counts[s.key]);
        }
      } else {
        for (const s of SAUNA_FRAME_STAGES) {
          if (payload[s.key] !== undefined) counts[s.key] = clampInt(payload[s.key]);
        }
      }
      const qty = payload.qty !== undefined ? clampInt(payload.qty, 99999) : row.qty;
      const label = payload.label !== undefined ? String(payload.label).trim() || row.label : row.label;
      return { sku: row.sku, label, qty, counts };
    });
    if (!nextFrames.some((f) => f.sku === sku) && payload.label) {
      const counts = emptyCounts();
      if (payload.counts && typeof payload.counts === 'object') {
        for (const s of SAUNA_FRAME_STAGES) {
          if (payload.counts[s.key] !== undefined) counts[s.key] = clampInt(payload.counts[s.key]);
        }
      }
      nextFrames.push({
        sku,
        label: String(payload.label).trim(),
        qty: clampInt(payload.qty, 99999),
        counts,
      });
    }
  } else {
    throw new Error('Indiquez frames[] ou sku + compteurs');
  }

  meta.sauna_frame_tracker = {
    frames: nextFrames,
    updated_at: new Date().toISOString(),
  };

  await writeProjectMeta(projectId, meta);
  return getSaunaCloudBoard(projectId);
}

export async function resetFrameTracker(projectId) {
  const { rows } = await pool.query('SELECT * FROM projects WHERE id = $1', [projectId]);
  if (!rows[0]) throw new Error('Projet Sauna Cloud introuvable');
  const meta = parseMeta(rows[0].meta);
  meta.sauna_frame_tracker = {
    frames: defaultTrackerRows(),
    updated_at: new Date().toISOString(),
  };
  await writeProjectMeta(projectId, meta);
  return getSaunaCloudBoard(projectId);
}

export async function setFrameStatus(frameId, status) {
  const next = status === 'done' ? 'done' : status === 'doing' ? 'doing' : 'todo';
  const { rows } = await pool.query(
    `UPDATE tasks SET status = $1
     WHERE id = $2
     RETURNING id, project_id, title, description, type, status, sort_order, estimated_minutes, created_at`,
    [next, frameId]
  );
  if (!rows[0]) throw new Error('Frame introuvable');

  try {
    const { syncProjectStatusFromTasks } = await import('./project-status-sync.js');
    await syncProjectStatusFromTasks(rows[0].project_id);
  } catch { /* optional */ }

  return rows[0];
}

export async function setFrameNotes(frameId, notes) {
  const { rows } = await pool.query(
    `UPDATE tasks SET description = $1
     WHERE id = $2
     RETURNING id, project_id, title, description, type, status, sort_order, estimated_minutes, created_at`,
    [notes == null ? '' : String(notes), frameId]
  );
  if (!rows[0]) throw new Error('Frame introuvable');
  return rows[0];
}

export async function setProjectNotes(projectId, notes) {
  const { rows } = await pool.query(
    `UPDATE projects SET notes = $1 WHERE id = $2 RETURNING id, name, status, notes, deadline, client_id`,
    [notes == null ? '' : String(notes), projectId]
  );
  if (!rows[0]) throw new Error('Projet Sauna Cloud introuvable');
  return rows[0];
}

export async function addFrame(projectId, { title, notes = '' } = {}) {
  const name = String(title || '').trim();
  if (!name) throw new Error('Titre de frame requis');
  const { rows: max } = await pool.query(
    'SELECT COALESCE(MAX(sort_order), -1) AS m FROM tasks WHERE project_id = $1',
    [projectId]
  );
  const sort = Number(max[0]?.m ?? -1) + 1;
  const { rows } = await pool.query(
    `INSERT INTO tasks (project_id, title, type, status, estimated_minutes, sort_order, description)
     VALUES ($1, $2, 'assemblage', 'todo', 120, $3, $4)
     RETURNING id, project_id, title, description, type, status, sort_order, estimated_minutes, created_at`,
    [projectId, name, sort, String(notes || '')]
  );
  return rows[0];
}

export async function deleteFrame(frameId) {
  const { rowCount } = await pool.query('DELETE FROM tasks WHERE id = $1', [frameId]);
  if (!rowCount) throw new Error('Frame introuvable');
  return { ok: true };
}

export async function renameFrame(frameId, title) {
  const name = String(title || '').trim();
  if (!name) throw new Error('Titre requis');
  const { rows } = await pool.query(
    `UPDATE tasks SET title = $1 WHERE id = $2
     RETURNING id, project_id, title, description, type, status, sort_order, estimated_minutes, created_at`,
    [name, frameId]
  );
  if (!rows[0]) throw new Error('Frame introuvable');
  return rows[0];
}

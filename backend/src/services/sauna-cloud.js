import pool from '../db/pool.js';

export const SAUNA_CLOUD_PROJECT_NAME = 'Sauna Cloud';

/** Frames / étapes de fabrication par défaut pour Sauna Cloud */
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

export async function ensureSaunaCloudProject() {
  const { rows } = await pool.query(
    `SELECT * FROM projects
     WHERE LOWER(TRIM(name)) IN ('sauna cloud', 'sonacloud', 'sauna cloud ')
     ORDER BY id ASC
     LIMIT 1`
  );

  let project = rows[0];
  if (!project) {
    const { rows: created } = await pool.query(
      `INSERT INTO projects (name, status, notes, budget_estimated)
       VALUES ($1, 'active', $2, 0)
       RETURNING *`,
      [
        SAUNA_CLOUD_PROJECT_NAME,
        'Suivi fabrication Sauna Cloud — cocher les frames au fur et à mesure.',
      ]
    );
    project = created[0];
  }

  const { rows: tasks } = await pool.query(
    `SELECT * FROM tasks WHERE project_id = $1 ORDER BY sort_order ASC, id ASC`,
    [project.id]
  );

  if (tasks.length === 0) {
    for (let i = 0; i < DEFAULT_SAUNA_FRAMES.length; i++) {
      const f = DEFAULT_SAUNA_FRAMES[i];
      await pool.query(
        `INSERT INTO tasks (project_id, title, type, status, estimated_minutes, sort_order, description)
         VALUES ($1, $2, $3, 'todo', 120, $4, '')`,
        [project.id, f.title, f.type, i]
      );
    }
  }

  return getSaunaCloudBoard(project.id);
}

export async function getSaunaCloudBoard(projectId = null) {
  let project;
  if (projectId) {
    const { rows } = await pool.query('SELECT * FROM projects WHERE id = $1', [projectId]);
    project = rows[0];
  }
  if (!project) {
    return ensureSaunaCloudProject();
  }

  const { rows: frames } = await pool.query(
    `SELECT id, project_id, title, description, type, status, sort_order, estimated_minutes,
            start_time, end_time, created_at
     FROM tasks
     WHERE project_id = $1
     ORDER BY sort_order ASC, id ASC`,
    [project.id]
  );

  const done = frames.filter(f => f.status === 'done').length;
  const total = frames.length;
  const pct = total ? Math.round((done / total) * 100) : 0;

  return {
    project: {
      id: project.id,
      name: project.name,
      status: project.status,
      notes: project.notes || '',
      deadline: project.deadline,
      client_id: project.client_id,
    },
    frames,
    progress: { done, total, pct },
  };
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

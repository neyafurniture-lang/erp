import pool from '../db/pool.js';

/**
 * Aligne le statut du projet après un changement de tâche.
 * - Dernière tâche passée à done → projet done
 * - Une tâche rouverte → projet active
 * - Rouverture manuelle du projet (toutes tâches déjà done) n'est pas écrasée
 *   tant qu'aucune tâche n'est modifiée.
 */
export async function syncProjectStatusFromTasks(projectId, opts = {}, client = pool) {
  if (!projectId) return null;
  const { fromStatus, toStatus } = opts;

  const { rows: counts } = await client.query(
    `SELECT
       COUNT(*)::int AS total,
       COUNT(*) FILTER (WHERE status != 'done')::int AS open
     FROM tasks
     WHERE project_id = $1`,
    [projectId]
  );
  const { total, open } = counts[0] || { total: 0, open: 0 };
  if (!total) return null;

  const { rows: projects } = await client.query(
    'SELECT id, status FROM projects WHERE id = $1',
    [projectId]
  );
  const project = projects[0];
  if (!project) return null;

  const justCompleted = fromStatus !== 'done' && toStatus === 'done';
  const justReopenedTask = fromStatus === 'done' && toStatus && toStatus !== 'done';
  const taskDeleted = opts.deleted === true;

  if ((justReopenedTask || (taskDeleted && open > 0)) && project.status === 'done') {
    const { rows } = await client.query(
      `UPDATE projects SET status = 'active' WHERE id = $1 RETURNING *`,
      [projectId]
    );
    return rows[0];
  }

  if (open > 0 && project.status === 'done' && justReopenedTask) {
    const { rows } = await client.query(
      `UPDATE projects SET status = 'active' WHERE id = $1 RETURNING *`,
      [projectId]
    );
    return rows[0];
  }

  if (justCompleted && open === 0 && project.status !== 'done') {
    const { rows } = await client.query(
      `UPDATE projects SET status = 'done' WHERE id = $1 RETURNING *`,
      [projectId]
    );
    return rows[0];
  }

  // Suppression de la dernière tâche ouverte → projet done
  if (taskDeleted && open === 0 && project.status !== 'done') {
    const { rows } = await client.query(
      `UPDATE projects SET status = 'done' WHERE id = $1 RETURNING *`,
      [projectId]
    );
    return rows[0];
  }

  return project;
}

/** Migration ponctuelle : ferme les actifs déjà 100 % done. */
export async function closeFullyDoneActiveProjects() {
  const { rows } = await pool.query(`
    UPDATE projects p
    SET status = 'done'
    WHERE p.status = 'active'
      AND EXISTS (SELECT 1 FROM tasks t WHERE t.project_id = p.id)
      AND NOT EXISTS (SELECT 1 FROM tasks t WHERE t.project_id = p.id AND t.status != 'done')
    RETURNING id, name
  `);
  return rows;
}

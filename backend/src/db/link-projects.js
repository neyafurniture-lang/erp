/**
 * Lie les projets actifs aux standards et injecte les tâches de fabrication.
 * Usage: npm run db:link-projects
 */
import pool from './pool.js';

const LINKS = [
  { projectName: 'Tabourets', standardSku: 'MÕA' },
];

const SEED_TAG = 'from-standard';

async function getStandard(client, sku) {
  const { rows } = await client.query(
    `SELECT * FROM standards WHERE product_type = $1 OR meta->>'sku' = $1 LIMIT 1`,
    [sku]
  );
  return rows[0];
}

async function getProject(client, name) {
  const { rows } = await client.query(
    `SELECT * FROM projects WHERE name ILIKE $1 ORDER BY id DESC LIMIT 1`,
    [name]
  );
  return rows[0];
}

async function link() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const { projectName, standardSku } of LINKS) {
      const project = await getProject(client, projectName);
      const standard = await getStandard(client, standardSku);
      if (!project) {
        console.log(`⚠ Projet introuvable : ${projectName}`);
        continue;
      }
      if (!standard) {
        console.log(`⚠ Standard introuvable : ${standardSku}`);
        continue;
      }

      await client.query('UPDATE projects SET standard_id = $1 WHERE id = $2', [standard.id, project.id]);

      const steps = typeof standard.steps === 'string' ? JSON.parse(standard.steps) : standard.steps;
      const { rows: existing } = await client.query(
        `SELECT title FROM tasks WHERE project_id = $1 AND description LIKE $2`,
        [project.id, `%${SEED_TAG}%`]
      );
      const existingTitles = new Set(existing.map(t => t.title));

      let added = 0;
      for (const step of steps) {
        const title = step.description || step.phase;
        if (existingTitles.has(title)) continue;
        await client.query(
          `INSERT INTO tasks (project_id, title, description, type, status, estimated_minutes)
           VALUES ($1,$2,$3,$4,'todo',$5)`,
          [
            project.id,
            title,
            `${SEED_TAG}:${standardSku} | ${step.instructions || ''}`,
            step.phase || 'admin',
            step.estimated_minutes || 60,
          ]
        );
        added++;
      }

      console.log(`✓ ${projectName} ← standard ${standardSku} (${added} tâches ajoutées, ${steps.length} au total)`);
    }

    await client.query('COMMIT');
    console.log('\nProjets liés. Ouvre Projets → Tabourets pour voir les étapes MÕA.');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

link().catch(err => {
  console.error('Erreur:', err.message);
  process.exit(1);
});

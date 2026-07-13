/**
 * Importe le planning semaine du 28 juin → 3 juillet 2026
 * Usage: npm run db:seed-week
 */
import pool from './pool.js';

const WEEK_START = '2026-06-28';
const WEEK_END = '2026-07-04';
const SEED_TAG = 'planning-semaine-2026-06-28';

function slot(date, h1, m1, h2, m2) {
  const p = (n) => String(n).padStart(2, '0');
  return {
    start: `${date}T${p(h1)}:${p(m1)}:00-04:00`,
    end: `${date}T${p(h2)}:${p(m2)}:00-04:00`,
  };
}

const PROJECTS = [
  {
    name: 'Déménagement',
    status: 'active',
    deadline: '2026-06-28',
    notes: 'Objectif : start déménagement sans stress. 10% organisation perso.',
  },
  {
    name: 'Tabourets',
    status: 'active',
    deadline: '2026-07-01',
    notes: 'Finition / livraison — priorité lundi si CNC OK.',
  },
  {
    name: 'Pharmacie Anne',
    status: 'active',
    deadline: '2026-07-03',
    notes: 'Installation vendredi après-midi. Portes jeudi.',
  },
  {
    name: 'Rampe Son',
    status: 'active',
    deadline: '2026-07-03',
    notes: 'Vendredi matin — livraison / installation.',
  },
];

function tasksForProjects(projectIds) {
  const P = projectIds;
  return [
    // ── DIMANCHE 28 ──
    { project: P['Déménagement'], title: 'Début déménagement léger', type: 'admin', ...slot('2026-06-28', 8, 0, 11, 0), description: SEED_TAG },
    { project: P['Déménagement'], title: 'Enlever cadres + vider bureau', type: 'admin', ...slot('2026-06-28', 8, 30, 10, 30), description: SEED_TAG },
    { project: P['Déménagement'], title: 'Préparer déplacement ordi / outils', type: 'admin', ...slot('2026-06-28', 9, 0, 11, 0), description: SEED_TAG },
    { project: P['Déménagement'], title: '11h → Louise arrive', type: 'admin', ...slot('2026-06-28', 11, 0, 12, 0), description: SEED_TAG },
    { project: P['Déménagement'], title: '13h → Récupération clés nouvel appart', type: 'admin', ...slot('2026-06-28', 13, 0, 14, 0), description: SEED_TAG },
    { project: P['Déménagement'], title: 'Transition + organisation nouveau logement', type: 'admin', ...slot('2026-06-28', 14, 0, 18, 0), description: SEED_TAG },
    { project: P['Déménagement'], title: 'Si énergie : session atelier OU planification semaine', type: 'admin', ...slot('2026-06-28', 16, 0, 18, 0), description: SEED_TAG },

    // ── LUNDI 29 — JOUR CRITIQUE ──
    { project: P['Tabourets'], title: '🔥 CNC banc 57"', type: 'usinage', ...slot('2026-06-29', 8, 0, 11, 0), description: `${SEED_TAG} | JOUR CRITIQUE ATELIER` },
    { project: P['Tabourets'], title: '🔥 CNC banc 38"', type: 'usinage', ...slot('2026-06-29', 11, 0, 14, 0), description: `${SEED_TAG} | JOUR CRITIQUE ATELIER` },
    { project: P['Tabourets'], title: '🔥 Délignage 5/4 banc tops', type: 'debitage', ...slot('2026-06-29', 14, 0, 17, 0), description: `${SEED_TAG} | JOUR CRITIQUE ATELIER` },
    { project: P['Tabourets'], title: 'Suivi tabourets — finition / livraison', type: 'finition', ...slot('2026-06-29', 16, 0, 18, 0), description: SEED_TAG },

    // ── MARDI 30 — Pharmacie ──
    { project: P['Pharmacie Anne'], title: 'Poignées pharmacie', type: 'assemblage', ...slot('2026-06-30', 8, 0, 11, 0), description: SEED_TAG },
    { project: P['Pharmacie Anne'], title: 'Sablage intérieur + colle', type: 'finition', ...slot('2026-06-30', 11, 0, 15, 0), description: SEED_TAG },
    { project: P['Pharmacie Anne'], title: 'Bandes de chant', type: 'assemblage', ...slot('2026-06-30', 15, 0, 18, 0), description: SEED_TAG },
    { project: P['Tabourets'], title: 'Finition tabourets (si pas fini lundi)', type: 'finition', ...slot('2026-06-30', 16, 0, 18, 0), description: SEED_TAG },

    // ── MERCREDI 1er juillet ──
    { project: P['Pharmacie Anne'], title: 'Tablette milieu pharmacie', type: 'assemblage', ...slot('2026-07-01', 8, 0, 12, 0), description: SEED_TAG },
    { project: P['Pharmacie Anne'], title: 'Avancement pharmacie — suite', type: 'finition', ...slot('2026-07-01', 13, 0, 17, 0), description: SEED_TAG },
    { project: P['Tabourets'], title: 'Finition tabourets — reprise si besoin', type: 'finition', ...slot('2026-07-01', 15, 0, 17, 0), description: SEED_TAG },

    // ── JEUDI 2 ──
    { project: P['Pharmacie Anne'], title: 'Récupération portes pharmacie', type: 'admin', ...slot('2026-07-02', 8, 0, 10, 0), description: SEED_TAG },
    { project: P['Pharmacie Anne'], title: 'Préparation installation vendredi', type: 'assemblage', ...slot('2026-07-02', 10, 0, 14, 0), description: SEED_TAG },
    { project: P['Pharmacie Anne'], title: 'Finition + vernis 1ère couche', type: 'finition', ...slot('2026-07-02', 14, 0, 18, 0), description: SEED_TAG },

    // ── VENDREDI 3 ──
    { project: P['Rampe Son'], title: '🔥 Rampe Son — matin', type: 'assemblage', ...slot('2026-07-03', 8, 0, 12, 0), description: SEED_TAG },
    { project: P['Pharmacie Anne'], title: '🔥 Pharmacie Anne — installation + finition', type: 'assemblage', ...slot('2026-07-03', 13, 0, 18, 0), description: SEED_TAG },
  ];
}

async function upsertClient(client, name) {
  const existing = await client.query('SELECT id FROM clients WHERE name ILIKE $1 LIMIT 1', [name]);
  if (existing.rows[0]) return existing.rows[0].id;
  const { rows } = await client.query('INSERT INTO clients (name) VALUES ($1) RETURNING id', [name]);
  return rows[0].id;
}

async function upsertProject(client, { name, client_id, status, deadline, notes }) {
  const existing = await client.query('SELECT id FROM projects WHERE name = $1 LIMIT 1', [name]);
  if (existing.rows[0]) {
    await client.query(
      'UPDATE projects SET status = $2, deadline = $3, notes = $4, client_id = COALESCE($5, client_id) WHERE id = $1',
      [existing.rows[0].id, status, deadline, notes, client_id]
    );
    return existing.rows[0].id;
  }
  const { rows } = await client.query(
    `INSERT INTO projects (name, client_id, status, deadline, notes) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [name, client_id, status, deadline, notes]
  );
  return rows[0].id;
}

async function seed() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      `DELETE FROM tasks WHERE description LIKE $1 OR (start_time >= $2::date AND start_time < $3::date AND description IS NULL)`,
      [`%${SEED_TAG}%`, WEEK_START, WEEK_END]
    );

    const anneId = await upsertClient(client, 'Anne');
    const sonId = await upsertClient(client, 'Son');

    const projectIds = {};
    for (const p of PROJECTS) {
      const client_id = p.name.includes('Anne') ? anneId : p.name.includes('Son') ? sonId : null;
      projectIds[p.name] = await upsertProject(client, { ...p, client_id });
    }

    const tasks = tasksForProjects(projectIds);
    let count = 0;
    for (const t of tasks) {
      await client.query(
        `INSERT INTO tasks (project_id, title, description, type, status, estimated_minutes, sort_order)
         VALUES ($1,$2,$3,$4,'todo',NULL,$5)`,
        [t.project, t.title, t.description, t.type, count]
      );
      count++;
    }

    await client.query('COMMIT');
    console.log(`✓ Planning importé : ${count} tâches, ${PROJECTS.length} projets (${WEEK_START} → ${WEEK_END})`);
    console.log('  Projets :', Object.keys(projectIds).join(', '));
    console.log('  Règle semaine : 70% atelier · 20% admin cash · 10% perso/déménagement');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch(err => {
  console.error('Erreur seed:', err.message);
  process.exit(1);
});

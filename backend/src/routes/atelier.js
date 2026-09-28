import { Router } from 'express';
import pool from '../db/pool.js';
import { getSetting, setSetting } from '../services/settings.js';
import * as drive from '../services/google-drive.js';
import {
  assertCanAccessFile,
  filterSearchResults,
  getRequestUser,
} from '../services/drive-access.js';

const router = Router();

const SETTINGS = {
  address: 'atelier_zotique_address',
  floor: 'atelier_zotique_floor',
  driveFileId: 'atelier_zotique_drive_file_id',
  glbUrl: 'atelier_zotique_glb_url',
  notes: 'atelier_zotique_notes',
  projectId: 'atelier_zotique_project_id',
};

const DEFAULT_ADDRESS = '200 Zotique, Montréal';
const DEFAULT_FLOOR = '1er étage';
const NEED_TAG = 'atelier-zotique';

/** Liste de départ — déménagement / fit-out atelier. */
export const ZOTIQUE_SEED_NEEDS = [
  { title: 'Éclairage atelier LED (plafonniers / rails)', category: 'outil', quantity: 1, unit: 'lot', priority: 'urgent', notes: '200 Zotique · 1er — couverture bancs + zones machines' },
  { title: 'Prises / circuits électriques atelier (électricien)', category: 'autre', quantity: 1, unit: 'job', priority: 'urgent', notes: '220 V machines + éclairage' },
  { title: 'Collecteur de poussière + tuyauterie', category: 'outil', quantity: 1, unit: 'kit', priority: 'urgent', notes: 'Selon plan 3D — positions machines' },
  { title: 'Établi / table de travail', category: 'outil', quantity: 2, unit: 'unité', priority: 'normal', notes: 'Hauteur confortable, surface stable' },
  { title: 'Rayonnage / rack bois & panneaux', category: 'materiaux', quantity: 1, unit: 'lot', priority: 'urgent', notes: 'Stock vertical panneaux' },
  { title: 'Supports machines / isolation vibration', category: 'outil', quantity: 1, unit: 'lot', priority: 'normal', notes: 'Selon implantation 3D' },
  { title: 'Chariot panneaux / scrap', category: 'outil', quantity: 2, unit: 'unité', priority: 'normal', notes: '' },
  { title: 'Compresseur + réseau air (si prévu)', category: 'outil', quantity: 1, unit: 'unité', priority: 'normal', notes: 'Optionnel selon layout' },
  { title: 'Extincteurs + trousse premiers soins', category: 'autre', quantity: 1, unit: 'kit', priority: 'urgent', notes: 'Conformité local' },
  { title: 'Étagères quincaillerie / bacs', category: 'quincaillerie', quantity: 1, unit: 'lot', priority: 'normal', notes: 'Vis, colles, abrasifs' },
  { title: 'Boîtes / caisses déménagement atelier', category: 'emballage', quantity: 20, unit: 'unité', priority: 'urgent', notes: 'Étiquetage zones du plan 3D' },
  { title: 'Ruban, étiquettes, marqueurs zones', category: 'consommable', quantity: 1, unit: 'lot', priority: 'normal', notes: '' },
  { title: 'Aspiration / balai industriel', category: 'outil', quantity: 1, unit: 'unité', priority: 'normal', notes: '' },
  { title: 'Rideau / séparation poussière (si besoin)', category: 'materiaux', quantity: 1, unit: 'lot', priority: 'normal', notes: 'Selon plan' },
];

function isModel3dName(name = '') {
  return /\.(glb|gltf)$/i.test(name);
}

function isCad3dName(name = '') {
  return /\.(skp|obj|stl|fbx|3ds|step|stp)$/i.test(name);
}

async function readConfig() {
  const [
    address,
    floor,
    driveFileId,
    glbUrl,
    notes,
    projectId,
  ] = await Promise.all([
    getSetting(SETTINGS.address),
    getSetting(SETTINGS.floor),
    getSetting(SETTINGS.driveFileId),
    getSetting(SETTINGS.glbUrl),
    getSetting(SETTINGS.notes),
    getSetting(SETTINGS.projectId),
  ]);
  return {
    address: String(address || DEFAULT_ADDRESS),
    floor: String(floor || DEFAULT_FLOOR),
    drive_file_id: driveFileId ? String(driveFileId) : null,
    glb_url: glbUrl ? String(glbUrl) : null,
    notes: notes ? String(notes) : '',
    project_id: projectId ? Number(projectId) : null,
  };
}

async function ensureProject(config) {
  if (config.project_id) {
    const { rows } = await pool.query('SELECT id, name FROM projects WHERE id = $1', [config.project_id]);
    if (rows[0]) return rows[0];
  }
  const name = 'Atelier 200 Zotique — 1er étage';
  const { rows: existing } = await pool.query(
    `SELECT id, name FROM projects
     WHERE LOWER(name) LIKE '%zotique%' OR LOWER(name) LIKE '%nouvel atelier%'
     ORDER BY id DESC LIMIT 1`
  );
  if (existing[0]) {
    await setSetting(SETTINGS.projectId, existing[0].id);
    return existing[0];
  }
  const { rows } = await pool.query(
    `INSERT INTO projects (name, status, notes, meta)
     VALUES ($1, 'active', $2, $3::jsonb)
     RETURNING id, name`,
    [
      name,
      'Déménagement atelier — 200 Zotique, 1er étage. Modèle 3D + liste d’achats.',
      JSON.stringify({ atelier_zotique: true, address: DEFAULT_ADDRESS, floor: DEFAULT_FLOOR }),
    ]
  );
  await setSetting(SETTINGS.projectId, rows[0].id);
  return rows[0];
}

router.get('/', async (req, res) => {
  try {
    const config = await readConfig();
    const project = await ensureProject(config);
    let driveFile = null;
    if (config.drive_file_id) {
      try {
        const user = await getRequestUser(req);
        await assertCanAccessFile(user, config.drive_file_id);
        driveFile = await drive.getFile(config.drive_file_id);
      } catch {
        driveFile = null;
      }
    }

    const { rows: needs } = await pool.query(
      `SELECT n.*, p.name AS project_name
       FROM purchase_needs n
       LEFT JOIN projects p ON p.id = n.project_id
       WHERE n.project_id = $1
          OR (n.notes IS NOT NULL AND n.notes ILIKE '%' || $2 || '%')
       ORDER BY
         CASE n.status WHEN 'needed' THEN 0 WHEN 'ordered' THEN 1 ELSE 2 END,
         CASE n.priority WHEN 'urgent' THEN 0 ELSE 1 END,
         n.created_at DESC`,
      [project.id, NEED_TAG]
    );

    const modelKind = driveFile
      ? (isModel3dName(driveFile.name) ? 'model3d' : isCad3dName(driveFile.name) ? 'cad3d' : 'other')
      : (config.glb_url ? 'model3d' : null);

    res.json({
      ...config,
      project,
      drive_file: driveFile,
      model_kind: modelKind,
      needs,
      seed_count: ZOTIQUE_SEED_NEEDS.length,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/', async (req, res) => {
  try {
    const body = req.body || {};
    if (body.address !== undefined) await setSetting(SETTINGS.address, String(body.address || DEFAULT_ADDRESS));
    if (body.floor !== undefined) await setSetting(SETTINGS.floor, String(body.floor || DEFAULT_FLOOR));
    if (body.notes !== undefined) await setSetting(SETTINGS.notes, String(body.notes || ''));
    if (body.glb_url !== undefined) {
      const url = String(body.glb_url || '').trim();
      await setSetting(SETTINGS.glbUrl, url || '');
    }
    if (body.drive_file_id !== undefined) {
      const id = body.drive_file_id ? String(body.drive_file_id).trim() : '';
      if (id) {
        const user = await getRequestUser(req);
        await assertCanAccessFile(user, id);
        await setSetting(SETTINGS.driveFileId, id);
      } else {
        await setSetting(SETTINGS.driveFileId, '');
      }
    }
    if (body.project_id !== undefined && body.project_id) {
      await setSetting(SETTINGS.projectId, Number(body.project_id));
    }
    const config = await readConfig();
    const project = await ensureProject(config);
    res.json({ ...config, project });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** Cherche sur Drive les fichiers 3D (assemblage atelier / Zotique / clients / production). */
router.get('/find-3d', async (req, res) => {
  try {
    const user = await getRequestUser(req);
    const queries = [
      String(req.query.q || '').trim(),
      'zotique',
      'atelier assemblage',
      'assemblage atelier',
      'nouvel atelier',
      'production atelier',
    ].filter(Boolean);

    const seen = new Set();
    const files = [];
    for (const q of queries) {
      try {
        const data = await drive.searchFiles(q);
        const filtered = await filterSearchResults(user, data.files || []);
        for (const f of filtered) {
          if (!f?.id || seen.has(f.id) || f.isFolder) continue;
          const name = f.name || '';
          if (!isModel3dName(name) && !isCad3dName(name)) continue;
          seen.add(f.id);
          files.push({
            ...f,
            kind: isModel3dName(name) ? 'model3d' : 'cad3d',
          });
        }
      } catch {
        /* query partial failure OK */
      }
      if (files.length >= 40) break;
    }

    files.sort((a, b) => {
      const score = (f) => {
        const n = String(f.name || '').toLowerCase();
        let s = 0;
        if (n.includes('zotique')) s += 5;
        if (n.includes('atelier')) s += 3;
        if (n.includes('assemblage') || n.includes('assembly')) s += 3;
        if (f.kind === 'model3d') s += 2;
        return s;
      };
      return score(b) - score(a);
    });

    res.json({ files: files.slice(0, 30) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/seed-needs', async (req, res) => {
  try {
    const config = await readConfig();
    const project = await ensureProject(config);
    const created = [];
    const skipped = [];

    for (const item of ZOTIQUE_SEED_NEEDS) {
      const { rows: dup } = await pool.query(
        `SELECT id FROM purchase_needs
         WHERE project_id = $1 AND LOWER(title) = LOWER($2)
         LIMIT 1`,
        [project.id, item.title]
      );
      if (dup[0]) {
        skipped.push(item.title);
        continue;
      }
      const notes = [item.notes, NEED_TAG].filter(Boolean).join(' · ');
      const { rows } = await pool.query(
        `INSERT INTO purchase_needs (title, category, quantity, unit, priority, status, project_id, notes, source)
         VALUES ($1,$2,$3,$4,$5,'needed',$6,$7,'manual')
         RETURNING *`,
        [item.title, item.category, item.quantity, item.unit, item.priority, project.id, notes]
      );
      created.push(rows[0]);
    }

    res.status(201).json({
      project,
      created: created.length,
      skipped: skipped.length,
      items: created,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;

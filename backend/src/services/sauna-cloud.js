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

/**
 * BOM Cutting Plan Sierra (PDF) — pièces par frame.
 * 2 longs + 2 shorts (périmètre) + traverses intérieures.
 */
export const SIERRA_CUTTING_BOM = {
  H2013: {
    label: '20×13"',
    long_in: 13,
    short_in: 20,
    long_count: 2,
    short_count: 2,
    traverse_in: 20,
    traverse_count: 2,
  },
  H2026: {
    label: '20×26"',
    long_in: 26,
    short_in: 20,
    long_count: 2,
    short_count: 2,
    traverse_in: 20,
    traverse_count: 4,
  },
  H2226: {
    label: '22×26"',
    long_in: 26,
    short_in: 22,
    long_count: 2,
    short_count: 2,
    traverse_in: 22,
    traverse_count: 4,
  },
  H3313: {
    label: '33×13"',
    long_in: 33,
    short_in: 13,
    long_count: 2,
    short_count: 2,
    traverse_in: 13,
    traverse_count: 2,
  },
  H3726: {
    label: '37×26"',
    long_in: 37,
    short_in: 26,
    long_count: 2,
    short_count: 2,
    traverse_in: 26,
    traverse_count: 4,
  },
};

export const SIERRA_PLAN_META = {
  title: 'Cutting plan — Sierra Frames',
  invoice: '#1026',
  pdf_url: '/docs/Cutting_Plan_Sierra_EN.pdf',
  notes: 'Stock structurel refendu ×2 · Traverses refendues ×4 · Planches 2×4 × 8 pi',
};

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

  return { frames, stages: SAUNA_FRAME_STAGES, size_logs: normalizeSizeLogs(saved?.size_logs) };
}

/** Notes de tailles (côtés / traverses) — clés = "20\"", valeurs = texte atelier. */
export function normalizeSizeLogs(raw) {
  const out = { sides: {}, traverses: {} };
  if (!raw || typeof raw !== 'object') return out;
  for (const kind of ['sides', 'traverses']) {
    const src = raw[kind];
    if (!src || typeof src !== 'object') continue;
    for (const [k, v] of Object.entries(src)) {
      const key = String(k || '').trim();
      if (!key) continue;
      out[kind][key] = String(v ?? '').slice(0, 2000);
    }
  }
  return out;
}

/**
 * Agrège les longueurs BOM pour la commande (qty × counts).
 * kind = 'sides' → longs + shorts ; 'traverses' → traverses.
 */
export function aggregatePieceSizes(frames = [], kind = 'sides') {
  const by = new Map();
  for (const row of frames) {
    const sku = String(row.sku || '').toUpperCase();
    const bom = SIERRA_CUTTING_BOM[sku];
    if (!bom) continue;
    const qty = Math.max(0, Math.round(Number(row.qty) || 0));
    if (!qty) continue;
    const add = (inches, count, role) => {
      if (!inches || !count) return;
      const length = `${inches}"`;
      const prev = by.get(length) || { length, inches: Number(inches), qty: 0, roles: {}, skus: [] };
      const pieceQty = count * qty;
      prev.qty += pieceQty;
      prev.roles[role] = (prev.roles[role] || 0) + pieceQty;
      if (!prev.skus.includes(sku)) prev.skus.push(sku);
      by.set(length, prev);
    };
    if (kind === 'traverses') {
      add(bom.traverse_in, bom.traverse_count, 'traverse');
    } else {
      add(bom.long_in, bom.long_count, 'long');
      add(bom.short_in, bom.short_count, 'short');
    }
  }
  return [...by.values()].sort((a, b) => b.inches - a.inches);
}

function piecesPerFrame(bom) {
  if (!bom) return 0;
  return (bom.long_count || 0) + (bom.short_count || 0) + (bom.traverse_count || 0);
}

/** Côtés de cadre = longs + shorts (périmètre). */
export function sidesPerFrame(bom) {
  if (!bom) return 0;
  return (bom.long_count || 0) + (bom.short_count || 0);
}

export function traversesPerFrame(bom) {
  if (!bom) return 0;
  return bom.traverse_count || 0;
}

/** Combien de frames n’ont pas encore atteint cette étape (pipeline exclusif). */
export function framesNotReachedStage(row, stageKey) {
  const qty = Number(row.qty) || 0;
  const counts = row.counts || {};
  const order = SAUNA_FRAME_STAGES.map((s) => s.key);
  const idx = order.indexOf(stageKey);
  if (idx < 0) return qty;
  // Frames déjà à cette étape ou plus loin
  const reached = order.slice(idx).reduce((s, k) => s + (Number(counts[k]) || 0), 0);
  return Math.max(0, qty - reached);
}

/** Expand n frames d’un SKU en compteurs de pièces (par longueur). */
export function expandPiecesForSku(sku, frameCount) {
  const n = Math.max(0, Math.round(Number(frameCount) || 0));
  const bom = SIERRA_CUTTING_BOM[String(sku || '').toUpperCase()];
  if (!bom || !n) {
    return {
      sku: String(sku || '').toUpperCase(),
      frames: n,
      pieces: 0,
      structural: 0,
      traverses: 0,
      by_length: {},
      bom: bom || null,
    };
  }
  const by_length = {};
  const add = (inches, count) => {
    if (!inches || !count) return;
    const key = `${inches}"`;
    by_length[key] = (by_length[key] || 0) + count;
  };
  add(bom.long_in, bom.long_count * n);
  add(bom.short_in, bom.short_count * n);
  add(bom.traverse_in, bom.traverse_count * n);
  const structural = (bom.long_count + bom.short_count) * n;
  const traverses = bom.traverse_count * n;
  return {
    sku: String(sku).toUpperCase(),
    frames: n,
    pieces: structural + traverses,
    structural,
    traverses,
    by_length,
    bom,
  };
}

function mergeLengthMaps(target, source) {
  for (const [k, v] of Object.entries(source || {})) {
    target[k] = (target[k] || 0) + v;
  }
  return target;
}

/**
 * Pour chaque étape : frames manquantes × BOM Sierra → pièces manquantes.
 * - debited : frames pas encore débitées (= à couper)
 * - in_progress : pas encore en assemblage
 * - done / delivered : idem
 */
export function computeSierraMissing(frames = []) {
  const by_sku = [];
  const by_stage = {};
  for (const st of SAUNA_FRAME_STAGES) {
    by_stage[st.key] = {
      key: st.key,
      label: st.label,
      frames: 0,
      pieces: 0,
      structural: 0,
      traverses: 0,
      by_length: {},
      rows: [],
    };
  }

  for (const row of frames) {
    const sku = String(row.sku || '').toUpperCase();
    const bom = SIERRA_CUTTING_BOM[sku];
    const remaining = Math.max(0, (Number(row.qty) || 0) - (
      SAUNA_FRAME_STAGES.reduce((s, st) => s + (Number(row.counts?.[st.key]) || 0), 0)
    ));
    const cutMissing = expandPiecesForSku(sku, remaining);
    const skuEntry = {
      sku,
      label: row.label || bom?.label || sku,
      qty: Number(row.qty) || 0,
      remaining,
      pieces_per_frame: piecesPerFrame(bom),
      sides_per_frame: sidesPerFrame(bom),
      traverses_per_frame: traversesPerFrame(bom),
      pieces_missing: cutMissing.pieces,
      structural_missing: cutMissing.structural,
      sides_missing: cutMissing.structural, // alias FR : côtés de cadre
      traverses_missing: cutMissing.traverses,
      by_length: cutMissing.by_length,
      has_bom: Boolean(bom),
      missing_by_stage: {},
    };

    for (const st of SAUNA_FRAME_STAGES) {
      const n = framesNotReachedStage(row, st.key);
      const exp = expandPiecesForSku(sku, n);
      skuEntry.missing_by_stage[st.key] = {
        frames: n,
        pieces: exp.pieces,
        structural: exp.structural,
        traverses: exp.traverses,
        by_length: exp.by_length,
      };
      const bucket = by_stage[st.key];
      bucket.frames += n;
      bucket.pieces += exp.pieces;
      bucket.structural += exp.structural;
      bucket.traverses += exp.traverses;
      mergeLengthMaps(bucket.by_length, exp.by_length);
      if (bom && n > 0) {
        bucket.rows.push({
          sku,
          label: skuEntry.label,
          frames: n,
          pieces: exp.pieces,
        });
      }
    }

    by_sku.push(skuEntry);
  }

  // Totaux « à débiter » = étape debited (pièces encore à couper)
  const to_cut = by_stage.debited;
  const length_list = Object.entries(to_cut.by_length)
    .map(([length, qty]) => ({ length, qty }))
    .sort((a, b) => parseFloat(b.length) - parseFloat(a.length));

  // Bois déjà débité = commande − encore à couper
  let orderSides = 0;
  let orderTrav = 0;
  let orderFrames = 0;
  for (const row of frames) {
    const sku = String(row.sku || '').toUpperCase();
    const bom = SIERRA_CUTTING_BOM[sku];
    const qty = Math.max(0, Math.round(Number(row.qty) || 0));
    orderFrames += qty;
    if (!bom) continue;
    orderSides += sidesPerFrame(bom) * qty;
    orderTrav += traversesPerFrame(bom) * qty;
  }
  const cut = {
    frames: Math.max(0, orderFrames - (to_cut.frames || 0)),
    sides: Math.max(0, orderSides - (to_cut.structural || 0)),
    traverses: Math.max(0, orderTrav - (to_cut.traverses || 0)),
    pieces: Math.max(0, orderSides + orderTrav - (to_cut.pieces || 0)),
  };

  return {
    plan: SIERRA_PLAN_META,
    bom: SIERRA_CUTTING_BOM,
    by_sku,
    by_stage,
    cut,
    to_cut: {
      frames: to_cut.frames,
      pieces: to_cut.pieces,
      structural: to_cut.structural,
      sides: to_cut.structural, // côtés de cadre
      traverses: to_cut.traverses,
      by_length: length_list,
    },
  };
}

export function enrichTrackerRow(row) {
  const placed = SAUNA_FRAME_STAGES.reduce((s, st) => s + (Number(row.counts?.[st.key]) || 0), 0);
  const remaining = Math.max(0, (Number(row.qty) || 0) - placed);
  const sku = String(row.sku || '').toUpperCase();
  const bom = SIERRA_CUTTING_BOM[sku] || null;
  const pieces_per_frame = piecesPerFrame(bom);
  const sides_per_frame = sidesPerFrame(bom);
  const traverses_per_frame = traversesPerFrame(bom);
  const pieces_missing = remaining * pieces_per_frame;
  const sides_missing = remaining * sides_per_frame;
  const traverses_missing = remaining * traverses_per_frame;
  const qty = Number(row.qty) || 0;
  const debitedCount = Number(row.counts?.debited) || 0;
  // Bois déjà coupé = frames placées (≥ débité, pipeline exclusif)
  const sides_cut = placed * sides_per_frame;
  const traverses_cut = placed * traverses_per_frame;
  // Bois compté dans la seule colonne « Débité »
  const sides_debited = debitedCount * sides_per_frame;
  const traverses_debited = debitedCount * traverses_per_frame;
  return {
    ...row,
    remaining,
    placed,
    bom,
    pieces_per_frame,
    sides_per_frame,
    traverses_per_frame,
    pieces_total: qty * pieces_per_frame,
    sides_total: qty * sides_per_frame,
    traverses_total: qty * traverses_per_frame,
    pieces_missing,
    sides_missing,
    traverses_missing,
    sides_cut,
    traverses_cut,
    sides_debited,
    traverses_debited,
  };
}

export function summarizeTracker(tracker) {
  const normalized = Array.isArray(tracker?.frames) || tracker?.size_logs
    ? tracker
    : { frames: tracker?.frames || tracker || [], size_logs: tracker?.size_logs };
  const frames = (normalized.frames || []).map(enrichTrackerRow);
  const size_logs = normalizeSizeLogs(normalized.size_logs);
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
    size_logs,
    size_breakdown: {
      sides: aggregatePieceSizes(frames, 'sides'),
      traverses: aggregatePieceSizes(frames, 'traverses'),
    },
    totals: {
      qty,
      remaining,
      debited,
      in_progress: inProgress,
      done,
      delivered,
      pct,
      complete,
      pieces_missing: frames.reduce((s, f) => s + (f.pieces_missing || 0), 0),
      sides_missing: frames.reduce((s, f) => s + (f.sides_missing || 0), 0),
      traverses_missing: frames.reduce((s, f) => s + (f.traverses_missing || 0), 0),
      pieces_total: frames.reduce((s, f) => s + (f.pieces_total || 0), 0),
      sides_total: frames.reduce((s, f) => s + (f.sides_total || 0), 0),
      traverses_total: frames.reduce((s, f) => s + (f.traverses_total || 0), 0),
      // Colonne « Débité » uniquement
      sides_debited: frames.reduce((s, f) => s + (f.sides_debited || 0), 0),
      traverses_debited: frames.reduce((s, f) => s + (f.traverses_debited || 0), 0),
      // Bois déjà coupé (débité + en cours + terminé + livré)
      sides_cut: frames.reduce((s, f) => s + (f.sides_cut || 0), 0),
      traverses_cut: frames.reduce((s, f) => s + (f.traverses_cut || 0), 0),
    },
    sierra: computeSierraMissing(frames),
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

/**
 * Fusionne un patch partiel dans projects.meta (jsonb ||).
 * Ne jamais y passer hours_logbook sauf intention explicite — sinon une
 * lecture périmée (Sauna Cloud) écrase le carnet d’heures.
 */
async function writeProjectMeta(projectId, patch, { allowHours = false } = {}) {
  const safe = { ...(patch || {}) };
  if (!allowHours) {
    delete safe.hours_logbook;
    delete safe.hours_logbook_prev;
  }
  if (!Object.keys(safe).length) return;
  await pool.query(
    `UPDATE projects SET meta = COALESCE(meta, '{}'::jsonb) || $1::jsonb WHERE id = $2`,
    [JSON.stringify(safe), projectId]
  );
}

async function ensureTrackerOnProject(project) {
  const meta = parseMeta(project.meta);
  if (meta.sauna_frame_tracker?.frames?.length) {
    return normalizeTracker(meta.sauna_frame_tracker);
  }
  const tracker = normalizeTracker(defaultTrackerRows());
  try {
    // Patch partiel uniquement — préserve hours_logbook / plans / etc.
    await writeProjectMeta(project.id, {
      sauna_frame_tracker: { frames: tracker.frames, updated_at: new Date().toISOString() },
    });
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
    sierra: tracker.sierra || computeSierraMissing(tracker.frames),
    frames,
    progress: {
      done: tracker.totals.delivered,
      total: tracker.totals.qty,
      pct: tracker.totals.pct,
      remaining: tracker.totals.remaining,
      complete: tracker.totals.complete,
      pieces_missing: tracker.totals.pieces_missing || 0,
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
  let sizeLogs = normalizeSizeLogs(current.size_logs || meta.sauna_frame_tracker?.size_logs);

  if (payload.size_logs !== undefined) {
    sizeLogs = normalizeSizeLogs(payload.size_logs);
  }

  if (Array.isArray(payload.frames)) {
    nextFrames = normalizeTracker({ frames: payload.frames, size_logs: sizeLogs }).frames;
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
  } else if (payload.size_logs === undefined) {
    throw new Error('Indiquez frames[], sku + compteurs, ou size_logs');
  }

  meta.sauna_frame_tracker = {
    frames: nextFrames,
    size_logs: sizeLogs,
    updated_at: new Date().toISOString(),
  };

  await writeProjectMeta(projectId, {
    sauna_frame_tracker: meta.sauna_frame_tracker,
  });
  return getSaunaCloudBoard(projectId);
}

export async function resetFrameTracker(projectId) {
  const { rows } = await pool.query('SELECT * FROM projects WHERE id = $1', [projectId]);
  if (!rows[0]) throw new Error('Projet Sauna Cloud introuvable');
  await writeProjectMeta(projectId, {
    sauna_frame_tracker: {
      frames: defaultTrackerRows(),
      size_logs: { sides: {}, traverses: {} },
      updated_at: new Date().toISOString(),
    },
  });
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

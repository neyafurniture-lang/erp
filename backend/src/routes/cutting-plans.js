import { Router } from 'express';
import pool from '../db/pool.js';
import {
  optimizeCuttingPlan,
  sierraFramesExample,
} from '../services/cutting-optimizer.js';
import { generateCuttingPlanPdf } from '../services/cutting-plan-pdf.js';
import { studioOptimize } from '../services/studio-optimize.js';

const router = Router();

async function ensureTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS cutting_plans (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL DEFAULT 'Plan de coupe',
      project_label TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      plan_input JSONB NOT NULL DEFAULT '{}',
      result_cache JSONB,
      project_id INT REFERENCES projects(id) ON DELETE SET NULL,
      created_by INT REFERENCES users(id) ON DELETE SET NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
}

let tableReady = null;
function ready() {
  if (!tableReady) tableReady = ensureTable().catch((err) => {
    tableReady = null;
    throw err;
  });
  return tableReady;
}

router.get('/', async (_req, res) => {
  try {
    await ready();
    const { rows } = await pool.query(
      `SELECT id, title, project_label, notes, project_id, created_at, updated_at,
              plan_input->>'date' AS plan_date,
              (result_cache->'purchase'->>'board_2x4_qty') AS board_qty,
              (result_cache->'purchase'->>'grand_taxed') AS grand_total
       FROM cutting_plans
       ORDER BY updated_at DESC NULLS LAST, id DESC
       LIMIT 100`,
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/example/sierra', async (_req, res) => {
  try {
    const input = sierraFramesExample();
    const result = optimizeCuttingPlan(input);
    res.json({ plan_input: input, result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/optimize', async (req, res) => {
  try {
    const planInput = req.body?.plan_input || req.body || {};
    const result = optimizeCuttingPlan(planInput);
    res.json({ plan_input: planInput, result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** Studio visuel — packing 1D/2D → layout éditable (Python si dispo). */
router.post('/studio/optimize', async (req, res) => {
  try {
    const result = await studioOptimize(req.body || {});
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/pdf', async (req, res) => {
  try {
    const planInput = req.body?.plan_input || req.body || {};
    let result = req.body?.result || null;
    if (!planInput.studio && !result) {
      result = optimizeCuttingPlan(planInput);
    }
    const buf = await generateCuttingPlanPdf(planInput, result);
    const safe = String(planInput.title || result?.title || 'cutting-plan')
      .replace(/[^a-zA-Z0-9._-]+/g, '_')
      .slice(0, 80);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${safe}.pdf"`);
    res.send(buf);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    await ready();
    const { rows } = await pool.query('SELECT * FROM cutting_plans WHERE id = $1', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Plan introuvable' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    await ready();
    const planInput = req.body?.plan_input || {};
    const title = req.body?.title || planInput.title || 'Plan de coupe';
    const project_label = req.body?.project_label || planInput.project_label || '';
    const notes = req.body?.notes || planInput.notes || '';
    const project_id = req.body?.project_id || null;
    const merged = { ...planInput, title, project_label, notes };
    const result = planInput.studio
      ? { studio: true, layout: planInput.layout || {}, boards: planInput.layout?.boards?.length || 0, sheets: planInput.layout?.sheets?.length || 0 }
      : optimizeCuttingPlan(merged);
    const { rows } = await pool.query(
      `INSERT INTO cutting_plans (title, project_label, notes, plan_input, result_cache, project_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        title,
        project_label,
        notes,
        JSON.stringify(merged),
        JSON.stringify(result),
        project_id,
        req.user?.id || null,
      ],
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    await ready();
    const existing = await pool.query('SELECT * FROM cutting_plans WHERE id = $1', [req.params.id]);
    if (!existing.rows[0]) return res.status(404).json({ error: 'Plan introuvable' });

    const planInput = req.body?.plan_input || existing.rows[0].plan_input || {};
    const title = req.body?.title ?? planInput.title ?? existing.rows[0].title;
    const project_label = req.body?.project_label ?? planInput.project_label ?? existing.rows[0].project_label;
    const notes = req.body?.notes ?? planInput.notes ?? existing.rows[0].notes;
    const project_id = req.body?.project_id !== undefined ? req.body.project_id : existing.rows[0].project_id;
    const merged = { ...planInput, title, project_label, notes };
    const result = merged.studio
      ? { studio: true, layout: merged.layout || {}, boards: merged.layout?.boards?.length || 0, sheets: merged.layout?.sheets?.length || 0 }
      : optimizeCuttingPlan(merged);

    const { rows } = await pool.query(
      `UPDATE cutting_plans
       SET title = $1, project_label = $2, notes = $3, plan_input = $4,
           result_cache = $5, project_id = $6, updated_at = NOW()
       WHERE id = $7
       RETURNING *`,
      [
        title,
        project_label,
        notes,
        JSON.stringify(merged),
        JSON.stringify(result),
        project_id,
        req.params.id,
      ],
    );
    res.json(rows[0]);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/:id/pdf', async (req, res) => {
  try {
    await ready();
    const { rows } = await pool.query('SELECT * FROM cutting_plans WHERE id = $1', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Plan introuvable' });
    const planInput = rows[0].plan_input || {};
    const result = rows[0].result_cache || optimizeCuttingPlan(planInput);
    const buf = await generateCuttingPlanPdf(planInput, result);
    const safe = String(rows[0].title || 'cutting-plan')
      .replace(/[^a-zA-Z0-9._-]+/g, '_')
      .slice(0, 80);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${safe}.pdf"`);
    res.send(buf);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await ready();
    await pool.query('DELETE FROM cutting_plans WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

export default router;

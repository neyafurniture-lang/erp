import { Router } from 'express';
import pool from '../db/pool.js';
import { listModules } from '../modules/registry.js';

const router = Router();

router.get('/', async (_req, res) => {
  try {
    const { rows } = await pool.query('SELECT id, enabled, settings FROM modules_config');
    const overrides = Object.fromEntries(rows.map(r => [r.id, r]));
    res.json(listModules(overrides));
  } catch {
    res.json(listModules());
  }
});

router.patch('/:id', async (req, res) => {
  try {
    const { enabled, settings } = req.body;
    await pool.query(
      `INSERT INTO modules_config (id, enabled, settings, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (id) DO UPDATE SET enabled = $2, settings = $3, updated_at = NOW()`,
      [req.params.id, enabled, JSON.stringify(settings || {})]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;

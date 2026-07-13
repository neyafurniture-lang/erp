import { Router } from 'express';
import pool from '../db/pool.js';
import {
  getCursorConfig,
  saveCursorConfig,
  getRuns,
  getRun,
  startAgentRun,
  startRoadmapAction,
  ROADMAP_ACTIONS,
  gatewayGitStatus,
  gatewayCreateBackup,
  gatewayRestoreBackup,
  gatewayCommit,
  gatewayPush,
  gatewayListBackups,
} from '../services/cursor-agent.js';

const router = Router();

async function requireAdmin(req, res) {
  const { rows } = await pool.query('SELECT role FROM users WHERE id = $1', [req.user.id]);
  if (rows[0]?.role !== 'admin') {
    res.status(403).json({ error: 'Réservé aux administrateurs' });
    return false;
  }
  return true;
}

router.get('/config', async (_req, res) => {
  try {
    res.json(await getCursorConfig());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/config', async (req, res) => {
  try {
    if (!(await requireAdmin(req, res))) return;
    res.json(await saveCursorConfig(req.body || {}));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/roadmap', (_req, res) => {
  res.json(ROADMAP_ACTIONS.map(({ id, label }) => ({ id, label })));
});

router.get('/runs', (_req, res) => {
  res.json(getRuns());
});

router.get('/runs/:id', (req, res) => {
  const run = getRun(req.params.id);
  if (!run) return res.status(404).json({ error: 'Run introuvable' });
  res.json(run);
});

router.post('/run', async (req, res) => {
  try {
    if (!(await requireAdmin(req, res))) return;
    const run = await startAgentRun({
      prompt: req.body?.prompt,
      label: req.body?.label,
      source: req.body?.source || 'manual',
    });
    res.status(202).json(run);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/roadmap/:id', async (req, res) => {
  try {
    if (!(await requireAdmin(req, res))) return;
    const run = await startRoadmapAction(req.params.id);
    res.status(202).json(run);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** Passerelle Git / backups via l'ERP */
router.get('/git', async (req, res) => {
  try {
    if (!(await requireAdmin(req, res))) return;
    res.json(await gatewayGitStatus());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/backups', async (req, res) => {
  try {
    if (!(await requireAdmin(req, res))) return;
    res.json(await gatewayListBackups());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/backups', async (req, res) => {
  try {
    if (!(await requireAdmin(req, res))) return;
    res.status(201).json(await gatewayCreateBackup(req.body?.label));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/backups/restore', async (req, res) => {
  try {
    if (!(await requireAdmin(req, res))) return;
    res.json(await gatewayRestoreBackup(req.body || {}));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/git/commit', async (req, res) => {
  try {
    if (!(await requireAdmin(req, res))) return;
    res.json(await gatewayCommit(req.body?.message));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/git/push', async (req, res) => {
  try {
    if (!(await requireAdmin(req, res))) return;
    res.json(await gatewayPush(req.body || {}));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

export default router;

import { Router } from 'express';
import {
  getCursorConfig,
  saveCursorConfig,
  getRuns,
  getRun,
  startAgentRun,
  startRoadmapAction,
  ROADMAP_ACTIONS,
} from '../services/cursor-agent.js';

const router = Router();

router.get('/config', async (_req, res) => {
  try {
    res.json(await getCursorConfig());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/config', async (req, res) => {
  try {
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
    const run = await startRoadmapAction(req.params.id);
    res.status(202).json(run);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

export default router;

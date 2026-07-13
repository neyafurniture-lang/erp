import { Router } from 'express';
import {
  getDashboardLayout,
  saveDashboardLayout,
  setEditMode,
  moveSection,
  reorderSections,
  addTodoSection,
  removeSection,
  setSectionVisible,
  DASHBOARD_SECTION_CATALOG,
} from '../services/ui-layout.js';

const router = Router();

router.get('/dashboard-layout', async (_req, res) => {
  try {
    res.json({
      layout: await getDashboardLayout(),
      catalog: DASHBOARD_SECTION_CATALOG,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/dashboard-layout', async (req, res) => {
  try {
    res.json(await saveDashboardLayout(req.body || {}));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/dashboard-layout/edit-mode', async (req, res) => {
  try {
    res.json(await setEditMode(req.body?.enabled !== false));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/dashboard-layout/move', async (req, res) => {
  try {
    const { section_id, direction } = req.body || {};
    if (!section_id || !['up', 'down'].includes(direction)) {
      return res.status(400).json({ error: 'section_id et direction (up|down) requis' });
    }
    res.json(await moveSection(section_id, direction));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/dashboard-layout/reorder', async (req, res) => {
  try {
    const ids = req.body?.ordered_ids;
    if (!Array.isArray(ids)) return res.status(400).json({ error: 'ordered_ids requis' });
    res.json(await reorderSections(ids));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/dashboard-layout/add-todo', async (req, res) => {
  try {
    res.json(await addTodoSection(req.body || {}));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/dashboard-layout/remove', async (req, res) => {
  try {
    res.json(await removeSection(req.body?.section_id));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/dashboard-layout/visibility', async (req, res) => {
  try {
    res.json(await setSectionVisible(req.body?.section_id, req.body?.visible !== false));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

export default router;

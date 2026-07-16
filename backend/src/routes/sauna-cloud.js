import { Router } from 'express';
import {
  addFrame,
  deleteFrame,
  ensureSaunaCloudProject,
  getSaunaCloudBoard,
  renameFrame,
  setFrameNotes,
  setFrameStatus,
  setProjectNotes,
} from '../services/sauna-cloud.js';

const router = Router();

router.get('/', async (_req, res) => {
  try {
    res.json(await ensureSaunaCloudProject());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/notes', async (req, res) => {
  try {
    const board = await ensureSaunaCloudProject();
    const project = await setProjectNotes(board.project.id, req.body?.notes);
    res.json({ project, board: await getSaunaCloudBoard(project.id) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/frames', async (req, res) => {
  try {
    const board = await ensureSaunaCloudProject();
    const frame = await addFrame(board.project.id, {
      title: req.body?.title,
      notes: req.body?.notes,
    });
    res.status(201).json({ frame, board: await getSaunaCloudBoard(board.project.id) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.patch('/frames/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    let frame = null;
    if (req.body?.status !== undefined) {
      frame = await setFrameStatus(id, req.body.status);
    }
    if (req.body?.notes !== undefined) {
      frame = await setFrameNotes(id, req.body.notes);
    }
    if (req.body?.title !== undefined) {
      frame = await renameFrame(id, req.body.title);
    }
    if (!frame) return res.status(400).json({ error: 'Rien à mettre à jour (status, notes ou title)' });
    const board = await getSaunaCloudBoard(frame.project_id);
    res.json({ frame, board });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/frames/:id', async (req, res) => {
  try {
    const board = await ensureSaunaCloudProject();
    await deleteFrame(Number(req.params.id));
    res.json({ ok: true, board: await getSaunaCloudBoard(board.project.id) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

export default router;

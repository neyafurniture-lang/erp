import { Router } from 'express';
import {
  readHabitsFile,
  writeHabitsFile,
  appendHabit,
  resolveHabitsPath,
} from '../services/atelier-habits.js';

const router = Router();

router.get('/', (req, res) => {
  try {
    res.json(readHabitsFile());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/', (req, res) => {
  try {
    const content = req.body?.content;
    if (typeof content !== 'string') {
      return res.status(400).json({ error: 'content (markdown) requis' });
    }
    res.json(writeHabitsFile(content));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/append', (req, res) => {
  try {
    const rule = req.body?.rule || req.body?.habit;
    const section = req.body?.section || 'Général';
    if (!rule) return res.status(400).json({ error: 'rule requis' });
    res.json(appendHabit({ section, rule }));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/path', (req, res) => {
  res.json({ path: resolveHabitsPath() });
});

export default router;

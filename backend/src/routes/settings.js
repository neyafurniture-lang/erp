import { Router } from 'express';
import { getPublicSettings, updateSettings, API_ROUTES } from '../services/settings.js';
import { seedDefaultSkills } from '../services/assistant.js';

const router = Router();

router.get('/', async (req, res) => {
  try {
    res.json(await getPublicSettings());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/', async (req, res) => {
  try {
    res.json(await updateSettings(req.body));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/api-routes', (req, res) => {
  res.json(API_ROUTES);
});

router.post('/seed-skills', async (req, res) => {
  try {
    await seedDefaultSkills();
    res.json({ ok: true, message: 'Skills par défaut ajoutées' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;

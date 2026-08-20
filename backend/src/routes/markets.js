import { Router } from 'express';
import multer from 'multer';
import {
  listMarketEvents,
  getMarketEvent,
  createMarketEvent,
  updateMarketEvent,
  deleteMarketEvent,
  importMarketContractFile,
  importSeedContractsFromDisk,
  scanMarketEmails,
  getMarketsSummary,
  ensureMarketEventsSchema,
  MARKET_STATUSES,
} from '../services/market-events.js';
import { parseMarketContractText } from '../services/market-contract-parse.js';

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024 },
});

router.get('/statuses', (_req, res) => {
  res.json(MARKET_STATUSES);
});

router.get('/summary', async (_req, res) => {
  try {
    res.json(await getMarketsSummary());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/', async (req, res) => {
  try {
    res.json(await listMarketEvents({ status: req.query.status, year: req.query.year }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const row = await getMarketEvent(Number(req.params.id));
    if (!row) return res.status(404).json({ error: 'Marché introuvable' });
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const row = await createMarketEvent(req.body);
    res.status(201).json(row);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const row = await updateMarketEvent(Number(req.params.id), req.body);
    res.json(row);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.patch('/:id', async (req, res) => {
  try {
    const row = await updateMarketEvent(Number(req.params.id), req.body);
    res.json(row);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    res.json(await deleteMarketEvent(Number(req.params.id)));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/import-contract', upload.single('contract'), async (req, res) => {
  try {
    if (!req.file?.buffer) return res.status(400).json({ error: 'PDF contrat requis (champ contract)' });
    const row = await importMarketContractFile({
      buffer: req.file.buffer,
      filename: req.file.originalname,
    });
    res.status(201).json(row);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/parse-contract-text', async (req, res) => {
  try {
    const text = req.body?.text || '';
    if (!text.trim()) return res.status(400).json({ error: 'text requis' });
    res.json(parseMarketContractText(text, { filename: req.body?.filename }));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/import-seed-contracts', async (_req, res) => {
  try {
    const rows = await importSeedContractsFromDisk();
    res.json({ imported: rows.length, rows });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/scan-mail', async (req, res) => {
  try {
    const max = Number(req.body?.max) || 25;
    res.json(await scanMarketEmails({ max }));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/reorder', async (req, res) => {
  try {
    await ensureMarketEventsSchema();
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
    for (let i = 0; i < ids.length; i++) {
      await updateMarketEvent(Number(ids[i]), { sort_order: (i + 1) * 10 });
    }
    res.json(await listMarketEvents());
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

export default router;

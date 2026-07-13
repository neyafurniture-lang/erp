import { Router } from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pool from '../db/pool.js';
import { imageFileFilter, safeImageExt } from '../middleware/security.js';
import { generateFichePdfAsync } from '../services/fiche-pdf.js';
import { syncStandardPhoto } from '../services/wordpress.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadDir = path.join(__dirname, '../../uploads/standards');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: uploadDir,
  filename: (_req, file, cb) => {
    cb(null, `block_${Date.now()}${safeImageExt(file.originalname)}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: imageFileFilter,
});

const router = Router();

router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM standards ORDER BY name');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/sync-photo', async (req, res) => {
  try {
    const result = await syncStandardPhoto(Number(req.params.id));
    res.json(result.standard);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/:id/upload', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Fichier image manquant' });
    res.json({ url: `/uploads/standards/${req.file.filename}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id/pdf', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM standards WHERE id = $1', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Standard introuvable' });
    const meta = typeof rows[0].meta === 'string' ? JSON.parse(rows[0].meta) : rows[0].meta;
    const sku = meta?.sku || rows[0].product_type || 'fiche';
    res.setHeader('Content-Disposition', `inline; filename="Fiche_${sku}.pdf"`);
    await generateFichePdfAsync(rows[0], res);
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM standards WHERE id = $1', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Standard introuvable' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const { name, product_type, meta, steps } = req.body;
    const { rows } = await pool.query(
      'INSERT INTO standards (name, product_type, meta, steps) VALUES ($1,$2,$3,$4) RETURNING *',
      [name, product_type, JSON.stringify(meta || {}), JSON.stringify(steps || [])]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const { name, product_type, meta, steps } = req.body;
    const { rows } = await pool.query(
      'UPDATE standards SET name=$1, product_type=$2, meta=$3, steps=$4 WHERE id=$5 RETURNING *',
      [name, product_type, JSON.stringify(meta || {}), JSON.stringify(steps), req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Standard introuvable' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM standards WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;

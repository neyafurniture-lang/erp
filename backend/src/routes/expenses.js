import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import pool from '../db/pool.js';
import { normalizePurchaseDate, todayISODate } from '../services/expense-date.js';

const RECEIPT_EXT = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.pdf']);

function receiptFileFilter(_req, file, cb) {
  const ext = path.extname(file.originalname || '').toLowerCase();
  const ok = (file.mimetype?.startsWith('image/') || file.mimetype === 'application/pdf')
    && RECEIPT_EXT.has(ext);
  cb(ok ? null : new Error('Reçu : images ou PDF uniquement'), ok);
}

function safeReceiptName(originalname) {
  const ext = path.extname(originalname || '').toLowerCase();
  return `${Date.now()}${RECEIPT_EXT.has(ext) ? ext : '.jpg'}`;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadDir = path.join(__dirname, '../../uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: uploadDir,
  filename: (_req, file, cb) => cb(null, safeReceiptName(file.originalname)),
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: receiptFileFilter,
});

const router = Router();

router.get('/', async (req, res) => {
  try {
    const { project_id, category, supplier_id, year, month } = req.query;
    let query = `
      SELECT e.*, p.name as project_name, s.name as supplier_name
      FROM expenses e
      LEFT JOIN projects p ON p.id = e.project_id
      LEFT JOIN suppliers s ON s.id = e.supplier_id
      WHERE 1=1
    `;
    const params = [];
    if (project_id) { params.push(project_id); query += ` AND e.project_id = $${params.length}`; }
    if (category) { params.push(category); query += ` AND e.category = $${params.length}`; }
    if (supplier_id) { params.push(supplier_id); query += ` AND e.supplier_id = $${params.length}`; }
    if (year) {
      params.push(Number(year));
      query += ` AND EXTRACT(YEAR FROM e.date) = $${params.length}`;
    }
    if (month) {
      params.push(Number(month));
      query += ` AND EXTRACT(MONTH FROM e.date) = $${params.length}`;
    }
    query += ' ORDER BY e.created_at DESC NULLS LAST, e.date DESC, e.id DESC';
    const { rows } = await pool.query(query, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', upload.single('receipt'), async (req, res) => {
  try {
    const { amount, category, description, project_id, date, supplier_id } = req.body;
    const receipt_url = req.file ? `/uploads/${req.file.filename}` : null;
    const expenseDate = normalizePurchaseDate(date) || todayISODate();
    const { rows } = await pool.query(
      `INSERT INTO expenses (amount, category, description, project_id, receipt_url, date, supplier_id)
       VALUES ($1,$2,$3,$4,$5,$6::date,$7) RETURNING *`,
      [
        amount,
        category || 'materiaux',
        description,
        project_id || null,
        receipt_url,
        expenseDate,
        supplier_id ? Number(supplier_id) : null,
      ]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM expenses WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;

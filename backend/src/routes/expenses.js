import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import pool from '../db/pool.js';
import { normalizePurchaseDate, todayISODate } from '../services/expense-date.js';
import { ensureMailExpenseSchema } from '../services/invoice-email-router.js';

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

let schemaReady;
async function ensureExpensesSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS suppliers (
          id SERIAL PRIMARY KEY,
          name TEXT NOT NULL,
          contact TEXT,
          email TEXT,
          phone TEXT,
          lead_days INT DEFAULT 7,
          notes TEXT,
          meta JSONB DEFAULT '{}',
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      await pool.query(
        'ALTER TABLE expenses ADD COLUMN IF NOT EXISTS supplier_id INT REFERENCES suppliers(id) ON DELETE SET NULL'
      );
      await pool.query('CREATE INDEX IF NOT EXISTS idx_expenses_supplier ON expenses(supplier_id)');
      await pool.query(`ALTER TABLE expenses ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'manual'`);
      await pool.query('ALTER TABLE expenses ADD COLUMN IF NOT EXISTS gmail_message_id TEXT');
      await pool.query(`ALTER TABLE expenses ADD COLUMN IF NOT EXISTS payment_status TEXT DEFAULT 'paid'`);
      await pool.query('ALTER TABLE expenses ADD COLUMN IF NOT EXISTS mail_from TEXT');
      await pool.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_expenses_gmail_message
        ON expenses(gmail_message_id) WHERE gmail_message_id IS NOT NULL
      `);
      await ensureMailExpenseSchema();
    })().catch((err) => {
      schemaReady = null;
      throw err;
    });
  }
  return schemaReady;
}

router.get('/', async (req, res) => {
  try {
    await ensureExpensesSchema();
    const { project_id, category, supplier_id, year, month, source, payment_status } = req.query;
    let query = `
      SELECT e.*, p.name as project_name, s.name as supplier_name,
             rs.drive_link AS receipt_drive_link,
             rs.drive_file_id AS receipt_drive_file_id,
             rs.id AS receipt_scan_id,
             sie.from_email AS mail_from_email,
             sie.subject AS mail_subject,
             sie.status AS mail_queue_status,
             sie.doc_kind AS mail_doc_kind,
             COALESCE(e.gmail_message_id, sie.gmail_message_id) AS mail_message_id
      FROM expenses e
      LEFT JOIN projects p ON p.id = e.project_id
      LEFT JOIN suppliers s ON s.id = e.supplier_id
      LEFT JOIN supplier_invoice_emails sie ON sie.expense_id = e.id
      LEFT JOIN LATERAL (
        SELECT id, drive_link, drive_file_id
        FROM receipt_scans
        WHERE expense_id = e.id
        ORDER BY id DESC
        LIMIT 1
      ) rs ON true
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
    if (source) {
      params.push(String(source));
      query += ` AND COALESCE(e.source, 'manual') = $${params.length}`;
    }
    if (payment_status) {
      params.push(String(payment_status));
      query += ` AND COALESCE(e.payment_status, 'paid') = $${params.length}`;
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
    await ensureExpensesSchema();
    const { amount, category, description, project_id, date, supplier_id, source, payment_status } = req.body;
    const receipt_url = req.file ? `/uploads/${req.file.filename}` : null;
    const expenseDate = normalizePurchaseDate(date) || todayISODate();
    const { rows } = await pool.query(
      `INSERT INTO expenses (amount, category, description, project_id, receipt_url, date, supplier_id, source, payment_status)
       VALUES ($1,$2,$3,$4,$5,$6::date,$7,$8,$9) RETURNING *`,
      [
        amount,
        category || 'materiaux',
        description,
        project_id || null,
        receipt_url,
        expenseDate,
        supplier_id ? Number(supplier_id) : null,
        source || 'manual',
        payment_status || 'paid',
      ]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/:id', async (req, res) => {
  try {
    await ensureExpensesSchema();
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'id invalide' });
    const status = String(req.body?.payment_status || '').toLowerCase();
    if (status !== 'paid' && status !== 'unpaid') {
      return res.status(400).json({ error: 'payment_status: paid ou unpaid' });
    }
    const { rows } = await pool.query(
      `UPDATE expenses SET payment_status = $1 WHERE id = $2 RETURNING *`,
      [status, id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Dépense introuvable' });
    res.json(rows[0]);
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

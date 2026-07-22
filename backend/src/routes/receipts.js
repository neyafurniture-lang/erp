import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import pool from '../db/pool.js';
import { scanReceiptImage } from '../services/receipt-scan.js';
import { normalizePurchaseDate, resolveExpenseDate, todayISODate } from '../services/expense-date.js';
import * as drive from '../services/google-drive.js';
import { getGoogleTokenRow } from '../services/google-oauth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadDir = path.join(__dirname, '../../uploads/receipts');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const RECEIPT_EXT = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.heic', '.heif']);
const MIME_TO_EXT = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/heic': '.heic',
  'image/heif': '.heif',
};

function extFromUpload(file) {
  const fromName = path.extname(file.originalname || '').toLowerCase();
  if (RECEIPT_EXT.has(fromName)) return fromName;
  return MIME_TO_EXT[String(file.mimetype || '').toLowerCase()] || '.jpg';
}

const storage = multer.diskStorage({
  destination: uploadDir,
  filename: (_req, file, cb) => {
    cb(null, `${Date.now()}${extFromUpload(file)}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 16 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const mime = String(file.mimetype || '').toLowerCase();
    const ext = path.extname(file.originalname || '').toLowerCase();
    // Mobile : souvent image/jpeg sans extension, ou HEIC galerie
    const ok = mime.startsWith('image/')
      || RECEIPT_EXT.has(ext)
      || !mime; // certains WebViews envoient un type vide
    if (!ok) {
      return cb(new Error('Photo requise (JPG, PNG, WebP — appareil photo recommandé)'));
    }
    cb(null, true);
  },
});

function multerScan(req, res, next) {
  upload.single('receipt')(req, res, (err) => {
    if (!err) return next();
    const msg = err.code === 'LIMIT_FILE_SIZE'
      ? 'Photo trop lourde (max 16 Mo). Recadrez ou utilisez l’appareil photo.'
      : (err.message || 'Échec envoi de la photo');
    return res.status(400).json({ error: msg });
  });
}

const router = Router();

async function listPending() {
  const { rows } = await pool.query(`
    SELECT r.*, p.name AS project_name
    FROM receipt_scans r
    LEFT JOIN projects p ON p.id = r.project_id
    WHERE r.status = 'pending'
    ORDER BY r.created_at DESC
    LIMIT 50
  `);
  return rows;
}

router.get('/pending', async (_req, res) => {
  try {
    res.json(await listPending());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/scan', multerScan, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Photo du ticket requise' });

    const mime = req.file.mimetype || 'image/jpeg';
    if (/heic|heif/i.test(mime) || /\.heic$|\.heif$/i.test(req.file.originalname || '')) {
      return res.status(400).json({
        error: 'Format HEIC non supporté par l’IA. Utilisez « Scanner un ticket » (appareil photo) ou convertissez en JPG.',
      });
    }

    const parsed = await scanReceiptImage(req.file.path, mime.startsWith('image/') ? mime : 'image/jpeg');
    const receipt_url = `/uploads/receipts/${req.file.filename}`;
    const purchaseDate = normalizePurchaseDate(parsed.date);

    const { rows } = await pool.query(
      `INSERT INTO receipt_scans (
        status, receipt_url, vendor, amount, tax_tps, tax_tvq, purchase_date,
        category, description, raw_text, parsed_json, confidence, created_by
      ) VALUES ('pending', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
      [
        receipt_url,
        parsed.vendor,
        parsed.amount,
        parsed.tax_tps,
        parsed.tax_tvq,
        purchaseDate,
        parsed.category,
        parsed.description,
        parsed.raw_text,
        JSON.stringify(parsed.parsed_json),
        parsed.confidence,
        req.user?.id || null,
      ]
    );

    res.status(201).json({ scan: rows[0], parsed });
  } catch (err) {
    if (req.file?.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    res.status(400).json({ error: err.message });
  }
});

router.post('/:id/confirm', async (req, res) => {
  try {
    const { rows: existing } = await pool.query('SELECT * FROM receipt_scans WHERE id = $1', [req.params.id]);
    if (!existing[0]) return res.status(404).json({ error: 'Ticket introuvable' });
    if (existing[0].status !== 'pending') return res.status(400).json({ error: 'Ticket déjà traité' });

    const row = existing[0];
    const {
      project_id,
      amount = row.amount,
      category = row.category,
      description = row.description,
      purchase_date = row.purchase_date,
      upload_to_drive = true,
      vendor,
    } = req.body;

    const finalAmount = Number(amount);
    if (!finalAmount || finalAmount <= 0) {
      return res.status(400).json({ error: 'Montant invalide — corrigez avant de confirmer' });
    }

    const finalVendor = (vendor != null ? String(vendor).trim() : row.vendor) || null;

    let drive_file_id = row.drive_file_id;
    let drive_link = row.drive_link;

    if (upload_to_drive && !drive_file_id) {
      try {
        const tokenRow = await getGoogleTokenRow();
        if (tokenRow?.access_token) {
          let parentId = 'root';
          if (project_id) {
            const { rows: pr } = await pool.query('SELECT drive_folder_id, name FROM projects WHERE id = $1', [project_id]);
            if (pr[0]?.drive_folder_id) parentId = pr[0].drive_folder_id;
          }

          const localPath = path.join(__dirname, '../..', row.receipt_url.replace(/^\//, ''));
          if (fs.existsSync(localPath)) {
            const buffer = fs.readFileSync(localPath);
            const ext = path.extname(localPath) || '.jpg';
            const name = `${row.vendor || 'Ticket'}-${normalizePurchaseDate(purchase_date) || normalizePurchaseDate(row.purchase_date) || 'sans-date'}${ext}`.replace(/[^\w.\-àâäéèêëïîôùûüç ]/gi, '_');
            const uploaded = await drive.uploadFile(name, buffer, 'image/jpeg', parentId);
            drive_file_id = uploaded.id;
            drive_link = uploaded.webViewLink;
          }
        }
      } catch {
        // Drive optionnel — la dépense est quand même créée
      }
    }

    // Description déjà complète côté UI (magasin + articles + notes) — pas de double préfixe
    const desc = String(description || '').trim()
      || [finalVendor, row.description].filter(Boolean).join(' — ')
      || 'Ticket de caisse';
    // Date du ticket pour le suivi mensuel — mais on refuse les dates OCR absurdes
    // (ex. février alors qu’on scanne en juillet) qui faisaient « disparaître » la dépense
    const forceDate = req.body?.force_date === true || req.body?.force_date === 'true';
    const resolved = resolveExpenseDate(
      purchase_date || row.purchase_date,
      { referenceDate: todayISODate(), maxDaysPast: 60, allowFutureDays: 1, force: forceDate }
    );
    const expenseDate = resolved.date;
    const { rows: expenseRows } = await pool.query(
      `INSERT INTO expenses (amount, category, description, project_id, receipt_url, date)
       VALUES ($1, $2, $3, $4, $5, $6::date) RETURNING *`,
      [
        finalAmount,
        category || 'materiaux',
        desc,
        project_id || null,
        row.receipt_url,
        expenseDate,
      ]
    );

    const { rows: updated } = await pool.query(
      `UPDATE receipt_scans SET
        status = 'confirmed',
        project_id = $1,
        amount = $2,
        category = $3,
        description = $4,
        purchase_date = $5::date,
        expense_id = $6,
        drive_file_id = $7,
        drive_link = $8,
        vendor = COALESCE($10, vendor)
       WHERE id = $9 RETURNING *`,
      [
        project_id || null,
        finalAmount,
        category || 'materiaux',
        desc,
        expenseDate,
        expenseRows[0].id,
        drive_file_id,
        drive_link,
        row.id,
        finalVendor,
      ]
    );

    res.json({
      receipt: updated[0],
      expense: expenseRows[0],
      date_adjusted: resolved.adjusted,
      date_original: resolved.original,
      date_reason: resolved.reason,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/dismiss', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE receipt_scans SET status = 'dismissed' WHERE id = $1 AND status = 'pending' RETURNING *`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Ticket introuvable' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;

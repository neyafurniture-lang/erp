import { Router } from 'express';
import pool from '../db/pool.js';
import { generateInvoicePdf, generateQuotePdf } from '../services/pdf.js';
import { sendDocumentEmail } from '../services/document-email.js';
import { calcDocTotals } from '../services/invoice-helpers.js';
import { syncMaterialsFromQuote } from '../services/project-materials.js';

const router = Router();

function calcTotals(lines) {
  return calcDocTotals(lines);
}

async function nextNumber(type) {
  if (type === 'FAC') {
    const { rows } = await pool.query(`
      SELECT invoice_number FROM invoices WHERE invoice_number ~ '^[0-9]+$'
      ORDER BY CAST(invoice_number AS INTEGER) DESC LIMIT 1
    `);
    const base = rows[0] ? parseInt(rows[0].invoice_number, 10) : 1026;
    return String(base + 1);
  }
  const { rows } = await pool.query('SELECT COUNT(*)::int as c FROM quotes');
  const year = new Date().getFullYear();
  return `Q-${year}-${String(rows[0].c + 1).padStart(3, '0')}`;
}

// QUOTES
router.get('/quotes', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT q.*, c.name as client_name, p.name as project_name,
             i.id as invoice_id, i.invoice_number
      FROM quotes q
      LEFT JOIN clients c ON c.id = q.client_id
      LEFT JOIN projects p ON p.id = q.project_id
      LEFT JOIN invoices i ON i.quote_id = q.id
      ORDER BY q.created_at DESC
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/quotes/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT q.*, c.name as client_name, c.contact, c.email, c.address as client_address, c.city as client_city,
             p.name as project_name, i.id as invoice_id, i.invoice_number
      FROM quotes q
      LEFT JOIN clients c ON c.id = q.client_id
      LEFT JOIN projects p ON p.id = q.project_id
      LEFT JOIN invoices i ON i.quote_id = q.id
      WHERE q.id = $1
    `, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Devis introuvable' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/quotes', async (req, res) => {
  try {
    const { project_id, client_id, lines, notes, status, title, reference, terms, order_summary } = req.body;
    const quote_number = await nextNumber('Q');
    const { subtotal, total } = calcTotals(lines);
    const { rows } = await pool.query(
      `INSERT INTO quotes (project_id, client_id, quote_number, status, lines, subtotal, tax_rate, total, notes, title, reference)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [project_id, client_id, quote_number, status || 'draft', JSON.stringify(lines || []), subtotal, 14.975, total, notes, title, reference]
    );
    const created = rows[0];
    if (project_id) await syncMaterialsFromQuote(project_id).catch(() => {});
    res.status(201).json(created);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/quotes/:id', async (req, res) => {
  try {
    const { status, lines, notes, title, reference, project_id } = req.body;
    let subtotal, total;
    if (lines) ({ subtotal, total } = calcTotals(lines));
    const { rows } = await pool.query(
      `UPDATE quotes SET
        status = COALESCE($1, status),
        lines = COALESCE($2, lines),
        subtotal = COALESCE($3, subtotal),
        total = COALESCE($4, total),
        notes = COALESCE($5, notes),
        title = COALESCE($6, title),
        reference = COALESCE($7, reference),
        project_id = COALESCE($8, project_id)
       WHERE id = $9 RETURNING *`,
      [status, lines ? JSON.stringify(lines) : null, subtotal, total, notes, title, reference, project_id || null, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Devis introuvable' });
    if (rows[0].project_id) await syncMaterialsFromQuote(rows[0].project_id).catch(() => {});
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/quotes/:id/pdf', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT q.*, c.name as client_name, c.contact, c.email, c.address as client_address, c.city as client_city,
             p.name as project_name
      FROM quotes q
      LEFT JOIN clients c ON c.id = q.client_id
      LEFT JOIN projects p ON p.id = q.project_id
      WHERE q.id = $1
    `, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Devis introuvable' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="devis-${rows[0].quote_number}.pdf"`);
    await generateQuotePdf(rows[0], res);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/quotes/:id/send', async (req, res) => {
  try {
    res.json(await sendDocumentEmail('quote', req.params.id));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// INVOICES
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT i.*, c.name as client_name, p.name as project_name
      FROM invoices i
      LEFT JOIN clients c ON c.id = i.client_id
      LEFT JOIN projects p ON p.id = i.project_id
      ORDER BY i.created_at DESC
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const { project_id, client_id, lines, notes, due_date, status, title, subtitle, reference, terms, order_summary } = req.body;
    const invoice_number = await nextNumber('FAC');
    const { subtotal, total } = calcTotals(lines);
    const { rows } = await pool.query(
      `INSERT INTO invoices (project_id, client_id, invoice_number, status, lines, subtotal, tax_rate, total, due_date, notes, title, subtitle, reference, terms, order_summary)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
      [project_id, client_id, invoice_number, status || 'draft', JSON.stringify(lines || []), subtotal, 14.975, total, due_date, notes, title, subtitle, reference, terms || 'Net 30', order_summary]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/from-quote/:quoteId', async (req, res) => {
  try {
    const { deposit_percent = 100, subtitle, due_date } = req.body;
    const pct = Math.min(100, Math.max(1, Number(deposit_percent) || 100));

    const { rows: quotes } = await pool.query('SELECT * FROM quotes WHERE id = $1', [req.params.quoteId]);
    if (!quotes[0]) return res.status(404).json({ error: 'Devis introuvable' });
    const q = quotes[0];

    const { rows: existing } = await pool.query(
      'SELECT id, invoice_number FROM invoices WHERE quote_id = $1',
      [q.id]
    );
    if (existing[0] && pct === 100) {
      return res.status(409).json({
        error: 'Ce devis a déjà une facture',
        invoice_id: existing[0].id,
        invoice_number: existing[0].invoice_number,
      });
    }

    const rawLines = typeof q.lines === 'string' ? JSON.parse(q.lines) : (q.lines || []);
    const factor = pct / 100;
    const lines = rawLines.map(l => ({
      ...l,
      price: Number(l.price) * factor,
      description: pct < 100
        ? `${l.description}${l.description ? ' — ' : ''}${pct}% acompte`
        : l.description,
    }));

    const { subtotal, total } = calcTotals(lines);
    const invoice_number = await nextNumber('FAC');

    const quoteDate = new Date(q.created_at).toLocaleDateString('en-CA', { day: '2-digit', month: 'long', year: 'numeric' });
    const reference = `${q.title || q.quote_number} Quote (${quoteDate})`;
    const due = due_date || (() => {
      const d = new Date();
      d.setDate(d.getDate() + 30);
      return d.toISOString().slice(0, 10);
    })();

    const invSubtitle = subtitle || (pct < 100 ? `${pct}% Deposit · ${q.title || 'Order'}` : null);

    const { rows } = await pool.query(
      `INSERT INTO invoices (project_id, client_id, quote_id, invoice_number, status, lines, subtotal, tax_rate, total, notes, title, subtitle, reference, terms, order_summary, due_date)
       VALUES ($1,$2,$3,$4,'draft',$5,$6,$7,$8,$9,$10,$11,$12,'Net 30',$13,$14) RETURNING *`,
      [q.project_id, q.client_id, q.id, invoice_number, JSON.stringify(lines), subtotal, 14.975, total, q.notes, q.title, invSubtitle, reference, q.notes, due]
    );

    await pool.query("UPDATE quotes SET status = 'accepted' WHERE id = $1", [q.id]);
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id/pdf', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT i.*, c.name as client_name, c.contact, c.email, c.address as client_address, c.city as client_city,
             p.name as project_name
      FROM invoices i
      LEFT JOIN clients c ON c.id = i.client_id
      LEFT JOIN projects p ON p.id = i.project_id
      WHERE i.id = $1
    `, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Facture introuvable' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="facture-${rows[0].invoice_number}.pdf"`);
    await generateInvoicePdf(rows[0], res);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT i.*, c.name as client_name, c.email, c.phone, p.name as project_name
      FROM invoices i
      LEFT JOIN clients c ON c.id = i.client_id
      LEFT JOIN projects p ON p.id = i.project_id
      WHERE i.id = $1
    `, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Facture introuvable' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/send', async (req, res) => {
  try {
    res.json(await sendDocumentEmail('invoice', req.params.id));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const { status, lines, due_date, notes, title, subtitle, reference, terms, order_summary } = req.body;
    let subtotal, total;
    if (lines) ({ subtotal, total } = calcTotals(lines));
    const { rows } = await pool.query(
      `UPDATE invoices SET
        status = COALESCE($1, status),
        lines = COALESCE($2, lines),
        subtotal = COALESCE($3, subtotal),
        total = COALESCE($4, total),
        due_date = COALESCE($5, due_date),
        notes = COALESCE($6, notes),
        title = COALESCE($7, title),
        subtitle = COALESCE($8, subtitle),
        reference = COALESCE($9, reference),
        terms = COALESCE($10, terms),
        order_summary = COALESCE($11, order_summary)
       WHERE id = $12 RETURNING *`,
      [status, lines ? JSON.stringify(lines) : null, subtotal, total, due_date, notes, title, subtitle, reference, terms, order_summary, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Facture introuvable' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;

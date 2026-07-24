import { Router } from 'express';
import pool from '../db/pool.js';

const router = Router();

const STATUS_LABELS = {
  planned: 'À prévoir',
  urgent: 'Urgent',
  pending: 'En attente',
  ordered: 'Commandé',
  received: 'Reçu',
};

const NEED_STATUS = {
  needed: 'À acheter',
  ordered: 'Commandé',
  received: 'Reçu',
};

const NEED_CATEGORIES = ['consommable', 'quincaillerie', 'finition', 'materiaux', 'outil', 'emballage', 'autre'];

function needSelect() {
  return `
    SELECT n.*,
      i.name AS inventory_name, i.quantity AS stock_qty, i.min_level AS stock_min,
      s.name AS supplier_name,
      p.name AS project_name
    FROM purchase_needs n
    LEFT JOIN inventory_items i ON i.id = n.inventory_item_id
    LEFT JOIN suppliers s ON s.id = n.supplier_id
    LEFT JOIN projects p ON p.id = n.project_id
  `;
}

router.get('/needs', async (req, res) => {
  try {
    const { status, category, priority, project_id } = req.query;
    let q = `${needSelect()} WHERE 1=1`;
    const params = [];
    if (status) { params.push(status); q += ` AND n.status = $${params.length}`; }
    if (category) { params.push(category); q += ` AND n.category = $${params.length}`; }
    if (priority) { params.push(priority); q += ` AND n.priority = $${params.length}`; }
    if (project_id) { params.push(Number(project_id)); q += ` AND n.project_id = $${params.length}`; }
    q += ` ORDER BY
      CASE n.status WHEN 'needed' THEN 0 WHEN 'ordered' THEN 1 ELSE 2 END,
      CASE n.priority WHEN 'urgent' THEN 0 ELSE 1 END,
      n.created_at DESC`;
    const { rows } = await pool.query(q, params);
    res.json(rows.map(r => ({ ...r, status_label: NEED_STATUS[r.status] || r.status })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/needs/summary', async (_req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'needed')::int AS to_buy,
        COUNT(*) FILTER (WHERE status = 'needed' AND priority = 'urgent')::int AS urgent,
        COUNT(*) FILTER (WHERE status = 'ordered')::int AS ordered,
        COUNT(*) FILTER (WHERE status = 'received')::int AS received
      FROM purchase_needs
    `);
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/needs', async (req, res) => {
  try {
    const title = String(req.body.title || '').trim();
    if (!title) return res.status(400).json({ error: 'Nom requis' });
    const category = NEED_CATEGORIES.includes(req.body.category) ? req.body.category : 'consommable';
    const { rows } = await pool.query(
      `INSERT INTO purchase_needs (title, category, quantity, unit, priority, status, inventory_item_id, project_id, supplier_id, notes, source)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [
        title,
        category,
        req.body.quantity ?? 1,
        req.body.unit || 'unité',
        req.body.priority === 'urgent' ? 'urgent' : 'normal',
        'needed',
        req.body.inventory_item_id || null,
        req.body.project_id || null,
        req.body.supplier_id || null,
        req.body.notes?.trim() || null,
        req.body.source || 'manual',
      ]
    );
    const { rows: full } = await pool.query(`${needSelect()} WHERE n.id = $1`, [rows[0].id]);
    res.status(201).json(full[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/needs/:id', async (req, res) => {
  try {
    const { rows: existing } = await pool.query('SELECT * FROM purchase_needs WHERE id = $1', [req.params.id]);
    if (!existing[0]) return res.status(404).json({ error: 'Besoin introuvable' });
    const n = existing[0];
    const status = req.body.status ?? n.status;
    const orderedAt = status === 'ordered' && n.status !== 'ordered' ? new Date() : n.ordered_at;
    const receivedAt = status === 'received' && n.status !== 'received' ? new Date() : n.received_at;

    const { rows } = await pool.query(
      `UPDATE purchase_needs SET
        title = $1, category = $2, quantity = $3, unit = $4, priority = $5, status = $6,
        supplier_id = $7, project_id = $8, notes = $9, ordered_at = $10, received_at = $11
       WHERE id = $12 RETURNING *`,
      [
        req.body.title !== undefined ? String(req.body.title).trim() : n.title,
        NEED_CATEGORIES.includes(req.body.category) ? req.body.category : n.category,
        req.body.quantity ?? n.quantity,
        req.body.unit ?? n.unit,
        req.body.priority === 'urgent' ? 'urgent' : req.body.priority === 'normal' ? 'normal' : n.priority,
        ['needed', 'ordered', 'received'].includes(status) ? status : n.status,
        req.body.supplier_id !== undefined
          ? (req.body.supplier_id === '' || req.body.supplier_id === null ? null : Number(req.body.supplier_id))
          : n.supplier_id,
        req.body.project_id !== undefined
          ? (req.body.project_id === '' || req.body.project_id === null ? null : Number(req.body.project_id))
          : n.project_id,
        req.body.notes !== undefined ? (req.body.notes === null ? null : String(req.body.notes)) : n.notes,
        orderedAt,
        receivedAt,
        req.params.id,
      ]
    );
    // Première réception → ajoute la quantité au stock lié
    if (status === 'received' && n.status !== 'received' && n.inventory_item_id) {
      const qty = Number(rows[0].quantity) || 0;
      if (qty > 0) {
        await pool.query(
          'UPDATE inventory_items SET quantity = quantity + $1 WHERE id = $2',
          [qty, n.inventory_item_id]
        );
      }
    }
    const { rows: full } = await pool.query(`${needSelect()} WHERE n.id = $1`, [rows[0].id]);
    res.json(full[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/needs/:id', async (req, res) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM purchase_needs WHERE id = $1', [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: 'Besoin introuvable' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/needs/sync-stock', async (_req, res) => {
  try {
    const { rows: low } = await pool.query(`
      SELECT i.*, s.id AS supplier_id, s.name AS supplier_name,
        GREATEST(i.min_level - i.quantity, 1) AS qty_needed
      FROM inventory_items i
      LEFT JOIN suppliers s ON s.id = i.supplier_id
      WHERE i.quantity <= i.min_level AND i.min_level > 0
    `);
    let added = 0;
    for (const item of low) {
      const { rows: dup } = await pool.query(
        `SELECT id FROM purchase_needs
         WHERE inventory_item_id = $1 AND status IN ('needed', 'ordered')`,
        [item.id]
      );
      if (dup.length) continue;
      await pool.query(
        `INSERT INTO purchase_needs (title, category, quantity, unit, priority, inventory_item_id, supplier_id, notes, source)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'low_stock')`,
        [
          item.name,
          item.category || 'consommable',
          item.qty_needed,
          item.unit || 'unité',
          item.quantity <= 0 ? 'urgent' : 'normal',
          item.id,
          item.supplier_id,
          `Stock: ${item.quantity} / min ${item.min_level}`,
        ]
      );
      added++;
    }
    res.json({ added, scanned: low.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/', async (req, res) => {
  try {
    const { status, project_id } = req.query;
    let q = `
      SELECT po.*, s.name AS supplier_name, p.name AS project_name,
        (SELECT json_agg(pi) FROM purchase_items pi WHERE pi.purchase_id = po.id) AS items
      FROM purchase_orders po
      LEFT JOIN suppliers s ON s.id = po.supplier_id
      LEFT JOIN projects p ON p.id = po.project_id
      WHERE 1=1
    `;
    const params = [];
    if (status) { params.push(status); q += ` AND po.status = $${params.length}`; }
    if (project_id) { params.push(project_id); q += ` AND po.project_id = $${params.length}`; }
    q += ' ORDER BY CASE po.status WHEN \'urgent\' THEN 0 WHEN \'planned\' THEN 1 WHEN \'pending\' THEN 2 WHEN \'ordered\' THEN 3 ELSE 4 END, po.created_at DESC';
    const { rows } = await pool.query(q, params);
    res.json(rows.map(r => ({ ...r, status_label: STATUS_LABELS[r.status] || r.status })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/suggestions', async (_req, res) => {
  try {
    const { rows: low } = await pool.query(
      `SELECT i.*, s.name AS supplier_name,
        GREATEST(i.min_level - i.quantity, 0) AS qty_needed
       FROM inventory_items i
       LEFT JOIN suppliers s ON s.id = i.supplier_id
       WHERE i.quantity <= i.min_level AND i.min_level > 0
       ORDER BY
         CASE WHEN i.category IN ('consommable', 'quincaillerie', 'finition') THEN 0 ELSE 1 END,
         i.quantity - i.min_level`
    );
    res.json({ low_stock: low, message: low.length ? `${low.length} article(s) sous le minimum` : 'Stock OK' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  const client = await pool.connect();
  try {
    const { supplier_id, project_id, status, title, notes, items = [] } = req.body;
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO purchase_orders (supplier_id, project_id, status, title, notes)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [supplier_id || null, project_id || null, status || 'planned', title, notes]
    );
    const po = rows[0];
    let total = 0;
    for (const item of items) {
      const lineTotal = (Number(item.quantity) || 1) * (Number(item.unit_cost) || 0);
      total += lineTotal;
      await client.query(
        `INSERT INTO purchase_items (purchase_id, inventory_item_id, description, quantity, unit_cost)
         VALUES ($1,$2,$3,$4,$5)`,
        [po.id, item.inventory_item_id || null, item.description, item.quantity ?? 1, item.unit_cost ?? 0]
      );
    }
    await client.query('UPDATE purchase_orders SET total = $1 WHERE id = $2', [total, po.id]);
    await client.query('COMMIT');
    res.status(201).json({ ...po, total });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

router.patch('/:id/status', async (req, res) => {
  const client = await pool.connect();
  try {
    const { status } = req.body;
    await client.query('BEGIN');
    const { rows: prev } = await client.query('SELECT * FROM purchase_orders WHERE id = $1', [req.params.id]);
    if (!prev[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Commande introuvable' });
    }
    const extra = status === 'ordered' ? ', ordered_at = NOW()' : status === 'received' ? ', received_at = NOW()' : '';
    const { rows } = await client.query(
      `UPDATE purchase_orders SET status = $1${extra} WHERE id = $2 RETURNING *`,
      [status, req.params.id]
    );
    if (status === 'received' && prev[0].status !== 'received') {
      await client.query(
        `UPDATE inventory_items i
         SET quantity = i.quantity + pi.quantity
         FROM purchase_items pi
         WHERE pi.purchase_id = $1 AND pi.inventory_item_id = i.id`,
        [req.params.id]
      );
    }
    await client.query('COMMIT');
    res.json(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

export default router;

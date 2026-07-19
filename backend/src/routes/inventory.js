import { Router } from 'express';
import pool from '../db/pool.js';

const router = Router();

router.get('/', async (req, res) => {
  try {
    const { category, low_stock } = req.query;
    let q = 'SELECT i.*, s.name AS supplier_name FROM inventory_items i LEFT JOIN suppliers s ON s.id = i.supplier_id WHERE 1=1';
    const params = [];
    if (category) { params.push(category); q += ` AND i.category = $${params.length}`; }
    if (low_stock === '1') q += ' AND i.quantity <= i.min_level';
    q += ' ORDER BY i.name';
    const { rows } = await pool.query(q, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const b = req.body || {};
    const name = String(b.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Nom requis' });
    const { rows } = await pool.query(
      `INSERT INTO inventory_items (sku, name, category, quantity, unit, unit_cost, location, supplier_id, min_level, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [
        b.sku || null,
        name,
        b.category || 'materiaux',
        Number(b.quantity) || 0,
        b.unit || 'unité',
        Number(b.unit_cost) || 0,
        b.location || null,
        b.supplier_id || null,
        Number(b.min_level) || 0,
        b.notes || null,
      ]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const b = req.body || {};
    const name = String(b.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Nom requis' });
    const { rows } = await pool.query(
      `UPDATE inventory_items SET sku=$1, name=$2, category=$3, quantity=$4, unit=$5, unit_cost=$6,
       location=$7, supplier_id=$8, min_level=$9, notes=$10 WHERE id=$11 RETURNING *`,
      [
        b.sku || null,
        name,
        b.category || 'materiaux',
        Number(b.quantity) || 0,
        b.unit || 'unité',
        Number(b.unit_cost) || 0,
        b.location || null,
        b.supplier_id || null,
        Number(b.min_level) || 0,
        b.notes || null,
        req.params.id,
      ]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Article introuvable' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM inventory_items WHERE id = $1', [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: 'Article introuvable' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/alerts', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM inventory_items WHERE quantity <= min_level AND min_level > 0 ORDER BY quantity - min_level'
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;

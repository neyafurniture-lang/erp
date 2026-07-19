import { Router } from 'express';
import pool from '../db/pool.js';
import {
  ensureKnownSuppliers,
  listSuppliersWithStats,
  getSupplierDetail,
} from '../services/suppliers-catalog.js';

const router = Router();

router.get('/', async (req, res) => {
  try {
    const withStats = req.query.stats !== '0';
    if (withStats) {
      res.json(await listSuppliersWithStats());
    } else {
      const { rows } = await pool.query('SELECT * FROM suppliers ORDER BY name');
      res.json(rows);
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Crée / met à jour les fournisseurs catalogue (Home Depot, Rona…). */
router.post('/ensure-catalog', async (_req, res) => {
  try {
    const result = await ensureKnownSuppliers();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const detail = await getSupplierDetail(Number(req.params.id));
    if (!detail) return res.status(404).json({ error: 'Fournisseur introuvable' });
    res.json(detail);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const b = req.body;
    const slug = b.slug
      ? String(b.slug).trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_').slice(0, 64)
      : null;
    const { rows } = await pool.query(
      `INSERT INTO suppliers (name, contact, email, phone, lead_days, notes, slug, address, website, account_number, meta)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,COALESCE($11::jsonb, '{}'::jsonb)) RETURNING *`,
      [
        b.name,
        b.contact || null,
        b.email || null,
        b.phone || null,
        b.lead_days ?? 7,
        b.notes || null,
        slug,
        b.address || null,
        b.website || null,
        b.account_number || null,
        b.meta ? JSON.stringify(b.meta) : null,
      ]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const b = req.body;
    const slug = b.slug != null
      ? String(b.slug).trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_').slice(0, 64) || null
      : undefined;
    const { rows } = await pool.query(
      `UPDATE suppliers SET
         name = $1,
         contact = $2,
         email = $3,
         phone = $4,
         lead_days = $5,
         notes = $6,
         slug = COALESCE($7, slug),
         address = COALESCE($8, address),
         website = COALESCE($9, website),
         account_number = COALESCE($10, account_number)
       WHERE id = $11 RETURNING *`,
      [
        b.name,
        b.contact,
        b.email,
        b.phone,
        b.lead_days,
        b.notes,
        slug === undefined ? null : slug,
        b.address ?? null,
        b.website ?? null,
        b.account_number ?? null,
        req.params.id,
      ]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Fournisseur introuvable' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM suppliers WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;

import { Router } from 'express';
import pool from '../db/pool.js';
import {
  scanInboxForSupplierInvoices,
  assignSupplierInvoice,
  upsertRoutingRule,
  SUPPLIERS,
} from '../services/invoice-email-router.js';

const router = Router();

function enrichQuery() {
  return `
    SELECT s.*, p.name AS project_name, sp.name AS suggested_project_name
    FROM supplier_invoice_emails s
    LEFT JOIN projects p ON p.id = s.project_id
    LEFT JOIN projects sp ON sp.id = s.suggested_project_id
  `;
}

router.get('/pending', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `${enrichQuery()} WHERE s.status = 'pending' ORDER BY s.created_at DESC LIMIT 20`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/rules', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT r.*, p.name AS project_name
       FROM invoice_routing_rules r
       JOIN projects p ON p.id = r.project_id
       WHERE r.active = true
       ORDER BY r.hit_count DESC, r.created_at DESC`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/suppliers', (_req, res) => {
  res.json(SUPPLIERS.filter(s => s.id !== 'other'));
});

router.post('/scan', async (_req, res) => {
  try {
    const result = await scanInboxForSupplierInvoices();
    const { rows } = await pool.query(
      `${enrichQuery()} WHERE s.status = 'pending' ORDER BY s.created_at DESC`
    );
    res.json({ ...result, pending_list: rows });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/:id/assign', async (req, res) => {
  try {
    const row = await assignSupplierInvoice(Number(req.params.id), req.body);
    const { rows } = await pool.query(`${enrichQuery()} WHERE s.id = $1`, [row.id]);
    res.json(rows[0]);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/:id/dismiss', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE supplier_invoice_emails SET status = 'dismissed' WHERE id = $1 AND status = 'pending' RETURNING *`,
      [Number(req.params.id)]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Introuvable' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/rules', async (req, res) => {
  try {
    const rule = await upsertRoutingRule(req.body);
    res.status(201).json(rule);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

export default router;

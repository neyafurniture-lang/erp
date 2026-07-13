import { Router } from 'express';
import pool from '../db/pool.js';
import { computeProjectCosts } from '../services/project-costs.js';
import { syncMaterialsFromQuote, findQuoteForProject } from '../services/project-materials.js';

const router = Router();

router.get('/profitability', async (_req, res) => {
  try {
    const [
      revenue,
      expenses,
      labor,
      stock,
      projectsActive,
      purchasesPlanned,
      quotesPending,
    ] = await Promise.all([
      pool.query(`SELECT COALESCE(SUM(amount_paid), 0)::float AS v FROM invoices WHERE status IN ('paid','partially_paid') AND created_at >= date_trunc('year', CURRENT_DATE)`),
      pool.query(`SELECT COALESCE(SUM(amount), 0)::float AS v FROM expenses WHERE date >= date_trunc('month', CURRENT_DATE)`),
      pool.query(`
        SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (COALESCE(ended_at, started_at) - started_at))/3600 * e.hourly_rate), 0)::float AS v
        FROM time_entries te JOIN employees e ON e.id = te.employee_id
        WHERE te.started_at >= date_trunc('month', CURRENT_DATE)
      `).catch(() => ({ rows: [{ v: 0 }] })),
      pool.query('SELECT COALESCE(SUM(quantity * unit_cost), 0)::float AS v FROM inventory_items'),
      pool.query(`SELECT COUNT(*)::int AS c FROM projects WHERE status = 'active'`),
      pool.query(`SELECT COUNT(*)::int AS c FROM purchase_orders WHERE status IN ('planned','urgent','pending')`),
      pool.query(`SELECT COUNT(*)::int AS c FROM quotes WHERE status IN ('draft','sent')`),
    ]);

    res.json({
      revenue_ytd: revenue.rows[0].v,
      expenses_month: expenses.rows[0].v,
      labor_month: labor.rows[0].v,
      stock_value: stock.rows[0].v,
      projects_active: projectsActive.rows[0].c,
      purchases_pending: purchasesPlanned.rows[0].c,
      quotes_pending: quotesPending.rows[0].c,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/projects/:id/costs', async (req, res) => {
  try {
    const costs = await computeProjectCosts(Number(req.params.id));
    if (!costs) return res.status(404).json({ error: 'Projet introuvable' });
    res.json(costs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/projects/:id/materials', async (req, res) => {
  try {
    if (req.query.sync !== '0') {
      await syncMaterialsFromQuote(Number(req.params.id));
    }
    const { rows } = await pool.query(
      'SELECT * FROM project_materials WHERE project_id = $1 ORDER BY id',
      [req.params.id]
    );
    const quote = await findQuoteForProject(Number(req.params.id));
    res.json({ materials: rows, quote: quote ? { id: quote.id, quote_number: quote.quote_number, title: quote.title } : null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/projects/:id/materials/sync-quote', async (req, res) => {
  try {
    const result = await syncMaterialsFromQuote(Number(req.params.id));
    const { rows } = await pool.query(
      'SELECT * FROM project_materials WHERE project_id = $1 ORDER BY id',
      [req.params.id]
    );
    res.json({ ...result, materials: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/projects/:id/materials', async (req, res) => {
  try {
    const b = req.body;
    const { rows } = await pool.query(
      `INSERT INTO project_materials (project_id, inventory_item_id, description, quantity, unit, unit_cost, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [req.params.id, b.inventory_item_id || null, b.description, b.quantity ?? 1, b.unit || 'unité', b.unit_cost ?? 0, b.notes]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;

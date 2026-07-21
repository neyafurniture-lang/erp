import { Router } from 'express';
import {
  importSupplierInvoicesForYear,
  syncIssuedInvoicesToGains,
  syncWebOrdersToMarketplace,
} from '../services/finance-sync.js';

const router = Router();

router.post('/import-supplier-invoices', async (req, res) => {
  try {
    const year = Number(req.body.year) || new Date().getFullYear();
    const max = Math.min(Number(req.body.max) || 80, 150);
    const autoExpense = req.body.auto_expense !== false;
    const result = await importSupplierInvoicesForYear({ year, max, autoExpense });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/sync-issued-invoices', async (req, res) => {
  try {
    const year = Number(req.body.year) || new Date().getFullYear();
    const result = await syncIssuedInvoicesToGains({ year });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/sync-web-orders-marketplace', async (req, res) => {
  try {
    const year = Number(req.body.year) || new Date().getFullYear();
    const book = req.body.book !== false;
    const result = await syncWebOrdersToMarketplace({ year, book });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** Aperçu rapide année courante (sans Gmail). */
router.get('/year-overview', async (req, res) => {
  try {
    const year = Number(req.query.year) || new Date().getFullYear();
    const issued = await syncIssuedInvoicesToGains({ year });
    res.json({
      year,
      issued_count: issued.issued_count,
      revenue_invoiced: issued.revenue_invoiced,
      revenue_collected: issued.revenue_collected,
      drafts_remaining: issued.drafts_remaining,
      marketplace_booked: issued.marketplace_booked,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;

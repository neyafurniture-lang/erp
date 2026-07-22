import { Router } from 'express';
import pool from '../db/pool.js';
import {
  scanClientCandidatesFromMail,
  importClientsFromCandidates,
} from '../services/clients-from-mail.js';
import {
  enrichClientFromMail,
  enrichIncompleteClientsFromMail,
} from '../services/client-contact-enrich.js';

const router = Router();

router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT c.*,
        (SELECT COUNT(*)::int FROM projects p WHERE p.client_id = c.id) AS project_count,
        (SELECT COUNT(*)::int FROM projects p WHERE p.client_id = c.id AND p.status = 'active') AS active_projects,
        (SELECT COALESCE(SUM(i.amount_paid), 0)::float FROM invoices i WHERE i.client_id = c.id) AS total_billed,
        (SELECT COALESCE(SUM(i.total), 0)::float FROM invoices i WHERE i.client_id = c.id AND i.status != 'draft') AS total_invoiced,
        GREATEST(
          c.created_at,
          (SELECT MAX(p.created_at) FROM projects p WHERE p.client_id = c.id),
          (SELECT MAX(i.created_at) FROM invoices i WHERE i.client_id = c.id),
          (SELECT MAX(q.created_at) FROM quotes q WHERE q.client_id = c.id)
        ) AS last_activity_at,
        (SELECT COUNT(*)::int FROM quotes q WHERE q.client_id = c.id AND q.status IN ('draft','sent')) AS open_quotes
      FROM clients c
      ORDER BY c.name
    `);
    res.json(rows.map(c => {
      const active = Number(c.active_projects || 0);
      const projects = Number(c.project_count || 0);
      const openQuotes = Number(c.open_quotes || 0);
      let tone = 'archived';
      if (active > 0) tone = 'active';
      else if (openQuotes > 0 && projects === 0) tone = 'prospect';
      else if (projects >= 2) tone = 'fidele';
      else if (projects > 0) tone = 'active';
      return { ...c, tone };
    }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Suggestions de clients à partir du miroir local (sans rescan Gmail). */
router.get('/from-mail/suggestions', async (_req, res) => {
  try {
    const result = await scanClientCandidatesFromMail({ maxMessages: 0 });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Scan Gmail + miroir local → candidats clients. */
router.post('/from-mail/scan', async (req, res) => {
  try {
    const maxMessages = Math.min(Number(req.body?.max_messages) || 400, 800);
    const days = Number(req.body?.days) || 0;
    const result = await scanClientCandidatesFromMail({ maxMessages, days });
    res.json(result);
  } catch (err) {
    const status = /token|oauth|gmail|connect/i.test(err.message) ? 400 : 500;
    res.status(status).json({ error: err.message });
  }
});

/** Création en masse des fiches clients sélectionnées. */
router.post('/from-mail/import', async (req, res) => {
  try {
    const items = Array.isArray(req.body?.clients) ? req.body.clients : [];
    if (!items.length) return res.status(400).json({ error: 'Aucun contact à importer' });
    if (items.length > 200) return res.status(400).json({ error: 'Maximum 200 contacts par import' });
    const result = await importClientsFromCandidates(items, {
      linkThreads: req.body?.link_threads !== false,
    });
    res.status(201).json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Remplit les champs manquants (tél., adresse, mail…) depuis les mails liés.
 * N’écrase jamais une valeur déjà saisie.
 */
router.post('/enrich-from-mail', async (req, res) => {
  try {
    const limit = Math.min(Number(req.body?.limit) || 40, 100);
    const useAi = req.body?.use_ai === true;
    const result = await enrichIncompleteClientsFromMail({ limit, useAi });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/enrich-from-mail', async (req, res) => {
  try {
    const useAi = req.body?.use_ai !== false;
    const result = await enrichClientFromMail(Number(req.params.id), { useAi });
    res.json(result);
  } catch (err) {
    const status = /introuvable/i.test(err.message) ? 404 : 500;
    res.status(status).json({ error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM clients WHERE id = $1', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Client introuvable' });

    const [projects, quotes, invoices] = await Promise.all([
      pool.query(`
        SELECT p.*,
          (SELECT COUNT(*)::int FROM tasks WHERE project_id = p.id AND status = 'done') AS tasks_done,
          (SELECT COUNT(*)::int FROM tasks WHERE project_id = p.id) AS tasks_total
        FROM projects p
        WHERE p.client_id = $1
        ORDER BY p.created_at DESC
      `, [req.params.id]),
      pool.query(`
        SELECT q.*, p.name AS project_name, i.id AS invoice_id, i.invoice_number
        FROM quotes q
        LEFT JOIN projects p ON p.id = q.project_id
        LEFT JOIN invoices i ON i.quote_id = q.id
        WHERE q.client_id = $1
        ORDER BY q.created_at DESC
      `, [req.params.id]),
      pool.query(`
        SELECT inv.*, p.name AS project_name
        FROM invoices inv
        LEFT JOIN projects p ON p.id = inv.project_id
        WHERE inv.client_id = $1
        ORDER BY inv.created_at DESC
      `, [req.params.id]),
    ]);

    res.json({
      ...rows[0],
      projects: projects.rows,
      quotes: quotes.rows,
      invoices: invoices.rows,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const { name, contact, email, phone, address, city, notes } = req.body;
    const { rows } = await pool.query(
      'INSERT INTO clients (name, contact, email, phone, address, city, notes) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *',
      [name, contact, email, phone, address, city, notes]
    );
    const client = rows[0];
    const { tryEnsureClientFolder } = await import('../services/drive-folders.js');
    const driveFolder = await tryEnsureClientFolder(client.id);
    if (driveFolder?.folder_id) client.drive_folder_id = driveFolder.folder_id;
    res.status(201).json(client);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const { name, contact, email, phone, address, city, notes } = req.body;
    const { rows } = await pool.query(
      'UPDATE clients SET name=$1, contact=$2, email=$3, phone=$4, address=$5, city=$6, notes=$7 WHERE id=$8 RETURNING *',
      [name, contact, email, phone, address, city, notes, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Client introuvable' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM clients WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;

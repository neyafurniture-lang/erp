import { Router } from 'express';
import pool from '../db/pool.js';

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
      const last = c.last_activity_at ? new Date(c.last_activity_at) : null;
      const daysSince = last && !Number.isNaN(last.getTime())
        ? (Date.now() - last.getTime()) / 86400000
        : null;
      // Aligné Craft Flow : Prospect par défaut, Archivé seulement si inactif > 90 j sans projets
      let tone = 'prospect';
      if (projects >= 2 && active > 0) tone = 'fidele';
      else if (active > 0 || projects > 0) tone = 'active';
      else if (openQuotes > 0) tone = 'prospect';
      else if (daysSince != null && daysSince > 90) tone = 'archived';
      return { ...c, tone };
    }));
  } catch (err) {
    res.status(500).json({ error: err.message });
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

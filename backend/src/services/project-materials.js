import pool from '../db/pool.js';
import { flattenQuoteLines } from './quote-document.js';

/** Trouve le devis le plus pertinent pour un projet */
export async function findQuoteForProject(projectId) {
  const { rows: proj } = await pool.query('SELECT client_id FROM projects WHERE id = $1', [projectId]);
  if (!proj[0]) return null;

  const { rows } = await pool.query(
    `SELECT * FROM quotes
     WHERE project_id = $1
        OR (client_id = $2 AND project_id IS NULL)
     ORDER BY
       CASE WHEN project_id = $1 THEN 0 ELSE 1 END,
       CASE status WHEN 'accepted' THEN 0 WHEN 'sent' THEN 1 WHEN 'draft' THEN 2 ELSE 3 END,
       created_at DESC
     LIMIT 1`,
    [projectId, proj[0].client_id]
  );
  return rows[0] || null;
}

/** Importe / met à jour les matériaux depuis les lignes du devis */
export async function syncMaterialsFromQuote(projectId) {
  const quote = await findQuoteForProject(projectId);
  if (!quote) return { synced: 0, updated: 0, quote: null };

  const lines = flattenQuoteLines(quote.lines);
  let synced = 0;
  let updated = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const desc = String(line.description || '').trim();
    if (!desc) continue;

    const marker = `from_quote:${quote.id}:${i}`;
    const qty = Number(line.qty) || 1;
    const unitCost = Number(line.price) || 0;

    const { rows: existing } = await pool.query(
      'SELECT id FROM project_materials WHERE project_id = $1 AND notes = $2',
      [projectId, marker]
    );

    if (existing[0]) {
      await pool.query(
        'UPDATE project_materials SET description = $1, quantity = $2, unit_cost = $3 WHERE id = $4',
        [desc, qty, unitCost, existing[0].id]
      );
      updated++;
    } else {
      await pool.query(
        `INSERT INTO project_materials (project_id, description, quantity, unit, unit_cost, notes)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [projectId, desc, qty, line.unit || 'unité', unitCost, marker]
      );
      synced++;
    }
  }

  if (!quote.project_id) {
    await pool.query('UPDATE quotes SET project_id = $1 WHERE id = $2 AND project_id IS NULL', [projectId, quote.id]);
  }

  return {
    synced,
    updated,
    quote: { id: quote.id, quote_number: quote.quote_number, title: quote.title },
  };
}

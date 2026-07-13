/**
 * Importe et découpe un PDF de plans pour le projet Sauna Cloud (id 6).
 * Usage: node scripts/import-sauna-plans.mjs [chemin.pdf]
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pool from '../src/db/pool.js';
import { splitPdfForProject } from '../src/services/project-plans.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ID = 6;
const DEFAULT_PDF = path.join(__dirname, '../uploads/chat/1783921870913-Sierra_Frames_Shop_Drawings.pdf');

async function main() {
  const pdfPath = process.argv[2] || DEFAULT_PDF;
  if (!fs.existsSync(pdfPath)) {
    console.error('PDF introuvable:', pdfPath);
    process.exit(1);
  }

  const buffer = fs.readFileSync(pdfPath);
  const sourceName = path.basename(pdfPath);
  const newPlans = await splitPdfForProject(PROJECT_ID, buffer, sourceName);

  const { rows } = await pool.query('SELECT meta FROM projects WHERE id = $1', [PROJECT_ID]);
  if (!rows[0]) {
    console.error('Projet', PROJECT_ID, 'introuvable');
    process.exit(1);
  }

  const prevMeta = typeof rows[0].meta === 'string'
    ? JSON.parse(rows[0].meta || '{}')
    : (rows[0].meta || {});

  await pool.query(
    `UPDATE projects SET meta = COALESCE(meta, '{}'::jsonb) || $1::jsonb WHERE id = $2`,
    [JSON.stringify({ plans: newPlans }), PROJECT_ID]
  );

  console.log(`OK — ${newPlans.length} plans importés pour Sauna Cloud (#${PROJECT_ID})`);
  console.log('Source:', sourceName);
  await pool.end();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

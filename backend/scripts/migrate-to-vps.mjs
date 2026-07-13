import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pool from '../src/db/pool.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, 'migration-export.sql');

const TABLES = [
  'clients',
  'employees',
  'standards',
  'projects',
  'tasks',
  'purchase_needs',
  'inventory_items',
  'suppliers',
  'admin_tasks',
  'dashboard_todos',
  'quotes',
  'invoices',
];

function esc(val) {
  if (val === null || val === undefined) return 'NULL';
  if (typeof val === 'boolean') return val ? 'TRUE' : 'FALSE';
  if (typeof val === 'number') return String(val);
  if (val instanceof Date) return `'${val.toISOString()}'`;
  if (typeof val === 'object') return `'${JSON.stringify(val).replace(/'/g, "''")}'::jsonb`;
  return `'${String(val).replace(/'/g, "''")}'`;
}

async function exportTable(client, table) {
  const exists = await client.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1`,
    [table]
  );
  if (!exists.rows.length) return { table, rows: 0, sql: '' };

  const { rows } = await client.query(`SELECT * FROM ${table} ORDER BY id`);
  if (!rows.length) return { table, rows: 0, sql: '' };

  const cols = Object.keys(rows[0]);
  const lines = rows.map((r) => {
    const vals = cols.map((c) => esc(r[c]));
    return `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${vals.join(', ')});`;
  });

  return {
    table,
    rows: rows.length,
    sql: `-- ${table} (${rows.length} rows)\n${lines.join('\n')}\n`,
  };
}

const DEFAULT_PURCHASE_NEEDS = [
  { title: 'Colle bois Titebond', category: 'consommable', quantity: 2, unit: 'bouteilles', priority: 'normal' },
  { title: 'Papier abrasif 120/180/220', category: 'consommable', quantity: 1, unit: 'lot', priority: 'normal' },
  { title: 'Lames scie circulaire', category: 'outil', quantity: 2, unit: 'unités', priority: 'normal' },
  { title: 'Vis à bois assorties', category: 'quincaillerie', quantity: 1, unit: 'boîte', priority: 'normal' },
  { title: 'Bandes de chant', category: 'materiaux', quantity: 1, unit: 'rouleau', priority: 'normal' },
];

async function main() {
  const client = await pool.connect();
  const parts = [
    '-- NEYA ERP migration export',
    `BEGIN;`,
    `-- Nettoyage données métier (garde users/admin)`,
    `TRUNCATE TABLE purchase_items, purchase_orders, project_materials, payments, expenses, purchase_needs, admin_tasks, dashboard_todos, invoices, quotes, tasks, projects, standards, clients RESTART IDENTITY CASCADE;`,
    `DELETE FROM employees;`,
  ];

  const stats = [];
  for (const table of TABLES) {
    const result = await exportTable(client, table);
    stats.push({ table: result.table, rows: result.rows });
    if (result.sql) parts.push(result.sql);
  }

  const needCount = stats.find((s) => s.table === 'purchase_needs')?.rows || 0;
  if (needCount === 0) {
    parts.push('-- Liste de courses par défaut (atelier)');
    for (const n of DEFAULT_PURCHASE_NEEDS) {
      parts.push(
        `INSERT INTO purchase_needs (title, category, quantity, unit, priority, status, source) VALUES (${esc(n.title)}, ${esc(n.category)}, ${n.quantity}, ${esc(n.unit)}, ${esc(n.priority)}, 'needed', 'seed');`
      );
    }
    stats.push({ table: 'purchase_needs (seed)', rows: DEFAULT_PURCHASE_NEEDS.length });
  }

  for (const table of TABLES) {
    parts.push(`SELECT setval(pg_get_serial_sequence('${table}', 'id'), COALESCE((SELECT MAX(id) FROM ${table}), 1));`);
  }

  parts.push('COMMIT;');

  fs.writeFileSync(OUT, parts.join('\n\n'), 'utf8');
  console.log('Export →', OUT);
  for (const s of stats) {
    if (s.rows > 0) console.log(`  ${s.table}: ${s.rows}`);
  }

  client.release();
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

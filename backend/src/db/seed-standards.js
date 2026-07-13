/**
 * Importe les fiches de fabrication Neya (doc v1.1 — Mai 2026)
 * Usage: npm run db:seed-standards
 */
import pool from './pool.js';
import { SOURCE, WORKSHOP_GUIDES, PRODUCTS } from '../data/fiches-fabrication.js';

async function upsertStandard(client, { name, product_type, meta, steps }) {
  const existing = await client.query(
    `SELECT id FROM standards WHERE product_type = $1 OR (meta->>'sku') = $2 LIMIT 1`,
    [product_type, meta?.sku || product_type]
  );
  const payload = [name, product_type, JSON.stringify(meta || {}), JSON.stringify(steps)];
  if (existing.rows[0]) {
    await client.query(
      `UPDATE standards SET name=$1, product_type=$2, meta=$3, steps=$4 WHERE id=$5`,
      [...payload, existing.rows[0].id]
    );
    return existing.rows[0].id;
  }
  const { rows } = await client.query(
    `INSERT INTO standards (name, product_type, meta, steps) VALUES ($1,$2,$3,$4) RETURNING id`,
    payload
  );
  return rows[0].id;
}

async function seed() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`ALTER TABLE standards ADD COLUMN IF NOT EXISTS meta JSONB NOT NULL DEFAULT '{}'`);

    await upsertStandard(client, WORKSHOP_GUIDES);
    for (const p of PRODUCTS) {
      await upsertStandard(client, {
        name: `${p.sku} — ${p.name}`,
        product_type: p.sku,
        meta: p.meta,
        steps: p.steps,
      });
    }

    await client.query('COMMIT');
    console.log(`✓ ${PRODUCTS.length + 1} standards importés depuis ${SOURCE}`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch(err => {
  console.error('Erreur:', err.message);
  process.exit(1);
});

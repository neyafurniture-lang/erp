import pool from '../db/pool.js';
import { SUPPLIERS } from './invoice-email-router.js';

/** Catalogue de base (slug = clé utilisée dans supplier_invoice_emails). */
export const KNOWN_SUPPLIER_DEFS = SUPPLIERS
  .filter(s => s.id !== 'other')
  .map(s => ({
    slug: s.id,
    name: s.label,
    email: null,
    lead_days: 3,
    notes: `Fournisseur catalogue (${s.label})`,
    meta: { patterns: s.patterns, source: 'catalog' },
  }));

export async function ensureKnownSuppliers() {
  const created = [];
  const existing = [];
  for (const def of KNOWN_SUPPLIER_DEFS) {
    const { rows: bySlug } = await pool.query(
      `SELECT * FROM suppliers WHERE slug = $1 LIMIT 1`,
      [def.slug]
    );
    if (bySlug[0]) {
      existing.push(bySlug[0]);
      continue;
    }
    const { rows: byName } = await pool.query(
      `SELECT * FROM suppliers WHERE LOWER(TRIM(name)) = LOWER($1) LIMIT 1`,
      [def.name]
    );
    if (byName[0]) {
      const { rows } = await pool.query(
        `UPDATE suppliers SET slug = COALESCE(slug, $1), meta = COALESCE(meta, '{}'::jsonb) || $2::jsonb
         WHERE id = $3 RETURNING *`,
        [def.slug, JSON.stringify(def.meta), byName[0].id]
      );
      existing.push(rows[0]);
      continue;
    }
    const { rows } = await pool.query(
      `INSERT INTO suppliers (name, email, lead_days, notes, slug, meta)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [def.name, def.email, def.lead_days, def.notes, def.slug, JSON.stringify(def.meta)]
    );
    created.push(rows[0]);
  }
  return { created, existing, total: created.length + existing.length };
}

function statsSelect(alias = 's') {
  return `
    (SELECT COUNT(*)::int FROM purchase_orders po WHERE po.supplier_id = ${alias}.id) AS order_count,
    (SELECT COALESCE(SUM(po.total), 0)::float FROM purchase_orders po WHERE po.supplier_id = ${alias}.id) AS orders_total,
    (SELECT COUNT(*)::int FROM purchase_needs pn WHERE pn.supplier_id = ${alias}.id AND pn.status IN ('needed','ordered')) AS open_needs,
    (SELECT COUNT(*)::int FROM inventory_items ii WHERE ii.supplier_id = ${alias}.id) AS inventory_count,
    (SELECT COUNT(*)::int FROM supplier_invoice_emails sie
      WHERE ${alias}.slug IS NOT NULL AND sie.supplier_id = ${alias}.slug
    ) AS invoice_email_count,
    (SELECT COALESCE(SUM(e.amount), 0)::float
      FROM supplier_invoice_emails sie
      JOIN expenses e ON e.id = sie.expense_id
      WHERE ${alias}.slug IS NOT NULL AND sie.supplier_id = ${alias}.slug
    ) AS invoiced_spend,
    (SELECT COALESCE(SUM(e.amount), 0)::float
      FROM expenses e WHERE e.supplier_id = ${alias}.id
    ) AS expenses_direct
  `;
}

export async function listSuppliersWithStats() {
  const { rows } = await pool.query(`
    SELECT s.*,
      ${statsSelect('s')}
    FROM suppliers s
    ORDER BY s.name
  `);
  return rows.map(enrichSupplierRow);
}

export async function getSupplierDetail(id) {
  const { rows } = await pool.query(
    `SELECT s.*, ${statsSelect('s')} FROM suppliers s WHERE s.id = $1`,
    [id]
  );
  if (!rows[0]) return null;
  const supplier = enrichSupplierRow(rows[0]);
  const slug = supplier.slug || '';

  const [orders, needs, inventory, invoiceEmails, expenses] = await Promise.all([
    pool.query(
      `SELECT po.*, p.name AS project_name
       FROM purchase_orders po
       LEFT JOIN projects p ON p.id = po.project_id
       WHERE po.supplier_id = $1
       ORDER BY COALESCE(po.ordered_at, po.created_at) DESC
       LIMIT 50`,
      [id]
    ),
    pool.query(
      `SELECT pn.*, p.name AS project_name
       FROM purchase_needs pn
       LEFT JOIN projects p ON p.id = pn.project_id
       WHERE pn.supplier_id = $1
       ORDER BY pn.created_at DESC
       LIMIT 50`,
      [id]
    ),
    pool.query(
      `SELECT id, sku, name, quantity, unit, unit_cost, min_level
       FROM inventory_items WHERE supplier_id = $1 ORDER BY name LIMIT 100`,
      [id]
    ),
    slug
      ? pool.query(
        `SELECT sie.*, p.name AS project_name, e.amount AS expense_amount, e.category AS expense_category
         FROM supplier_invoice_emails sie
         LEFT JOIN projects p ON p.id = sie.project_id
         LEFT JOIN expenses e ON e.id = sie.expense_id
         WHERE sie.supplier_id = $1
         ORDER BY sie.created_at DESC
         LIMIT 50`,
        [slug]
      )
      : Promise.resolve({ rows: [] }),
    pool.query(
      `SELECT e.*, p.name AS project_name
       FROM expenses e
       LEFT JOIN projects p ON p.id = e.project_id
       WHERE e.supplier_id = $1
          OR (
            $2 <> '' AND e.id IN (
              SELECT sie.expense_id FROM supplier_invoice_emails sie
              WHERE sie.expense_id IS NOT NULL AND sie.supplier_id = $2
            )
          )
       ORDER BY e.date DESC NULLS LAST, e.created_at DESC
       LIMIT 50`,
      [id, slug]
    ),
  ]);

  return {
    ...supplier,
    purchase_orders: orders.rows,
    purchase_needs: needs.rows,
    inventory_items: inventory.rows,
    invoice_emails: invoiceEmails.rows,
    expenses: expenses.rows,
  };
}

function enrichSupplierRow(row) {
  const ordersTotal = Number(row.orders_total || 0);
  const invoiced = Number(row.invoiced_spend || 0);
  const direct = Number(row.expenses_direct || 0);
  const totalSpent = ordersTotal + Math.max(invoiced, direct);
  return {
    ...row,
    total_spent: totalSpent,
    billed_purchases: invoiced,
  };
}

export async function resolveSupplierIdFromSlug(slug) {
  if (!slug || slug === 'other') return null;
  const { rows } = await pool.query(
    `SELECT id FROM suppliers WHERE slug = $1 LIMIT 1`,
    [slug]
  );
  return rows[0]?.id || null;
}

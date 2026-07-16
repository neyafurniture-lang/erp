import pool from '../db/pool.js';
import { getWebStatus } from './wordpress.js';

export const ADMIN_CATEGORIES = [
  'marche',
  'facturation',
  'site_web',
  'marketing',
  'gestion',
];

async function upsertBySource({ source_key, title, category, link_href, due_date }) {
  const existing = await pool.query(
    'SELECT id, status FROM admin_tasks WHERE source_key = $1',
    [source_key]
  );
  if (!existing.rows[0]) {
    const { rows } = await pool.query(
      `INSERT INTO admin_tasks (title, category, link_href, source_key, due_date, sort_order)
       VALUES ($1, $2, $3, $4, $5, COALESCE((SELECT MAX(sort_order) + 1 FROM admin_tasks), 0))
       RETURNING id`,
      [title, category, link_href || null, source_key, due_date || null]
    );
    return { id: rows[0].id, inserted: true };
  }
  if (existing.rows[0].status === 'done') return { id: existing.rows[0].id, inserted: false };
  await pool.query(
    `UPDATE admin_tasks SET title = $1, link_href = COALESCE($2, link_href), due_date = COALESCE($3, due_date)
     WHERE source_key = $4`,
    [title, link_href || null, due_date || null, source_key]
  );
  return { id: existing.rows[0].id, inserted: false };
}

export async function syncAdminTasksFromModules() {
  const created = [];

  const draftInvoices = await pool.query(`
    SELECT id, invoice_number, due_date, client_id
    FROM invoices
    WHERE status = 'draft'
    ORDER BY created_at DESC
    LIMIT 20
  `);
  for (const inv of draftInvoices.rows) {
    const r = await upsertBySource({
      source_key: `invoice_draft_${inv.id}`,
      title: `Facture à émettre — ${inv.invoice_number || `#${inv.id}`}`,
      category: 'facturation',
      link_href: `/invoices/${inv.id}`,
      due_date: inv.due_date,
    });
    if (r?.inserted) created.push(r.id);
  }

  const pendingQuotes = await pool.query(`
    SELECT id, quote_number, valid_until
    FROM quotes
    WHERE status IN ('draft', 'sent')
    ORDER BY created_at DESC
    LIMIT 15
  `);
  for (const q of pendingQuotes.rows) {
    const r = await upsertBySource({
      source_key: `quote_${q.status}_${q.id}`,
      title: q.status === 'draft'
        ? `Devis à finaliser — ${q.quote_number || `#${q.id}`}`
        : `Suivre devis envoyé — ${q.quote_number || `#${q.id}`}`,
      category: 'facturation',
      link_href: `/invoices?quote=${q.id}`,
      due_date: q.valid_until,
    });
    if (r?.inserted) created.push(r.id);
  }

  try {
    const web = await getWebStatus();
    if (!web?.configured) {
      const r = await upsertBySource({
        source_key: 'web_setup',
        title: 'Configurer la connexion au site web',
        category: 'site_web',
        link_href: '/web',
      });
      if (r?.inserted) created.push(r.id);
    } else if (web?.web_orders_active > 0) {
      const r = await upsertBySource({
        source_key: 'web_pending_orders',
        title: `${web.web_orders_active} commande(s) web à traiter`,
        category: 'site_web',
        link_href: '/web',
      });
      if (r?.inserted) created.push(r.id);
    }
  } catch {
    /* wordpress optionnel */
  }

  await pool.query(`
    UPDATE admin_tasks SET status = 'done', completed_at = NOW()
    WHERE source_key LIKE 'invoice_draft_%'
      AND status != 'done'
      AND NOT EXISTS (
        SELECT 1 FROM invoices i
        WHERE i.id = (regexp_replace(admin_tasks.source_key, '^invoice_draft_', ''))::int
          AND i.status = 'draft'
      )
  `);

  return { synced: created.length, created };
}

export async function seedDefaultAdminTasks() {
  const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM admin_tasks');
  if (rows[0].n > 0) return;

  const defaults = [
    { title: 'Préparer participation au prochain marché', category: 'marche', notes: 'Stand, inventaire, affiches, paiement' },
    { title: 'Factures en attente à émettre', category: 'facturation', link_href: '/invoices' },
    { title: 'Finaliser le site web (pages, produits, checkout)', category: 'site_web', link_href: '/web' },
    { title: 'Campagne pub & SEO (Google, réseaux sociaux)', category: 'marketing' },
    { title: 'Suivi comptabilité et dépenses mensuelles', category: 'gestion', link_href: '/expenses' },
    { title: 'Renouveler assurances et permis atelier', category: 'gestion' },
  ];

  for (let i = 0; i < defaults.length; i++) {
    const t = defaults[i];
    await pool.query(
      `INSERT INTO admin_tasks (title, category, notes, link_href, sort_order)
       VALUES ($1, $2, $3, $4, $5)`,
      [t.title, t.category, t.notes || null, t.link_href || null, i]
    );
  }
  console.log('Tâches admin par défaut créées');
}

export const PRIORITY_TASKS = [
  { source_key: 'prio_p1_internet_cut', title: "Couper Internet de l'ancien appartement", category: 'gestion', priority_tier: 'p1', sort_order: 0 },
  { source_key: 'prio_p1_electric_cut', title: "Couper l'électricité de l'ancien appartement", category: 'gestion', priority_tier: 'p1', sort_order: 1 },
  { source_key: 'prio_p1_internet_new', title: 'Trouver et souscrire un nouvel abonnement Internet', category: 'gestion', priority_tier: 'p1', sort_order: 2 },
  { source_key: 'prio_p1_etel', title: 'Refaire la facture pour Etel', category: 'facturation', priority_tier: 'p1', sort_order: 3, link_href: '/invoices' },
  { source_key: 'prio_p1_aem', title: "Envoyer la facture pour l'AEM", category: 'facturation', priority_tier: 'p1', sort_order: 4, link_href: '/invoices' },
  { source_key: 'prio_p1_olive', title: "Payer la facture d'Olive", category: 'gestion', priority_tier: 'p1', sort_order: 5, link_href: '/expenses' },
  { source_key: 'prio_p2_anne', title: 'Faire la facture Anne', category: 'facturation', priority_tier: 'p2', sort_order: 6, link_href: '/invoices' },
  { source_key: 'prio_p2_son', title: 'Faire la facture Son', category: 'facturation', priority_tier: 'p2', sort_order: 7, link_href: '/invoices' },
  { source_key: 'prio_p2_enns_relance', title: 'Relancer ENNS pour le paiement', category: 'facturation', priority_tier: 'p2', sort_order: 8, link_href: '/invoices' },
  { source_key: 'prio_p2_enns_devis', title: 'Modifier le devis ENNS (caissons + table)', category: 'facturation', priority_tier: 'p2', sort_order: 9, link_href: '/invoices' },
  { source_key: 'prio_p2_sonacloud_plan', title: 'Préparer le plan de production Sonacloud', category: 'gestion', priority_tier: 'p2', sort_order: 10, link_href: '/production' },
  { source_key: 'prio_p3_rp_pdf', title: 'Ajouter le PDF Sonacloud dans le RP', category: 'site_web', priority_tier: 'p3', sort_order: 11, link_href: '/web' },
  { source_key: 'prio_p3_rp_online', title: 'Mettre le RP en ligne', category: 'marketing', priority_tier: 'p3', sort_order: 12, link_href: '/web' },
  { source_key: 'prio_p3_site', title: 'Finir le site web', category: 'site_web', priority_tier: 'p3', sort_order: 13, link_href: '/web' },
];

export async function seedPriorityTasks() {
  for (const t of PRIORITY_TASKS) {
    const { rows } = await pool.query('SELECT id, status FROM admin_tasks WHERE source_key = $1', [t.source_key]);
    if (!rows[0]) {
      await pool.query(
        `INSERT INTO admin_tasks (title, category, priority_tier, sort_order, link_href, source_key, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [t.title, t.category, t.priority_tier, t.sort_order, t.link_href || null, t.source_key, t.notes || null]
      );
    } else if (rows[0].status !== 'done') {
      await pool.query(
        `UPDATE admin_tasks SET title = $1, category = $2, priority_tier = $3, sort_order = $4,
         link_href = COALESCE($5, link_href) WHERE source_key = $6`,
        [t.title, t.category, t.priority_tier, t.sort_order, t.link_href || null, t.source_key]
      );
    }
  }
}

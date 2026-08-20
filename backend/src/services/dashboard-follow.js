/** Libellés et liens du tableau de bord — pour que chaque ligne ouvre la bonne fiche. */

export const ADMIN_CAT_LABELS = {
  a_payer: 'À payer',
  a_recevoir: 'À encaisser',
  marche: 'Marché',
  facturation: 'Facture / devis',
  site_web: 'Site',
  marketing: 'Pub',
  gestion: 'Gestion',
};

export function quoteDetailHref(id) {
  if (!id) return '/invoices';
  return `/invoices/quotes/${id}`;
}

export function invoiceDetailHref(id) {
  if (!id) return '/invoices';
  return `/invoices/${id}`;
}

export function formatQuoteFollowTitle({ status, quote_number, client_name } = {}) {
  const who = String(client_name || '').trim() || 'client';
  const num = String(quote_number || '').trim();
  const tag = num ? ` (${num})` : '';
  if (status === 'draft') return `Devis à finir — ${who}${tag}`;
  if (status === 'sent') return `Relancer ${who}${num ? ` — ${num}` : ''}`;
  return `${who}${tag}`;
}

export function formatInvoiceFollowTitle({ status, invoice_number, client_name } = {}) {
  const who = String(client_name || '').trim() || 'client';
  const num = String(invoice_number || '').trim();
  const tag = num ? ` (${num})` : '';
  if (status === 'draft') return `Facture à envoyer — ${who}${tag}`;
  return `À encaisser — ${who}${tag}`;
}

export function adminCategoryLabel(category) {
  return ADMIN_CAT_LABELS[category] || 'Gestion';
}

/** Todos auto-générées à partir des devis/factures : elles vont dans le panneau Argent, pas dans la to-do. */
export function isMoneyFollowSourceKey(sourceKey) {
  const k = String(sourceKey || '');
  return k.startsWith('quote_') || k.startsWith('invoice_draft_');
}

/**
 * Dashboard = aujourd’hui à l’atelier, pas le dump des seeds perso (internet, Etel…).
 * Ces seeds restent sur /admin (Tâches bureau).
 */
export function shouldShowAdminOnDashboard(t = {}) {
  const key = String(t.source_key || '');
  if (isMoneyFollowSourceKey(key)) return false;
  if (key.startsWith('prio_')) return false;
  if (key.startsWith('ops_') || key.startsWith('mail_')) return true;
  if (t.status === 'doing') return true;
  if (t.priority_tier === 'p1') return true;
  if (t.category === 'a_payer' || t.category === 'a_recevoir') return true;
  if (t.due_date) {
    const due = new Date(t.due_date);
    if (!Number.isNaN(due.getTime())) {
      const limit = new Date();
      limit.setHours(23, 59, 59, 999);
      limit.setDate(limit.getDate() + 7);
      if (due.getTime() <= limit.getTime()) return true;
    }
  }
  return false;
}

export function mondayOf(date = new Date()) {
  const d = new Date(date);
  d.setHours(12, 0, 0, 0);
  const day = d.getDay(); // 0 dimanche
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10);
}

export function addDaysIso(isoDate, days) {
  const d = new Date(`${String(isoDate).slice(0, 10)}T12:00:00`);
  d.setDate(d.getDate() + Number(days || 0));
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function shiftCopyRange(sourceMonday) {
  const from = String(sourceMonday || mondayOf(addDaysIso(mondayOf(new Date()), -7))).slice(0, 10);
  const to = addDaysIso(from, 7);
  const destFrom = addDaysIso(from, 7);
  const destTo = addDaysIso(destFrom, 7);
  return { from, to, destFrom, destTo };
}

'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import AppShell from '../../../components/AppShell';
import AuthGuard from '../../../components/AuthGuard';
import { api, formatMoney, formatDate } from '../../../lib/api';

const ORDER_STATUS = {
  planned: 'À prévoir',
  urgent: 'Urgent',
  pending: 'En attente',
  ordered: 'Commandé',
  received: 'Reçu',
};

export default function SupplierDetailPage() {
  const { id } = useParams();
  const [supplier, setSupplier] = useState(null);
  const [tab, setTab] = useState('orders');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!id) return;
    api(`/suppliers/${id}`)
      .then(setSupplier)
      .catch(() => setError('Fournisseur introuvable'));
  }, [id]);

  if (error) {
    return (
      <AuthGuard>
        <AppShell title="Fournisseur">
          <p className="text-neya-muted mb-4">{error}</p>
          <Link href="/suppliers" className="btn-secondary">Retour</Link>
        </AppShell>
      </AuthGuard>
    );
  }

  if (!supplier) {
    return (
      <AuthGuard>
        <AppShell title="Fournisseur">
          <p className="text-neya-muted">Chargement…</p>
        </AppShell>
      </AuthGuard>
    );
  }

  const tabs = [
    { key: 'orders', label: 'Commandes', count: supplier.purchase_orders?.length || 0 },
    { key: 'invoices', label: 'Factures mail', count: supplier.invoice_emails?.length || 0 },
    { key: 'expenses', label: 'Dépenses', count: supplier.expenses?.length || 0 },
    { key: 'needs', label: 'Besoins', count: supplier.purchase_needs?.length || 0 },
    { key: 'stock', label: 'Stock lié', count: supplier.inventory_items?.length || 0 },
  ];

  return (
    <AuthGuard>
      <AppShell title={supplier.name}>
        <Link href="/suppliers" className="text-sm text-neya-orange hover:underline mb-4 inline-block">
          ← Retour aux fournisseurs
        </Link>

        <div className="card mb-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="font-heading text-2xl text-neya-ink">{supplier.name}</h1>
              {supplier.contact && <p className="text-sm text-neya-muted mt-1">{supplier.contact}</p>}
            </div>
            <Link href="/suppliers" className="btn-secondary text-sm">Liste</Link>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-4 pt-4 border-t border-neya-border">
            <Stat label="Total suivi" value={formatMoney(supplier.total_spent || 0)} />
            <Stat label="Commandes" value={String(supplier.order_count || 0)} />
            <Stat label="Factures mail" value={String(supplier.invoice_email_count || 0)} />
            <Stat label="Dépenses liées" value={formatMoney(supplier.billed_purchases || supplier.invoiced_spend || 0)} />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-4 pt-4 border-t border-neya-border text-sm">
            {supplier.email && (
              <div>
                <p className="text-[10px] uppercase tracking-wider text-neya-muted">Email</p>
                <a href={`mailto:${supplier.email}`} className="text-neya-ink hover:text-neya-orange">{supplier.email}</a>
              </div>
            )}
            {supplier.phone && (
              <div>
                <p className="text-[10px] uppercase tracking-wider text-neya-muted">Téléphone</p>
                <p className="text-neya-ink">{supplier.phone}</p>
              </div>
            )}
            {supplier.lead_days != null && (
              <div>
                <p className="text-[10px] uppercase tracking-wider text-neya-muted">Délai</p>
                <p className="text-neya-ink">{supplier.lead_days} jours</p>
              </div>
            )}
            {supplier.account_number && (
              <div>
                <p className="text-[10px] uppercase tracking-wider text-neya-muted">N° compte</p>
                <p className="text-neya-ink">{supplier.account_number}</p>
              </div>
            )}
            {(supplier.address || supplier.website) && (
              <div className="sm:col-span-2">
                <p className="text-[10px] uppercase tracking-wider text-neya-muted">Coordonnées</p>
                <p className="text-neya-ink">
                  {[supplier.address, supplier.website].filter(Boolean).join(' · ')}
                </p>
              </div>
            )}
          </div>
          {supplier.notes && (
            <p className="text-xs text-neya-muted mt-4 pt-4 border-t border-neya-border italic">{supplier.notes}</p>
          )}
        </div>

        <div className="flex flex-wrap gap-2 mb-6">
          {tabs.map(t => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                tab === t.key
                  ? 'bg-neya-orange text-white'
                  : 'bg-white border border-neya-border text-neya-muted hover:border-neya-orange'
              }`}
            >
              {t.label} ({t.count})
            </button>
          ))}
        </div>

        {tab === 'orders' && (
          <Table
            empty="Aucune commande d’achat"
            headers={['Titre', 'Projet', 'Statut', 'Total', 'Date']}
            rows={(supplier.purchase_orders || []).map(o => [
              o.title || `Commande #${o.id}`,
              o.project_name || '—',
              ORDER_STATUS[o.status] || o.status,
              formatMoney(o.total || 0),
              formatDate(o.ordered_at || o.created_at),
            ])}
          />
        )}

        {tab === 'invoices' && (
          <Table
            empty="Aucune facture détectée dans le courriel"
            headers={['Sujet', 'Statut', 'Projet', 'Montant', 'Date']}
            rows={(supplier.invoice_emails || []).map(inv => [
              inv.subject || '—',
              inv.status,
              inv.project_name || '—',
              inv.expense_amount != null ? formatMoney(inv.expense_amount) : '—',
              formatDate(inv.assigned_at || inv.created_at),
            ])}
          />
        )}

        {tab === 'expenses' && (
          <Table
            empty="Aucune dépense liée"
            headers={['Description', 'Projet', 'Catégorie', 'Montant', 'Date']}
            rows={(supplier.expenses || []).map(e => [
              e.description || '—',
              e.project_name || '—',
              e.category,
              formatMoney(e.amount),
              formatDate(e.date),
            ])}
          />
        )}

        {tab === 'needs' && (
          <Table
            empty="Aucun besoin d’achat"
            headers={['Article', 'Qté', 'Priorité', 'Statut', 'Projet']}
            rows={(supplier.purchase_needs || []).map(n => [
              n.title,
              `${n.quantity} ${n.unit || ''}`.trim(),
              n.priority,
              n.status,
              n.project_name || '—',
            ])}
          />
        )}

        {tab === 'stock' && (
          <Table
            empty="Aucun article de stock lié"
            headers={['SKU', 'Nom', 'Qté', 'Coût unit.']}
            rows={(supplier.inventory_items || []).map(i => [
              i.sku || '—',
              i.name,
              `${i.quantity ?? 0} ${i.unit || ''}`.trim(),
              formatMoney(i.unit_cost || 0),
            ])}
          />
        )}

        <div className="mt-6 flex flex-wrap gap-3 text-sm">
          <Link href="/purchases" className="text-neya-orange hover:underline">Achats atelier →</Link>
          <Link href="/expenses" className="text-neya-orange hover:underline">Dépenses →</Link>
          <Link href="/mail" className="text-neya-orange hover:underline">Courriel / factures →</Link>
        </div>
      </AppShell>
    </AuthGuard>
  );
}

function Stat({ label, value }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-neya-muted">{label}</p>
      <p className="text-lg font-semibold text-neya-ink tabular-nums">{value}</p>
    </div>
  );
}

function Table({ headers, rows, empty }) {
  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-neya-border text-left text-neya-muted">
            {headers.map(h => (
              <th key={h} className="pb-3 pr-4">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={headers.length} className="py-8 text-center text-neya-muted">{empty}</td>
            </tr>
          ) : (
            rows.map((cells, idx) => (
              <tr key={idx} className="border-b border-neya-border">
                {cells.map((cell, i) => (
                  <td key={i} className="py-3 pr-4 text-neya-ink">{cell}</td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

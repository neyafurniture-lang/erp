'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Search, Plus, ChevronRight, Truck } from 'lucide-react';
import AppShell from '../../components/AppShell';
import AuthGuard from '../../components/AuthGuard';
import { api, formatMoney } from '../../lib/api';

function initials(name) {
  return String(name || '?')
    .split(/\s+/)
    .map(n => n[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

const emptyForm = {
  name: '',
  contact: '',
  email: '',
  phone: '',
  lead_days: 7,
  address: '',
  website: '',
  account_number: '',
  notes: '',
  slug: '',
};

export default function SuppliersPage() {
  return (
    <AuthGuard>
      <AppShell title="Fournisseurs" subtitle="Achats, factures et délais" wide>
        <SuppliersContent />
      </AppShell>
    </AuthGuard>
  );
}

function SuppliersContent() {
  const [suppliers, setSuppliers] = useState([]);
  const [query, setQuery] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = () => api('/suppliers').then(setSuppliers).catch(err => setError(err.message));

  useEffect(() => {
    load();
  }, []);

  async function ensureCatalog() {
    setBusy(true);
    setError('');
    try {
      await api('/suppliers/ensure-catalog', { method: 'POST', body: '{}' });
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const payload = {
        ...form,
        lead_days: Number(form.lead_days) || 7,
        slug: form.slug || undefined,
      };
      if (editId) {
        await api(`/suppliers/${editId}`, { method: 'PUT', body: JSON.stringify(payload) });
      } else {
        await api('/suppliers', { method: 'POST', body: JSON.stringify(payload) });
      }
      setShowForm(false);
      setEditId(null);
      setForm(emptyForm);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function startEdit(s) {
    setForm({
      name: s.name || '',
      contact: s.contact || '',
      email: s.email || '',
      phone: s.phone || '',
      lead_days: s.lead_days ?? 7,
      address: s.address || '',
      website: s.website || '',
      account_number: s.account_number || '',
      notes: s.notes || '',
      slug: s.slug || '',
    });
    setEditId(s.id);
    setShowForm(true);
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return suppliers;
    return suppliers.filter(s =>
      [s.name, s.contact, s.email, s.phone, s.slug, s.account_number]
        .filter(Boolean)
        .some(v => String(v).toLowerCase().includes(q))
    );
  }, [suppliers, query]);

  const totalSpend = suppliers.reduce((sum, s) => sum + Number(s.total_spent || 0), 0);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-[26px] font-semibold text-neya-ink lg:hidden">Fournisseurs</h1>
          <p className="text-sm text-neya-muted">
            {suppliers.length} fiche{suppliers.length > 1 ? 's' : ''}
            {totalSpend > 0 ? ` · ${formatMoney(totalSpend)} suivis` : ''}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-secondary text-sm" disabled={busy} onClick={ensureCatalog}>
            Catalogue (Home Depot, Rona…)
          </button>
          <button
            type="button"
            className="btn-primary gap-1.5"
            onClick={() => {
              setShowForm(true);
              setEditId(null);
              setForm(emptyForm);
            }}
          >
            <Plus className="h-4 w-4" /> Nouveau
          </button>
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="relative max-w-xl">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neya-muted" aria-hidden />
        <input
          type="search"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Rechercher un fournisseur…"
          className="cf-page-search h-11 pl-10 text-[13.5px]"
        />
      </div>

      {showForm && (
        <form onSubmit={save} className="card rounded-2xl grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="label">Nom</label>
            <input className="input" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required />
          </div>
          <div>
            <label className="label">Contact</label>
            <input className="input" value={form.contact} onChange={e => setForm({ ...form, contact: e.target.value })} />
          </div>
          <div>
            <label className="label">Email</label>
            <input type="email" className="input" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
          </div>
          <div>
            <label className="label">Téléphone</label>
            <input className="input" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} />
          </div>
          <div>
            <label className="label">Délai (jours)</label>
            <input
              type="number"
              min={0}
              className="input"
              value={form.lead_days}
              onChange={e => setForm({ ...form, lead_days: e.target.value })}
            />
          </div>
          <div>
            <label className="label">N° compte</label>
            <input className="input" value={form.account_number} onChange={e => setForm({ ...form, account_number: e.target.value })} />
          </div>
          <div>
            <label className="label">Adresse</label>
            <input className="input" value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} />
          </div>
          <div>
            <label className="label">Site web</label>
            <input className="input" value={form.website} onChange={e => setForm({ ...form, website: e.target.value })} />
          </div>
          <div>
            <label className="label">Slug mail (ex. home_depot)</label>
            <input className="input" value={form.slug} onChange={e => setForm({ ...form, slug: e.target.value })} placeholder="optionnel" />
          </div>
          <div className="md:col-span-2">
            <label className="label">Notes</label>
            <textarea className="input" rows={2} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} />
          </div>
          <div className="md:col-span-2 flex gap-2">
            <button type="submit" className="btn-primary" disabled={busy}>{editId ? 'Modifier' : 'Créer'}</button>
            <button type="button" className="btn-secondary" onClick={() => setShowForm(false)}>Annuler</button>
          </div>
        </form>
      )}

      <ul className="space-y-2 lg:hidden">
        {filtered.map(s => (
          <li key={s.id}>
            <Link
              href={`/suppliers/${s.id}`}
              className="flex w-full items-center gap-3 rounded-2xl border border-neya-border bg-white p-3.5 text-left shadow-sm"
            >
              <div className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-neya-ink font-display text-[13px] font-semibold text-white">
                {initials(s.name)}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] font-semibold text-neya-ink">{s.name}</p>
                <p className="truncate text-[11.5px] text-neya-muted mt-0.5">
                  {[
                    `${s.order_count || 0} commande${Number(s.order_count) > 1 ? 's' : ''}`,
                    formatMoney(s.total_spent || 0),
                  ].join(' · ')}
                </p>
              </div>
              <ChevronRight className="h-4 w-4 shrink-0 text-neya-muted" />
            </Link>
          </li>
        ))}
        {filtered.length === 0 && (
          <li className="card rounded-2xl text-center py-10 text-sm text-neya-muted">
            Aucun fournisseur — créez-en ou chargez le catalogue.
          </li>
        )}
      </ul>

      <div className="cf-table-wrap hidden lg:block">
        <table className="w-full text-[13px]">
          <thead>
            <tr>
              <th className="px-5 py-3">Fournisseur</th>
              <th className="px-5 py-3">Délai</th>
              <th className="px-5 py-3">Commandes</th>
              <th className="px-5 py-3">Factures mail</th>
              <th className="px-5 py-3">Total suivi</th>
              <th className="px-5 py-3 text-right"> </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neya-border">
            {filtered.map(s => (
              <tr key={s.id}>
                <td className="px-5 py-3">
                  <Link href={`/suppliers/${s.id}`} className="flex items-center gap-3 min-w-0">
                    <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-neya-ink text-white">
                      <Truck className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-neya-ink">{s.name}</p>
                      {s.email ? (
                        <p className="truncate text-[11px] text-neya-muted">{s.email}</p>
                      ) : s.slug ? (
                        <p className="truncate text-[11px] text-neya-muted">{s.slug}</p>
                      ) : null}
                    </div>
                  </Link>
                </td>
                <td className="px-5 py-3 text-neya-muted">{s.lead_days ?? '—'} j</td>
                <td className="px-5 py-3 tabular-nums">{s.order_count || 0}</td>
                <td className="px-5 py-3 tabular-nums">{s.invoice_email_count || 0}</td>
                <td className="px-5 py-3 tabular-nums font-medium">{formatMoney(s.total_spent || 0)}</td>
                <td className="px-5 py-3 text-right">
                  <button type="button" className="text-xs font-medium text-neya-orange hover:underline" onClick={() => startEdit(s)}>
                    Modifier
                  </button>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="px-5 py-10 text-center text-neya-muted">Aucun fournisseur</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

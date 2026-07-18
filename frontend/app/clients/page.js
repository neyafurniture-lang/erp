'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Search, Plus, Mail, MapPin, Phone, ChevronRight } from 'lucide-react';
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

function relativeLast(dateLike) {
  if (!dateLike) return '—';
  const d = new Date(dateLike);
  if (Number.isNaN(d.getTime())) return '—';
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startThat = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diff = Math.round((startToday - startThat) / 86400000);
  if (diff <= 0) return "Aujourd'hui";
  if (diff === 1) return 'Hier';
  if (diff < 7) return `${diff} j`;
  if (diff < 30) return `${Math.floor(diff / 7)} sem`;
  if (diff < 60) return '1 mois';
  return d.toLocaleDateString('fr-CA', { day: 'numeric', month: 'short' });
}

function toneLabel(tone) {
  if (tone === 'fidele') return 'Fidèle';
  if (tone === 'prospect') return 'Prospect';
  if (tone === 'active') return 'Actif';
  return 'Archivé';
}

/** Couleurs statut = Craft Flow Lovable */
function toneClass(tone) {
  if (tone === 'active') return 'bg-neya-orange-soft text-neya-orange';
  if (tone === 'fidele') return 'bg-emerald-50 text-emerald-700';
  if (tone === 'prospect') return 'bg-amber-50 text-amber-800';
  return 'bg-neya-surface text-neya-ink-light';
}

export default function ClientsPage() {
  return (
    <AuthGuard>
      <Suspense fallback={
        <AppShell title="Clients" subtitle="Répertoire clients de l'atelier" wide>
          <p className="text-neya-muted">Chargement…</p>
        </AppShell>
      }>
        <ClientsShell />
      </Suspense>
    </AuthGuard>
  );
}

function ClientsShell() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [clients, setClients] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [query, setQuery] = useState('');
  const [form, setForm] = useState({ name: '', contact: '', email: '', phone: '', address: '', city: '', notes: '' });
  const [editId, setEditId] = useState(null);

  const load = () => api('/clients').then(setClients);

  useEffect(() => {
    load();
    window.addEventListener('neya:assistant-action', load);
    return () => window.removeEventListener('neya:assistant-action', load);
  }, []);

  useEffect(() => {
    const editParam = searchParams.get('edit');
    if (!editParam || clients.length === 0) return;
    const c = clients.find(x => String(x.id) === editParam);
    if (c) startEdit(c);
  }, [searchParams, clients]);

  async function save(e) {
    e.preventDefault();
    if (editId) {
      await api(`/clients/${editId}`, { method: 'PUT', body: JSON.stringify(form) });
    } else {
      await api('/clients', { method: 'POST', body: JSON.stringify(form) });
    }
    setShowForm(false);
    setEditId(null);
    setForm({ name: '', contact: '', email: '', phone: '', address: '', city: '', notes: '' });
    load();
  }

  function startEdit(c) {
    setForm({
      name: c.name,
      contact: c.contact || '',
      email: c.email || '',
      phone: c.phone || '',
      address: c.address || '',
      city: c.city || '',
      notes: c.notes || '',
    });
    setEditId(c.id);
    setShowForm(true);
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return clients;
    return clients.filter(c =>
      [c.name, c.contact, c.email, c.phone, c.city, c.address]
        .filter(Boolean)
        .some(v => String(v).toLowerCase().includes(q))
    );
  }, [clients, query]);

  const activeCount = clients.filter(c => c.tone === 'active' || c.tone === 'fidele' || c.active_projects > 0).length;
  const subtitle = `${clients.length} compte${clients.length > 1 ? 's' : ''}${
    activeCount ? ` · ${activeCount} actif${activeCount > 1 ? 's' : ''}` : ''
  }`;

  return (
    <AppShell title="Clients" subtitle={subtitle || "Répertoire clients de l'atelier"} wide>
      <div className="mx-auto max-w-[1200px] space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="lg:hidden">
            <h1 className="font-display text-[26px] font-semibold text-neya-ink">Clients</h1>
            <p className="text-sm text-neya-muted">{subtitle}</p>
          </div>
          <button
            type="button"
            onClick={() => {
              setShowForm(true);
              setEditId(null);
              setForm({ name: '', contact: '', email: '', phone: '', address: '', city: '', notes: '' });
            }}
            className="ml-auto inline-flex h-9 items-center gap-1.5 rounded-lg bg-neya-orange px-3 text-[13px] font-semibold text-white shadow-sm hover:bg-neya-orange/90"
          >
            <Plus className="h-4 w-4" /> Nouveau client
          </button>
        </div>

        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neya-muted" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Rechercher un client, une ville…"
            className="h-11 w-full rounded-lg border border-neya-border bg-neya-surface pl-10 pr-3 text-[13.5px] outline-none placeholder:text-neya-muted focus:border-neya-orange/40 focus:bg-white focus:ring-2 focus:ring-neya-orange/15"
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
              <label className="label">Adresse</label>
              <input className="input" value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} />
            </div>
            <div>
              <label className="label">Ville / Province</label>
              <input className="input" value={form.city} onChange={e => setForm({ ...form, city: e.target.value })} placeholder="Montréal QC" />
            </div>
            <div className="md:col-span-2">
              <label className="label">Notes</label>
              <textarea className="input" rows={2} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} />
            </div>
            <div className="md:col-span-2 flex gap-2">
              <button type="submit" className="btn-primary">{editId ? 'Modifier' : 'Créer'}</button>
              <button type="button" onClick={() => setShowForm(false)} className="btn-secondary">Annuler</button>
            </div>
          </form>
        )}

        {/* Mobile cards — Craft Flow */}
        <ul className="space-y-2 lg:hidden">
          {filtered.map(c => {
            const projects = Number(c.project_count || 0);
            const total = Number(c.total_billed || c.total_invoiced || 0);
            return (
              <li key={c.id}>
                <Link
                  href={`/clients/${c.id}`}
                  className="flex w-full items-center gap-3 rounded-2xl border border-neya-border bg-white p-3 text-left shadow-sm"
                >
                  <div className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-neya-ink font-display text-[13px] font-semibold text-white">
                    {initials(c.name)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14px] font-semibold text-neya-ink">{c.name}</p>
                    <p className="truncate text-[11.5px] text-neya-muted">
                      {[c.city || '—', `${projects} projet${projects > 1 ? 's' : ''}`, formatMoney(total)].join(' · ')}
                    </p>
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-neya-muted" />
                </Link>
              </li>
            );
          })}
          {filtered.length === 0 && (
            <li className="rounded-2xl border border-dashed border-neya-border bg-white/60 py-10 text-center text-sm text-neya-muted">
              Aucun client
            </li>
          )}
        </ul>

        {/* Desktop table — Craft Flow Lovable */}
        <div className="hidden overflow-hidden rounded-2xl border border-neya-border bg-white shadow-sm lg:block">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-neya-border bg-neya-surface text-left text-[11px] font-semibold uppercase tracking-wider text-neya-muted">
                <th className="px-5 py-3">Client</th>
                <th className="px-5 py-3">Ville</th>
                <th className="px-5 py-3 text-center">Projets</th>
                <th className="px-5 py-3 text-right">Total facturé</th>
                <th className="px-5 py-3">Statut</th>
                <th className="px-5 py-3 text-right">Dernier contact</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neya-border">
              {filtered.map(c => {
                const projects = Number(c.project_count || 0);
                const total = Number(c.total_billed || c.total_invoiced || 0);
                return (
                  <tr
                    key={c.id}
                    className="cursor-pointer transition-colors hover:bg-neya-surface/60"
                    onClick={() => router.push(`/clients/${c.id}`)}
                  >
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-neya-ink font-display text-[12px] font-semibold text-white">
                          {initials(c.name)}
                        </div>
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-neya-ink">{c.name}</p>
                          {c.email ? (
                            <p className="flex items-center gap-1.5 truncate text-[11px] text-neya-muted">
                              <Mail className="h-3 w-3" /> {c.email}
                            </p>
                          ) : c.phone ? (
                            <p className="flex items-center gap-1.5 truncate text-[11px] text-neya-muted">
                              <Phone className="h-3 w-3" /> {c.phone}
                            </p>
                          ) : null}
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3 text-neya-ink-light">
                      {c.city ? (
                        <span className="inline-flex items-center gap-1.5">
                          <MapPin className="h-3 w-3 text-neya-muted" /> {c.city}
                        </span>
                      ) : '—'}
                    </td>
                    <td className="px-5 py-3 text-center font-display tabular-nums font-semibold text-neya-ink">
                      {projects}
                    </td>
                    <td className="px-5 py-3 text-right font-display tabular-nums font-semibold text-neya-ink">
                      {formatMoney(total)}
                    </td>
                    <td className="px-5 py-3">
                      <span className={`rounded-full px-2.5 py-0.5 text-[10.5px] font-semibold ${toneClass(c.tone)}`}>
                        {toneLabel(c.tone)}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-right text-neya-muted tabular-nums">
                      {c.open_quotes > 0 && !c.last_activity_at ? 'Devis' : relativeLast(c.last_activity_at)}
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-5 py-10 text-center text-neya-muted">Aucun client</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

      </div>
    </AppShell>
  );
}

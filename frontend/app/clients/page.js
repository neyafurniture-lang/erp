'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Search, Plus, Mail, MapPin, Phone, ChevronRight } from 'lucide-react';
import AppShell from '../../components/AppShell';
import AuthGuard from '../../components/AuthGuard';
import { api } from '../../lib/api';

function initials(name) {
  return String(name || '?')
    .split(/\s+/)
    .map(n => n[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

export default function ClientsPage() {
  return (
    <AuthGuard>
      <AppShell title="Clients" subtitle="Répertoire clients de l'atelier">
        <Suspense fallback={<p className="text-neya-muted">Chargement…</p>}>
          <ClientsContent />
        </Suspense>
      </AppShell>
    </AuthGuard>
  );
}

function ClientsContent() {
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
    setForm({ name: c.name, contact: c.contact || '', email: c.email || '', phone: c.phone || '', address: c.address || '', city: c.city || '', notes: c.notes || '' });
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

  return (
    <div className="space-y-5">
      <div className="lg:hidden">
        <h1 className="font-display text-[26px] font-semibold text-neya-ink">Clients</h1>
        <p className="text-sm text-neya-muted">{clients.length} compte{clients.length > 1 ? 's' : ''}</p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neya-muted" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Rechercher un client, une ville…"
            className="cf-page-search h-11 pl-10 text-[13.5px]"
          />
        </div>
        <button
          type="button"
          onClick={() => {
            setShowForm(true);
            setEditId(null);
            setForm({ name: '', contact: '', email: '', phone: '', address: '', city: '', notes: '' });
          }}
          className="btn-primary gap-1.5 shrink-0"
        >
          <Plus className="h-4 w-4" /> Nouveau client
        </button>
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
            <input className="input" value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} placeholder="433 Chabanel West, suite 1021" />
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

      {/* Mobile card list */}
      <ul className="space-y-2 lg:hidden">
        {filtered.map(c => (
          <li key={c.id}>
            <div className="flex w-full items-center gap-3 rounded-2xl border border-neya-border bg-white p-3 text-left shadow-sm">
              <Link href={`/clients/${c.id}`} className="flex min-w-0 flex-1 items-center gap-3">
                <div className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-neya-ink font-display text-[13px] font-semibold text-white">
                  {initials(c.name)}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-semibold text-neya-ink">{c.name}</p>
                  <p className="truncate text-[11.5px] text-neya-muted">
                    {[c.city, c.email || c.phone].filter(Boolean).join(' · ') || '—'}
                  </p>
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 text-neya-muted" />
              </Link>
              <button
                type="button"
                onClick={() => startEdit(c)}
                title="Modifier"
                className="shrink-0 p-2 rounded-lg text-neya-muted hover:text-neya-orange hover:bg-neya-orange/10 text-sm"
              >
                ✎
              </button>
            </div>
          </li>
        ))}
        {filtered.length === 0 && (
          <li className="card rounded-2xl text-center py-10 text-sm text-neya-muted">Aucun client</li>
        )}
      </ul>

      {/* Desktop table */}
      <div className="cf-table-wrap hidden lg:block">
        <table className="w-full text-[13px]">
          <thead>
            <tr>
              <th className="px-5 py-3">Client</th>
              <th className="px-5 py-3">Ville</th>
              <th className="px-5 py-3">Contact</th>
              <th className="px-5 py-3">Téléphone</th>
              <th className="px-5 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neya-border">
            {filtered.map(c => (
              <tr key={c.id} className="cursor-pointer">
                <td className="px-5 py-3">
                  <Link href={`/clients/${c.id}`} className="flex items-center gap-3 min-w-0">
                    <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-neya-ink font-display text-[12px] font-semibold text-white">
                      {initials(c.name)}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-neya-ink">{c.name}</p>
                      {c.email && (
                        <p className="flex items-center gap-1.5 truncate text-[11px] text-neya-muted">
                          <Mail className="h-3 w-3" /> {c.email}
                        </p>
                      )}
                    </div>
                  </Link>
                </td>
                <td className="px-5 py-3 text-neya-ink-light">
                  {c.city ? (
                    <span className="inline-flex items-center gap-1.5">
                      <MapPin className="h-3 w-3 text-neya-muted" /> {c.city}
                    </span>
                  ) : '—'}
                </td>
                <td className="px-5 py-3 text-neya-ink-light">{c.contact || '—'}</td>
                <td className="px-5 py-3 text-neya-ink-light">
                  {c.phone ? (
                    <span className="inline-flex items-center gap-1.5">
                      <Phone className="h-3 w-3 text-neya-muted" /> {c.phone}
                    </span>
                  ) : '—'}
                </td>
                <td className="px-5 py-3 text-right">
                  <button
                    type="button"
                    onClick={() => startEdit(c)}
                    className="text-xs font-medium text-neya-orange hover:underline"
                  >
                    Modifier
                  </button>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={5} className="px-5 py-10 text-center text-neya-muted">Aucun client</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import AppShell from '../../components/AppShell';
import AuthGuard from '../../components/AuthGuard';
import { api } from '../../lib/api';

export default function ClientsPage() {
  return (
    <AuthGuard>
      <AppShell title="Clients">
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

  return (
    <>
        <div className="flex justify-end mb-6">
          <button onClick={() => { setShowForm(true); setEditId(null); setForm({ name: '', contact: '', email: '', phone: '', address: '', city: '', notes: '' }); }} className="btn-primary">
            + Client
          </button>
        </div>

        {showForm && (
          <form onSubmit={save} className="card mb-6 grid grid-cols-1 md:grid-cols-2 gap-4">
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

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {clients.map(c => (
            <div key={c.id} className="card hover:border-neya-orange transition-colors relative group">
              <Link href={`/clients/${c.id}`} className="block">
                <h3 className="font-heading text-lg pr-8">{c.name}</h3>
                {c.contact && <p className="text-sm text-neya-muted mt-1">{c.contact}</p>}
                {c.email && <p className="text-xs text-neya-muted">{c.email}</p>}
                {c.phone && <p className="text-xs text-neya-muted">{c.phone}</p>}
                <p className="text-xs text-neya-orange mt-3 opacity-0 group-hover:opacity-100 transition-opacity">
                  Voir projets & factures →
                </p>
              </Link>
              <button
                type="button"
                onClick={() => startEdit(c)}
                title="Modifier"
                className="absolute top-4 right-4 p-1 rounded text-neya-muted hover:text-neya-orange hover:bg-neya-orange/10 text-sm"
              >
                ✎
              </button>
            </div>
          ))}
        </div>
    </>
  );
}

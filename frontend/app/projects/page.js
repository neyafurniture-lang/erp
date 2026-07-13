'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import AppShell from '../../components/AppShell';
import AuthGuard from '../../components/AuthGuard';
import { api, formatMoney, formatDate, PROJECT_STATUS } from '../../lib/api';
import { isCustomProject } from '../../lib/projects';

export default function ProjectsPage() {
  const [projects, setProjects] = useState([]);
  const [clients, setClients] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', client_id: '', deadline: '', budget_estimated: '' });

  const load = () => {
    api('/projects').then(setProjects);
    api('/clients').then(setClients);
  };

  useEffect(() => {
    load();
    window.addEventListener('neya:assistant-action', load);
    return () => window.removeEventListener('neya:assistant-action', load);
  }, []);

  async function create(e) {
    e.preventDefault();
    await api('/projects', {
      method: 'POST',
      body: JSON.stringify({
        ...form,
        client_id: form.client_id || null,
        budget_estimated: Number(form.budget_estimated) || 0,
      }),
    });
    setShowForm(false);
    setForm({ name: '', client_id: '', deadline: '', budget_estimated: '' });
    load();
  }

  return (
    <AuthGuard>
      <AppShell title="Projets">
        <div className="flex justify-between items-center mb-6">
          <p className="text-neya-muted text-sm">{projects.length} projet(s)</p>
          <button onClick={() => setShowForm(!showForm)} className="btn-primary">
            + Nouveau projet
          </button>
        </div>

        {showForm && (
          <form onSubmit={create} className="card mb-6 grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="label">Nom du projet</label>
              <input className="input" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required />
            </div>
            <div>
              <label className="label">Client</label>
              <select className="input" value={form.client_id} onChange={e => setForm({ ...form, client_id: e.target.value })}>
                <option value="">— Aucun —</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Deadline</label>
              <input type="date" className="input" value={form.deadline} onChange={e => setForm({ ...form, deadline: e.target.value })} />
            </div>
            <div>
              <label className="label">Budget estimé ($)</label>
              <input type="number" className="input" value={form.budget_estimated} onChange={e => setForm({ ...form, budget_estimated: e.target.value })} />
            </div>
            <div className="md:col-span-2 flex gap-2">
              <button type="submit" className="btn-primary">Créer</button>
              <button type="button" onClick={() => setShowForm(false)} className="btn-secondary">Annuler</button>
            </div>
          </form>
        )}

        <div className="grid gap-4">
          {projects.map(p => {
            const st = PROJECT_STATUS.find(s => s.value === p.status) || PROJECT_STATUS[0];
            const custom = isCustomProject(p);
            return (
              <Link key={p.id} href={`/projects/${p.id}`} className="card hover:border-neya-orange transition-colors block">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-heading text-lg">{p.name}</h3>
                      {p.wp_order_id && (
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-blue-50 text-blue-800 border border-blue-200">
                          Web
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-neya-muted">{p.client_name || 'Sans client'}</p>
                  </div>
                  <span className={`text-xs px-2 py-1 rounded-full text-white ${st.color}`}>{st.label}</span>
                </div>
                <div className="flex flex-wrap gap-6 mt-3 text-sm text-neya-muted">
                  <span>Deadline : {formatDate(p.deadline)}</span>
                  {!custom && <span>Budget : {formatMoney(p.budget_estimated)}</span>}
                  {custom && p.tasks_total > 0 && (
                    <span className="text-neya-orange font-medium">
                      Checklist : {p.tasks_done}/{p.tasks_total}
                    </span>
                  )}
                  {custom && !p.tasks_total && (
                    <span className="italic">Checklist vide</span>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      </AppShell>
    </AuthGuard>
  );
}

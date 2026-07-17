'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Search, Plus, Calendar, DollarSign, ChevronRight } from 'lucide-react';
import AppShell from '../../components/AppShell';
import AuthGuard from '../../components/AuthGuard';
import { api, formatMoney, formatDate, PROJECT_STATUS } from '../../lib/api';
import { isCustomProject } from '../../lib/projects';

const FILTERS = [
  { id: 'active', label: 'En cours' },
  { id: 'done', label: 'Terminés' },
  { id: 'all', label: 'Tous' },
];

export default function ProjectsPage() {
  const [projects, setProjects] = useState([]);
  const [clients, setClients] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [filter, setFilter] = useState('active');
  const [query, setQuery] = useState('');
  const [busyId, setBusyId] = useState(null);
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
        name: form.name.trim(),
        client_id: form.client_id ? Number(form.client_id) : null,
        deadline: form.deadline || null,
        budget_estimated: Number(form.budget_estimated) || 0,
      }),
    });
    setShowForm(false);
    setForm({ name: '', client_id: '', deadline: '', budget_estimated: '' });
    load();
  }

  async function toggleDone(e, project) {
    e.preventDefault();
    e.stopPropagation();
    setBusyId(project.id);
    try {
      await api(`/projects/${project.id}/toggle-done`, { method: 'POST' });
      load();
    } catch (err) {
      window.alert(err.message || 'Impossible de mettre à jour le projet');
    } finally {
      setBusyId(null);
    }
  }

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return projects.filter(p => {
      if (filter === 'done' && p.status !== 'done') return false;
      if (filter === 'active' && p.status === 'done') return false;
      if (!q) return true;
      return (
        (p.name || '').toLowerCase().includes(q)
        || (p.client_name || '').toLowerCase().includes(q)
      );
    });
  }, [projects, filter, query]);

  const activeCount = projects.filter(p => p.status !== 'done').length;
  const doneCount = projects.filter(p => p.status === 'done').length;

  return (
    <AuthGuard>
      <AppShell
        title="Projets"
        subtitle={`${activeCount} actifs · ${doneCount} terminés · ${projects.length} au total`}
      >
        <div className="space-y-5">
          <div className="lg:hidden">
            <h1 className="font-display text-[26px] font-semibold text-neya-ink">Projets</h1>
            <p className="text-sm text-neya-muted">{activeCount} actifs · {doneCount} terminés</p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="relative min-w-[220px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neya-muted" aria-hidden />
              <input
                type="search"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Rechercher client ou projet"
                className="cf-page-search"
              />
            </div>
            <div className="flex items-center gap-1.5 overflow-x-auto">
              {FILTERS.map(f => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setFilter(f.id)}
                  className={`cf-chip ${filter === f.id ? 'cf-chip-active' : ''}`}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <button type="button" onClick={() => setShowForm(!showForm)} className="btn-primary gap-1.5 shrink-0">
              <Plus className="h-4 w-4" /> Nouveau projet
            </button>
          </div>

          {showForm && (
            <form onSubmit={create} className="card rounded-2xl mb-0 grid grid-cols-1 md:grid-cols-2 gap-4">
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

          {visible.length === 0 ? (
            <div className="card rounded-2xl text-center py-10 text-neya-muted text-sm">
              Aucun projet dans ce filtre.
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {visible.map(p => {
                const st = PROJECT_STATUS.find(s => s.value === p.status) || PROJECT_STATUS[0];
                const custom = isCustomProject(p);
                const isDone = p.status === 'done';
                const pct = custom && p.tasks_total > 0
                  ? Math.round((p.tasks_done / p.tasks_total) * 100)
                  : (isDone ? 100 : null);

                return (
                  <div
                    key={p.id}
                    className={`group relative grid grid-rows-[auto_1fr_auto] rounded-2xl border border-neya-border bg-white p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md ${isDone ? 'opacity-80' : ''}`}
                  >
                    <Link href={`/projects/${p.id}`} className="min-w-0 block pr-16">
                      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-[11px] font-semibold uppercase tracking-[0.14em] text-neya-muted">
                            {p.client_name || 'Sans client'}
                          </p>
                          <h3 className={`mt-1 truncate font-display text-[17px] font-semibold text-neya-ink ${isDone ? 'line-through text-neya-muted' : ''}`}>
                            {p.name}
                          </h3>
                        </div>
                        <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10.5px] font-semibold text-white ${st.color}`}>
                          {st.label}
                        </span>
                      </div>

                      <div className="mt-4 space-y-2 text-[12.5px] text-neya-ink-light">
                        <p className="flex items-center gap-2">
                          <Calendar className="h-3.5 w-3.5 text-neya-muted" /> Livraison {formatDate(p.deadline)}
                        </p>
                        {!custom && (
                          <p className="flex items-center gap-2">
                            <DollarSign className="h-3.5 w-3.5 text-neya-muted" /> {formatMoney(p.budget_estimated)}
                          </p>
                        )}
                        {custom && p.tasks_total > 0 && (
                          <p className="text-neya-orange font-medium">
                            Checklist : {p.tasks_done}/{p.tasks_total}
                          </p>
                        )}
                        {custom && !p.tasks_total && (
                          <p className="italic text-neya-muted">Checklist vide</p>
                        )}
                        {p.wp_order_id && (
                          <span className="inline-flex text-[10px] font-semibold px-2 py-0.5 rounded-full bg-blue-50 text-blue-800 border border-blue-200">
                            Web
                          </span>
                        )}
                      </div>

                      {pct != null && (
                        <div className="mt-5">
                          <div className="flex items-center justify-between text-[11px] text-neya-muted">
                            <span>Progression</span>
                            <span className="font-display font-semibold tabular-nums text-neya-ink">{pct}%</span>
                          </div>
                          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-neya-surface">
                            <div
                              className={`h-full rounded-full ${isDone ? 'bg-neya-success' : 'bg-neya-orange'}`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                      )}

                      <div className="mt-4 flex items-center justify-end text-[12px] font-medium text-neya-orange opacity-0 transition-opacity group-hover:opacity-100">
                        Ouvrir <ChevronRight className="ml-1 h-3.5 w-3.5" />
                      </div>
                    </Link>

                    <button
                      type="button"
                      onClick={(e) => toggleDone(e, p)}
                      disabled={busyId === p.id}
                      className={`absolute top-4 right-4 text-xs font-semibold px-2.5 py-1.5 rounded-lg border transition-colors disabled:opacity-50 z-10 ${
                        isDone
                          ? 'bg-white border-neya-orange text-neya-orange hover:bg-neya-orange hover:text-white'
                          : 'bg-neya-orange text-white border-neya-orange hover:bg-neya-ink'
                      }`}
                    >
                      {busyId === p.id ? '…' : isDone ? 'Rouvrir' : 'Terminer'}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </AppShell>
    </AuthGuard>
  );
}

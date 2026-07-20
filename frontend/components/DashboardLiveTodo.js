'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Circle, ListTodo, Plus } from 'lucide-react';
import { api } from '../lib/api';

const SOURCE_META = {
  admin: { label: 'Admin', className: 'bg-amber-50 text-amber-800 border-amber-200/80' },
  atelier: { label: 'Atelier', className: 'bg-orange-50 text-neya-orange border-orange-200/70' },
  rdv: { label: 'RDV', className: 'bg-sky-50 text-sky-800 border-sky-200/80' },
  todo: { label: 'Perso', className: 'bg-neya-surface text-neya-muted border-neya-border' },
};

function formatSlot(iso) {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return null;
  }
}

export default function DashboardLiveTodo({ initial }) {
  const [live, setLive] = useState(initial || { items: [], open: 0, bySource: {} });
  const [busyKey, setBusyKey] = useState('');
  const [draft, setDraft] = useState('');
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    setLive(initial || { items: [], open: 0, bySource: {} });
  }, [initial]);

  useEffect(() => {
    api('/admin-tasks/seed-priorities', { method: 'POST' }).catch(() => {});
  }, []);

  async function toggle(item) {
    if (busyKey) return;
    setBusyKey(item.key);
    try {
      const next = await api('/dashboard/live-todo', {
        method: 'PATCH',
        body: JSON.stringify({ key: item.key, done: true }),
      });
      setLive(next);
    } catch {
      /* ignore — reload parent may refresh */
    } finally {
      setBusyKey('');
    }
  }

  async function addTodo(e) {
    e.preventDefault();
    const title = draft.trim();
    if (!title || adding) return;
    setAdding(true);
    try {
      await api('/dashboard/todos', {
        method: 'POST',
        body: JSON.stringify({ title, list_key: 'main' }),
      });
      setDraft('');
      const next = await api('/dashboard/live-todo');
      setLive(next);
    } finally {
      setAdding(false);
    }
  }

  const items = live?.items || [];
  const open = live?.open ?? items.length;
  const by = live?.bySource || {};

  return (
    <section className="cf-panel mb-6">
      <div className="cf-panel-head">
        <div className="min-w-0">
          <h2 className="cf-panel-title inline-flex items-center gap-2">
            <ListTodo className="h-4 w-4 text-neya-orange" strokeWidth={2} />
            To do live
          </h2>
          <p className="cf-panel-sub">
            {open} reste{open > 1 ? 'nt' : ''} à faire
            {by.admin || by.atelier
              ? ` · ${by.admin || 0} admin · ${by.atelier || 0} atelier`
              : ''}
            {by.rdv ? ` · ${by.rdv} RDV` : ''}
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <Link href="/admin" className="dash-link">Admin</Link>
          <Link href="/production" className="dash-link">Atelier</Link>
        </div>
      </div>

      {!items.length ? (
        <p className="dash-empty px-1">Rien en attente — admin et atelier sont à jour.</p>
      ) : (
        <ul className="divide-y divide-neya-border/70">
          {items.map(item => {
            const meta = SOURCE_META[item.source] || SOURCE_META.todo;
            const slot = formatSlot(item.start_time);
            const busy = busyKey === item.key;
            return (
              <li key={item.key} className="flex items-start gap-3 py-2.5 first:pt-0 last:pb-0">
                <button
                  type="button"
                  onClick={() => toggle(item)}
                  disabled={busy}
                  className={`dash-check mt-0.5 rounded-md ${busy ? 'opacity-50' : ''}`}
                  title="Marquer fait"
                  aria-label={`Marquer « ${item.title} » comme fait`}
                >
                  <Circle className="h-3.5 w-3.5 text-neya-muted/70 m-auto" strokeWidth={2} />
                </button>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    {item.href ? (
                      <Link
                        href={item.href}
                        className="text-sm font-medium text-neya-ink hover:text-neya-orange truncate"
                      >
                        {item.title}
                      </Link>
                    ) : (
                      <p className="text-sm font-medium text-neya-ink truncate">{item.title}</p>
                    )}
                    <span className={`text-[10px] px-1.5 py-0.5 rounded border ${meta.className}`}>
                      {meta.label}
                    </span>
                    {item.priority === 'p1' ? (
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-neya-orange">
                        Prioritaire
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-0.5 text-[12px] text-neya-muted truncate">
                    {slot ? `${slot} · ` : ''}
                    {item.subtitle || meta.label}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <form onSubmit={addTodo} className="mt-3 flex gap-2 border-t border-neya-border/70 pt-3">
        <input
          type="text"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          placeholder="Ajouter une chose à faire…"
          className="flex-1 min-w-0 rounded-lg border border-neya-border bg-white px-3 py-2 text-sm text-neya-ink placeholder:text-neya-muted focus:outline-none focus:ring-2 focus:ring-neya-orange/30"
        />
        <button
          type="submit"
          disabled={adding || !draft.trim()}
          className="inline-flex items-center gap-1.5 rounded-lg bg-neya-ink px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-40"
        >
          <Plus className="h-4 w-4" strokeWidth={2} />
          Ajouter
        </button>
      </form>
    </section>
  );
}

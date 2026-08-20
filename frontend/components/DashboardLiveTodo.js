'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Circle, ListTodo, Plus } from 'lucide-react';
import { api } from '../lib/api';

const LIVE_TYPES = [
  { id: 'admin', label: 'Admin' },
  { id: 'atelier', label: 'Atelier' },
  { id: 'rdv', label: 'RDV' },
  { id: 'installation', label: 'Installation' },
];

const SOURCE_META = {
  admin: { label: 'Bureau', className: 'bg-amber-50 text-amber-800 border-amber-200/80' },
  atelier: { label: 'Atelier', className: 'bg-orange-50 text-neya-orange border-orange-200/70' },
  rdv: { label: 'RDV', className: 'bg-sky-50 text-sky-800 border-sky-200/80' },
  installation: { label: 'Installation', className: 'bg-emerald-50 text-emerald-800 border-emerald-200/80' },
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
  const [todoType, setTodoType] = useState('admin');
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    setLive(initial || { items: [], open: 0, bySource: {} });
  }, [initial]);

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
        body: JSON.stringify({ title, list_key: todoType }),
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
  const types = live?.types?.length ? live.types : LIVE_TYPES;

  const summaryBits = [
    by.admin ? `${by.admin} admin` : null,
    by.atelier ? `${by.atelier} atelier` : null,
    by.rdv ? `${by.rdv} RDV` : null,
    by.installation ? `${by.installation} installation` : null,
  ].filter(Boolean);

  return (
    <section className="cf-panel mb-6">
      <div className="cf-panel-head">
        <div className="min-w-0">
          <h2 className="cf-panel-title inline-flex items-center gap-2">
            <ListTodo className="h-4 w-4 text-neya-orange" strokeWidth={2} />
            À faire
          </h2>
          <p className="cf-panel-sub">
            {open} reste{open > 1 ? 'nt' : ''}
            {by.admin ? ` · ${by.admin} bureau` : ''}
            {by.atelier ? ` · ${by.atelier} atelier` : ''}
            {by.rdv ? ` · ${by.rdv} RDV` : ''}
            {by.installation ? ` · ${by.installation} installation` : ''}
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <Link href="/admin" className="dash-link">Bureau</Link>
          <Link href="/calendar" className="dash-link">RDV</Link>
          <Link href="/production" className="dash-link">Atelier</Link>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap gap-1.5">
        {types.map(t => {
          const meta = SOURCE_META[t.id] || SOURCE_META.todo;
          const count = by[t.id] || 0;
          return (
            <span
              key={t.id}
              className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[11px] font-medium ${meta.className}`}
            >
              {meta.label}
              <span className="tabular-nums opacity-70">{count}</span>
            </span>
          );
        })}
      </div>

      {!items.length ? (
        <p className="dash-empty px-1">Rien en attente — admin, atelier, RDV et installation sont à jour.</p>
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

      <form onSubmit={addTodo} className="mt-3 flex flex-col gap-2 border-t border-neya-border/70 pt-3 sm:flex-row sm:items-center">
        <div className="flex flex-wrap gap-1.5 shrink-0">
          {LIVE_TYPES.map(t => {
            const active = todoType === t.id;
            const meta = SOURCE_META[t.id];
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTodoType(t.id)}
                className={`rounded border px-2 py-1 text-[11px] font-medium transition-colors ${
                  active
                    ? `${meta.className} ring-1 ring-neya-ink/15`
                    : 'border-neya-border bg-white text-neya-muted hover:bg-neya-surface'
                }`}
              >
                {t.label}
              </button>
            );
          })}
        </div>
        <input
          type="text"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          placeholder={`Ajouter une tâche ${SOURCE_META[todoType]?.label?.toLowerCase() || ''}…`}
          className="flex-1 min-w-0 rounded-lg border border-neya-border bg-white px-3 py-2 text-sm text-neya-ink placeholder:text-neya-muted focus:outline-none focus:ring-2 focus:ring-neya-orange/30"
        />
        <button
          type="submit"
          disabled={adding || !draft.trim()}
          className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-neya-ink px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-40"
        >
          <Plus className="h-4 w-4" strokeWidth={2} />
          Ajouter
        </button>
      </form>
    </section>
  );
}

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  api,
  formatDate,
  adminCategoryMeta,
  ADMIN_TASK_CATEGORIES,
} from '../lib/api';

const STATUS_CYCLE = { todo: 'doing', doing: 'done', done: 'todo' };

const PRIORITY_SECTIONS = [
  { tier: 'p1', label: 'Priorité 1 — Administratif urgent', emoji: '🔴', border: 'border-red-200 bg-red-50/40' },
  { tier: 'p2', label: 'Priorité 2 — Clients / Neya Furniture', emoji: '🟠', border: 'border-amber-200 bg-amber-50/40' },
  { tier: 'p3', label: 'Priorité 3 — Communication / Site web', emoji: '🟡', border: 'border-yellow-200 bg-yellow-50/30' },
];

function TaskItem({ task, compact, onUpdate, onDelete }) {
  const cat = adminCategoryMeta(task.category);
  const overdue = task.due_date && task.status !== 'done'
    && new Date(task.due_date) < new Date(new Date().toDateString());

  async function cycleStatus() {
    const next = STATUS_CYCLE[task.status] || 'done';
    const updated = await api(`/admin-tasks/${task.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: next }),
    });
    onUpdate(updated);
  }

  async function remove() {
    if (!confirm('Supprimer cette tâche ?')) return;
    await api(`/admin-tasks/${task.id}`, { method: 'DELETE' });
    onDelete(task.id);
  }

  return (
    <li className="flex items-start gap-2 py-2.5 border-b border-neya-border/50 last:border-0">
      <button
        type="button"
        onClick={cycleStatus}
        className={`shrink-0 w-8 h-8 rounded-lg border-2 text-xs font-bold transition-colors ${
          task.status === 'done'
            ? 'bg-green-500 border-green-500 text-white'
            : task.status === 'doing'
              ? 'bg-neya-warning border-neya-warning text-white'
              : 'border-neya-border hover:border-neya-orange bg-white'
        }`}
        title="Changer statut"
      >
        {task.status === 'done' ? '✓' : task.status === 'doing' ? '…' : ''}
      </button>
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-medium ${task.status === 'done' ? 'line-through opacity-60' : ''}`}>{task.title}</p>
        <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
          <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${cat.color}`}>{cat.icon} {cat.label}</span>
          {task.due_date && (
            <span className={`text-[10px] ${overdue ? 'text-red-600 font-semibold' : 'text-neya-muted'}`}>
              {overdue ? 'En retard · ' : ''}{formatDate(task.due_date)}
            </span>
          )}
        </div>
        {!compact && task.notes && (
          <p className="text-xs text-neya-muted mt-1 line-clamp-2">{task.notes}</p>
        )}
      </div>
      {task.link_href && (
        <Link href={task.link_href} className="text-xs text-neya-orange hover:underline shrink-0">Ouvrir →</Link>
      )}
      {!compact && (
        <button type="button" onClick={remove} className="text-neya-muted hover:text-red-600 text-xs shrink-0" title="Supprimer">✕</button>
      )}
    </li>
  );
}

export function AdminTasksSummary({ tasks = [], openCount = 0, onChange }) {
  function handleUpdate() { onChange?.(); }

  return (
    <div className="card h-full">
      <div className="flex items-center justify-between gap-2 mb-3">
        <h2 className="font-heading text-base sm:text-lg">Gestion admin</h2>
        {openCount > 0 && (
          <span className="text-xs font-semibold bg-neya-orange text-white px-2.5 py-0.5 rounded-full">{openCount}</span>
        )}
      </div>
      {tasks.length === 0 ? (
        <p className="text-sm text-neya-muted py-2">Aucune tâche admin en cours</p>
      ) : (
        <ul>
          {tasks.map(t => (
            <TaskItem key={t.id} task={t} compact onUpdate={handleUpdate} onDelete={handleUpdate} />
          ))}
        </ul>
      )}
      <Link href="/admin" className="btn-secondary text-xs w-full mt-3 text-center block">
        Voir tout le suivi admin →
      </Link>
    </div>
  );
}

export default function AdminTasksPanel() {
  const [tasks, setTasks] = useState([]);
  const [summary, setSummary] = useState(null);
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [form, setForm] = useState({ title: '', category: 'gestion', due_date: '', notes: '' });
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [list, sum] = await Promise.all([
        api('/admin-tasks'),
        api('/admin-tasks/summary'),
      ]);
      setTasks(list);
      setSummary(sum);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    api('/admin-tasks/seed-priorities', { method: 'POST' }).catch(() => {}).finally(load);
  }, []);

  async function sync() {
    setSyncing(true);
    try {
      const res = await api('/admin-tasks/sync', { method: 'POST' });
      setTasks(res.tasks || []);
      await load();
    } finally {
      setSyncing(false);
    }
  }

  async function addTask(e) {
    e.preventDefault();
    if (!form.title.trim()) return;
    setSaving(true);
    try {
      await api('/admin-tasks', {
        method: 'POST',
        body: JSON.stringify({
          title: form.title.trim(),
          category: form.category,
          due_date: form.due_date || null,
          notes: form.notes.trim() || null,
        }),
      });
      setForm({ title: '', category: 'gestion', due_date: '', notes: '' });
      await load();
    } finally {
      setSaving(false);
    }
  }

  function updateTask(updated) {
    setTasks(prev => prev.map(t => (t.id === updated.id ? updated : t)));
    load();
  }

  function removeTask(id) {
    setTasks(prev => prev.filter(t => t.id !== id));
    load();
  }

  const filtered = filter === 'all' ? tasks : tasks.filter(t => t.category === filter);
  const openTasks = filtered.filter(t => t.status !== 'done');
  const doneTasks = filtered.filter(t => t.status === 'done');
  const priorityTasks = tasks
    .filter(t => t.source_key?.startsWith('prio_') && t.status !== 'done')
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));

  const columns = [
    { key: 'todo', label: 'À faire', items: openTasks.filter(t => t.status === 'todo') },
    { key: 'doing', label: 'En cours', items: openTasks.filter(t => t.status === 'doing') },
    { key: 'done', label: 'Terminé', items: doneTasks },
  ];

  if (loading && !tasks.length) {
    return <div className="text-neya-muted py-12 text-center">Chargement…</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <p className="text-sm text-neya-muted">
            Marchés, factures, site web, pub & SEO — tout le suivi administratif NEYA
          </p>
          {summary && (
            <p className="text-xs text-neya-muted mt-1">
              {summary.byStatus?.find(s => s.status === 'todo')?.count || 0} à faire ·{' '}
              {summary.byStatus?.find(s => s.status === 'doing')?.count || 0} en cours
              {summary.overdue > 0 && (
                <span className="text-red-600 font-medium"> · {summary.overdue} en retard</span>
              )}
            </p>
          )}
        </div>
        <button type="button" onClick={sync} disabled={syncing} className="btn-secondary text-sm shrink-0 disabled:opacity-50">
          {syncing ? 'Synchronisation…' : '↻ Sync factures & site'}
        </button>
      </div>

      <div className="card">
        <h3 className="font-heading text-base mb-1">Ordre conseillé — cette semaine</h3>
        <p className="text-xs text-neya-muted mb-4">Cochez au fur et à mesure · clic sur le carré pour avancer le statut</p>
        <div className="space-y-4">
          {PRIORITY_SECTIONS.map(sec => {
            const items = priorityTasks.filter(t => t.priority_tier === sec.tier);
            if (!items.length) return null;
            return (
              <div key={sec.tier} className={`rounded-xl border p-3 ${sec.border}`}>
                <p className="text-sm font-semibold mb-2">{sec.emoji} {sec.label}</p>
                <ul>
                  {items.map(t => (
                    <TaskItem key={t.id} task={t} onUpdate={updateTask} onDelete={removeTask} />
                  ))}
                </ul>
              </div>
            );
          })}
          {priorityTasks.length === 0 && (
            <p className="text-sm text-neya-muted">Toutes les priorités sont terminées ✓</p>
          )}
        </div>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
        <button
          type="button"
          onClick={() => setFilter('all')}
          className={`shrink-0 text-xs px-3 py-1.5 rounded-full border ${filter === 'all' ? 'bg-neya-orange text-white border-neya-orange' : 'border-neya-border'}`}
        >
          Tout
        </button>
        {ADMIN_TASK_CATEGORIES.map(c => (
          <button
            key={c.value}
            type="button"
            onClick={() => setFilter(c.value)}
            className={`shrink-0 text-xs px-3 py-1.5 rounded-full border ${filter === c.value ? 'bg-neya-orange text-white border-neya-orange' : 'border-neya-border'}`}
          >
            {c.icon} {c.label}
          </button>
        ))}
      </div>

      <form onSubmit={addTask} className="card grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <input
          className="input sm:col-span-2"
          placeholder="Nouvelle tâche admin…"
          value={form.title}
          onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
        />
        <select className="input" value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
          {ADMIN_TASK_CATEGORIES.map(c => (
            <option key={c.value} value={c.value}>{c.label}</option>
          ))}
        </select>
        <input type="date" className="input" value={form.due_date} onChange={e => setForm(f => ({ ...f, due_date: e.target.value }))} />
        <textarea
          className="input sm:col-span-3 min-h-[60px]"
          placeholder="Notes (optionnel)"
          value={form.notes}
          onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
        />
        <button type="submit" disabled={saving || !form.title.trim()} className="btn-primary disabled:opacity-40">
          Ajouter
        </button>
      </form>

      <div className="grid lg:grid-cols-3 gap-4">
        {columns.map(col => (
          <div key={col.key} className="card min-h-[200px]">
            <h3 className="font-heading text-sm mb-3 flex items-center justify-between">
              {col.label}
              <span className="text-xs text-neya-muted font-normal">{col.items.length}</span>
            </h3>
            {col.items.length === 0 ? (
              <p className="text-xs text-neya-muted italic">—</p>
            ) : (
              <ul>
                {col.items.map(t => (
                  <TaskItem key={t.id} task={t} onUpdate={updateTask} onDelete={removeTask} />
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

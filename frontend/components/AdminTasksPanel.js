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

function TaskItem({ task, onUpdate, onDelete }) {
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
    if (!confirm('Supprimer ?')) return;
    await api(`/admin-tasks/${task.id}`, { method: 'DELETE' });
    onDelete(task.id);
  }

  return (
    <li className="flex items-start gap-2 py-1.5 border-b border-neya-border/40 last:border-0">
      <button
        type="button"
        onClick={cycleStatus}
        className={`shrink-0 w-6 h-6 rounded border text-[10px] font-bold ${
          task.status === 'done'
            ? 'bg-green-500 border-green-500 text-white'
            : task.status === 'doing'
              ? 'bg-neya-warning border-neya-warning text-white'
              : 'border-neya-border hover:border-neya-orange bg-white'
        }`}
        title="Statut"
      >
        {task.status === 'done' ? '✓' : task.status === 'doing' ? '…' : ''}
      </button>
      <div className="flex-1 min-w-0">
        <p className={`text-xs font-medium leading-snug ${task.status === 'done' ? 'line-through opacity-50' : ''}`}>
          {task.title}
        </p>
        <div className="flex flex-wrap items-center gap-1 mt-0.5">
          <span className={`text-[9px] px-1 py-0 rounded ${cat.color}`}>{cat.label}</span>
          {task.due_date && (
            <span className={`text-[9px] ${overdue ? 'text-red-600' : 'text-neya-muted'}`}>
              {formatDate(task.due_date)}
            </span>
          )}
          {task.notes && (
            <span className="text-[9px] text-neya-muted truncate max-w-[140px]" title={task.notes}>
              · {task.notes}
            </span>
          )}
        </div>
      </div>
      {task.link_href && (
        <Link href={task.link_href} className="text-[10px] text-neya-orange shrink-0">→</Link>
      )}
      <button type="button" onClick={remove} className="text-neya-muted hover:text-red-600 text-[10px] shrink-0">✕</button>
    </li>
  );
}

/** Petit rappel dashboard : lien seulement, jamais la liste en permanence. */
export function AdminTasksSummary() {
  return (
    <div className="border border-neya-border rounded-xl bg-white px-3 py-2.5 flex items-center justify-between gap-2">
      <div className="min-w-0">
        <p className="text-xs font-medium text-neya-ink">Session admin</p>
        <p className="text-[10px] text-neya-muted truncate">Notes & suivi — code requis</p>
      </div>
      <Link href="/admin" className="text-[11px] text-neya-orange hover:underline shrink-0 whitespace-nowrap">
        Ouvrir →
      </Link>
    </div>
  );
}

export default function AdminTasksPanel() {
  const [tasks, setTasks] = useState([]);
  const [summary, setSummary] = useState(null);
  const [filter, setFilter] = useState('open');
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ title: '', category: 'gestion', notes: '' });
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
          notes: form.notes.trim() || null,
        }),
      });
      setForm({ title: '', category: 'gestion', notes: '' });
      setShowAdd(false);
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

  const openTasks = tasks.filter(t => t.status !== 'done');
  const doneTasks = tasks.filter(t => t.status === 'done');
  const shown = filter === 'done' ? doneTasks : filter === 'all' ? tasks : openTasks;

  if (loading && !tasks.length) {
    return <p className="text-xs text-neya-muted py-6 text-center">Chargement…</p>;
  }

  return (
    <div className="max-w-lg mx-auto space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-neya-ink">Notes admin</p>
          {summary && (
            <p className="text-[10px] text-neya-muted">
              {openTasks.length} ouvertes
              {summary.overdue > 0 && (
                <span className="text-red-600"> · {summary.overdue} en retard</span>
              )}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => setShowAdd(v => !v)}
          className="text-[11px] border border-neya-border rounded-lg px-2.5 py-1 hover:border-neya-orange"
        >
          {showAdd ? 'Annuler' : '+ Note'}
        </button>
      </div>

      {showAdd && (
        <form onSubmit={addTask} className="border border-neya-border rounded-xl p-2.5 space-y-2 bg-neya-cream/30">
          <input
            className="input text-sm h-9"
            placeholder="Titre…"
            value={form.title}
            autoFocus
            onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
          />
          <div className="flex gap-2">
            <select
              className="input text-xs h-8 flex-1"
              value={form.category}
              onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
            >
              {ADMIN_TASK_CATEGORIES.map(c => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
            <button type="submit" disabled={saving || !form.title.trim()} className="btn-primary text-xs h-8 px-3 disabled:opacity-40">
              Ajouter
            </button>
          </div>
          <input
            className="input text-xs h-8"
            placeholder="Notes (optionnel)"
            value={form.notes}
            onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
          />
        </form>
      )}

      <div className="flex gap-1">
        {[
          { id: 'open', label: 'À faire' },
          { id: 'done', label: 'Fait' },
          { id: 'all', label: 'Tout' },
        ].map(f => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFilter(f.id)}
            className={`text-[10px] px-2 py-1 rounded-md border ${
              filter === f.id ? 'bg-neya-orange text-white border-neya-orange' : 'border-neya-border text-neya-muted'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="border border-neya-border rounded-xl px-2.5 py-1 bg-white">
        {shown.length === 0 ? (
          <p className="text-[11px] text-neya-muted py-4 text-center">Rien ici</p>
        ) : (
          <ul>
            {shown.map(t => (
              <TaskItem key={t.id} task={t} onUpdate={updateTask} onDelete={removeTask} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

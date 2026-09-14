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

const SECTION_ORDER = [
  'a_payer',
  'a_recevoir',
  'facturation',
  'marche',
  'site_web',
  'marketing',
  'gestion',
];

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
    <li className="neya-lift flex items-start gap-2.5 rounded-xl border border-neya-border/70 bg-neya-surface/30 px-2.5 py-2 mb-1.5 last:mb-0">
      <button
        type="button"
        onClick={cycleStatus}
        className={`shrink-0 w-6 h-6 rounded-lg border text-[10px] font-bold transition-colors ${
          task.status === 'done'
            ? 'bg-emerald-500 border-emerald-500 text-white'
            : task.status === 'doing'
              ? 'bg-neya-warning border-neya-warning text-white'
              : 'border-neya-border hover:border-neya-orange bg-white'
        }`}
        title="Statut"
      >
        {task.status === 'done' ? '✓' : task.status === 'doing' ? '…' : ''}
      </button>
      <div className="flex-1 min-w-0">
        {task.link_href ? (
          <Link
            href={task.link_href}
            className={`text-[13px] font-medium leading-snug hover:text-neya-orange ${task.status === 'done' ? 'line-through opacity-50' : ''}`}
          >
            {task.title}
          </Link>
        ) : (
          <p className={`text-[13px] font-medium leading-snug ${task.status === 'done' ? 'line-through opacity-50' : ''}`}>
            {task.title}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-1.5 mt-1">
          <span className={`cf-chip !px-2 !py-0.5 !text-[10px] ${cat.color}`}>{cat.label}</span>
          {task.due_date && (
            <span className={`text-[10px] ${overdue ? 'text-red-600 font-medium' : 'text-neya-muted'}`}>
              {formatDate(task.due_date)}
            </span>
          )}
          {task.notes && (
            <span className="text-[10px] text-neya-muted truncate max-w-[160px]" title={task.notes}>
              · {task.notes.split('\n')[0]}
            </span>
          )}
        </div>
      </div>
      {task.link_href && (
        <Link href={task.link_href} className="text-[11px] text-neya-orange shrink-0 font-medium" aria-label="Ouvrir">→</Link>
      )}
      <button type="button" onClick={remove} className="btn-ghost !px-1.5 !py-0.5 text-neya-muted hover:text-red-600 text-[11px] shrink-0">✕</button>
    </li>
  );
}

function groupTasksByCategory(tasks) {
  const map = new Map();
  for (const t of tasks) {
    const key = t.category || 'gestion';
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(t);
  }
  const keys = [
    ...SECTION_ORDER.filter(k => map.has(k)),
    ...[...map.keys()].filter(k => !SECTION_ORDER.includes(k)).sort(),
  ];
  return keys.map(key => ({
    key,
    meta: adminCategoryMeta(key),
    tasks: map.get(key),
  }));
}

/** Petit rappel dashboard : lien seulement, jamais la liste en permanence. */
export function AdminTasksSummary() {
  return (
    <div className="border border-neya-border rounded-xl bg-white px-3 py-2.5 flex items-center justify-between gap-2">
      <div className="min-w-0">
        <p className="text-xs font-medium text-neya-ink">Tâches bureau</p>
        <p className="text-[10px] text-neya-muted truncate">Notes & suivi</p>
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
  const [form, setForm] = useState({ title: '', category: 'a_payer', notes: '' });
  const [saving, setSaving] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanInfo, setScanInfo] = useState('');
  const [scanErr, setScanErr] = useState('');

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
      setForm({ title: '', category: 'a_payer', notes: '' });
      setShowAdd(false);
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function scanMailInvoices() {
    setScanning(true);
    setScanErr('');
    setScanInfo('');
    try {
      const result = await api('/admin-tasks/scan-mail-invoices', {
        method: 'POST',
        body: JSON.stringify({ days: 30, max: 50 }),
      });
      const parts = [
        `${result.classified || 0} facture(s) classée(s)`,
        result.payable ? `${result.payable} à payer` : null,
        result.receivable ? `${result.receivable} à recevoir` : null,
        result.created ? `${result.created} nouvelle(s)` : null,
      ].filter(Boolean);
      setScanInfo(parts.join(' · ') || 'Scan terminé');
      await load();
    } catch (err) {
      setScanErr(err.message || 'Scan impossible');
    } finally {
      setScanning(false);
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
  let shown = openTasks;
  if (filter === 'done') shown = doneTasks;
  else if (filter === 'all') shown = tasks;
  else if (filter === 'a_payer') shown = openTasks.filter(t => t.category === 'a_payer');
  else if (filter === 'a_recevoir') shown = openTasks.filter(t => t.category === 'a_recevoir');
  const sections = groupTasksByCategory(shown);

  if (loading && !tasks.length) {
    return <p className="text-xs text-neya-muted py-6 text-center">Chargement…</p>;
  }

  return (
    <div className="max-w-lg mx-auto space-y-4">
      <div className="flex items-center justify-between gap-2 neya-enter">
        <div>
          <p className="font-display text-[15px] font-semibold text-neya-ink">Notes admin</p>
          {summary && (
            <p className="text-[11px] text-neya-muted mt-0.5">
              {openTasks.length} ouverte{openTasks.length > 1 ? 's' : ''}
              {summary.overdue > 0 && (
                <span className="text-red-600"> · {summary.overdue} en retard</span>
              )}
            </p>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={scanMailInvoices}
            disabled={scanning}
            className="btn-secondary text-[11px] !min-h-[32px] !px-2.5 !py-1 disabled:opacity-50"
            title="Scanner Gmail + factures ERP"
          >
            {scanning ? 'Scan…' : 'Scanner factures'}
          </button>
          <button
            type="button"
            onClick={() => setShowAdd(v => !v)}
            className="btn-primary text-[11px] !min-h-[32px] !px-2.5 !py-1"
          >
            {showAdd ? 'Annuler' : '+ Note'}
          </button>
        </div>
      </div>

      {(scanInfo || scanErr) && (
        <p className={`text-[11px] px-3 py-2 rounded-xl border neya-enter ${scanErr ? 'border-red-200 bg-red-50 text-red-700' : 'border-neya-border bg-neya-orange-soft/40 text-neya-ink'}`}>
          {scanErr || scanInfo}
        </p>
      )}

      {showAdd && (
        <form onSubmit={addTask} className="card rounded-2xl p-3 space-y-2 neya-enter">
          <input
            className="input text-sm h-9"
            placeholder="Titre… ex. À payer — facture Olive"
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

      <div className="flex flex-wrap gap-1.5 neya-enter" style={{ animationDelay: '45ms' }}>
        {[
          { id: 'open', label: 'À faire' },
          { id: 'done', label: 'Fait' },
          { id: 'all', label: 'Tout' },
          { id: 'a_payer', label: 'À payer' },
          { id: 'a_recevoir', label: 'À recevoir' },
        ].map(f => (
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

      <div className="space-y-3 neya-stagger">
        {sections.length === 0 ? (
          <div className="rounded-xl border border-dashed border-neya-border bg-neya-surface/40 px-4 py-8 text-center">
            <p className="text-sm font-medium text-neya-ink">Rien ici</p>
            <p className="text-[12px] text-neya-muted mt-1">Lancez « Scanner factures » ou ajoutez une note.</p>
          </div>
        ) : (
          sections.map(sec => (
              <div key={sec.key} className="card !p-0 overflow-hidden neya-lift">
                <div className="px-3 py-2 border-b border-neya-border/60 flex items-center gap-2 bg-neya-surface/50">
                  <span className={`cf-chip !px-2 !py-0.5 !text-[10px] ${sec.meta.color}`}>{sec.meta.label}</span>
                  <span className="text-[11px] text-neya-muted tabular-nums">{sec.tasks.length}</span>
                </div>
                <ul className="px-2.5 py-2">
                  {sec.tasks.map(t => (
                    <TaskItem key={t.id} task={t} onUpdate={updateTask} onDelete={removeTask} />
                  ))}
                </ul>
              </div>
            ))
        )}
      </div>
    </div>
  );
}

'use client';

import { useEffect, useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import AppShell from '../../components/AppShell';
import AuthGuard from '../../components/AuthGuard';
import { api, formatMoney, formatDate, EXPENSE_CATEGORIES, resolveUploadUrl } from '../../lib/api';
import ReceiptScanner from '../../components/ReceiptScanner';

const CATEGORY_LABELS = {
  materiaux: 'Matériaux', outils: 'Outils', transport: 'Transport', atelier: 'Atelier', admin: 'Admin',
};

const MONTH_LABELS = [
  '', 'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre',
];

function expenseMonthKey(dateStr) {
  const s = String(dateStr || '');
  const m = s.match(/^(\d{4})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}`;
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return 'sans-date';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(key) {
  if (!key || key === 'sans-date') return 'Sans date';
  const [y, mo] = key.split('-');
  return `${MONTH_LABELS[Number(mo)] || mo} ${y}`;
}

export default function ExpensesPage() {
  const [expenses, setExpenses] = useState([]);
  const [projects, setProjects] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [monthFilter, setMonthFilter] = useState('all');
  const [formErr, setFormErr] = useState('');
  const [form, setForm] = useState({
    amount: '',
    category: 'materiaux',
    description: '',
    notes: '',
    project_id: '',
    date: new Date().toISOString().slice(0, 10),
  });

  const load = () => {
    api('/expenses')
      .then(setExpenses)
      .catch(err => {
        console.warn('expenses load:', err.message);
        setExpenses([]);
      });
    api('/projects')
      .then(p => setProjects(Array.isArray(p) ? p.filter(x => x.status !== 'cancelled') : []))
      .catch(() => setProjects([]));
  };

  useEffect(() => {
    load();
    window.addEventListener('neya:assistant-action', load);
    return () => window.removeEventListener('neya:assistant-action', load);
  }, []);

  async function create(e) {
    e.preventDefault();
    setFormErr('');
    const parts = [form.description.trim(), form.notes.trim()].filter(Boolean);
    try {
      await api('/expenses', {
        method: 'POST',
        body: JSON.stringify({
          amount: Number(form.amount),
          category: form.category,
          description: parts.join(' — ') || null,
          project_id: form.project_id || null,
          date: form.date || null,
        }),
      });
      setShowForm(false);
      setForm({
        amount: '',
        category: 'materiaux',
        description: '',
        notes: '',
        project_id: '',
        date: new Date().toISOString().slice(0, 10),
      });
      load();
    } catch (err) {
      setFormErr(err.message || 'Enregistrement impossible');
    }
  }

  const monthOptions = useMemo(() => {
    const keys = [...new Set(expenses.map(e => expenseMonthKey(e.date)))].sort().reverse();
    return keys;
  }, [expenses]);

  const filtered = useMemo(() => {
    if (monthFilter === 'all') return expenses;
    return expenses.filter(e => expenseMonthKey(e.date) === monthFilter);
  }, [expenses, monthFilter]);

  const total = filtered.reduce((s, e) => s + Number(e.amount), 0);

  const grouped = useMemo(() => {
    const map = new Map();
    for (const e of filtered) {
      const key = expenseMonthKey(e.date);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(e);
    }
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [filtered]);

  return (
    <AuthGuard>
      <AppShell title="Dépenses" subtitle={`${filtered.length} entrée${filtered.length > 1 ? 's' : ''} · total ${formatMoney(total)}`}>
        <ReceiptScanner onChange={load} />

        <div className="flex flex-wrap justify-between items-center gap-3 mb-4">
          <p className="text-neya-muted text-sm">
            Total : <span className="font-display text-xl font-semibold text-neya-ink tabular-nums">{formatMoney(total)}</span>
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <select
              className="input text-xs h-9 w-auto min-w-[9rem]"
              value={monthFilter}
              onChange={e => setMonthFilter(e.target.value)}
              aria-label="Filtrer par mois"
            >
              <option value="all">Tous les mois</option>
              {monthOptions.map(k => (
                <option key={k} value={k}>{monthLabel(k)}</option>
              ))}
            </select>
            <button type="button" onClick={() => setShowForm(!showForm)} className="btn-primary gap-1.5">
              <Plus className="h-4 w-4" /> Dépense
            </button>
          </div>
        </div>

        {showForm && (
          <form onSubmit={create} className="card rounded-2xl mb-6 space-y-4">
            <p className="text-sm font-medium text-neya-ink">Dépense manuelle</p>
            {formErr && <p className="text-xs text-red-700 bg-red-50 px-2 py-1.5 rounded">{formErr}</p>}

            <div>
              <label className="label">Projet</label>
              <select
                className="input"
                value={form.project_id}
                onChange={e => setForm({ ...form, project_id: e.target.value })}
              >
                <option value="">— Général atelier —</option>
                {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="label">Montant ($)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  className="input"
                  value={form.amount}
                  onChange={e => setForm({ ...form, amount: e.target.value })}
                  required
                />
              </div>
              <div>
                <label className="label">Date</label>
                <input
                  type="date"
                  className="input"
                  value={form.date}
                  onChange={e => setForm({ ...form, date: e.target.value })}
                />
              </div>
            </div>

            <div>
              <label className="label">Catégorie</label>
              <select className="input" value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>
                {EXPENSE_CATEGORIES.map(c => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
              </select>
            </div>

            <div>
              <label className="label">Description</label>
              <input
                className="input"
                value={form.description}
                onChange={e => setForm({ ...form, description: e.target.value })}
                placeholder="Ex. Vis, colle, panneau…"
              />
            </div>

            <div>
              <label className="label">Détails / notes</label>
              <textarea
                className="input min-h-[88px] resize-y"
                value={form.notes}
                onChange={e => setForm({ ...form, notes: e.target.value })}
                placeholder="Contexte, magasin, n° facture…"
              />
            </div>

            <div className="flex gap-2">
              <button type="submit" className="btn-primary">Enregistrer</button>
              <button type="button" className="btn-secondary" onClick={() => setShowForm(false)}>Annuler</button>
            </div>
          </form>
        )}

        <div className="space-y-5">
          {grouped.length === 0 && (
            <div className="cf-table-wrap overflow-x-auto">
              <p className="px-4 py-10 text-center text-neya-muted text-sm">Aucune dépense</p>
            </div>
          )}
          {grouped.map(([key, rows]) => {
            const sub = rows.reduce((s, e) => s + Number(e.amount), 0);
            return (
              <div key={key} className="cf-table-wrap overflow-x-auto">
                <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-neya-border bg-neya-cream/30">
                  <p className="text-sm font-medium text-neya-ink">{monthLabel(key)}</p>
                  <p className="text-xs text-neya-muted tabular-nums">
                    {rows.length} · {formatMoney(sub)}
                  </p>
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr>
                      <th className="px-4 py-3">Date</th>
                      <th className="px-4 py-3">Description</th>
                      <th className="px-4 py-3">Catégorie</th>
                      <th className="px-4 py-3">Projet</th>
                      <th className="px-4 py-3">Reçu</th>
                      <th className="px-4 py-3 text-right">Montant</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(e => (
                      <tr key={e.id}>
                        <td className="px-4 py-3 tabular-nums">{formatDate(e.date)}</td>
                        <td className="px-4 py-3">{e.description || '—'}</td>
                        <td className="px-4 py-3">
                          <span className="rounded-full bg-neya-surface px-2.5 py-0.5 text-[11px] font-medium text-neya-ink-light">
                            {CATEGORY_LABELS[e.category] || e.category}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-neya-muted">{e.project_name || '—'}</td>
                        <td className="px-4 py-3">
                          {e.receipt_url ? (
                            <a href={resolveUploadUrl(e.receipt_url)} target="_blank" rel="noopener noreferrer" className="text-neya-orange text-xs hover:underline">Voir</a>
                          ) : '—'}
                        </td>
                        <td className="px-4 py-3 text-right font-display font-semibold tabular-nums">{formatMoney(e.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>
      </AppShell>
    </AuthGuard>
  );
}

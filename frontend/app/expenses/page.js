'use client';

import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import AppShell from '../../components/AppShell';
import AuthGuard from '../../components/AuthGuard';
import { api, formatMoney, formatDate, EXPENSE_CATEGORIES, resolveUploadUrl } from '../../lib/api';
import ReceiptScanner from '../../components/ReceiptScanner';
import FinanceSyncPanel from '../../components/FinanceSyncPanel';

const CATEGORY_LABELS = {
  materiaux: 'Matériaux', outils: 'Outils', transport: 'Transport', atelier: 'Atelier', admin: 'Admin',
};

export default function ExpensesPage() {
  const [expenses, setExpenses] = useState([]);
  const [projects, setProjects] = useState([]);
  const [showForm, setShowForm] = useState(false);
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
    const parts = [form.description.trim(), form.notes.trim()].filter(Boolean);
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
  }

  const total = expenses.reduce((s, e) => s + Number(e.amount), 0);

  return (
    <AuthGuard>
      <AppShell title="Dépenses" subtitle={`${expenses.length} entrée${expenses.length > 1 ? 's' : ''} · total ${formatMoney(total)}`}>
        <FinanceSyncPanel year={new Date().getFullYear()} onDone={load} />
        <ReceiptScanner onChange={load} />

        <div className="flex flex-wrap justify-between items-center gap-3 mb-6">
          <p className="text-neya-muted text-sm">
            Total : <span className="font-display text-xl font-semibold text-neya-ink tabular-nums">{formatMoney(total)}</span>
          </p>
          <button type="button" onClick={() => setShowForm(!showForm)} className="btn-primary gap-1.5">
            <Plus className="h-4 w-4" /> Dépense
          </button>
        </div>

        {showForm && (
          <form onSubmit={create} className="card rounded-2xl mb-6 space-y-4">
            <p className="text-sm font-medium text-neya-ink">Dépense manuelle</p>

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

        <div className="cf-table-wrap overflow-x-auto">
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
              {expenses.map(e => (
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
              {expenses.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-neya-muted">Aucune dépense</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </AppShell>
    </AuthGuard>
  );
}

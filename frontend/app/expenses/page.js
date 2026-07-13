'use client';

import { useEffect, useState } from 'react';
import AppShell from '../../components/AppShell';
import AuthGuard from '../../components/AuthGuard';
import { api, formatMoney, formatDate, EXPENSE_CATEGORIES, resolveUploadUrl } from '../../lib/api';
import ReceiptScanner from '../../components/ReceiptScanner';

const CATEGORY_LABELS = {
  materiaux: 'Matériaux', outils: 'Outils', transport: 'Transport', atelier: 'Atelier', admin: 'Admin',
};

export default function ExpensesPage() {
  const [expenses, setExpenses] = useState([]);
  const [projects, setProjects] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ amount: '', category: 'materiaux', description: '', project_id: '' });

  const load = () => {
    api('/expenses').then(setExpenses);
    api('/projects').then(setProjects);
  };

  useEffect(() => {
    load();
    window.addEventListener('neya:assistant-action', load);
    return () => window.removeEventListener('neya:assistant-action', load);
  }, []);

  async function create(e) {
    e.preventDefault();
    await api('/expenses', {
      method: 'POST',
      body: JSON.stringify({ ...form, amount: Number(form.amount), project_id: form.project_id || null }),
    });
    setShowForm(false);
    setForm({ amount: '', category: 'materiaux', description: '', project_id: '' });
    load();
  }

  const total = expenses.reduce((s, e) => s + Number(e.amount), 0);

  return (
    <AuthGuard>
      <AppShell title="Dépenses">
        <ReceiptScanner onChange={load} />

        <div className="flex justify-between items-center mb-6">
          <p className="text-neya-muted">Total : <span className="font-heading text-xl text-neya-ink">{formatMoney(total)}</span></p>
          <button onClick={() => setShowForm(!showForm)} className="btn-primary">+ Dépense</button>
        </div>

        {showForm && (
          <form onSubmit={create} className="card mb-6 grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="label">Montant ($)</label>
              <input type="number" className="input" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} required />
            </div>
            <div>
              <label className="label">Catégorie</label>
              <select className="input" value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>
                {EXPENSE_CATEGORIES.map(c => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Description</label>
              <input className="input" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
            </div>
            <div>
              <label className="label">Projet (optionnel)</label>
              <select className="input" value={form.project_id} onChange={e => setForm({ ...form, project_id: e.target.value })}>
                <option value="">— Aucun —</option>
                {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div className="md:col-span-2">
              <button type="submit" className="btn-primary">Enregistrer</button>
            </div>
          </form>
        )}

        <div className="card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neya-border text-left text-neya-muted">
                <th className="pb-3">Date</th>
                <th className="pb-3">Description</th>
                <th className="pb-3">Catégorie</th>
                <th className="pb-3">Projet</th>
                <th className="pb-3">Reçu</th>
                <th className="pb-3 text-right">Montant</th>
              </tr>
            </thead>
            <tbody>
              {expenses.map(e => (
                <tr key={e.id} className="border-b border-neya-border">
                  <td className="py-3">{formatDate(e.date)}</td>
                  <td className="py-3">{e.description || '—'}</td>
                  <td className="py-3">{CATEGORY_LABELS[e.category] || e.category}</td>
                  <td className="py-3">{e.project_name || '—'}</td>
                  <td className="py-3">
                    {e.receipt_url ? (
                      <a href={resolveUploadUrl(e.receipt_url)} target="_blank" rel="noopener noreferrer" className="text-neya-orange text-xs hover:underline">Voir</a>
                    ) : '—'}
                  </td>
                  <td className="py-3 text-right font-medium">{formatMoney(e.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </AppShell>
    </AuthGuard>
  );
}

'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Search, Pencil, Trash2 } from 'lucide-react';
import AppShell from '../../components/AppShell';
import AuthGuard from '../../components/AuthGuard';
import { api, formatMoney } from '../../lib/api';

const CATEGORIES = [
  { id: 'materiaux', label: 'Matières premières' },
  { id: 'quincaillerie', label: 'Quincaillerie' },
  { id: 'finition', label: 'Finitions' },
  { id: 'emballage', label: 'Emballages' },
  { id: 'outil', label: 'Outils' },
  { id: 'machine', label: 'Machines' },
  { id: 'consommable', label: 'Consommables' },
];

const CATEGORY_LABEL = Object.fromEntries(CATEGORIES.map(c => [c.id, c.label]));

const emptyForm = () => ({
  name: '',
  sku: '',
  category: 'materiaux',
  quantity: '0',
  unit: 'unité',
  unit_cost: '',
  location: '',
  min_level: '0',
  notes: '',
});

export default function InventoryPage() {
  const [items, setItems] = useState([]);
  const [cat, setCat] = useState('');
  const [query, setQuery] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    setErr('');
    try {
      const list = await api(`/inventory${cat ? `?category=${cat}` : ''}`);
      setItems(Array.isArray(list) ? list : []);
    } catch (e) {
      setErr(e.message || 'Impossible de charger le stock');
      setItems([]);
    }
  }, [cat]);

  useEffect(() => {
    load();
    window.addEventListener('neya:assistant-action', load);
    return () => window.removeEventListener('neya:assistant-action', load);
  }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(i =>
      [i.name, i.sku, i.category, i.location]
        .filter(Boolean)
        .some(v => String(v).toLowerCase().includes(q))
    );
  }, [items, query]);

  function openCreate() {
    setEditingId(null);
    setForm(emptyForm());
    setShowForm(true);
    setErr('');
  }

  function openEdit(item) {
    setEditingId(item.id);
    setForm({
      name: item.name || '',
      sku: item.sku || '',
      category: item.category || 'materiaux',
      quantity: String(item.quantity ?? 0),
      unit: item.unit || 'unité',
      unit_cost: item.unit_cost != null ? String(item.unit_cost) : '',
      location: item.location || '',
      min_level: String(item.min_level ?? 0),
      notes: item.notes || '',
    });
    setShowForm(true);
    setErr('');
  }

  async function save(e) {
    e.preventDefault();
    if (!form.name.trim()) {
      setErr('Nom requis');
      return;
    }
    setSaving(true);
    setErr('');
    const payload = {
      name: form.name.trim(),
      sku: form.sku.trim() || null,
      category: form.category,
      quantity: Number(form.quantity) || 0,
      unit: form.unit.trim() || 'unité',
      unit_cost: Number(form.unit_cost) || 0,
      location: form.location.trim() || null,
      min_level: Number(form.min_level) || 0,
      notes: form.notes.trim() || null,
    };
    try {
      if (editingId) {
        await api(`/inventory/${editingId}`, { method: 'PUT', body: JSON.stringify(payload) });
      } else {
        await api('/inventory', { method: 'POST', body: JSON.stringify(payload) });
      }
      setShowForm(false);
      setEditingId(null);
      setForm(emptyForm());
      await load();
    } catch (e2) {
      setErr(e2.message || 'Enregistrement impossible');
    } finally {
      setSaving(false);
    }
  }

  async function remove(id) {
    if (!confirm('Supprimer cet article du stock ?')) return;
    try {
      await api(`/inventory/${id}`, { method: 'DELETE' });
      if (editingId === id) {
        setShowForm(false);
        setEditingId(null);
      }
      await load();
    } catch (e) {
      setErr(e.message);
    }
  }

  return (
    <AuthGuard>
      <AppShell title="Stock" subtitle={`${items.length} article${items.length > 1 ? 's' : ''} en inventaire`}>
        <div className="space-y-5">
          {err && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{err}</div>
          )}

          <div className="flex flex-wrap items-center gap-3 justify-between">
            <div className="relative max-w-md flex-1 min-w-[200px]">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neya-muted" aria-hidden />
              <input
                type="search"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Rechercher un article, SKU…"
                className="cf-page-search"
              />
            </div>
            <button type="button" onClick={openCreate} className="btn-primary gap-1.5 shrink-0">
              <Plus className="h-4 w-4" /> Ajouter un article
            </button>
          </div>

          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => setCat('')}
              className={`cf-chip ${!cat ? 'cf-chip-active' : ''}`}
            >
              Tout
            </button>
            {CATEGORIES.map(c => (
              <button
                key={c.id}
                type="button"
                onClick={() => setCat(c.id)}
                className={`cf-chip ${cat === c.id ? 'cf-chip-active' : ''}`}
              >
                {c.label}
              </button>
            ))}
          </div>

          {showForm && (
            <form onSubmit={save} className="card rounded-2xl grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="md:col-span-2 flex items-center justify-between gap-2">
                <h3 className="font-display text-[15px] font-semibold text-neya-ink">
                  {editingId ? 'Modifier l’article' : 'Nouvel article'}
                </h3>
                <button
                  type="button"
                  className="btn-secondary text-xs"
                  onClick={() => { setShowForm(false); setEditingId(null); }}
                >
                  Fermer
                </button>
              </div>
              <div className="md:col-span-2">
                <label className="label">Nom *</label>
                <input
                  className="input"
                  value={form.name}
                  onChange={e => setForm({ ...form, name: e.target.value })}
                  placeholder="Ex. Contreplaqué chêne ¾″"
                  required
                  autoFocus
                />
              </div>
              <div>
                <label className="label">SKU / code</label>
                <input
                  className="input"
                  value={form.sku}
                  onChange={e => setForm({ ...form, sku: e.target.value })}
                  placeholder="Optionnel"
                />
              </div>
              <div>
                <label className="label">Catégorie</label>
                <select
                  className="input"
                  value={form.category}
                  onChange={e => setForm({ ...form, category: e.target.value })}
                >
                  {CATEGORIES.map(c => (
                    <option key={c.id} value={c.id}>{c.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Quantité</label>
                <input
                  type="number"
                  step="0.001"
                  min="0"
                  className="input"
                  value={form.quantity}
                  onChange={e => setForm({ ...form, quantity: e.target.value })}
                />
              </div>
              <div>
                <label className="label">Unité</label>
                <input
                  className="input"
                  value={form.unit}
                  onChange={e => setForm({ ...form, unit: e.target.value })}
                  placeholder="unité, pi², feuille…"
                />
              </div>
              <div>
                <label className="label">Coût unitaire ($)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  className="input"
                  value={form.unit_cost}
                  onChange={e => setForm({ ...form, unit_cost: e.target.value })}
                />
              </div>
              <div>
                <label className="label">Seuil bas (alerte)</label>
                <input
                  type="number"
                  step="0.001"
                  min="0"
                  className="input"
                  value={form.min_level}
                  onChange={e => setForm({ ...form, min_level: e.target.value })}
                />
              </div>
              <div>
                <label className="label">Emplacement</label>
                <input
                  className="input"
                  value={form.location}
                  onChange={e => setForm({ ...form, location: e.target.value })}
                  placeholder="Ex. Étagère B2"
                />
              </div>
              <div>
                <label className="label">Notes</label>
                <input
                  className="input"
                  value={form.notes}
                  onChange={e => setForm({ ...form, notes: e.target.value })}
                />
              </div>
              <div className="md:col-span-2 flex flex-wrap gap-2">
                <button type="submit" disabled={saving} className="btn-primary">
                  {saving ? 'Enregistrement…' : (editingId ? 'Enregistrer' : 'Ajouter au stock')}
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => { setShowForm(false); setEditingId(null); }}
                >
                  Annuler
                </button>
              </div>
            </form>
          )}

          <div className="cf-table-wrap overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="px-4 py-3">Article</th>
                  <th className="px-4 py-3">Qté</th>
                  <th className="px-4 py-3 hidden sm:table-cell">Emplacement</th>
                  <th className="px-4 py-3 text-right">Valeur</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(i => {
                  const low = Number(i.quantity) <= Number(i.min_level) && Number(i.min_level) > 0;
                  return (
                    <tr key={i.id} className={low ? 'bg-red-50/50' : ''}>
                      <td className="px-4 py-3">
                        <p className="font-semibold text-neya-ink">{i.name}</p>
                        <p className="text-xs text-neya-muted">
                          {i.sku ? `${i.sku} · ` : ''}{CATEGORY_LABEL[i.category] || i.category}
                        </p>
                      </td>
                      <td className="px-4 py-3 tabular-nums">
                        {i.quantity} {i.unit}
                        {low && <span className="ml-2 text-[10px] font-semibold text-neya-error">Bas</span>}
                      </td>
                      <td className="px-4 py-3 hidden sm:table-cell text-neya-muted">{i.location || '—'}</td>
                      <td className="px-4 py-3 text-right font-display font-semibold tabular-nums">
                        {formatMoney(Number(i.quantity) * Number(i.unit_cost || 0))}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-neya-muted hover:bg-neya-surface hover:text-neya-ink"
                            title="Modifier"
                            onClick={() => openEdit(i)}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-neya-muted hover:bg-red-50 hover:text-red-600"
                            title="Supprimer"
                            onClick={() => remove(i.id)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {filtered.length === 0 && !showForm && (
              <div className="p-8 text-center">
                <p className="text-sm text-neya-muted mb-3">
                  {items.length === 0 ? 'Inventaire vide — ajoutez votre premier article.' : 'Aucun résultat pour cette recherche.'}
                </p>
                {items.length === 0 && (
                  <button type="button" onClick={openCreate} className="btn-primary gap-1.5 inline-flex">
                    <Plus className="h-4 w-4" /> Ajouter un article
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </AppShell>
    </AuthGuard>
  );
}

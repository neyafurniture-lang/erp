'use client';

import { useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
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

export default function InventoryPage() {
  const [items, setItems] = useState([]);
  const [cat, setCat] = useState('');
  const [query, setQuery] = useState('');

  useEffect(() => {
    api(`/inventory${cat ? `?category=${cat}` : ''}`).then(setItems);
  }, [cat]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(i =>
      [i.name, i.sku, i.category, i.location]
        .filter(Boolean)
        .some(v => String(v).toLowerCase().includes(q))
    );
  }, [items, query]);

  return (
    <AuthGuard>
      <AppShell title="Stock" subtitle={`${items.length} article${items.length > 1 ? 's' : ''} en inventaire`}>
        <div className="space-y-5">
          <div className="relative max-w-md">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neya-muted" aria-hidden />
            <input
              type="search"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Rechercher un article, SKU…"
              className="cf-page-search"
            />
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

          <div className="cf-table-wrap overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="px-4 py-3">Article</th>
                  <th className="px-4 py-3">Qté</th>
                  <th className="px-4 py-3 hidden sm:table-cell">Emplacement</th>
                  <th className="px-4 py-3 text-right">Valeur</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(i => {
                  const low = i.quantity <= i.min_level && i.min_level > 0;
                  return (
                    <tr key={i.id} className={low ? 'bg-red-50/50' : ''}>
                      <td className="px-4 py-3">
                        <p className="font-semibold text-neya-ink">{i.name}</p>
                        <p className="text-xs text-neya-muted">{i.sku || i.category}</p>
                      </td>
                      <td className="px-4 py-3 tabular-nums">
                        {i.quantity} {i.unit}
                        {low && <span className="ml-2 text-[10px] font-semibold text-neya-error">Bas</span>}
                      </td>
                      <td className="px-4 py-3 hidden sm:table-cell text-neya-muted">{i.location || '—'}</td>
                      <td className="px-4 py-3 text-right font-display font-semibold tabular-nums">
                        {formatMoney(i.quantity * i.unit_cost)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {filtered.length === 0 && (
              <p className="p-8 text-center text-neya-muted text-sm">Inventaire vide</p>
            )}
          </div>
        </div>
      </AppShell>
    </AuthGuard>
  );
}

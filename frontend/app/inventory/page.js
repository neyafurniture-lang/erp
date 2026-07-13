'use client';

import { useEffect, useState } from 'react';
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

  useEffect(() => {
    api(`/inventory${cat ? `?category=${cat}` : ''}`).then(setItems);
  }, [cat]);

  return (
    <AuthGuard>
      <AppShell title="Stock">
        <div className="flex flex-wrap gap-2 mb-6">
          <button type="button" onClick={() => setCat('')} className={`px-3 py-1.5 text-sm rounded border ${!cat ? 'border-neya-ink' : 'border-neya-border text-neya-muted'}`}>Tout</button>
          {CATEGORIES.map(c => (
            <button key={c.id} type="button" onClick={() => setCat(c.id)} className={`px-3 py-1.5 text-sm rounded border ${cat === c.id ? 'border-neya-ink' : 'border-neya-border text-neya-muted'}`}>{c.label}</button>
          ))}
        </div>

        <div className="border border-neya-border rounded overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-neya-surface border-b border-neya-border">
              <tr className="text-left text-xs uppercase tracking-wide text-neya-muted">
                <th className="p-3 font-medium">Article</th>
                <th className="p-3 font-medium">Qté</th>
                <th className="p-3 font-medium hidden sm:table-cell">Emplacement</th>
                <th className="p-3 font-medium text-right">Valeur</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neya-border">
              {items.map(i => {
                const low = i.quantity <= i.min_level && i.min_level > 0;
                return (
                  <tr key={i.id} className={low ? 'bg-red-50/50' : ''}>
                    <td className="p-3">
                      <p className="font-medium">{i.name}</p>
                      <p className="text-xs text-neya-muted">{i.sku || i.category}</p>
                    </td>
                    <td className="p-3">{i.quantity} {i.unit}</td>
                    <td className="p-3 hidden sm:table-cell text-neya-muted">{i.location || '—'}</td>
                    <td className="p-3 text-right">{formatMoney(i.quantity * i.unit_cost)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {items.length === 0 && <p className="p-8 text-center text-neya-muted text-sm">Inventaire vide</p>}
        </div>
      </AppShell>
    </AuthGuard>
  );
}

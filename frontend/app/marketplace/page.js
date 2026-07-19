'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Store, Trash2 } from 'lucide-react';
import AppShell from '../../components/AppShell';
import AuthGuard from '../../components/AuthGuard';
import { api, formatMoney, formatDate } from '../../lib/api';

const CHANNELS = [
  { value: 'etsy', label: 'Etsy' },
  { value: 'amazon', label: 'Amazon' },
  { value: 'facebook', label: 'Facebook Marketplace' },
  { value: 'kijiji', label: 'Kijiji' },
  { value: 'lespac', label: 'LesPAC' },
  { value: 'site', label: 'Site neyafurniture.ca' },
  { value: 'showroom', label: 'Showroom / atelier' },
  { value: 'autre', label: 'Autre' },
];

const CHANNEL_LABEL = Object.fromEntries(CHANNELS.map(c => [c.value, c.label]));

const emptyForm = () => ({
  sold_at: new Date().toISOString().slice(0, 10),
  channel: 'facebook',
  product_name: '',
  buyer_name: '',
  amount: '',
  fees: '',
  order_ref: '',
  notes: '',
});

export default function MarketplacePage() {
  const [sales, setSales] = useState([]);
  const [summary, setSummary] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [filter, setFilter] = useState('all');
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setErr('');
    try {
      const [list, sum] = await Promise.all([
        api('/marketplace'),
        api('/marketplace/summary'),
      ]);
      setSales(Array.isArray(list) ? list : []);
      setSummary(sum);
    } catch (e) {
      setErr(e.message || 'Impossible de charger les ventes');
      setSales([]);
    }
  }, []);

  useEffect(() => {
    load();
    window.addEventListener('neya:assistant-action', load);
    return () => window.removeEventListener('neya:assistant-action', load);
  }, [load]);

  const filtered = useMemo(
    () => (filter === 'all' ? sales : sales.filter(s => s.channel === filter)),
    [sales, filter]
  );

  async function create(e) {
    e.preventDefault();
    setSaving(true);
    setErr('');
    try {
      await api('/marketplace', {
        method: 'POST',
        body: JSON.stringify({
          ...form,
          amount: Number(form.amount) || 0,
          fees: Number(form.fees) || 0,
        }),
      });
      setShowForm(false);
      setForm(emptyForm());
      await load();
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setSaving(false);
    }
  }

  async function remove(id) {
    if (!confirm('Supprimer cette vente ?')) return;
    await api(`/marketplace/${id}`, { method: 'DELETE' });
    load();
  }

  const totals = summary?.totals || { count: 0, gross: 0, fees: 0, net: 0 };

  return (
    <AuthGuard>
      <AppShell
        title="Marketplace"
        subtitle="Ventes Etsy, Facebook, Kijiji, site… notées et suivies"
        wide
      >
        {err && (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{err}</div>
        )}

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
          {[
            { label: 'Ventes', value: String(totals.count || 0) },
            { label: 'Brut', value: formatMoney(totals.gross || 0) },
            { label: 'Frais', value: formatMoney(totals.fees || 0) },
            { label: 'Net', value: formatMoney(totals.net || 0) },
          ].map(card => (
            <div key={card.label} className="rounded-2xl border border-neya-border bg-white px-4 py-3 shadow-sm">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-neya-muted">{card.label}</p>
              <p className="mt-1 font-display text-xl font-semibold tabular-nums text-neya-ink">{card.value}</p>
            </div>
          ))}
        </div>

        {(summary?.by_channel || []).length > 0 && (
          <div className="flex flex-wrap gap-2 mb-5">
            <button
              type="button"
              onClick={() => setFilter('all')}
              className={`cf-chip ${filter === 'all' ? 'bg-neya-ink text-white border-neya-ink' : ''}`}
            >
              Tous
            </button>
            {(summary.by_channel || []).map(c => (
              <button
                key={c.channel}
                type="button"
                onClick={() => setFilter(c.channel)}
                className={`cf-chip ${filter === c.channel ? 'bg-neya-ink text-white border-neya-ink' : ''}`}
              >
                {CHANNEL_LABEL[c.channel] || c.channel}
                <span className="ml-1 opacity-70 tabular-nums">{c.count}</span>
              </button>
            ))}
          </div>
        )}

        <div className="flex flex-wrap justify-between items-center gap-3 mb-4">
          <p className="text-sm text-neya-muted inline-flex items-center gap-1.5">
            <Store className="h-4 w-4 text-neya-orange" />
            Notez chaque vente marketplace réalisée pour suivre le réel.
          </p>
          <button type="button" onClick={() => setShowForm(v => !v)} className="btn-primary gap-1.5">
            <Plus className="h-4 w-4" /> Noter une vente
          </button>
        </div>

        {showForm && (
          <form onSubmit={create} className="card rounded-2xl mb-6 grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="label">Date</label>
              <input
                type="date"
                className="input"
                value={form.sold_at}
                onChange={e => setForm({ ...form, sold_at: e.target.value })}
                required
              />
            </div>
            <div>
              <label className="label">Canal</label>
              <select
                className="input"
                value={form.channel}
                onChange={e => setForm({ ...form, channel: e.target.value })}
              >
                {CHANNELS.map(c => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </div>
            <div className="md:col-span-2">
              <label className="label">Produit / pièce</label>
              <input
                className="input"
                value={form.product_name}
                onChange={e => setForm({ ...form, product_name: e.target.value })}
                placeholder="Ex. Table chêne 6 places"
                required
              />
            </div>
            <div>
              <label className="label">Acheteur (optionnel)</label>
              <input
                className="input"
                value={form.buyer_name}
                onChange={e => setForm({ ...form, buyer_name: e.target.value })}
              />
            </div>
            <div>
              <label className="label">Réf. commande</label>
              <input
                className="input"
                value={form.order_ref}
                onChange={e => setForm({ ...form, order_ref: e.target.value })}
                placeholder="Ex. #FB-204"
              />
            </div>
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
              <label className="label">Frais plateforme ($)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                className="input"
                value={form.fees}
                onChange={e => setForm({ ...form, fees: e.target.value })}
              />
            </div>
            <div className="md:col-span-2">
              <label className="label">Notes</label>
              <textarea
                className="input min-h-[72px]"
                value={form.notes}
                onChange={e => setForm({ ...form, notes: e.target.value })}
                placeholder="Livraison, variantes, etc."
              />
            </div>
            <div className="md:col-span-2 flex gap-2">
              <button type="submit" disabled={saving} className="btn-primary">
                {saving ? 'Enregistrement…' : 'Enregistrer la vente'}
              </button>
              <button type="button" className="btn-secondary" onClick={() => setShowForm(false)}>Annuler</button>
            </div>
          </form>
        )}

        <div className="cf-table-wrap overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Canal</th>
                <th className="px-4 py-3">Produit</th>
                <th className="px-4 py-3">Acheteur</th>
                <th className="px-4 py-3 text-right">Brut</th>
                <th className="px-4 py-3 text-right">Frais</th>
                <th className="px-4 py-3 text-right">Net</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {filtered.map(s => {
                const net = Number(s.amount) - Number(s.fees || 0);
                return (
                  <tr key={s.id}>
                    <td className="px-4 py-3 tabular-nums whitespace-nowrap">{formatDate(s.sold_at)}</td>
                    <td className="px-4 py-3">
                      <span className="rounded-full bg-neya-surface px-2.5 py-0.5 text-[11px] font-medium">
                        {CHANNEL_LABEL[s.channel] || s.channel}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-neya-ink">{s.product_name}</p>
                      {s.order_ref && <p className="text-[11px] text-neya-muted">{s.order_ref}</p>}
                    </td>
                    <td className="px-4 py-3 text-neya-muted">{s.buyer_name || '—'}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{formatMoney(s.amount)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-neya-muted">{formatMoney(s.fees || 0)}</td>
                    <td className="px-4 py-3 text-right font-display font-semibold tabular-nums">{formatMoney(net)}</td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => remove(s.id)}
                        className="text-neya-muted hover:text-red-600 p-1"
                        aria-label="Supprimer"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-neya-muted">
                    Aucune vente notée — cliquez « Noter une vente ».
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </AppShell>
    </AuthGuard>
  );
}

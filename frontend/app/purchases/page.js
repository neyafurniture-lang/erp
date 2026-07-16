'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import AppShell from '../../components/AppShell';
import AuthGuard from '../../components/AuthGuard';
import PriceCompareLinks from '../../components/PriceCompareLinks';
import { api, formatMoney, PURCHASE_NEED_CATEGORIES, PURCHASE_NEED_STATUS } from '../../lib/api';
import { getPriceCompareLinks } from '../../lib/price-compare';

const ORDER_STATUS = {
  planned: 'À prévoir',
  urgent: 'Urgent',
  pending: 'En attente',
  ordered: 'Commandé',
  received: 'Reçu',
};

function formFromItem(it) {
  return {
    title: it.title || '',
    category: it.category || 'consommable',
    quantity: it.quantity ?? 1,
    unit: it.unit || 'unité',
    priority: it.priority || 'normal',
    status: it.status || 'needed',
    supplier_id: it.supplier_id ? String(it.supplier_id) : '',
    project_id: it.project_id ? String(it.project_id) : '',
    notes: it.notes || '',
  };
}

function NeedRow({ item, suppliers, projects, onChange, onUpdated }) {
  const st = PURCHASE_NEED_STATUS[item.status] || PURCHASE_NEED_STATUS.needed;
  const priceLinks = getPriceCompareLinks(item);
  const googleLink = priceLinks[0];
  const [draft, setDraft] = useState(() => formFromItem(item));
  const [saving, setSaving] = useState(false);
  const [saveHint, setSaveHint] = useState('');
  const [err, setErr] = useState('');
  const saveTimer = useRef(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;

  useEffect(() => {
    setDraft(formFromItem(item));
  }, [item.id, item.title, item.category, item.quantity, item.unit, item.priority, item.status, item.supplier_id, item.project_id, item.notes]);

  useEffect(() => () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
  }, []);

  function patchField(key, value) {
    setDraft(prev => {
      const next = { ...prev, [key]: value };
      draftRef.current = next;
      return next;
    });
    setErr('');
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      save(draftRef.current);
    }, 450);
  }

  async function save(next = draftRef.current) {
    const title = String(next.title || '').trim();
    if (!title) {
      setErr('Nom requis');
      return;
    }
    setSaving(true);
    setErr('');
    try {
      const updated = await api(`/purchases/needs/${item.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          title,
          category: next.category,
          quantity: Number(next.quantity) || 1,
          unit: String(next.unit || 'unité').trim() || 'unité',
          priority: next.priority,
          status: next.status,
          supplier_id: next.supplier_id === '' ? null : Number(next.supplier_id),
          project_id: next.project_id === '' ? null : Number(next.project_id),
          notes: String(next.notes || '').trim() || null,
        }),
      });
      setSaveHint('Enregistré');
      setTimeout(() => setSaveHint(''), 1200);
      onUpdated?.(updated);
      if (updated.status !== item.status || updated.priority !== item.priority || updated.category !== item.category) {
        onChange();
      }
    } catch (e) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!confirm(`Retirer « ${item.title} » de la liste ?`)) return;
    await api(`/purchases/needs/${item.id}`, { method: 'DELETE' });
    onChange();
  }

  return (
    <div className={`card space-y-3 ${draft.priority === 'urgent' && draft.status === 'needed' ? 'border-red-200 bg-red-50/30' : ''}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className={`text-[10px] px-2 py-0.5 rounded-full ${st.cls}`}>{st.label}</span>
        {draft.priority === 'urgent' && draft.status === 'needed' && (
          <span className="text-[10px] font-bold uppercase tracking-wide text-red-700 bg-red-100 px-2 py-0.5 rounded-full">Urgent</span>
        )}
        <span className="text-[10px] text-neya-muted ml-auto">
          {saving ? 'Enregistrement…' : saveHint || 'Modifiable'}
        </span>
      </div>

      {err && <p className="text-xs text-red-700 bg-red-50 px-2 py-1">{err}</p>}

      <div className="grid sm:grid-cols-2 lg:grid-cols-6 gap-2">
        <input
          className="input sm:col-span-2 lg:col-span-2 text-sm font-medium"
          value={draft.title}
          onChange={e => patchField('title', e.target.value)}
          onBlur={() => save()}
          placeholder="Nom de l’article"
          aria-label="Nom"
        />
        <select
          className="input text-sm"
          value={draft.category}
          onChange={e => patchField('category', e.target.value)}
          aria-label="Catégorie"
        >
          {PURCHASE_NEED_CATEGORIES.map(c => (
            <option key={c.value} value={c.value}>{c.label}</option>
          ))}
        </select>
        <input
          type="number"
          min={0.001}
          step="any"
          className="input text-sm"
          value={draft.quantity}
          onChange={e => patchField('quantity', e.target.value)}
          onBlur={() => save()}
          aria-label="Quantité"
          placeholder="Qté"
        />
        <input
          className="input text-sm"
          value={draft.unit}
          onChange={e => patchField('unit', e.target.value)}
          onBlur={() => save()}
          aria-label="Unité"
          placeholder="Unité"
        />
        <select
          className="input text-sm"
          value={draft.status}
          onChange={e => patchField('status', e.target.value)}
          aria-label="Statut"
        >
          <option value="needed">À acheter</option>
          <option value="ordered">Commandé</option>
          <option value="received">Reçu</option>
        </select>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2">
        <select
          className="input text-sm"
          value={draft.priority}
          onChange={e => patchField('priority', e.target.value)}
          aria-label="Priorité"
        >
          <option value="normal">Priorité normale</option>
          <option value="urgent">Urgent</option>
        </select>
        <select
          className="input text-sm"
          value={draft.supplier_id}
          onChange={e => patchField('supplier_id', e.target.value)}
          aria-label="Fournisseur"
        >
          <option value="">— Fournisseur —</option>
          {suppliers.map(s => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
        <select
          className="input text-sm"
          value={draft.project_id}
          onChange={e => patchField('project_id', e.target.value)}
          aria-label="Projet"
        >
          <option value="">— Projet —</option>
          {projects.map(p => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        <div className="flex flex-wrap gap-1.5 items-center">
          {draft.status === 'needed' && googleLink && (
            <a
              href={googleLink.url}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-secondary text-xs py-1.5 px-3"
              title="Google Shopping — comparer les prix"
            >
              Prix ↗
            </a>
          )}
          <button type="button" onClick={() => save()} disabled={saving} className="btn-secondary text-xs py-1.5 px-3">
            Sauver
          </button>
          <button type="button" onClick={remove} className="btn-secondary text-xs py-1.5 px-3 text-red-600 border-red-200">
            ✕
          </button>
        </div>
      </div>

      <input
        className="input text-sm w-full"
        value={draft.notes}
        onChange={e => patchField('notes', e.target.value)}
        onBlur={() => save()}
        placeholder="Notes (référence, magasin, urgence…)"
        aria-label="Notes"
      />

      {item.stock_qty != null && (
        <p className="text-[10px] text-neya-muted">
          Stock actuel : {item.stock_qty}{item.stock_min > 0 ? ` / min ${item.stock_min}` : ''}
        </p>
      )}

      {draft.status !== 'received' && <PriceCompareLinks item={{ ...item, title: draft.title }} />}
    </div>
  );
}

export default function PurchasesPage({ title = 'Liste de courses', subtitle = 'Consommables et fournitures à commander pour l\'atelier — colles, abrasifs, vis, lames, etc.' }) {
  const [view, setView] = useState('needs');
  const [needs, setNeeds] = useState([]);
  const [summary, setSummary] = useState(null);
  const [orders, setOrders] = useState([]);
  const [suggestions, setSuggestions] = useState(null);
  const [suppliers, setSuppliers] = useState([]);
  const [projects, setProjects] = useState([]);
  const [filter, setFilter] = useState('needed');
  const [catFilter, setCatFilter] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ title: '', category: 'consommable', quantity: 1, unit: 'unité', notes: '' });

  const load = () => {
    const params = new URLSearchParams();
    if (filter !== 'all') params.set('status', filter);
    if (catFilter) params.set('category', catFilter);
    api(`/purchases/needs?${params}`).then(setNeeds);
    api('/purchases/needs/summary').then(setSummary);
    api('/purchases/suggestions').then(setSuggestions);
    api('/purchases').then(setOrders);
  };

  useEffect(() => { load(); }, [filter, catFilter]);

  useEffect(() => {
    api('/suppliers').then(setSuppliers).catch(() => setSuppliers([]));
    api('/projects').then(list => setProjects((list || []).filter(p => p.status === 'active' || !p.status))).catch(() => setProjects([]));
  }, []);

  function onNeedUpdated(updated) {
    setNeeds(prev => prev.map(n => (n.id === updated.id ? { ...n, ...updated } : n)));
  }

  async function syncStock() {
    setSyncing(true);
    try {
      const res = await api('/purchases/needs/sync-stock', { method: 'POST' });
      load();
      if (res.added > 0) {
        alert(`${res.added} article(s) ajouté(s) depuis le stock bas`);
      } else {
        alert(res.scanned > 0 ? 'Tous les articles en stock bas sont déjà dans la liste' : 'Aucun stock sous le minimum');
      }
    } finally {
      setSyncing(false);
    }
  }

  async function addNeed(e) {
    e.preventDefault();
    if (!form.title.trim()) return;
    setSaving(true);
    try {
      await api('/purchases/needs', {
        method: 'POST',
        body: JSON.stringify({
          title: form.title.trim(),
          category: form.category,
          quantity: Number(form.quantity) || 1,
          unit: form.unit.trim() || 'unité',
          notes: form.notes.trim() || null,
        }),
      });
      setForm({ title: '', category: 'consommable', quantity: 1, unit: 'unité', notes: '' });
      setFilter('needed');
      load();
    } finally {
      setSaving(false);
    }
  }

  async function addFromSuggestion(item) {
    await api('/purchases/needs', {
      method: 'POST',
      body: JSON.stringify({
        title: item.name,
        category: item.category || 'consommable',
        quantity: item.qty_needed || 1,
        unit: item.unit || 'unité',
        inventory_item_id: item.id,
        supplier_id: item.supplier_id,
        priority: item.quantity <= 0 ? 'urgent' : 'normal',
        notes: `Stock: ${item.quantity} / min ${item.min_level}`,
        source: 'low_stock',
      }),
    });
    load();
  }

  const filteredNeeds = needs;

  return (
    <AuthGuard>
      <AppShell title={title} wide>
        <p className="text-sm text-neya-muted mb-6">
          {subtitle}
          {' '}
          <span className="text-neya-ink/80">Chaque ligne est modifiable directement. Liens prix : Google, Home Depot, Rona, Canac…</span>
        </p>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          <div className="card-flat text-center py-3">
            <p className="text-2xl font-heading text-neya-orange">{summary?.to_buy ?? 0}</p>
            <p className="text-xs text-neya-muted">À acheter</p>
          </div>
          <div className="card-flat text-center py-3">
            <p className="text-2xl font-heading text-red-600">{summary?.urgent ?? 0}</p>
            <p className="text-xs text-neya-muted">Urgents</p>
          </div>
          <div className="card-flat text-center py-3">
            <p className="text-2xl font-heading">{summary?.ordered ?? 0}</p>
            <p className="text-xs text-neya-muted">Commandés</p>
          </div>
          <div className="card-flat text-center py-3">
            <p className="text-2xl font-heading text-green-700">{summary?.received ?? 0}</p>
            <p className="text-xs text-neya-muted">Reçus</p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 mb-6">
          <button type="button" onClick={() => setView('needs')} className={`px-4 py-2 text-sm rounded-lg border font-medium ${view === 'needs' ? 'bg-neya-orange text-white border-neya-orange' : 'border-neya-border'}`}>
            À acheter
          </button>
          <button type="button" onClick={() => setView('orders')} className={`px-4 py-2 text-sm rounded-lg border font-medium ${view === 'orders' ? 'bg-neya-orange text-white border-neya-orange' : 'border-neya-border'}`}>
            Bons de commande
          </button>
          <Link href="/inventory" className="btn-secondary text-sm ml-auto">Voir le stock →</Link>
        </div>

        {view === 'needs' && (
          <>
            <form onSubmit={addNeed} className="card mb-6 grid sm:grid-cols-2 lg:grid-cols-6 gap-3">
              <input
                className="input sm:col-span-2"
                placeholder="Ex. Lames scie, colle, papier abrasif…"
                value={form.title}
                onChange={e => setForm({ ...form, title: e.target.value })}
                required
              />
              <select className="input" value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>
                {PURCHASE_NEED_CATEGORIES.map(c => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
              <input type="number" min={0.001} step="any" className="input" placeholder="Qté" value={form.quantity} onChange={e => setForm({ ...form, quantity: e.target.value })} />
              <input className="input" placeholder="Unité" value={form.unit} onChange={e => setForm({ ...form, unit: e.target.value })} />
              <button type="submit" disabled={saving} className="btn-primary disabled:opacity-50">
                {saving ? '…' : '+ Ajouter'}
              </button>
              <input
                className="input sm:col-span-5 lg:col-span-6"
                placeholder="Notes (fournisseur, référence, urgence…)"
                value={form.notes}
                onChange={e => setForm({ ...form, notes: e.target.value })}
              />
            </form>

            {suggestions?.low_stock?.length > 0 && (
              <div className="card-flat mb-6 border-amber-200 bg-amber-50/50">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                  <p className="text-sm font-medium text-amber-900">Stock bas détecté — consommables & atelier</p>
                  <button type="button" onClick={syncStock} disabled={syncing} className="btn-secondary text-xs">
                    {syncing ? 'Sync…' : '↻ Tout importer'}
                  </button>
                </div>
                <ul className="text-sm space-y-2">
                  {suggestions.low_stock.slice(0, 8).map(i => {
                    const already = needs.some(n => n.inventory_item_id === i.id && n.status !== 'received');
                    return (
                      <li key={i.id} className="flex flex-wrap items-center justify-between gap-2">
                        <span>
                          <span className="font-medium">{i.name}</span>
                          <span className="text-neya-muted ml-2">{i.quantity} / min {i.min_level} {i.unit}</span>
                        </span>
                        {already ? (
                          <span className="text-xs text-green-700">Déjà listé</span>
                        ) : (
                          <button type="button" onClick={() => addFromSuggestion(i)} className="text-xs text-neya-orange hover:underline">
                            + Ajouter
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            <div className="flex flex-wrap gap-2 mb-4">
              {[
                { id: 'needed', label: 'À acheter' },
                { id: 'ordered', label: 'Commandés' },
                { id: 'received', label: 'Reçus' },
                { id: 'all', label: 'Tout' },
              ].map(s => (
                <button key={s.id} type="button" onClick={() => setFilter(s.id)} className={`shrink-0 px-3 py-1.5 text-sm rounded-full border ${filter === s.id ? 'bg-neya-ink text-white border-neya-ink' : 'border-neya-border text-neya-muted'}`}>
                  {s.label}
                </button>
              ))}
            </div>

            <div className="flex gap-2 overflow-x-auto pb-2 mb-4 scrollbar-hide">
              <button type="button" onClick={() => setCatFilter('')} className={`shrink-0 text-xs px-3 py-1 rounded-full border ${!catFilter ? 'bg-neya-orange text-white border-neya-orange' : 'border-neya-border'}`}>
                Toutes catégories
              </button>
              {PURCHASE_NEED_CATEGORIES.map(c => (
                <button key={c.value} type="button" onClick={() => setCatFilter(c.value)} className={`shrink-0 text-xs px-3 py-1 rounded-full border ${catFilter === c.value ? 'bg-neya-orange text-white border-neya-orange' : 'border-neya-border'}`}>
                  {c.label}
                </button>
              ))}
            </div>

            <div className="space-y-3">
              {filteredNeeds.length === 0 ? (
                <div className="card-flat text-center py-12">
                  <p className="text-sm text-neya-muted mb-2">Aucun article à acheter pour l&apos;instant</p>
                  <p className="text-xs text-neya-muted">Ajoutez un consommable manquant ou importez depuis le stock bas</p>
                </div>
              ) : (
                filteredNeeds.map(n => (
                  <NeedRow
                    key={n.id}
                    item={n}
                    suppliers={suppliers}
                    projects={projects}
                    onChange={load}
                    onUpdated={onNeedUpdated}
                  />
                ))
              )}
            </div>
          </>
        )}

        {view === 'orders' && (
          <div className="space-y-2">
            {orders.length === 0 ? (
              <p className="text-sm text-neya-muted card-flat py-8 text-center">Aucun bon de commande</p>
            ) : (
              orders.map(o => (
                <div key={o.id} className="card flex flex-wrap justify-between gap-2">
                  <div>
                    <p className="font-medium text-sm">{o.title || `Commande #${o.id}`}</p>
                    <p className="text-xs text-neya-muted">{o.supplier_name} · {o.project_name || 'Stock général'}</p>
                  </div>
                  <div className="text-right">
                    <span className="badge border-neya-border">{ORDER_STATUS[o.status] || o.status}</span>
                    <p className="text-sm font-medium mt-1">{formatMoney(o.total)}</p>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </AppShell>
    </AuthGuard>
  );
}

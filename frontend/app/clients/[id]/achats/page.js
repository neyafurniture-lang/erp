'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  Copy,
  ExternalLink,
  Plus,
  RefreshCw,
  ShieldOff,
  Trash2,
} from 'lucide-react';
import AppShell from '../../../components/AppShell';
import AuthGuard from '../../../components/AuthGuard';
import { api, formatMoney } from '../../../lib/api';

const URGENCY_OPTS = [
  { value: 'critical', label: 'Critique' },
  { value: 'high', label: 'Urgent' },
  { value: 'normal', label: 'Normal' },
  { value: 'low', label: 'Basse' },
];

const STATUS_OPTS = [
  { value: 'todo', label: 'À faire' },
  { value: 'ordered', label: 'Commandé' },
  { value: 'done', label: 'Fait' },
];

function emptyItem() {
  return {
    title: '',
    price: '',
    url: '',
    urgency: 'normal',
    notes_public: '',
    status: 'todo',
  };
}

export default function ClientShopListsPage() {
  const { id: clientId } = useParams();
  const [client, setClient] = useState(null);
  const [lists, setLists] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState(emptyItem);
  const [copied, setCopied] = useState(false);

  const loadLists = useCallback(async () => {
    const data = await api(`/shop-lists/by-client/${clientId}`);
    setClient(data.client);
    setLists(data.lists || []);
    return data.lists || [];
  }, [clientId]);

  const loadDetail = useCallback(async (listId) => {
    if (!listId) {
      setDetail(null);
      return;
    }
    const d = await api(`/shop-lists/${listId}`);
    setDetail(d);
  }, []);

  useEffect(() => {
    if (!clientId) return;
    setError('');
    loadLists()
      .then(async (ls) => {
        const first = ls[0]?.id || null;
        setActiveId(first);
        if (first) await loadDetail(first);
      })
      .catch(e => setError(e.message));
  }, [clientId, loadLists, loadDetail]);

  async function selectList(id) {
    setActiveId(id);
    setError('');
    try {
      await loadDetail(id);
    } catch (e) {
      setError(e.message);
    }
  }

  async function createList() {
    setBusy(true);
    setError('');
    try {
      const list = await api('/shop-lists', {
        method: 'POST',
        body: JSON.stringify({
          client_id: Number(clientId),
          title: 'Liste d’achats',
          subtitle: 'Achats à prévoir',
        }),
      });
      await loadLists();
      setActiveId(list.id);
      await loadDetail(list.id);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function patchList(patch) {
    if (!activeId) return;
    setBusy(true);
    setError('');
    try {
      const updated = await api(`/shop-lists/${activeId}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });
      setDetail(prev => ({ ...prev, ...updated }));
      await loadLists();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function rotateToken() {
    if (!activeId) return;
    if (!confirm('Régénérer le lien public ? L’ancien lien ne fonctionnera plus.')) return;
    setBusy(true);
    try {
      const updated = await api(`/shop-lists/${activeId}/rotate-token`, { method: 'POST' });
      setDetail(prev => ({ ...prev, ...updated }));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function removeList() {
    if (!activeId) return;
    if (!confirm('Supprimer cette liste et tous ses articles ?')) return;
    setBusy(true);
    try {
      await api(`/shop-lists/${activeId}`, { method: 'DELETE' });
      const ls = await loadLists();
      const next = ls[0]?.id || null;
      setActiveId(next);
      await loadDetail(next);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function addItem(e) {
    e.preventDefault();
    if (!activeId || !draft.title.trim()) return;
    setBusy(true);
    setError('');
    try {
      await api(`/shop-lists/${activeId}/items`, {
        method: 'POST',
        body: JSON.stringify({
          title: draft.title.trim(),
          price: draft.price === '' ? null : Number(draft.price),
          url: draft.url.trim() || null,
          urgency: draft.urgency,
          notes_public: draft.notes_public.trim() || null,
          status: draft.status,
        }),
      });
      setDraft(emptyItem());
      await loadDetail(activeId);
      await loadLists();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function patchItem(itemId, patch) {
    setError('');
    try {
      await api(`/shop-lists/items/${itemId}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });
      await loadDetail(activeId);
    } catch (err) {
      setError(err.message);
    }
  }

  async function removeItem(itemId) {
    if (!confirm('Supprimer cet article ?')) return;
    try {
      await api(`/shop-lists/items/${itemId}`, { method: 'DELETE' });
      await loadDetail(activeId);
      await loadLists();
    } catch (err) {
      setError(err.message);
    }
  }

  const publicUrl = detail?.public_token
    ? `${typeof window !== 'undefined' ? window.location.origin : ''}/partage/achats/${detail.public_token}`
    : '';

  async function copyLink() {
    if (!publicUrl) return;
    try {
      await navigator.clipboard.writeText(publicUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setError('Impossible de copier le lien');
    }
  }

  return (
    <AuthGuard>
      <AppShell title="Listes d’achats client" wide>
        <Link href={`/clients/${clientId}`} className="text-sm text-neya-orange hover:underline mb-4 inline-block">
          ← Retour fiche client
        </Link>

        <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
          <div>
            <h1 className="font-display text-2xl font-semibold">Listes d’achats</h1>
            <p className="text-sm text-neya-muted mt-1">
              {client?.name || '…'} — partage public lecture seule (lien tokenisé)
            </p>
          </div>
          <button type="button" className="btn-primary text-sm gap-1.5" onClick={createList} disabled={busy}>
            <Plus className="h-4 w-4" /> Nouvelle liste
          </button>
        </div>

        {error ? (
          <div className="mb-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-4 py-3">{error}</div>
        ) : null}

        {!lists.length ? (
          <div className="card text-sm text-neya-muted py-10 text-center">
            Aucune liste. Crée-en une pour Sonacloud ou ce client, puis partage le lien.
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-4">
            <aside className="card p-2 space-y-1 h-fit">
              {lists.map(l => (
                <button
                  key={l.id}
                  type="button"
                  onClick={() => selectList(l.id)}
                  className={`w-full text-left rounded-lg px-3 py-2 text-sm transition-colors ${
                    activeId === l.id ? 'bg-neya-ink text-white' : 'hover:bg-neya-surface text-neya-ink'
                  }`}
                >
                  <span className="font-medium block truncate">{l.title}</span>
                  <span className={`text-[11px] ${activeId === l.id ? 'text-white/70' : 'text-neya-muted'}`}>
                    {l.open_count}/{l.items_count} ouverts
                    {!l.public_enabled ? ' · off' : ''}
                  </span>
                </button>
              ))}
            </aside>

            {detail ? (
              <section className="space-y-4">
                <div className="card space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="label">Titre</label>
                      <input
                        className="input"
                        value={detail.title || ''}
                        onChange={e => setDetail({ ...detail, title: e.target.value })}
                        onBlur={e => patchList({ title: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className="label">Sous-titre</label>
                      <input
                        className="input"
                        value={detail.subtitle || ''}
                        onChange={e => setDetail({ ...detail, subtitle: e.target.value })}
                        onBlur={e => patchList({ subtitle: e.target.value })}
                      />
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-3 text-sm">
                    <label className="inline-flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={Boolean(detail.public_enabled)}
                        onChange={e => patchList({ public_enabled: e.target.checked })}
                      />
                      Lien public actif
                    </label>
                    <label className="inline-flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={Boolean(detail.show_client_name)}
                        onChange={e => patchList({ show_client_name: e.target.checked })}
                      />
                      Afficher le nom du client
                    </label>
                  </div>

                  <div className="rounded-xl border border-neya-border bg-neya-surface/60 px-3 py-3">
                    <p className="text-[11px] uppercase tracking-wider text-neya-muted mb-1">Lien public (sans connexion)</p>
                    <p className="text-xs break-all font-mono text-neya-ink">{publicUrl}</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button type="button" className="btn-secondary text-xs gap-1" onClick={copyLink} disabled={!detail.public_enabled}>
                        <Copy className="h-3.5 w-3.5" /> {copied ? 'Copié' : 'Copier'}
                      </button>
                      <a
                        href={publicUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn-secondary text-xs gap-1 inline-flex items-center"
                      >
                        <ExternalLink className="h-3.5 w-3.5" /> Ouvrir
                      </a>
                      <button type="button" className="btn-secondary text-xs gap-1" onClick={rotateToken} disabled={busy}>
                        <RefreshCw className="h-3.5 w-3.5" /> Régénérer le token
                      </button>
                      <button type="button" className="btn-secondary text-xs gap-1 text-red-700" onClick={removeList} disabled={busy}>
                        <Trash2 className="h-3.5 w-3.5" /> Supprimer liste
                      </button>
                    </div>
                    <p className="mt-2 text-[11px] text-neya-muted inline-flex items-start gap-1.5">
                      <ShieldOff className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                      Lecture seule · token long aléatoire · désactivable · pas d’accès ERP ni données clients sensibles.
                    </p>
                  </div>
                </div>

                <form onSubmit={addItem} className="card space-y-3">
                  <h2 className="text-sm font-semibold">Ajouter un achat</h2>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="sm:col-span-2">
                      <label className="label">Article</label>
                      <input className="input" value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} required />
                    </div>
                    <div>
                      <label className="label">Prix ($)</label>
                      <input className="input" type="number" min="0" step="0.01" value={draft.price} onChange={e => setDraft({ ...draft, price: e.target.value })} />
                    </div>
                    <div>
                      <label className="label">Urgence</label>
                      <select className="input" value={draft.urgency} onChange={e => setDraft({ ...draft, urgency: e.target.value })}>
                        {URGENCY_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    </div>
                    <div className="sm:col-span-2">
                      <label className="label">Lien d’achat (https)</label>
                      <input className="input" type="url" placeholder="https://…" value={draft.url} onChange={e => setDraft({ ...draft, url: e.target.value })} />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="label">Note visible client</label>
                      <input className="input" value={draft.notes_public} onChange={e => setDraft({ ...draft, notes_public: e.target.value })} />
                    </div>
                  </div>
                  <button type="submit" className="btn-primary text-sm" disabled={busy || !draft.title.trim()}>
                    Ajouter
                  </button>
                </form>

                <ul className="space-y-2">
                  {(detail.items || []).map(item => (
                    <li key={item.id} className="card !p-3 flex flex-col gap-2 sm:flex-row sm:items-start">
                      <div className="flex-1 min-w-0 space-y-2">
                        <input
                          className="input"
                          defaultValue={item.title}
                          onBlur={e => {
                            const v = e.target.value.trim();
                            if (v && v !== item.title) patchItem(item.id, { title: v });
                          }}
                        />
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                          <input
                            className="input"
                            type="number"
                            min="0"
                            step="0.01"
                            defaultValue={item.price ?? ''}
                            placeholder="Prix"
                            onBlur={e => {
                              const v = e.target.value;
                              const next = v === '' ? null : Number(v);
                              if (next !== (item.price == null ? null : Number(item.price))) {
                                patchItem(item.id, { price: next });
                              }
                            }}
                          />
                          <select
                            className="input"
                            value={item.urgency}
                            onChange={e => patchItem(item.id, { urgency: e.target.value })}
                          >
                            {URGENCY_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                          </select>
                          <select
                            className="input"
                            value={item.status}
                            onChange={e => patchItem(item.id, { status: e.target.value })}
                          >
                            {STATUS_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                          </select>
                          <input
                            className="input"
                            type="url"
                            defaultValue={item.url || ''}
                            placeholder="https://…"
                            onBlur={e => {
                              const v = e.target.value.trim();
                              if (v !== (item.url || '')) patchItem(item.id, { url: v || null });
                            }}
                          />
                        </div>
                        {item.price != null ? (
                          <p className="text-xs text-neya-muted tabular-nums">{formatMoney(item.price)}</p>
                        ) : null}
                      </div>
                      <button type="button" className="btn-secondary text-xs text-red-700 shrink-0" onClick={() => removeItem(item.id)}>
                        Supprimer
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </div>
        )}
      </AppShell>
    </AuthGuard>
  );
}

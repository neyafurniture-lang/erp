'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { ExternalLink, Plus, Trash2 } from 'lucide-react';
import NeyaMark from '../../../../components/NeyaMark';
import { getApiUrl, formatMoney } from '../../../../lib/api';

const URGENCY_OPTS = [
  { value: 'critical', label: 'Critique' },
  { value: 'high', label: 'Haute' },
  { value: 'normal', label: 'Normale' },
  { value: 'low', label: 'Basse' },
];

function emptyDraft() {
  return { title: '', price: '', urgency: 'normal', url: '' };
}

export default function PublicShopListPage() {
  const { token } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [hint, setHint] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState(emptyDraft);
  const saveTimers = useRef({});

  const apiBase = useMemo(
    () => `${getApiUrl()}/public/shop/${encodeURIComponent(token || '')}`,
    [token]
  );

  const load = useCallback(async () => {
    if (!token) return;
    setError('');
    const res = await fetch(apiBase, { cache: 'no-store' });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || 'Liste introuvable');
    setData(json);
  }, [apiBase, token]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        await load();
      } catch (e) {
        if (!cancelled) setError(e.message || 'Impossible de charger la liste');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      Object.values(saveTimers.current).forEach(clearTimeout);
    };
  }, [load]);

  function flash(msg) {
    setHint(msg);
    setTimeout(() => setHint(''), 1400);
  }

  async function mutate(path, options) {
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`${apiBase}${path}`, {
        ...options,
        headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Erreur');
      setData(json);
      flash('Enregistré');
      return json;
    } catch (e) {
      setError(e.message || 'Erreur');
      throw e;
    } finally {
      setBusy(false);
    }
  }

  function schedulePatch(itemId, patch) {
    const key = String(itemId);
    if (saveTimers.current[key]) clearTimeout(saveTimers.current[key]);
    // Optimistic local update
    setData(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        items: (prev.items || []).map(it => (it.id === itemId ? { ...it, ...patch } : it)),
      };
    });
    saveTimers.current[key] = setTimeout(() => {
      mutate(`/items/${itemId}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      }).catch(() => load().catch(() => {}));
    }, 400);
  }

  async function addRow(e) {
    e.preventDefault();
    const title = draft.title.trim();
    if (!title || busy) return;
    await mutate('/items', {
      method: 'POST',
      body: JSON.stringify({
        title,
        price: draft.price === '' ? null : Number(draft.price),
        urgency: draft.urgency,
        url: draft.url.trim() || null,
        status: 'todo',
      }),
    });
    setDraft(emptyDraft());
  }

  async function removeRow(itemId) {
    if (!confirm('Supprimer cette ligne ?')) return;
    await mutate(`/items/${itemId}`, { method: 'DELETE' });
  }

  const totals = useMemo(() => {
    const items = data?.items || [];
    const open = items.filter(i => i.status !== 'done' && i.status !== 'ordered');
    const sum = items.reduce((acc, i) => acc + (Number(i.price) || 0), 0);
    const orderedSum = items
      .filter(i => i.status === 'ordered' || i.status === 'done')
      .reduce((acc, i) => acc + (Number(i.price) || 0), 0);
    return { count: items.length, open: open.length, sum, orderedSum };
  }, [data]);

  return (
    <div className="min-h-screen bg-neya-cream text-neya-ink">
      <header className="border-b border-neya-border bg-white">
        <div className="mx-auto max-w-6xl px-3 sm:px-4 py-4 flex items-center gap-3">
          <NeyaMark className="h-9 w-9" />
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-[0.14em] text-neya-muted">Neya Furniture</p>
            <p className="text-sm font-medium truncate">Liste d’achats — tableur</p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-2 sm:px-4 py-5 sm:py-8">
        {loading ? (
          <p className="text-neya-muted text-sm px-2">Chargement…</p>
        ) : error && !data ? (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-5 text-sm text-red-800">
            {error}
          </div>
        ) : (
          <>
            <div className="mb-4 px-1">
              {data.client_name ? (
                <p className="text-sm text-neya-muted mb-0.5">{data.client_name}</p>
              ) : null}
              <h1 className="font-display text-2xl sm:text-3xl font-semibold tracking-tight">
                {data.title}
              </h1>
              {data.subtitle ? (
                <p className="mt-1 text-neya-muted text-sm">{data.subtitle}</p>
              ) : null}
              <p className="mt-2 text-sm text-neya-ink">
                {totals.count} ligne{totals.count > 1 ? 's' : ''}
                {totals.open ? ` · ${totals.open} à commander` : ''}
                {totals.sum > 0 ? (
                  <>
                    {' · total '}
                    <span className="font-semibold tabular-nums">{formatMoney(totals.sum)}</span>
                  </>
                ) : null}
                {totals.orderedSum > 0 ? (
                  <span className="text-neya-muted">
                    {' '}(commandé {formatMoney(totals.orderedSum)})
                  </span>
                ) : null}
                {hint ? <span className="ml-2 text-emerald-700 text-xs">{hint}</span> : null}
              </p>
              {error ? <p className="mt-2 text-sm text-red-700">{error}</p> : null}
            </div>

            <div className="overflow-x-auto rounded-xl border border-neya-border bg-white shadow-sm">
              <table className="w-full min-w-[720px] border-collapse text-sm">
                <thead>
                  <tr className="bg-neya-surface/80 text-left text-[11px] uppercase tracking-wider text-neya-muted">
                    <th className="px-2 py-2.5 font-medium w-[28%]">Nom</th>
                    <th className="px-2 py-2.5 font-medium w-[12%]">Prix</th>
                    <th className="px-2 py-2.5 font-medium w-[14%]">Importance</th>
                    <th className="px-2 py-2.5 font-medium w-[28%]">Lien</th>
                    <th className="px-2 py-2.5 font-medium w-[10%] text-center">Commandé</th>
                    <th className="px-2 py-2.5 font-medium w-[8%] text-center"> </th>
                  </tr>
                </thead>
                <tbody>
                  {(data.items || []).map(item => {
                    const ordered = item.status === 'ordered' || item.status === 'done';
                    return (
                      <tr
                        key={item.id}
                        className={`border-t border-neya-border/70 ${ordered ? 'bg-emerald-50/40' : 'bg-white'}`}
                      >
                        <td className="px-1.5 py-1">
                          <input
                            className="w-full rounded-md border border-transparent hover:border-neya-border focus:border-neya-orange focus:outline-none px-1.5 py-1.5 bg-transparent"
                            defaultValue={item.title}
                            onBlur={e => {
                              const v = e.target.value.trim();
                              if (v && v !== item.title) schedulePatch(item.id, { title: v });
                              else if (!v) e.target.value = item.title;
                            }}
                          />
                        </td>
                        <td className="px-1.5 py-1">
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            className="w-full rounded-md border border-transparent hover:border-neya-border focus:border-neya-orange focus:outline-none px-1.5 py-1.5 bg-transparent tabular-nums"
                            defaultValue={item.price ?? ''}
                            placeholder="—"
                            onBlur={e => {
                              const raw = e.target.value;
                              const next = raw === '' ? null : Number(raw);
                              const cur = item.price == null ? null : Number(item.price);
                              if (next !== cur) schedulePatch(item.id, { price: next });
                            }}
                          />
                        </td>
                        <td className="px-1.5 py-1">
                          <select
                            className="w-full rounded-md border border-neya-border/60 bg-white px-1.5 py-1.5"
                            value={item.urgency || 'normal'}
                            onChange={e => schedulePatch(item.id, { urgency: e.target.value })}
                          >
                            {URGENCY_OPTS.map(o => (
                              <option key={o.value} value={o.value}>{o.label}</option>
                            ))}
                          </select>
                        </td>
                        <td className="px-1.5 py-1">
                          <div className="flex items-center gap-1">
                            <input
                              type="url"
                              className="w-full min-w-0 rounded-md border border-transparent hover:border-neya-border focus:border-neya-orange focus:outline-none px-1.5 py-1.5 bg-transparent text-[13px]"
                              defaultValue={item.url || ''}
                              placeholder="https://…"
                              onBlur={e => {
                                const v = e.target.value.trim();
                                if (v !== (item.url || '')) schedulePatch(item.id, { url: v || null });
                              }}
                            />
                            {item.url ? (
                              <a
                                href={item.url}
                                target="_blank"
                                rel="noopener noreferrer nofollow"
                                className="shrink-0 text-neya-orange p-1"
                                title="Ouvrir"
                              >
                                <ExternalLink className="h-3.5 w-3.5" />
                              </a>
                            ) : null}
                          </div>
                        </td>
                        <td className="px-1.5 py-1 text-center">
                          <input
                            type="checkbox"
                            className="h-4 w-4 accent-neya-orange"
                            checked={ordered}
                            onChange={e => schedulePatch(item.id, {
                              status: e.target.checked ? 'ordered' : 'todo',
                            })}
                            title="Marquer comme commandé"
                          />
                        </td>
                        <td className="px-1.5 py-1 text-center">
                          <button
                            type="button"
                            className="inline-flex items-center justify-center rounded-md p-1.5 text-neya-muted hover:text-red-700 hover:bg-red-50"
                            onClick={() => removeRow(item.id)}
                            disabled={busy}
                            title="Supprimer"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <form
              onSubmit={addRow}
              className="mt-3 overflow-x-auto rounded-xl border border-dashed border-neya-border bg-white/80"
            >
              <div className="min-w-[720px] grid grid-cols-[28%_12%_14%_28%_10%_8%] gap-0 items-center px-1.5 py-2">
                <input
                  className="mx-1 rounded-md border border-neya-border px-2 py-1.5 text-sm"
                  placeholder="Nouvel article…"
                  value={draft.title}
                  onChange={e => setDraft({ ...draft, title: e.target.value })}
                  required
                />
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  className="mx-1 rounded-md border border-neya-border px-2 py-1.5 text-sm tabular-nums"
                  placeholder="Prix"
                  value={draft.price}
                  onChange={e => setDraft({ ...draft, price: e.target.value })}
                />
                <select
                  className="mx-1 rounded-md border border-neya-border px-2 py-1.5 text-sm bg-white"
                  value={draft.urgency}
                  onChange={e => setDraft({ ...draft, urgency: e.target.value })}
                >
                  {URGENCY_OPTS.map(o => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
                <input
                  type="url"
                  className="mx-1 rounded-md border border-neya-border px-2 py-1.5 text-sm"
                  placeholder="https://…"
                  value={draft.url}
                  onChange={e => setDraft({ ...draft, url: e.target.value })}
                />
                <div className="text-center text-[11px] text-neya-muted">—</div>
                <div className="text-center">
                  <button
                    type="submit"
                    disabled={busy || !draft.title.trim()}
                    className="inline-flex items-center gap-1 rounded-lg bg-neya-ink text-white text-xs font-medium px-2.5 py-1.5 disabled:opacity-40"
                  >
                    <Plus className="h-3.5 w-3.5" /> Ajouter
                  </button>
                </div>
              </div>
            </form>
          </>
        )}
      </main>

      <footer className="mx-auto max-w-6xl px-4 pb-10 pt-2 text-center text-[11px] text-neya-muted">
        Tableur partagé — modifications enregistrées automatiquement. Lien privé Neya Furniture.
      </footer>
    </div>
  );
}

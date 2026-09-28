'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { ExternalLink, ShoppingBag } from 'lucide-react';
import NeyaMark from '../../../components/NeyaMark';
import { getApiUrl, formatMoney } from '../../../lib/api';

const URGENCY = {
  critical: { label: 'Critique', className: 'bg-red-100 text-red-800 border-red-200' },
  high: { label: 'Urgent', className: 'bg-amber-100 text-amber-900 border-amber-200' },
  normal: { label: 'Normal', className: 'bg-neya-surface text-neya-ink border-neya-border' },
  low: { label: 'Basse', className: 'bg-white text-neya-muted border-neya-border' },
};

const STATUS = {
  todo: { label: 'À faire' },
  ordered: { label: 'Commandé' },
  done: { label: 'Fait' },
};

export default function PublicShopListPage() {
  const { token } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const res = await fetch(`${getApiUrl()}/public/shop/${encodeURIComponent(token)}`, {
          cache: 'no-store',
        });
        const json = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          setError(json.error || 'Liste introuvable');
          setData(null);
          return;
        }
        setData(json);
      } catch {
        if (!cancelled) setError('Impossible de charger la liste');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  const totals = useMemo(() => {
    const items = data?.items || [];
    const open = items.filter(i => i.status !== 'done');
    const sum = open.reduce((acc, i) => acc + (Number(i.price) || 0), 0);
    return { count: open.length, sum };
  }, [data]);

  return (
    <div className="min-h-screen bg-neya-cream text-neya-ink">
      <header className="border-b border-neya-border bg-white">
        <div className="mx-auto max-w-3xl px-4 py-5 flex items-center gap-3">
          <NeyaMark className="h-9 w-9" />
          <div>
            <p className="text-[11px] uppercase tracking-[0.14em] text-neya-muted">Neya Furniture</p>
            <p className="text-sm font-medium">Liste d’achats partagée</p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-8">
        {loading ? (
          <p className="text-neya-muted text-sm">Chargement…</p>
        ) : error ? (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-5 text-sm text-red-800">
            {error}
          </div>
        ) : (
          <>
            <div className="mb-6">
              {data.client_name ? (
                <p className="text-sm text-neya-muted mb-1">{data.client_name}</p>
              ) : null}
              <h1 className="font-display text-3xl font-semibold tracking-tight flex items-center gap-2">
                <ShoppingBag className="h-7 w-7 text-neya-orange" strokeWidth={1.75} />
                {data.title}
              </h1>
              {data.subtitle ? (
                <p className="mt-2 text-neya-muted text-sm leading-relaxed max-w-2xl">{data.subtitle}</p>
              ) : null}
              <p className="mt-3 text-sm text-neya-ink">
                {totals.count} article{totals.count > 1 ? 's' : ''} restant{totals.count > 1 ? 's' : ''}
                {totals.sum > 0 ? (
                  <>
                    {' · '}
                    <span className="font-semibold tabular-nums">{formatMoney(totals.sum)}</span>
                    {' estimés'}
                  </>
                ) : null}
              </p>
            </div>

            {!data.items?.length ? (
              <p className="text-sm text-neya-muted border border-dashed border-neya-border rounded-xl px-4 py-8 text-center">
                Aucun achat pour le moment.
              </p>
            ) : (
              <ul className="space-y-3">
                {data.items.map(item => {
                  const urg = URGENCY[item.urgency] || URGENCY.normal;
                  const st = STATUS[item.status] || STATUS.todo;
                  const done = item.status === 'done';
                  return (
                    <li
                      key={item.id}
                      className={`rounded-xl border border-neya-border bg-white px-4 py-3.5 ${done ? 'opacity-55' : ''}`}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className={`text-base font-medium ${done ? 'line-through' : ''}`}>{item.title}</p>
                          {item.notes ? (
                            <p className="mt-1 text-[13px] text-neya-muted">{item.notes}</p>
                          ) : null}
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            <span className={`text-[11px] px-2 py-0.5 rounded-full border ${urg.className}`}>
                              {urg.label}
                            </span>
                            <span className="text-[11px] px-2 py-0.5 rounded-full border border-neya-border text-neya-muted">
                              {st.label}
                            </span>
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          {item.price != null ? (
                            <p className="text-base font-semibold tabular-nums">{formatMoney(item.price)}</p>
                          ) : (
                            <p className="text-sm text-neya-muted">Prix à confirmer</p>
                          )}
                          {item.url ? (
                            <a
                              href={item.url}
                              target="_blank"
                              rel="noopener noreferrer nofollow"
                              className="mt-1 inline-flex items-center gap-1 text-sm text-neya-orange hover:underline"
                            >
                              Voir l’achat <ExternalLink className="h-3.5 w-3.5" />
                            </a>
                          ) : null}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
      </main>

      <footer className="mx-auto max-w-3xl px-4 pb-10 pt-4 text-center text-[11px] text-neya-muted">
        Lien privé Neya Furniture — ne partagez pas hors des personnes concernées.
      </footer>
    </div>
  );
}

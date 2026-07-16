'use client';

import { useMemo, useState } from 'react';
import { getPriceCompareLinks } from '../lib/price-compare';

/**
 * Propose des liens marchands pour trouver le prix le moins cher.
 * Ouvre les sites en nouvel onglet (recherche produit).
 */
export default function PriceCompareLinks({ item, compact = false }) {
  const [open, setOpen] = useState(false);
  const links = useMemo(() => getPriceCompareLinks(item), [item]);

  if (!links.length) return null;

  const query = links[0].query;

  function openAll() {
    // Limite à 3 premiers pour éviter le bloqueur de popups
    links.slice(0, 3).forEach((l, i) => {
      window.setTimeout(() => {
        window.open(l.url, '_blank', 'noopener,noreferrer');
      }, i * 200);
    });
  }

  if (compact && !open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-[11px] font-medium text-neya-orange hover:underline"
        title={`Comparer les prix pour « ${query} »`}
      >
        Comparer les prix →
      </button>
    );
  }

  return (
    <div className="mt-2 pt-2 border-t border-neya-border/70">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-neya-muted">
          Prix le moins cher
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={openAll}
            className="text-[11px] font-medium text-neya-ink hover:underline"
            title="Ouvre Google, Home Depot et Rona"
          >
            Ouvrir les 3 meilleurs
          </button>
          {compact && (
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-[11px] text-neya-muted hover:text-neya-ink"
              aria-label="Replier"
            >
              ✕
            </button>
          )}
        </div>
      </div>
      <p className="text-[10px] text-neya-muted mb-1.5 truncate" title={query}>
        Recherche : « {query} »
      </p>
      <div className="flex flex-wrap gap-1.5">
        {links.map((l) => (
          <a
            key={l.id}
            href={l.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center px-2 py-1 text-[11px] font-medium border border-neya-border bg-white text-neya-ink hover:border-neya-ink/40 hover:bg-neya-surface transition-colors"
            title={`${l.label} — ${query}`}
          >
            {l.short}
            <span className="ml-1 text-neya-muted" aria-hidden>↗</span>
          </a>
        ))}
      </div>
    </div>
  );
}

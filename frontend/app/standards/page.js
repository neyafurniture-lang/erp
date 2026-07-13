'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import AppShell from '../../components/AppShell';
import AuthGuard from '../../components/AuthGuard';
import { api } from '../../lib/api';
import { parseMeta, parseSteps, isCatalogProduct } from '../../lib/standards';
import { productImageUrl } from '../../lib/fiche-images';

function ProductCard({ standard }) {
  const meta = parseMeta(standard.meta);
  const steps = parseSteps(standard.steps);
  const totalMin = steps.reduce((sum, st) => sum + (st.estimated_minutes || 0), 0);
  const sku = meta.sku || standard.product_type;
  const displayName = standard.name.replace(/^[A-Z0-9ÕÄÜ]+\s+—\s+/, '');
  const image = productImageUrl(meta);

  return (
    <Link
      href={`/standards/${standard.id}`}
      className="card block hover:border-neya-orange hover:shadow-md transition-all group cursor-pointer overflow-hidden p-0"
    >
      {image && (
        <div className="relative h-36 bg-neya-cream border-b border-neya-border">
          <Image
            src={image}
            alt={displayName}
            fill
            className="object-contain p-3"
            unoptimized
          />
        </div>
      )}
      <div className="p-4">
      <div className="flex items-start justify-between gap-3">
        <span className="text-xs font-bold bg-neya-orange text-white px-2.5 py-1 rounded-full shrink-0">
          {sku}
        </span>
        <span className="text-xs text-neya-muted group-hover:text-neya-orange transition-colors">
          Ouvrir →
        </span>
      </div>
      <h3 className="font-heading text-lg text-neya-ink mt-3 group-hover:text-neya-orange transition-colors">
        {displayName}
      </h3>
      {meta.web_permalink && (
        <p className="text-xs text-neya-orange mt-1 truncate">{meta.web_permalink.replace(/^https?:\/\//, '')}</p>
      )}
      {meta.price && (
        <p className="text-sm font-medium text-neya-ink mt-1">{meta.price}</p>
      )}
      <p className="text-xs text-neya-muted mt-2 line-clamp-2">
        {meta.wood && `${meta.wood} · `}
        {meta.finish}
      </p>
      <p className="text-xs text-neya-muted mt-3 pt-3 border-t border-neya-border">
        {steps.length} étapes · ~{Math.round(totalMin / 60)}h
      </p>
      </div>
    </Link>
  );
}

function GuideCard({ standard }) {
  const steps = parseSteps(standard.steps);
  return (
    <Link
      href={`/standards/${standard.id}`}
      className="card block border-neya-orange/30 bg-neya-cream/40 hover:border-neya-orange hover:shadow-md transition-all group"
    >
      <div className="flex items-center justify-between">
        <h3 className="font-heading text-base text-neya-ink group-hover:text-neya-orange transition-colors">
          {standard.name}
        </h3>
        <span className="text-xs text-neya-muted group-hover:text-neya-orange">Ouvrir →</span>
      </div>
      <p className="text-xs text-neya-muted mt-2">
        Sécurité, collage, sablage, Domino, finition — {steps.length} sections
      </p>
    </Link>
  );
}

export default function StandardsPage() {
  const [standards, setStandards] = useState([]);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState('');

  function loadStandards() {
    return api('/standards').then(setStandards);
  }

  useEffect(() => {
    loadStandards();
    const onAction = () => loadStandards();
    window.addEventListener('neya:assistant-action', onAction);
    return () => window.removeEventListener('neya:assistant-action', onAction);
  }, []);

  async function refreshAllPhotos() {
    setSyncing(true);
    setSyncMsg('');
    try {
      const result = await api('/wordpress/sync-photos', { method: 'POST' });
      await loadStandards();
      setSyncMsg(`${result.photos_downloaded ?? 0} photo(s) mises à jour`);
      window.dispatchEvent(new CustomEvent('neya:assistant-action'));
    } catch (e) {
      setSyncMsg(e.message);
    } finally {
      setSyncing(false);
    }
  }

  const guides = standards.filter(s => s.product_type === 'guide');
  const products = standards.filter(isCatalogProduct);

  return (
    <AuthGuard>
      <AppShell title="Standards de fabrication">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
          <p className="text-neya-muted text-sm">
            Cliquez sur une fiche pour voir le détail complet — catalogue atelier v1.1
          </p>
          <button
            type="button"
            onClick={refreshAllPhotos}
            disabled={syncing}
            className="btn-secondary text-sm shrink-0 disabled:opacity-50"
          >
            {syncing ? 'Mise à jour…' : '↻ Photos depuis le site'}
          </button>
        </div>
        {syncMsg && (
          <p className={`text-sm mb-4 px-3 py-2 rounded-lg ${syncMsg.includes('échou') || syncMsg.includes('manquant') ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-800'}`}>
            {syncMsg}
          </p>
        )}

        {guides.length > 0 && (
          <section className="mb-10">
            <h2 className="font-heading text-base text-neya-ink mb-3">Guides atelier</h2>
            <div className="grid gap-3">{guides.map(s => <GuideCard key={s.id} standard={s} />)}</div>
          </section>
        )}

        <section>
          <h2 className="font-heading text-base text-neya-ink mb-3">
            Fiches produit ({products.length})
          </h2>
          {products.length === 0 ? (
            <p className="text-neya-muted text-sm">
              Aucune fiche — lancez <code className="bg-neya-cream px-1 rounded">npm run db:seed-standards</code>
            </p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {products.map(s => <ProductCard key={s.id} standard={s} />)}
            </div>
          )}
        </section>
      </AppShell>
    </AuthGuard>
  );
}

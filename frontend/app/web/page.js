'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import AppShell from '../../components/AppShell';
import AuthGuard from '../../components/AuthGuard';
import { api, formatMoney, formatDate } from '../../lib/api';
import { resolveImageUrl } from '../../lib/fiche-images';

export default function WebHubPage() {
  const [status, setStatus] = useState(null);
  const [orders, setOrders] = useState([]);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  async function load() {
    setLoading(true);
    try {
      const [st, ord, prod] = await Promise.all([
        api('/wordpress/status'),
        api('/wordpress/orders').catch(() => []),
        api('/wordpress/products').catch(() => []),
      ]);
      setStatus(st);
      setOrders(ord);
      setProducts(prod);
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function runSync(type) {
    setSyncing(type);
    setErr('');
    setMsg('');
    try {
      const path = type === 'all' ? '/wordpress/sync-all'
        : type === 'orders' ? '/wordpress/sync-orders'
          : type === 'photos' ? '/wordpress/sync-photos'
            : '/wordpress/sync';
      const result = await api(path, { method: 'POST' });
      setMsg(type === 'all'
        ? `Sync complète : ${result.products?.matched ?? 0} produits, ${result.orders?.imported ?? 0} commandes importées`
        : type === 'orders'
          ? `${result.imported} commande(s) importée(s)`
          : type === 'photos'
            ? `${result.photos_downloaded ?? 0} photo(s) récupérée(s) pour ${result.matched ?? 0} fiche(s)`
            : `${result.matched} fiche(s) liée(s), ${result.photos_downloaded ?? 0} photo(s)`);
      load();
      window.dispatchEvent(new CustomEvent('neya:assistant-action'));
    } catch (e) {
      setErr(e.message);
    } finally {
      setSyncing('');
    }
  }

  if (loading) {
    return (
      <AuthGuard>
        <AppShell title="Site web">
          <p className="text-neya-muted">Chargement…</p>
        </AppShell>
      </AuthGuard>
    );
  }

  const shopUrl = status?.base || 'https://neyafurniture.ca';

  return (
    <AuthGuard>
      <AppShell title="Site web">
        <div className="max-w-5xl space-y-6">
          {msg && <p className="text-sm text-green-700 bg-green-50 px-4 py-2 rounded-lg">{msg}</p>}
          {err && <p className="text-sm text-neya-error bg-red-50 px-4 py-2 rounded-lg">{err}</p>}

          <div className="card flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="font-heading text-xl">neyafurniture.ca</h2>
                <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${
                  status?.configured ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'
                }`}>
                  {status?.configured ? 'WooCommerce connecté' : 'Non configuré'}
                </span>
              </div>
              <p className="text-sm text-neya-muted mt-2">
                Liez votre boutique en ligne à l&apos;ERP : produits, photos, commandes → clients &amp; projets.
              </p>
              {status?.last_sync && (
                <p className="text-xs text-neya-muted mt-1">
                  Dernière sync : {formatDate(status.last_sync)}
                </p>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <a href={shopUrl} target="_blank" rel="noopener noreferrer" className="btn-secondary text-sm">
                Ouvrir le site ↗
              </a>
              <Link href="/settings?tab=web" className="btn-secondary text-sm">Configurer API</Link>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <div className="card text-center">
              <p className="text-2xl font-heading text-neya-orange">{status?.linked_products ?? 0}</p>
              <p className="text-xs text-neya-muted mt-1">Fiches liées</p>
            </div>
            <div className="card text-center">
              <p className="text-2xl font-heading text-neya-orange">{status?.photos_downloaded ?? 0}</p>
              <p className="text-xs text-neya-muted mt-1">Photos locales</p>
            </div>
            <div className="card text-center">
              <p className="text-2xl font-heading">{status?.web_orders_total ?? 0}</p>
              <p className="text-xs text-neya-muted mt-1">Commandes sync</p>
            </div>
            <div className="card text-center">
              <p className="text-2xl font-heading">{status?.web_orders_active ?? 0}</p>
              <p className="text-xs text-neya-muted mt-1">En cours</p>
            </div>
            <div className="card text-center">
              <p className="text-2xl font-heading">{status?.web_projects ?? 0}</p>
              <p className="text-xs text-neya-muted mt-1">Projets web</p>
            </div>
          </div>

          <div className="card">
            <h3 className="font-heading text-lg mb-3">Synchronisation</h3>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => runSync('photos')} disabled={!!syncing || !status?.configured}
                className="btn-primary text-sm disabled:opacity-40">
                {syncing === 'photos' ? 'Téléchargement…' : 'Récupérer les photos'}
              </button>
              <button type="button" onClick={() => runSync('all')} disabled={!!syncing || !status?.configured}
                className="btn-secondary text-sm disabled:opacity-40">
                {syncing === 'all' ? 'Sync…' : 'Tout synchroniser'}
              </button>
              <button type="button" onClick={() => runSync('products')} disabled={!!syncing || !status?.configured}
                className="btn-secondary text-sm disabled:opacity-40">
                {syncing === 'products' ? 'Sync…' : 'Produits & liens'}
              </button>
              <button type="button" onClick={() => runSync('orders')} disabled={!!syncing || !status?.configured}
                className="btn-secondary text-sm disabled:opacity-40">
                {syncing === 'orders' ? 'Import…' : 'Commandes → projets'}
              </button>
            </div>
            {!status?.configured && (
              <p className="text-xs text-amber-700 mt-3">
                Configurez les clés WooCommerce dans <Link href="/settings?tab=web" className="text-neya-orange underline">Paramètres → Site web</Link>.
              </p>
            )}
          </div>

          <div className="grid lg:grid-cols-2 gap-6">
            <div className="card">
              <h3 className="font-heading text-lg mb-4">Commandes web récentes</h3>
              {orders.length === 0 ? (
                <p className="text-sm text-neya-muted">Aucune commande importée. Cliquez « Commandes → projets ».</p>
              ) : (
                <ul className="space-y-2">
                  {orders.map(o => (
                    <li key={o.id} className="flex items-center justify-between py-2 border-b border-neya-border/50 last:border-0 text-sm">
                      <div>
                        <p className="font-medium">#{o.order_number} — {o.customer_name}</p>
                        <p className="text-xs text-neya-muted">{o.status} · {formatMoney(o.total)}</p>
                      </div>
                      <div className="flex gap-2 shrink-0">
                        {o.project_id && (
                          <Link href={`/projects/${o.project_id}`} className="text-xs text-neya-orange hover:underline">Projet</Link>
                        )}
                        {o.client_id && (
                          <Link href={`/clients/${o.client_id}`} className="text-xs text-neya-muted hover:underline">Client</Link>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="card">
              <h3 className="font-heading text-lg mb-4">Produits liés au site</h3>
              {products.length === 0 ? (
                <p className="text-sm text-neya-muted">Sync produits pour voir les liens.</p>
              ) : (
                <ul className="space-y-3 max-h-80 overflow-y-auto">
                  {products.map(p => (
                    <li key={p.id} className="flex gap-3 items-center">
                      {resolveImageUrl(p.image || p.web_image_url) && (
                        <img src={resolveImageUrl(p.image || p.web_image_url)} alt="" className="w-12 h-12 rounded-lg object-cover border border-neya-border" />
                      )}
                      <div className="min-w-0 flex-1">
                        <Link href={`/standards/${p.id}`} className="text-sm font-medium hover:text-neya-orange truncate block">{p.name}</Link>
                        <p className="text-xs text-neya-muted">{p.sku}{p.web_price ? ` · ${p.web_price}$` : ''}</p>
                      </div>
                      {p.web_permalink && (
                        <a href={p.web_permalink} target="_blank" rel="noopener noreferrer" className="text-xs text-neya-orange shrink-0">↗</a>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      </AppShell>
    </AuthGuard>
  );
}

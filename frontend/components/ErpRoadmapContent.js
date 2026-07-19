'use client';

import { useState } from 'react';
import Link from 'next/link';
import { api } from '../lib/api';

const PRIORITY = [
  { id: 'drive-ai-sort', label: 'IA + tri Google Drive', detail: 'Décrire photos prod, 3D, plans → l\'IA range et catégorise' },
  { id: 'social-posts', label: 'Posts réseaux sociaux', detail: 'Calendrier éditorial FB/IG, brouillons, suivi publications' },
  { id: 'dev-space', label: 'Espace Dev + tâches dev', detail: 'Liste bugs/features ERP, puis IDE/Git intégré' },
];

const BACKLOG = [
  'Visualiseur 3D (GLB/STEP depuis Drive)',
  'IA vocale (micro → commandes)',
  'IA mémoire / RAG complet',
  'Agents spécialisés (compta, fab, marketing…)',
  'Meta Ads + statistiques',
  'Tableau rentabilité temps réel',
  'Bons de commande depuis liste achats',
  'Workflows Gmail (devis depuis courriel)',
  'VPS production (Docker, HTTPS, backups)',
  'Rappels & tâches récurrentes admin',
  'UI fournisseurs & mouvements stock',
  'Modules on/off dans Paramètres',
];

const DONE = [
  'Production, projets, calendrier éditable',
  'Gestion admin (marchés, factures, site, pub/SEO)',
  'Achats atelier — consommables manquants',
  'Drive + Gmail, permissions, assistant IA',
  'Marketplace (ventes canaux) + pôle réseaux sociaux',
];

export default function ErpRoadmapContent() {
  const [busyId, setBusyId] = useState(null);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  async function launch(id) {
    setBusyId(id);
    setMsg('');
    setErr('');
    try {
      const run = await api(`/cursor-agent/roadmap/${id}`, { method: 'POST' });
      setMsg(`Agent #${run.id} lancé — ${run.label}. Suivi dans Paramètres → Agent Cursor.`);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-8">
      <p className="text-sm text-neya-muted max-w-2xl">
        Vision produit NEYA ERP — priorités, backlog et modules déjà livrés. Cliquez « Lancer l&apos;agent » pour démarrer Cursor sur une priorité.
      </p>

      {msg && <div className="text-sm bg-green-50 border border-green-200 text-green-800 px-4 py-3 rounded-xl">{msg}</div>}
      {err && (
        <div className="text-sm bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl">
          {err}{' '}
          <Link href="/settings?tab=cursor" className="underline text-neya-orange">Configurer l&apos;agent</Link>
        </div>
      )}

      <section>
        <p className="text-[10px] uppercase tracking-wide text-neya-orange font-semibold mb-3">Priorité</p>
        <ul className="space-y-2">
          {PRIORITY.map(item => (
            <li key={item.id} className="rounded-2xl border border-neya-border bg-neya-surface/60 px-4 py-3 flex flex-wrap items-start justify-between gap-3 shadow-sm hover:shadow-md transition-shadow">
              <div className="min-w-0 flex-1">
                <p className="font-medium text-neya-ink text-sm">{item.label}</p>
                <p className="text-xs text-neya-muted mt-1">{item.detail}</p>
              </div>
              <button
                type="button"
                disabled={busyId === item.id}
                onClick={() => launch(item.id)}
                className="btn-primary text-xs shrink-0 disabled:opacity-50"
              >
                {busyId === item.id ? 'Lancement…' : 'Lancer l\'agent'}
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <p className="text-[10px] uppercase tracking-wide text-neya-muted font-semibold mb-3">Backlog</p>
        <ul className="grid sm:grid-cols-2 gap-2 text-sm text-neya-muted">
          {BACKLOG.map(item => (
            <li key={item} className="flex gap-2 bg-white border border-neya-border rounded-2xl px-3 py-2 shadow-sm">
              <span className="text-neya-border shrink-0">○</span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <p className="text-[10px] uppercase tracking-wide text-green-700 font-semibold mb-3">Déjà livré</p>
        <ul className="grid sm:grid-cols-2 gap-2 text-sm text-neya-muted">
          {DONE.map(item => (
            <li key={item} className="flex gap-2 bg-green-50/50 border border-green-100 rounded-2xl px-3 py-2 shadow-sm">
              <span className="text-green-600 shrink-0">✓</span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </section>

      <p className="text-xs text-neya-muted border-t border-neya-border pt-4">
        Détail complet : <code className="text-neya-ink bg-neya-cream px-1.5 py-0.5 rounded">docs/CAHIER_DES_CHARGES.md</code>
      </p>
    </div>
  );
}

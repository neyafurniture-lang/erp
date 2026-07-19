'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import AppShell from '../../components/AppShell';
import AuthGuard from '../../components/AuthGuard';
import { api, formatDate } from '../../lib/api';
import { parseMeta, isCatalogProduct } from '../../lib/standards';
import { productImageUrl } from '../../lib/fiche-images';
import { PRODUCTION_STAGES, productionProgress, displayKind, computeProductionStage, resolveProject3dUrl } from '../../lib/production';

const TABS = [
  { id: 'all', label: 'Tout' },
  { id: 'catalog', label: 'Bancs & catalogue' },
  { id: 'custom', label: 'Sur mesure' },
];

function StageBadge({ stage }) {
  const st = PRODUCTION_STAGES[stage] || PRODUCTION_STAGES.queued;
  return (
    <span className={`text-[10px] sm:text-xs font-semibold px-2.5 py-1 rounded-full border ${st.color}`}>
      {st.label}
    </span>
  );
}

function ProductionCard({ item, onAdvance, advancing }) {
  const { done, total, pct } = productionProgress(item.tasks);
  const meta = item.standard_meta ? parseMeta(item.standard_meta) : {};
  const projectMeta = typeof item.meta === 'string' ? JSON.parse(item.meta || '{}') : (item.meta || {});
  const image = item.catalog ? productImageUrl(meta) : null;
  const qty = item.quantity > 1 ? ` ×${item.quantity}` : '';
  const stage = item.stage || computeProductionStage(item.tasks);
  const stageInfo = PRODUCTION_STAGES[stage] || PRODUCTION_STAGES.queued;
  const nextTask = item.tasks?.find(t => t.status !== 'done');

  return (
    <div className="card p-0 overflow-hidden flex flex-col h-full rounded-2xl shadow-sm">
      <div className="relative h-36 bg-neya-surface border-b border-neya-border">
        {image ? (
          <Image src={image} alt="" fill className="object-contain p-2" unoptimized />
        ) : (
          <div className="h-full flex items-center justify-center text-xs text-neya-muted px-4 text-center">
            {(() => {
              const plans = Array.isArray(projectMeta.plans) ? projectMeta.plans : [];
              if (plans.length) return `${plans.length} plan${plans.length > 1 ? 's' : ''} PDF`;
              if (resolveProject3dUrl(projectMeta, item.standard_meta)) return 'Modèle 3D disponible';
              return 'Sans visuel';
            })()}
          </div>
        )}
      </div>
      <div className="p-4 flex flex-col flex-1">
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="min-w-0">
            {item.sku && (
              <span className="text-[10px] font-bold text-neya-orange">{item.sku}{qty}</span>
            )}
            <h3 className="font-display font-semibold text-base sm:text-lg leading-tight text-neya-ink">{item.name}</h3>
          </div>
          <StageBadge stage={stage} />
        </div>

        <p className="text-xs font-medium text-neya-ink/70">{displayKind(item)}</p>
        {item.client_name && <p className="text-xs text-neya-muted mt-0.5">{item.client_name}</p>}
        {nextTask && (
          <p className="text-xs text-neya-ink mt-2">
            <span className="text-neya-muted">Prochaine :</span>{' '}
            <span className="font-medium">{nextTask.title}</span>
          </p>
        )}
        {item.deadline && (
          <p className={`text-xs mt-1 ${new Date(item.deadline) < new Date() ? 'text-neya-error font-medium' : 'text-neya-muted'}`}>
            Deadline {formatDate(item.deadline)}
          </p>
        )}

        {total > 0 && (
          <div className="mt-3">
            <div className="flex justify-between text-xs mb-1">
              <span className="text-neya-muted">Étapes · {stageInfo.label}</span>
              <span className="font-semibold text-neya-ink">{done}/{total} · {pct}%</span>
            </div>
            <div className="h-1.5 bg-neya-cream rounded-full overflow-hidden">
              <div className="h-full bg-neya-orange transition-all" style={{ width: `${pct}%` }} />
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-2 mt-4 mt-auto pt-3">
          {item.status === 'active' && stage !== 'done' && (
            <button
              type="button"
              disabled={advancing}
              onClick={() => onAdvance(item.id)}
              className="btn-primary text-xs sm:text-sm flex-1 min-h-[44px]"
            >
              {advancing ? '…' : 'Étape suivante →'}
            </button>
          )}
          <Link href={`/projects/${item.id}`} className="btn-secondary text-xs sm:text-sm flex-1 min-h-[44px] text-center">
            Vue d&apos;ensemble
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function ProductionPage() {
  const [tab, setTab] = useState('all');
  const [statusFilter, setStatusFilter] = useState('active');
  const [data, setData] = useState({ summary: null, items: [] });
  const [standards, setStandards] = useState([]);
  const [clients, setClients] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [advancingId, setAdvancingId] = useState(null);
  const [form, setForm] = useState({
    kind: 'catalog',
    standard_id: '',
    name: '',
    client_id: '',
    quantity: 1,
    deadline: '',
    notes: '',
    priority: 0,
  });

  const load = () => {
    api(`/production?kind=${tab}&status=${statusFilter}`).then(setData);
  };

  useEffect(() => {
    load();
    api('/standards').then(rows => setStandards(rows.filter(isCatalogProduct)));
    api('/clients').then(setClients);
    window.addEventListener('neya:assistant-action', load);
    return () => window.removeEventListener('neya:assistant-action', load);
  }, [tab, statusFilter]);

  async function create(e) {
    e.preventDefault();
    await api('/production', {
      method: 'POST',
      body: JSON.stringify({
        kind: form.kind,
        standard_id: form.kind === 'catalog' ? Number(form.standard_id) : undefined,
        name: form.kind === 'custom' ? form.name : form.name || undefined,
        client_id: form.client_id || null,
        quantity: Number(form.quantity) || 1,
        deadline: form.deadline || null,
        notes: form.notes || null,
        priority: Number(form.priority) || 0,
      }),
    });
    setShowForm(false);
    setForm({ kind: 'catalog', standard_id: '', name: '', client_id: '', quantity: 1, deadline: '', notes: '', priority: 0 });
    load();
  }

  async function advance(id) {
    setAdvancingId(id);
    try {
      await api(`/production/${id}/advance`, { method: 'POST' });
      load();
    } finally {
      setAdvancingId(null);
    }
  }

  const summary = data.summary || {};

  return (
    <AuthGuard>
      <AppShell title="Production" subtitle="File atelier — bancs catalogue et sur mesure">
        <p className="text-sm text-neya-muted mb-6 lg:hidden">
          Suivez la fabrication des bancs catalogue et de vos meubles sur mesure — étape par étape.
        </p>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          <div className="card py-3">
            <p className="text-[10px] font-medium uppercase tracking-wide text-neya-muted">En cours</p>
            <p className="text-2xl font-semibold text-neya-ink mt-0.5">{summary.total_active ?? '—'}</p>
          </div>
          <div className="card py-3">
            <p className="text-[10px] font-medium uppercase tracking-wide text-neya-muted">Bancs / catalogue</p>
            <p className="text-2xl font-semibold text-neya-ink mt-0.5">{summary.catalog ?? '—'}</p>
          </div>
          <div className="card py-3">
            <p className="text-[10px] font-medium uppercase tracking-wide text-neya-muted">Sur mesure</p>
            <p className="text-2xl font-semibold text-neya-ink mt-0.5">{summary.custom ?? '—'}</p>
          </div>
          <div className="card py-3 col-span-2 sm:col-span-1">
            <p className="text-[10px] font-medium uppercase tracking-wide text-neya-muted">En finition</p>
            <p className="text-2xl font-semibold text-neya-ink mt-0.5">{summary.by_stage?.finition ?? 0}</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
          <div className="flex flex-wrap gap-2">
            {TABS.map(t => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`cf-chip min-h-[36px] ${
                  tab === t.id ? 'cf-chip-active' : ''
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <select
              className="input w-auto text-sm min-h-[44px]"
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
            >
              <option value="active">Actifs</option>
              <option value="done">Terminés</option>
              <option value="all">Tous</option>
            </select>
            <button type="button" onClick={() => setShowForm(!showForm)} className="btn-primary min-h-[44px]">
              + Production
            </button>
          </div>
        </div>

        {showForm && (
          <form onSubmit={create} className="card mb-6 grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="label">Type</label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setForm({ ...form, kind: 'catalog' })}
                  className={`flex-1 py-3 rounded-xl text-sm font-medium border min-h-[44px] ${
                    form.kind === 'catalog' ? 'border-neya-orange bg-neya-orange/10 text-neya-orange' : 'border-neya-border'
                  }`}
                >
                  Banc / fiche catalogue
                </button>
                <button
                  type="button"
                  onClick={() => setForm({ ...form, kind: 'custom' })}
                  className={`flex-1 py-3 rounded-xl text-sm font-medium border min-h-[44px] ${
                    form.kind === 'custom' ? 'border-neya-orange bg-neya-orange/10 text-neya-orange' : 'border-neya-border'
                  }`}
                >
                  Meuble sur mesure
                </button>
              </div>
            </div>

            {form.kind === 'catalog' ? (
              <div className="sm:col-span-2">
                <label className="label">Produit (fiche)</label>
                <select
                  className="input"
                  value={form.standard_id}
                  onChange={e => setForm({ ...form, standard_id: e.target.value })}
                  required
                >
                  <option value="">— Choisir un banc / produit —</option>
                  {standards.map(s => {
                    const m = parseMeta(s.meta);
                    return (
                      <option key={s.id} value={s.id}>
                        {m.sku || s.product_type} — {s.name.replace(/^[A-Z0-9ÕÄÜ]+\s+—\s+/, '')}
                      </option>
                    );
                  })}
                </select>
              </div>
            ) : (
              <div className="sm:col-span-2">
                <label className="label">Nom du meuble</label>
                <input
                  className="input"
                  placeholder="ex. Table à manger chêne 8 places"
                  value={form.name}
                  onChange={e => setForm({ ...form, name: e.target.value })}
                  required
                />
              </div>
            )}

            <div>
              <label className="label">Quantité</label>
              <input
                type="number"
                min={1}
                className="input"
                value={form.quantity}
                onChange={e => setForm({ ...form, quantity: e.target.value })}
              />
            </div>
            <div>
              <label className="label">Client (optionnel)</label>
              <select className="input" value={form.client_id} onChange={e => setForm({ ...form, client_id: e.target.value })}>
                <option value="">— Stock / atelier —</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Deadline</label>
              <input type="date" className="input" value={form.deadline} onChange={e => setForm({ ...form, deadline: e.target.value })} />
            </div>
            <div>
              <label className="label">Priorité</label>
              <select className="input" value={form.priority} onChange={e => setForm({ ...form, priority: e.target.value })}>
                <option value={0}>Normale</option>
                <option value={1}>Haute</option>
                <option value={2}>Urgente</option>
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="label">Notes atelier</label>
              <textarea
                className="input min-h-[80px]"
                placeholder="Bois, finition, instructions…"
                value={form.notes}
                onChange={e => setForm({ ...form, notes: e.target.value })}
              />
            </div>
            <div className="sm:col-span-2 flex gap-2">
              <button type="submit" className="btn-primary">Lancer la production</button>
              <button type="button" onClick={() => setShowForm(false)} className="btn-secondary">Annuler</button>
            </div>
          </form>
        )}

        {data.items?.length === 0 ? (
          <div className="card text-center py-12">
            <p className="text-neya-muted mb-4">Aucune production {statusFilter === 'active' ? 'en cours' : ''}.</p>
            <button type="button" onClick={() => setShowForm(true)} className="btn-primary">
              + Ajouter une production
            </button>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {data.items.map(item => (
              <ProductionCard
                key={item.id}
                item={item}
                onAdvance={advance}
                advancing={advancingId === item.id}
              />
            ))}
          </div>
        )}
      </AppShell>
    </AuthGuard>
  );
}

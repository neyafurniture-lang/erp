'use client';

import { useState } from 'react';
import Link from 'next/link';
import { api } from '../lib/api';
import {
  IMPACT_LABEL,
  ROADMAP_AREAS,
  ROADMAP_BACKLOG,
  ROADMAP_DOING,
  ROADMAP_DONE,
  ROADMAP_NEXT,
} from '../lib/erp-roadmap';

function AreaBadge({ area }) {
  const meta = ROADMAP_AREAS[area] || ROADMAP_AREAS.platform;
  return (
    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${meta.cls}`}>
      {meta.label}
    </span>
  );
}

function ImpactDot({ impact }) {
  if (!impact) return null;
  const color =
    impact === 'high' ? 'bg-neya-orange' : impact === 'medium' ? 'bg-amber-400' : 'bg-neya-border';
  return (
    <span className="inline-flex items-center gap-1.5 text-[10px] text-neya-muted">
      <span className={`w-1.5 h-1.5 rounded-full ${color}`} aria-hidden />
      {IMPACT_LABEL[impact]}
    </span>
  );
}

function RoadmapCard({ item, onLaunch, busy, variant = 'next' }) {
  const isDone = variant === 'done';
  const isDoing = variant === 'doing';

  return (
    <li
      className={`rounded-xl border px-4 py-3 flex flex-col gap-2 ${
        isDone
          ? 'bg-green-50/40 border-green-100'
          : isDoing
            ? 'bg-amber-50/40 border-amber-100'
            : 'bg-white border-neya-border'
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            {isDone ? (
              <span className="text-green-600 text-sm" aria-hidden>✓</span>
            ) : isDoing ? (
              <span className="text-amber-600 text-[10px] font-bold uppercase tracking-wide">En cours</span>
            ) : null}
            <p className="font-medium text-neya-ink text-sm leading-snug">{item.label}</p>
          </div>
          <p className="text-xs text-neya-muted leading-relaxed">{item.detail}</p>
          {item.why && (
            <p className="text-xs text-neya-ink/70 leading-relaxed">
              <span className="font-medium text-neya-ink">Pourquoi : </span>
              {item.why}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2 pt-0.5">
            <AreaBadge area={item.area} />
            <ImpactDot impact={item.impact} />
            {item.href && (
              <Link href={item.href} className="text-[10px] text-neya-orange font-medium hover:underline">
                Ouvrir le module →
              </Link>
            )}
          </div>
        </div>
        {item.launchable && onLaunch && (
          <button
            type="button"
            disabled={busy}
            onClick={() => onLaunch(item.id)}
            className="btn-primary text-xs shrink-0 disabled:opacity-50 min-h-[40px]"
          >
            {busy ? 'Lancement…' : 'Lancer l\'agent'}
          </button>
        )}
      </div>
    </li>
  );
}

function Section({ title, hint, children, tone = 'default' }) {
  const titleCls =
    tone === 'next'
      ? 'text-neya-orange'
      : tone === 'doing'
        ? 'text-amber-700'
        : tone === 'done'
          ? 'text-green-700'
          : 'text-neya-muted';
  return (
    <section>
      <div className="mb-3">
        <p className={`text-[10px] uppercase tracking-wide font-semibold ${titleCls}`}>{title}</p>
        {hint && <p className="text-xs text-neya-muted mt-1">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

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
    <div className="space-y-10 max-w-4xl">
      <div>
        <p className="text-sm text-neya-muted max-w-2xl leading-relaxed">
          Vision produit NEYA ERP — ce qui compte pour l&apos;atelier maintenant, ce qui suit, et ce qui est déjà en prod.
          Les boutons « Lancer l&apos;agent » démarrent Cursor sur une priorité (admin).
        </p>
        <div className="mt-3 flex flex-wrap gap-3 text-[11px] text-neya-muted">
          <span><b className="text-neya-ink">{ROADMAP_NEXT.length}</b> prochaines</span>
          <span>·</span>
          <span><b className="text-neya-ink">{ROADMAP_DOING.length}</b> en cours</span>
          <span>·</span>
          <span><b className="text-neya-ink">{ROADMAP_BACKLOG.length}</b> backlog</span>
          <span>·</span>
          <span><b className="text-neya-ink">{ROADMAP_DONE.length}</b> livrés</span>
        </div>
      </div>

      {msg && (
        <div className="text-sm bg-green-50 border border-green-200 text-green-800 px-4 py-3 rounded-xl">{msg}</div>
      )}
      {err && (
        <div className="text-sm bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl">
          {err}{' '}
          <Link href="/settings?tab=cursor" className="underline text-neya-orange">
            Configurer l&apos;agent
          </Link>
        </div>
      )}

      <Section
        title="Prochaines priorités"
        hint="À lancer en premier — impact atelier fort, agent Cursor prêt."
        tone="next"
      >
        <ul className="space-y-2">
          {ROADMAP_NEXT.map((item) => (
            <RoadmapCard
              key={item.id}
              item={item}
              variant="next"
              busy={busyId === item.id}
              onLaunch={launch}
            />
          ))}
        </ul>
      </Section>

      <Section
        title="En cours"
        hint="Déjà amorcé ou quasi prêt — à finir avant d’empiler du nouveau."
        tone="doing"
      >
        <ul className="space-y-2">
          {ROADMAP_DOING.map((item) => (
            <RoadmapCard key={item.id} item={item} variant="doing" />
          ))}
        </ul>
      </Section>

      <Section
        title="Backlog"
        hint="Idées valides, pas urgentes — classées par impact quand on choisit la suite."
        tone="default"
      >
        <ul className="grid sm:grid-cols-2 gap-2">
          {ROADMAP_BACKLOG.map((item) => (
            <RoadmapCard
              key={item.id}
              item={item}
              variant="backlog"
              busy={busyId === item.id}
              onLaunch={item.launchable ? launch : undefined}
            />
          ))}
        </ul>
      </Section>

      <Section
        title="Déjà livré"
        hint="Modules utilisables en production aujourd’hui."
        tone="done"
      >
        <ul className="grid sm:grid-cols-2 gap-2">
          {ROADMAP_DONE.map((item) => (
            <RoadmapCard key={item.id} item={item} variant="done" />
          ))}
        </ul>
      </Section>

      <p className="text-xs text-neya-muted border-t border-neya-border pt-4 leading-relaxed">
        Design UI : fiches Lovable page par page dans{' '}
        <code className="text-neya-ink bg-neya-cream px-1.5 py-0.5 rounded">docs/cahier-pages-lovable-une-par-une.md</code>
        {' '}· agent Cursor :{' '}
        <Link href="/settings?tab=cursor" className="text-neya-orange hover:underline">
          Paramètres
        </Link>
        .
      </p>
    </div>
  );
}

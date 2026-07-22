'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowUpRight,
  CheckCircle2,
  Clock,
  FileText,
  Hammer,
  Mail,
  TrendingUp,
} from 'lucide-react';
import AppShell from '../components/AppShell';
import AuthGuard from '../components/AuthGuard';
import DashboardLiveTodo from '../components/DashboardLiveTodo';
import { api, formatMoney, formatDate } from '../lib/api';
import { useAuth } from '../lib/auth-context';

function initials(name = '') {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map(p => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase() || '?';
}

function dueLabel(deadline) {
  if (!deadline) return 'Sans échéance';
  const d = new Date(deadline);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(d);
  target.setHours(0, 0, 0, 0);
  const diff = Math.round((target - today) / 86400000);
  if (diff < 0) return `En retard · ${formatDate(deadline)}`;
  if (diff === 0) return "Aujourd'hui";
  if (diff === 1) return 'Demain';
  return d.toLocaleDateString('fr-CA', { weekday: 'short', day: 'numeric', month: 'short' });
}

function agendaType(task) {
  const t = `${task.title || ''} ${task.type || ''}`.toLowerCase();
  if (/livr|delivery/.test(t)) return 'livraison';
  if (/appel|call|zoom|meet/.test(t)) return 'appel';
  return 'atelier';
}

function KpiCard({ label, value, delta, Icon, tone = 'neutral', href }) {
  const toneClass = {
    success: 'cf-kpi-icon-success',
    primary: 'cf-kpi-icon-primary',
    warning: 'cf-kpi-icon-warning',
    neutral: 'cf-kpi-icon-neutral',
  }[tone] || 'cf-kpi-icon-neutral';
  const deltaClass = {
    success: 'text-emerald-700',
    primary: 'text-neya-orange',
    warning: 'text-amber-700',
    neutral: 'text-neya-muted',
  }[tone] || 'text-neya-muted';

  const body = (
    <div className="cf-kpi">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="cf-kpi-label">{label}</p>
          <p className="cf-kpi-value">{value}</p>
          {delta ? <p className={`cf-kpi-delta ${deltaClass}`}>{delta}</p> : null}
        </div>
        <span className={`cf-kpi-icon ${toneClass}`}>
          <Icon className="h-[18px] w-[18px]" strokeWidth={2} />
        </span>
      </div>
    </div>
  );
  return href ? <Link href={href} className="block hover:opacity-95 transition-opacity">{body}</Link> : body;
}

export default function DashboardPage() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [mailPreview, setMailPreview] = useState({ messages: [], unread: 0, urgent: 0 });
  const [error, setError] = useState('');
  const firstName = (user?.name || '').split(/\s+/)[0] || 'Mehdi';

  const load = () => {
    Promise.all([
      api('/dashboard'),
      api('/gmail/inbox-sorted?max=30').catch(() => null),
    ]).then(([d, mail]) => {
      setData(d);
      setError('');
      if (mail) {
        const sections = mail.sections || [];
        const reply = sections.find(s => s.id === 'a_repondre');
        const msgs = (mail.messages || [])
          .filter(m => (m.erpFolder || m.folder || m.section) === 'a_repondre' || m.urgent || m.needsReply)
          .slice(0, 4);
        const fallback = msgs.length
          ? msgs
          : (mail.messages || []).slice(0, 4);
        const urgent = (mail.messages || []).filter(m => m.urgent || /urgent/i.test(m.subject || '')).length;
        setMailPreview({
          messages: fallback,
          unread: reply?.count ?? (mail.messages || []).length,
          urgent,
        });
      }
    }).catch(e => setError(e.message));
  };

  useEffect(() => {
    load();
    const handler = () => load();
    window.addEventListener('neya:assistant-action', handler);
    return () => window.removeEventListener('neya:assistant-action', handler);
  }, []);

  const greeting = useMemo(() => {
    const h = new Date().getHours();
    if (h < 12) return 'Bonjour';
    if (h < 18) return 'Bon après-midi';
    return 'Bonsoir';
  }, []);

  const todayLabel = useMemo(() => new Date().toLocaleDateString('fr-CA', {
    weekday: 'long', day: 'numeric', month: 'long',
  }), []);

  if (!data && !error) {
    return (
      <AuthGuard>
        <AppShell title="Tableau de bord" wide>
          <div className="text-neya-muted py-16 text-center text-sm">Chargement…</div>
        </AppShell>
      </AuthGuard>
    );
  }

  const s = data?.stats || {};
  const projects = (data?.projectCards || data?.activeProjects || []).slice(0, 4);
  const agenda = (data?.tasksToday || [])
    .filter(t => t.start_time)
    .slice(0, 5);
  const agendaFallback = agenda.length
    ? agenda
    : (data?.tasksWeek || []).slice(0, 3);

  const revDelta = s.revenueDeltaPct;
  const revDeltaLabel = revDelta == null
    ? (s.revenueMonth > 0 ? 'Encaissé ce mois' : 'Aucun encaissement')
    : `${revDelta >= 0 ? '+' : ''}${revDelta} %`;

  const nextFree = (() => {
    const withTime = agendaFallback
      .filter(t => t.start_time)
      .map(t => new Date(t.start_time))
      .sort((a, b) => a - b);
    if (!withTime.length) return 'Après-midi libre';
    const last = withTime[withTime.length - 1];
    const next = new Date(last.getTime() + 60 * 60 * 1000);
    return next.toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit' });
  })();

  const statusOk = !(s.overdueProjects > 0);
  const statusText = statusOk
    ? "L'atelier tourne rond aujourd'hui"
    : `${s.overdueProjects} projet(s) en retard — à prioriser`;
  const statusSub = statusOk
    ? (s.dueSoonProjects
      ? `${s.dueSoonProjects} échéance(s) sous 7 jours · ${s.activeProjects ?? 0} projets actifs`
      : `${s.activeProjects ?? 0} projets actifs · rien en retard`)
    : 'Ouvre Production pour réorganiser la file atelier.';

  return (
    <AuthGuard>
      <AppShell
        title={`${greeting} ${firstName} 👋`}
        subtitle={`Voici l'atelier · ${todayLabel}`}
        wide
      >
        {error && (
          <div className="mb-6 text-sm text-red-700 bg-red-50 border border-red-200 px-4 py-3 rounded-xl">{error}</div>
        )}

        {/* Hero mobile */}
        <header className="dash-hero lg:hidden mb-6">
          <div>
            <p className="dash-hero-kicker capitalize">{todayLabel}</p>
            <h1 className="dash-hero-title">
              {greeting}{' '}
              <span className="text-neya-orange">{firstName}</span>
            </h1>
            <p className="dash-hero-sub">
              {mailPreview.urgent > 0 ? `${mailPreview.urgent} mails urgents · ` : ''}
              {s.activeProjects ?? 0} projets actifs
            </p>
          </div>
        </header>

        {/* KPIs Craft Flow */}
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 mb-6">
          <KpiCard
            label="Chiffre du mois"
            value={formatMoney(s.revenueMonth || 0)}
            delta={revDeltaLabel}
            Icon={TrendingUp}
            tone="success"
            href="/finance"
          />
          <KpiCard
            label="Projets actifs"
            value={String(s.activeProjects ?? 0)}
            delta={s.dueSoonProjects ? `${s.dueSoonProjects} en livraison / échéance` : 'File atelier'}
            Icon={Hammer}
            tone="primary"
            href="/production"
          />
          <KpiCard
            label="Mails à traiter"
            value={String(mailPreview.unread || 0)}
            delta={mailPreview.urgent ? `${mailPreview.urgent} urgents` : 'Boîte synchronisée'}
            Icon={Mail}
            tone="warning"
            href="/mail"
          />
          <KpiCard
            label="Devis en attente"
            value={String(s.quotesPending ?? data?.pendingQuotes?.length ?? 0)}
            delta={formatMoney(s.quotesPendingTotal || 0)}
            Icon={FileText}
            tone="neutral"
            href="/invoices"
          />
        </div>

        <DashboardLiveTodo initial={data?.liveTodo} />

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
          {/* Production en cours */}
          <section className="cf-panel lg:col-span-2">
            <div className="cf-panel-head">
              <div>
                <h2 className="cf-panel-title">Production en cours</h2>
                <p className="cf-panel-sub">
                  {projects.length} pièce{projects.length > 1 ? 's' : ''} suivie{projects.length > 1 ? 's' : ''} · file atelier
                </p>
              </div>
              <Link href="/production" className="dash-link inline-flex items-center gap-1">
                Voir tout <ArrowUpRight className="h-3.5 w-3.5" />
              </Link>
            </div>
            {!projects.length ? (
              <p className="dash-empty px-1">Aucun projet actif — crée-en un depuis Projets.</p>
            ) : (
              <ul className="divide-y divide-neya-border/70">
                {projects.map(p => {
                  const pct = Number(p.progress_pct || 0);
                  const label = p.client_name ? `${p.name} — ${p.client_name}` : p.name;
                  return (
                    <li key={p.id}>
                      <Link href={`/projects/${p.id}`} className="cf-prod-row">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-neya-ink truncate">{label}</p>
                          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] text-neya-muted">
                            <span className="inline-flex items-center gap-1">
                              <Hammer className="h-3 w-3" /> {p.current_step || 'En cours'}
                            </span>
                            <span>·</span>
                            <span className="inline-flex items-center gap-1">
                              <Clock className="h-3 w-3" /> {dueLabel(p.deadline)}
                            </span>
                          </p>
                          <div className="cf-prod-bar mt-2.5">
                            <div className="cf-prod-bar-fill" style={{ width: `${Math.min(100, pct)}%` }} />
                          </div>
                        </div>
                        <div className="shrink-0 text-right pl-3">
                          <span className="cf-chip">{p.assigned_to || p.artisan || 'Atelier'}</span>
                          <p className="mt-2 text-sm font-semibold tabular-nums text-neya-ink">{pct}%</p>
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {/* Agenda du jour */}
          <section className="cf-panel">
            <div className="cf-panel-head">
              <div>
                <h2 className="cf-panel-title">Agenda du jour</h2>
                <p className="cf-panel-sub">
                  {agendaFallback.length} rendez-vous · atelier & clients
                </p>
              </div>
              <Link href="/calendar" className="dash-link">Calendrier</Link>
            </div>
            {!agendaFallback.length ? (
              <p className="dash-empty">Rien de planifié — ouvre le calendrier.</p>
            ) : (
              <ul className="space-y-2.5">
                {agendaFallback.map(t => {
                  const time = t.start_time
                    ? new Date(t.start_time).toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit' })
                    : '—';
                  const type = agendaType(t);
                  return (
                    <li key={t.id}>
                      <Link
                        href={t.project_id ? `/projects/${t.project_id}` : '/calendar'}
                        className="cf-agenda-row"
                      >
                        <span className="cf-agenda-time">{time}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium text-neya-ink truncate">
                            {t.title}
                          </span>
                          <span className="cf-agenda-type">{type}</span>
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
            <div className="cf-agenda-free mt-4">
              <CheckCircle2 className="h-3.5 w-3.5 text-neya-orange shrink-0" />
              <span>Prochain créneau libre : {nextFree}</span>
            </div>
          </section>
        </div>

        {/* Courriel — à répondre */}
        <section className="cf-panel mb-6">
          <div className="cf-panel-head">
            <div>
              <h2 className="cf-panel-title">Courriel — à répondre</h2>
              <p className="cf-panel-sub">
                {mailPreview.unread || 0} à traiter · Gmail
              </p>
            </div>
            <Link href="/mail" className="dash-link inline-flex items-center gap-1">
              Ouvrir la boîte <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          </div>
          {!mailPreview.messages?.length ? (
            <p className="dash-empty">Aucun mail à afficher — connecte Gmail ou ouvre la boîte.</p>
          ) : (
            <ul className="divide-y divide-neya-border/70">
              {mailPreview.messages.map(m => {
                const from = m.fromName || m.from || m.sender || 'Inconnu';
                const urgent = m.urgent || /urgent/i.test(m.subject || '');
                const tag = m.erpFolder || m.tag || (urgent ? 'À répondre' : 'Boîte');
                const time = m.date
                  ? new Date(m.date).toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit' })
                  : (m.internalDate
                    ? new Date(Number(m.internalDate)).toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit' })
                    : '');
                return (
                  <li key={m.id}>
                    <Link
                      href={m.id ? `/mail?message=${encodeURIComponent(m.id)}` : '/mail'}
                      className="cf-mail-row"
                    >
                      <span className="cf-mail-avatar" aria-hidden>{initials(from)}</span>
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium text-neya-ink truncate">{from}</span>
                          {urgent && <span className="cf-badge-urgent">Urgent</span>}
                        </span>
                        <span className="block text-[13px] text-neya-muted truncate mt-0.5">
                          {m.subject || '(sans objet)'}
                        </span>
                      </span>
                      <span className="shrink-0 text-right pl-2">
                        <span className="block text-[11px] text-neya-muted tabular-nums">{time}</span>
                        <span className="cf-chip mt-1 inline-block capitalize">{String(tag).replace(/_/g, ' ')}</span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* Status banner */}
        <section className={`cf-status ${statusOk ? 'cf-status-ok' : 'cf-status-warn'}`}>
          <div className="min-w-0 flex-1">
            <p className="font-display font-semibold text-neya-ink">{statusText}</p>
            <p className="text-sm text-neya-muted mt-0.5">{statusSub}</p>
          </div>
          <Link href={statusOk ? '/projects' : '/production'} className="btn-secondary text-sm shrink-0">
            {statusOk ? 'Voir les projets' : 'Ouvrir Production'}
          </Link>
        </section>
      </AppShell>
    </AuthGuard>
  );
}

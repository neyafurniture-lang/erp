'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  ArrowLeft,
  Link2,
  CheckCircle2,
  Circle,
  ChevronRight,
  RefreshCw,
} from 'lucide-react';
import AppShell from '../../../components/AppShell';
import AuthGuard from '../../../components/AuthGuard';
import { api, formatMoney, formatDate } from '../../../lib/api';

function YearReviewInner() {
  const searchParams = useSearchParams();
  const currentYear = new Date().getFullYear();
  const initialYear = Number(searchParams.get('year')) || currentYear;
  const [year, setYear] = useState(initialYear);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [linking, setLinking] = useState(false);
  const [linkMsg, setLinkMsg] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const r = await api(`/projects/year-review?year=${year}`);
      setData(r);
    } catch (e) {
      setErr(e.message || 'Chargement impossible');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [year]);

  useEffect(() => {
    load();
  }, [load]);

  async function toggleDone(project) {
    setBusyId(project.id);
    try {
      await api(`/projects/${project.id}/toggle-done`, { method: 'POST' });
      await load();
    } catch (e) {
      window.alert(e.message || 'Impossible de mettre à jour');
    } finally {
      setBusyId(null);
    }
  }

  async function linkOrphans() {
    setLinking(true);
    setLinkMsg('');
    try {
      const r = await api('/projects/year-review/link-orphans', {
        method: 'POST',
        body: JSON.stringify({ year }),
      });
      setLinkMsg(
        r.linked
          ? `${r.linked} facture(s) liée(s) au projet du même client.`
          : 'Aucune facture orpheline à lier automatiquement (plusieurs projets ou aucun pour le client).'
      );
      await load();
    } catch (e) {
      setLinkMsg(e.message || 'Liaison impossible');
    } finally {
      setLinking(false);
    }
  }

  const summary = data?.summary;
  const company = data?.company;
  const projects = data?.projects || [];
  const orphans = data?.orphan_invoices || [];

  return (
    <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-3">
            <Link href="/projects" className="inline-flex items-center gap-1.5 text-sm text-neya-muted hover:text-neya-orange">
              <ArrowLeft className="h-4 w-4" /> Projets
            </Link>
            <label className="text-xs text-neya-muted flex items-center gap-2 ml-auto">
              Année
              <select
                value={year}
                onChange={e => setYear(Number(e.target.value))}
                className="rounded-lg border border-neya-border bg-white px-2 py-1.5 text-sm text-neya-ink"
              >
                {[currentYear, currentYear - 1, currentYear - 2].map(y => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={load}
              disabled={loading}
              className="btn-secondary text-sm gap-1.5"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
              Actualiser
            </button>
            <Link href="/finance" className="btn-ghost text-sm">
              Finance P&amp;L →
            </Link>
          </div>

          <p className="text-sm text-neya-muted max-w-2xl">
            Ici on regarde les <strong className="font-medium text-neya-ink">projets {year}</strong> et
            les factures que les clients doivent te payer (encaissements) — pas les factures
            fournisseurs à payer toi-même.
          </p>

          {err && (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>
          )}

          {summary && (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-2xl border border-neya-border bg-white p-4">
                <p className="text-[11px] uppercase tracking-wide text-neya-muted">Projets {year}</p>
                <p className="mt-1 font-display text-2xl font-semibold text-neya-ink tabular-nums">
                  {summary.projects_count}
                </p>
                <p className="text-xs text-neya-muted mt-1">
                  {summary.active_count} ouverts · {summary.done_count} terminés
                </p>
              </div>
              <div className="rounded-2xl border border-neya-border bg-white p-4">
                <p className="text-[11px] uppercase tracking-wide text-neya-muted">Facturé (liés projets)</p>
                <p className="mt-1 font-display text-2xl font-semibold text-neya-ink tabular-nums">
                  {formatMoney(summary.invoiced_total)}
                </p>
                <p className="text-xs text-neya-muted mt-1">
                  {summary.with_invoice} avec facture · {summary.without_invoice} sans
                </p>
              </div>
              <div className="rounded-2xl border border-neya-border bg-white p-4">
                <p className="text-[11px] uppercase tracking-wide text-neya-muted">Encaissé (liés)</p>
                <p className="mt-1 font-display text-2xl font-semibold text-neya-ink tabular-nums">
                  {formatMoney(summary.collected_total)}
                </p>
                <p className="text-xs text-neya-muted mt-1">
                  Reste dû {formatMoney(summary.unpaid_total)}
                </p>
              </div>
              <div className="rounded-2xl border border-neya-border bg-white p-4">
                <p className="text-[11px] uppercase tracking-wide text-neya-muted">Toutes factures {year}</p>
                <p className="mt-1 font-display text-2xl font-semibold text-neya-ink tabular-nums">
                  {formatMoney(company?.invoiced_total || 0)}
                </p>
                <p className="text-xs text-neya-muted mt-1">
                  Encaissé {formatMoney(company?.collected_total || 0)}
                  {company?.orphan_count ? ` · ${company.orphan_count} sans projet` : ''}
                </p>
              </div>
            </div>
          )}

          {!!orphans.length && (
            <section className="rounded-2xl border border-amber-200/80 bg-amber-50/40 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="font-display text-base font-semibold text-neya-ink">
                    Factures sans projet ({orphans.length})
                  </h2>
                  <p className="text-sm text-neya-muted mt-0.5">
                    Lie automatiquement quand le client n’a qu’un seul projet candidat.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={linkOrphans}
                  disabled={linking}
                  className="btn-primary text-sm gap-1.5"
                >
                  <Link2 className="h-3.5 w-3.5" />
                  {linking ? 'Liaison…' : 'Lier les factures'}
                </button>
              </div>
              {linkMsg && <p className="mt-2 text-sm text-neya-ink">{linkMsg}</p>}
              <ul className="mt-3 divide-y divide-neya-border/60 max-h-48 overflow-y-auto">
                {orphans.slice(0, 12).map(inv => (
                  <li key={inv.id} className="flex items-center gap-3 py-2 text-sm">
                    <span className="font-medium text-neya-ink truncate min-w-0 flex-1">
                      {inv.invoice_number || `#${inv.id}`}
                      <span className="text-neya-muted font-normal">
                        {' · '}{inv.client_name || 'Sans client'}
                      </span>
                    </span>
                    <span className="tabular-nums text-neya-ink shrink-0">{formatMoney(inv.total)}</span>
                    <Link href={`/invoices/${inv.id}`} className="text-neya-orange text-xs shrink-0">
                      Ouvrir
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section>
            <h2 className="font-display text-lg font-semibold text-neya-ink mb-3">
              Projets {year}
            </h2>
            {loading && !data ? (
              <p className="text-sm text-neya-muted">Chargement…</p>
            ) : !projects.length ? (
              <p className="text-sm text-neya-muted">Aucun projet trouvé pour {year}.</p>
            ) : (
              <ul className="divide-y divide-neya-border rounded-2xl border border-neya-border bg-white overflow-hidden">
                {projects.map(p => {
                  const isDone = p.status === 'done';
                  return (
                    <li key={p.id} className="flex flex-wrap items-center gap-3 px-4 py-3 hover:bg-neya-surface/40">
                      <span className="shrink-0 text-neya-muted" aria-hidden>
                        {isDone
                          ? <CheckCircle2 className="h-4 w-4 text-neya-success" />
                          : <Circle className="h-4 w-4" />}
                      </span>
                      <div className="min-w-0 flex-1">
                        <Link
                          href={`/projects/${p.id}`}
                          className="text-sm font-medium text-neya-ink hover:text-neya-orange"
                        >
                          {p.name}
                        </Link>
                        <p className="text-[12px] text-neya-muted truncate">
                          {p.client_name || 'Sans client'}
                          {p.deadline ? ` · échéance ${formatDate(p.deadline)}` : ''}
                          {Number(p.invoice_count)
                            ? ` · ${p.invoice_count} facture(s)`
                            : ' · aucune facture liée'}
                        </p>
                      </div>
                      <div className="text-right text-xs shrink-0 tabular-nums">
                        <p className="text-neya-ink font-medium">{formatMoney(p.invoiced_total)}</p>
                        <p className="text-neya-muted">
                          encaissé {formatMoney(p.collected_total)}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => toggleDone(p)}
                        disabled={busyId === p.id}
                        className={`text-xs font-semibold px-2.5 py-1.5 rounded-lg border shrink-0 disabled:opacity-50 ${
                          isDone
                            ? 'bg-white border-neya-border text-neya-muted hover:border-neya-orange hover:text-neya-orange'
                            : 'bg-neya-orange text-white border-neya-orange hover:bg-neya-ink'
                        }`}
                      >
                        {busyId === p.id ? '…' : isDone ? 'Rouvrir' : 'Terminer'}
                      </button>
                      <Link
                        href={`/projects/${p.id}`}
                        className="text-neya-orange shrink-0"
                        aria-label="Ouvrir le projet"
                      >
                        <ChevronRight className="h-4 w-4" />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
  );
}

export default function ProjectsYearReviewPage() {
  return (
    <AuthGuard>
      <AppShell
        title="Revue projets"
        subtitle="Factures liées · totaux encaissés · marquer terminé"
        wide
      >
        <Suspense fallback={<p className="text-sm text-neya-muted">Chargement…</p>}>
          <YearReviewInner />
        </Suspense>
      </AppShell>
    </AuthGuard>
  );
}

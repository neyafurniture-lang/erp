'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Banknote,
  Check,
  ChevronLeft,
  ChevronRight,
  Plus,
  RefreshCw,
  ListChecks,
} from 'lucide-react';
import AppShell from '../../components/AppShell';
import AuthGuard from '../../components/AuthGuard';
import { api, formatMoney } from '../../lib/api';

const STATUS_LABEL = {
  open: 'Ouverte',
  review: 'En révision',
  paid: 'Payée',
};

function Kpi({ label, value, hint }) {
  return (
    <div className="rounded-2xl border border-neya-border bg-white px-4 py-3 shadow-sm">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-neya-muted">{label}</p>
      <p className="mt-1 font-display text-2xl font-semibold tabular-nums text-neya-ink">{value}</p>
      {hint ? <p className="mt-0.5 text-[11px] text-neya-muted">{hint}</p> : null}
    </div>
  );
}

export default function PaiePage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState('');
  const [newTodo, setNewTodo] = useState('');
  const [editLine, setEditLine] = useState(null);

  const load = useCallback(async (start, end) => {
    setLoading(true);
    setErr('');
    try {
      const qs = start && end
        ? `?start=${start}&end=${end}`
        : '';
      const d = await api(`/payroll/period${qs}`);
      setData(d);
    } catch (e) {
      setErr(e.message || 'Impossible de charger la paie');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function navigate(dir) {
    if (!data?.period?.start_date) return;
    setBusy('nav');
    try {
      const d = await api(`/payroll/period/navigate?start=${data.period.start_date}&dir=${dir}`);
      setData(d);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy('');
    }
  }

  async function setStatus(status) {
    if (!data?.period?.id) return;
    setBusy('status');
    setMsg('');
    try {
      await api(`/payroll/periods/${data.period.id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      setMsg(status === 'paid' ? 'Période marquée payée.' : `Statut : ${STATUS_LABEL[status] || status}`);
      await load(data.period.start_date, data.period.end_date);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy('');
    }
  }

  async function toggleTodo(todo) {
    try {
      await api(`/payroll/todos/${todo.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ done: !todo.done }),
      });
      await load(data.period.start_date, data.period.end_date);
    } catch (e) {
      setErr(e.message);
    }
  }

  async function addTodo(e) {
    e.preventDefault();
    if (!newTodo.trim() || !data?.period?.id) return;
    setBusy('todo');
    try {
      await api('/payroll/todos', {
        method: 'POST',
        body: JSON.stringify({ period_id: data.period.id, title: newTodo.trim() }),
      });
      setNewTodo('');
      await load(data.period.start_date, data.period.end_date);
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setBusy('');
    }
  }

  async function saveLine(e) {
    e.preventDefault();
    if (!editLine || !data?.period?.id) return;
    setBusy('line');
    try {
      await api(`/payroll/lines/${data.period.id}/${editLine.employee_id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          deductions: Number(editLine.deductions) || 0,
          advances: Number(editLine.advances) || 0,
          notes: editLine.notes || null,
        }),
      });
      setEditLine(null);
      setMsg('Ligne mise à jour.');
      await load(data.period.start_date, data.period.end_date);
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setBusy('');
    }
  }

  const totals = data?.totals;
  const period = data?.period;

  return (
    <AuthGuard>
      <AppShell
        title="Paie"
        subtitle="Montants à verser, heures et tâches — style QuickBooks"
        wide
      >
        {err && (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{err}</div>
        )}
        {msg && (
          <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">{msg}</div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
          <div className="flex items-center gap-2">
            <button type="button" className="btn-secondary min-h-[36px] px-2" onClick={() => navigate(-1)} disabled={!!busy}>
              <ChevronLeft className="h-4 w-4" />
            </button>
            <div>
              <p className="font-display text-lg font-semibold text-neya-ink">
                {period?.label || 'Période'}
              </p>
              <p className="text-xs text-neya-muted">
                {period?.start_date} → {period?.end_date}
                {' · '}
                <span className={`font-medium ${
                  period?.status === 'paid' ? 'text-emerald-700' : 'text-neya-orange'
                }`}>
                  {STATUS_LABEL[period?.status] || period?.status || '—'}
                </span>
              </p>
            </div>
            <button type="button" className="btn-secondary min-h-[36px] px-2" onClick={() => navigate(1)} disabled={!!busy}>
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-secondary text-sm gap-1.5"
              onClick={() => load(period?.start_date, period?.end_date)}
              disabled={loading}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
              Recalculer
            </button>
            {period?.status !== 'paid' && (
              <>
                <button type="button" className="btn-secondary text-sm" disabled={!!busy} onClick={() => setStatus('review')}>
                  En révision
                </button>
                <button type="button" className="btn-primary text-sm gap-1.5" disabled={!!busy} onClick={() => setStatus('paid')}>
                  <Banknote className="h-4 w-4" />
                  Marquer payée
                </button>
              </>
            )}
            {period?.status === 'paid' && (
              <button type="button" className="btn-secondary text-sm" disabled={!!busy} onClick={() => setStatus('open')}>
                Rouvrir
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
          <Kpi label="Heures travaillées" value={loading ? '…' : `${totals?.hours_worked ?? 0} h`} hint={`Planifié : ${totals?.hours_scheduled ?? 0} h`} />
          <Kpi label="Brut" value={loading ? '…' : formatMoney(totals?.gross || 0)} />
          <Kpi label="Déductions + avances" value={loading ? '…' : formatMoney((totals?.deductions || 0) + (totals?.advances || 0))} />
          <Kpi label="Net à verser" value={loading ? '…' : formatMoney(totals?.net || 0)} hint="Somme des nets employés" />
        </div>

        <div className="grid lg:grid-cols-3 gap-5">
          <section className="lg:col-span-2 space-y-3">
            <h2 className="font-display text-base font-semibold text-neya-ink">Détail par employé</h2>
            {loading ? (
              <p className="text-sm text-neya-muted">Calcul…</p>
            ) : !(data?.lines || []).length ? (
              <p className="text-sm text-neya-muted rounded-xl border border-dashed border-neya-border px-4 py-6">
                Aucun employé actif. Ajoutez Olive / Mehdi dans Équipe.
              </p>
            ) : (
              <ul className="space-y-2">
                {data.lines.map(line => (
                  <li key={line.employee_id} className="rounded-2xl border border-neya-border bg-white px-4 py-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span
                            className="w-2.5 h-2.5 rounded-full shrink-0"
                            style={{ background: line.employee_color || '#D86B30' }}
                            aria-hidden
                          />
                          <p className="font-semibold text-neya-ink">{line.employee_name}</p>
                          <span className="text-[11px] text-neya-muted">{line.employee_role}</span>
                        </div>
                        <p className="text-xs text-neya-muted mt-1">
                          {line.hours_worked} h × {formatMoney(line.hourly_rate)}/h
                          {line.source_breakdown && (
                            <span className="ml-1">
                              (carnet {line.source_breakdown.hours_logbook || 0}
                              {' · '}pointage {line.source_breakdown.hours_time_entries || 0}
                              {' · '}shifts {line.source_breakdown.hours_scheduled_shifts || 0})
                            </span>
                          )}
                        </p>
                        {(line.deductions > 0 || line.advances > 0) && (
                          <p className="text-xs text-neya-muted mt-0.5">
                            Déductions {formatMoney(line.deductions)} · Avances {formatMoney(line.advances)}
                          </p>
                        )}
                        {line.notes && <p className="text-xs text-neya-muted mt-0.5">{line.notes}</p>}
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-[11px] text-neya-muted">Net</p>
                        <p className="font-display text-xl font-semibold tabular-nums text-neya-ink">
                          {formatMoney(line.net)}
                        </p>
                        <p className="text-[11px] text-neya-muted tabular-nums">Brut {formatMoney(line.gross)}</p>
                        <button
                          type="button"
                          className="text-xs text-neya-orange hover:underline mt-1"
                          onClick={() => setEditLine({
                            employee_id: line.employee_id,
                            employee_name: line.employee_name,
                            deductions: line.deductions,
                            advances: line.advances,
                            notes: line.notes || '',
                          })}
                        >
                          Ajuster
                        </button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {data?.hint && (
              <p className="text-[11px] text-neya-muted">{data.hint}</p>
            )}
          </section>

          <section className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-display text-base font-semibold text-neya-ink inline-flex items-center gap-1.5">
                <ListChecks className="h-4 w-4 text-neya-orange" />
                À faire
              </h2>
              <span className="text-xs text-neya-muted tabular-nums">
                {data?.progress?.todos_done ?? 0}/{data?.progress?.todos_total ?? 0}
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-neya-surface overflow-hidden">
              <div
                className="h-full rounded-full bg-neya-orange transition-all"
                style={{ width: `${data?.progress?.pct || 0}%` }}
              />
            </div>
            <ul className="space-y-1.5">
              {(data?.todos || []).map(todo => (
                <li key={todo.id}>
                  <label className="flex items-start gap-2.5 rounded-xl border border-neya-border bg-white px-3 py-2.5 cursor-pointer hover:border-neya-orange/40">
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={!!todo.done}
                      onChange={() => toggleTodo(todo)}
                    />
                    <span className={`text-sm flex-1 ${todo.done ? 'text-neya-muted line-through' : 'text-neya-ink'}`}>
                      {todo.title}
                      {todo.link_href && (
                        <Link
                          href={todo.link_href}
                          className="block text-[11px] text-neya-orange hover:underline mt-0.5 no-underline"
                          onClick={e => e.stopPropagation()}
                        >
                          Ouvrir →
                        </Link>
                      )}
                    </span>
                    {todo.done && <Check className="h-4 w-4 text-emerald-600 shrink-0" />}
                  </label>
                </li>
              ))}
            </ul>
            <form onSubmit={addTodo} className="flex gap-2">
              <input
                className="input text-sm"
                placeholder="Nouvelle tâche…"
                value={newTodo}
                onChange={e => setNewTodo(e.target.value)}
              />
              <button type="submit" className="btn-secondary px-3" disabled={busy === 'todo' || !newTodo.trim()}>
                <Plus className="h-4 w-4" />
              </button>
            </form>
            <p className="text-[11px] text-neya-muted">
              Après paiement : créez une dépense catégorie Admin / salaires dans{' '}
              <Link href="/expenses" className="text-neya-orange hover:underline">Dépenses</Link>
              {' · '}
              <Link href="/finance" className="text-neya-orange hover:underline">Finance</Link>
            </p>
          </section>
        </div>

        {editLine && (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
            <button type="button" aria-label="Fermer" className="absolute inset-0 bg-black/40" onClick={() => setEditLine(null)} />
            <form
              onSubmit={saveLine}
              className="relative bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl border border-neya-border shadow-xl p-5 space-y-4"
            >
              <h3 className="font-heading text-lg">Ajuster — {editLine.employee_name}</h3>
              <div>
                <label className="label">Déductions ($)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  className="input"
                  value={editLine.deductions}
                  onChange={e => setEditLine({ ...editLine, deductions: e.target.value })}
                />
              </div>
              <div>
                <label className="label">Avances ($)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  className="input"
                  value={editLine.advances}
                  onChange={e => setEditLine({ ...editLine, advances: e.target.value })}
                />
              </div>
              <div>
                <label className="label">Notes</label>
                <textarea
                  className="input min-h-[72px]"
                  value={editLine.notes}
                  onChange={e => setEditLine({ ...editLine, notes: e.target.value })}
                  placeholder="Ex. avance Interac du 12…"
                />
              </div>
              <div className="flex gap-2">
                <button type="submit" className="btn-primary flex-1" disabled={busy === 'line'}>
                  {busy === 'line' ? '…' : 'Enregistrer'}
                </button>
                <button type="button" className="btn-secondary" onClick={() => setEditLine(null)}>Annuler</button>
              </div>
            </form>
          </div>
        )}
      </AppShell>
    </AuthGuard>
  );
}

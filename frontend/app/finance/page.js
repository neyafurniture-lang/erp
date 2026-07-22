'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import AppShell from '../../components/AppShell';
import AuthGuard from '../../components/AuthGuard';
import FinanceSessionGate from '../../components/FinanceSessionGate';
import { api, formatMoney } from '../../lib/api';
import { useAuth } from '../../lib/auth-context';
import FinanceSyncPanel from '../../components/FinanceSyncPanel';

const CATEGORY_LABELS = {
  materiaux: 'Matériaux',
  outils: 'Outils',
  transport: 'Transport',
  atelier: 'Atelier',
  admin: 'Admin',
  autre: 'Autre',
};

function moneyTone(n) {
  if (n > 0) return 'text-emerald-700';
  if (n < 0) return 'text-red-700';
  return 'text-neya-ink';
}

function Kpi({ label, value, hint, tone }) {
  return (
    <div className="card rounded-2xl p-4">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-neya-muted">{label}</p>
      <p className={`mt-1 font-display text-2xl font-semibold tabular-nums ${tone || 'text-neya-ink'}`}>{value}</p>
      {hint ? <p className="mt-1 text-xs text-neya-muted">{hint}</p> : null}
    </div>
  );
}

function BarRow({ label, value, max, format = formatMoney }) {
  const pct = max > 0 ? Math.min(100, Math.round((Math.abs(value) / max) * 100)) : 0;
  return (
    <div className="space-y-1">
      <div className="flex justify-between gap-2 text-sm">
        <span className="text-neya-ink truncate">{label}</span>
        <span className="tabular-nums text-neya-muted shrink-0">{format(value)}</span>
      </div>
      <div className="h-1.5 rounded-full bg-neya-surface overflow-hidden">
        <div className="h-full rounded-full bg-neya-orange/80" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export default function FinancePage() {
  return (
    <AuthGuard>
      <AppShell
        title="Finance"
        subtitle="Gestionnaire total — code requis · bénéfice, dépenses et temps"
      >
        <FinanceSessionGate>
          <FinanceDashboard />
        </FinanceSessionGate>
      </AppShell>
    </AuthGuard>
  );
}

function FinanceDashboard() {
  const { user } = useAuth();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [basis, setBasis] = useState('collected'); // collected | invoiced
  const [meName, setMeName] = useState(user?.employee_name || 'Mehdi');
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth() + 1);

  useEffect(() => {
    if (user?.employee_name) setMeName(user.employee_name);
  }, [user?.employee_name]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErr('');
    const q = new URLSearchParams({ year: String(year), me: meName || 'Mehdi' });
    api(`/analytics/monthly-pnl?${q}`)
      .then(d => {
        if (cancelled) return;
        setData(d);
        setLoading(false);
      })
      .catch(e => {
        if (cancelled) return;
        setErr(e.message || 'Impossible de charger le P&L');
        setData(null);
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [year, meName]);

  const totals = data?.totals;
  const month = useMemo(
    () => data?.months?.find(m => m.month === selectedMonth) || null,
    [data, selectedMonth]
  );

  const profitKey = basis === 'invoiced' ? 'profit_invoiced' : 'profit_collected';
  const revenueKey = basis === 'invoiced' ? 'revenue_invoiced' : 'revenue_collected';
  const profitYtd = totals?.[profitKey] ?? 0;
  const revenueYtd = totals?.[revenueKey] ?? 0;

  const activeMonths = (data?.months || []).filter(m => (
    m.revenue_invoiced || m.revenue_collected || m.expenses_total || m.labor_cost || m.revenue_draft
  ));
  const maxExpense = Math.max(0, ...Object.values(month?.expenses_by_category || {}));
  const maxLabor = Math.max(0, ...Object.values(month?.labor_by_person || {}).map(p => p.hours));

  const years = [now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1];

  return (
    <>
        <FinanceSyncPanel
          year={year}
          onDone={() => {
            const q = new URLSearchParams({ year: String(year), me: meName || 'Mehdi' });
            api(`/analytics/monthly-pnl?${q}`).then(setData).catch(() => {});
          }}
        />

        <p className="mb-6 text-sm text-neya-muted">
          Pour revoir les projets {year}, lier les factures et marquer terminé :{' '}
          <Link href={`/projects/revue?year=${year}`} className="text-neya-orange hover:underline">
            Revue projets {year} →
          </Link>
        </p>
        <div className="flex flex-wrap items-end gap-3 mb-6">
          <div>
            <label className="label">Année</label>
            <select className="input min-w-[120px]" value={year} onChange={e => setYear(Number(e.target.value))}>
              {years.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Base bénéfice</label>
            <div className="flex rounded-xl border border-neya-border overflow-hidden">
              <button
                type="button"
                className={`px-3 py-2 text-sm ${basis === 'collected' ? 'bg-neya-ink text-white' : 'bg-white text-neya-muted'}`}
                onClick={() => setBasis('collected')}
              >
                Encaissé
              </button>
              <button
                type="button"
                className={`px-3 py-2 text-sm ${basis === 'invoiced' ? 'bg-neya-ink text-white' : 'bg-white text-neya-muted'}`}
                onClick={() => setBasis('invoiced')}
              >
                Facturé
              </button>
            </div>
          </div>
          <div>
            <label className="label">Mon tracking</label>
            <select
              className="input min-w-[140px]"
              value={meName}
              onChange={e => setMeName(e.target.value)}
            >
              {(data?.employees?.length
                ? data.employees.map(e => e.name)
                : ['Mehdi', 'Olive']
              ).map(name => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
          </div>
          <div className="flex gap-2 ml-auto">
            <Link href="/expenses" className="btn-secondary text-sm">Dépenses</Link>
            <Link href="/invoices" className="btn-secondary text-sm">Factures</Link>
          </div>
        </div>

        {loading && <p className="text-sm text-neya-muted">Chargement du P&L…</p>}
        {err && (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {err}
          </div>
        )}

        {data && totals && (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-6">
              <Kpi
                label={basis === 'invoiced' ? 'Facturé YTD' : 'Encaissé YTD'}
                value={formatMoney(revenueYtd)}
                hint={basis === 'invoiced' && totals.revenue_draft
                  ? `+ ${formatMoney(totals.revenue_draft)} en brouillon`
                  : undefined}
              />
              <Kpi label="Dépenses YTD" value={formatMoney(totals.expenses_total)} />
              <Kpi
                label="Main-d’œuvre YTD"
                value={formatMoney(totals.labor_cost)}
                hint={`${totals.labor_hours} h`}
              />
              <Kpi
                label="Bénéfice YTD"
                value={formatMoney(profitYtd)}
                tone={moneyTone(profitYtd)}
                hint={`${basis === 'invoiced' ? 'Facturé' : 'Encaissé'} − dépenses − MO`}
              />
              <Kpi
                label={`Moi · ${data.me.name}`}
                value={`${data.me.hours} h`}
                hint={`${formatMoney(data.me.cost)} · ${formatMoney(data.me.hourly_rate)}/h`}
                tone="text-neya-orange"
              />
            </div>

            <div className="cf-table-wrap overflow-x-auto mb-6">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className="px-3 py-3 text-left">Mois</th>
                    <th className="px-3 py-3 text-right">Revenus</th>
                    <th className="px-3 py-3 text-right">Dépenses</th>
                    <th className="px-3 py-3 text-right">MO</th>
                    <th className="px-3 py-3 text-right">Bénéfice</th>
                    <th className="px-3 py-3 text-right">Moi (h)</th>
                  </tr>
                </thead>
                <tbody>
                  {(activeMonths.length ? activeMonths : data.months).map(m => {
                    const profit = m[profitKey];
                    const revenue = m[revenueKey];
                    const selected = m.month === selectedMonth;
                    return (
                      <tr
                        key={m.month}
                        className={`cursor-pointer border-t border-neya-border/60 ${selected ? 'bg-neya-orange/10' : 'hover:bg-neya-surface/80'}`}
                        onClick={() => setSelectedMonth(m.month)}
                      >
                        <td className="px-3 py-2.5 font-medium text-neya-ink">{m.label}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{formatMoney(revenue)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{formatMoney(m.expenses_total)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">
                          {formatMoney(m.labor_cost)}
                          <span className="block text-[10px] text-neya-muted">{m.labor_hours} h</span>
                        </td>
                        <td className={`px-3 py-2.5 text-right tabular-nums font-medium ${moneyTone(profit)}`}>
                          {formatMoney(profit)}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-neya-orange">
                          {m.me_hours || '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-neya-ink/20 bg-neya-surface/50 font-semibold">
                    <td className="px-3 py-3">Total {year}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{formatMoney(revenueYtd)}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{formatMoney(totals.expenses_total)}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{formatMoney(totals.labor_cost)}</td>
                    <td className={`px-3 py-3 text-right tabular-nums ${moneyTone(profitYtd)}`}>{formatMoney(profitYtd)}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-neya-orange">{totals.me_hours} h</td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {month && (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-8">
                <div className="card rounded-2xl p-5">
                  <h3 className="font-display text-lg font-semibold text-neya-ink mb-1">
                    {month.label} {year}
                  </h3>
                  <p className="text-xs text-neya-muted mb-4">
                    Détail du mois sélectionné
                  </p>
                  <dl className="space-y-2 text-sm">
                    <div className="flex justify-between gap-2">
                      <dt className="text-neya-muted">Facturé (hors brouillon)</dt>
                      <dd className="tabular-nums">{formatMoney(month.revenue_invoiced)}</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-neya-muted">Brouillons</dt>
                      <dd className="tabular-nums">{formatMoney(month.revenue_draft)}</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-neya-muted">Encaissé</dt>
                      <dd className="tabular-nums">{formatMoney(month.revenue_collected)}</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-neya-muted">Dépenses</dt>
                      <dd className="tabular-nums">{formatMoney(month.expenses_total)}</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-neya-muted">Main-d’œuvre</dt>
                      <dd className="tabular-nums">{formatMoney(month.labor_cost)} ({month.labor_hours} h)</dd>
                    </div>
                    <div className="flex justify-between gap-2 pt-2 border-t border-neya-border font-semibold">
                      <dt>Bénéfice ({basis === 'invoiced' ? 'facturé' : 'encaissé'})</dt>
                      <dd className={`tabular-nums ${moneyTone(month[profitKey])}`}>{formatMoney(month[profitKey])}</dd>
                    </div>
                    <div className="flex justify-between gap-2 text-neya-orange font-medium">
                      <dt>{data.me.name} — mon temps</dt>
                      <dd className="tabular-nums">{month.me_hours} h · {formatMoney(month.me_cost)}</dd>
                    </div>
                  </dl>
                </div>

                <div className="card rounded-2xl p-5">
                  <h3 className="font-display text-base font-semibold text-neya-ink mb-3">Dépenses par catégorie</h3>
                  {Object.keys(month.expenses_by_category || {}).length === 0 ? (
                    <p className="text-sm text-neya-muted">Aucune dépense ce mois.</p>
                  ) : (
                    <div className="space-y-3">
                      {Object.entries(month.expenses_by_category)
                        .sort((a, b) => b[1] - a[1])
                        .map(([cat, amt]) => (
                          <BarRow
                            key={cat}
                            label={CATEGORY_LABELS[cat] || cat}
                            value={amt}
                            max={maxExpense}
                          />
                        ))}
                    </div>
                  )}
                </div>

                <div className="card rounded-2xl p-5">
                  <h3 className="font-display text-base font-semibold text-neya-ink mb-3">Heures par personne</h3>
                  {Object.keys(month.labor_by_person || {}).length === 0 ? (
                    <p className="text-sm text-neya-muted">
                      Aucune heure (carnet projets / pointages) ce mois.
                    </p>
                  ) : (
                    <div className="space-y-3">
                      {Object.entries(month.labor_by_person)
                        .sort((a, b) => b[1].hours - a[1].hours)
                        .map(([person, info]) => (
                          <div key={person}>
                            <BarRow
                              label={person}
                              value={info.hours}
                              max={maxLabor}
                              format={v => `${v} h`}
                            />
                            <p className="text-[11px] text-neya-muted mt-0.5 tabular-nums">
                              {formatMoney(info.cost)} · {formatMoney(info.rate)}/h
                            </p>
                          </div>
                        ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="card rounded-2xl p-5">
              <h3 className="font-display text-base font-semibold text-neya-ink mb-2">
                Année {year} — équipe
              </h3>
              <p className="text-xs text-neya-muted mb-4">
                Coût main-d’œuvre basé sur le carnet d’heures des projets + pointages, × taux employés.
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr>
                      <th className="px-3 py-2 text-left">Personne</th>
                      <th className="px-3 py-2 text-right">Heures</th>
                      <th className="px-3 py-2 text-right">Taux</th>
                      <th className="px-3 py-2 text-right">Coût</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(totals.labor_by_person || {})
                      .sort((a, b) => b[1].cost - a[1].cost)
                      .map(([person, info]) => (
                        <tr key={person} className="border-t border-neya-border/60">
                          <td className="px-3 py-2 font-medium">
                            {person}
                            {person.toLowerCase().startsWith(String(data.me.name).toLowerCase().split(/\s+/)[0]) && (
                              <span className="ml-2 text-[10px] uppercase tracking-wide text-neya-orange">moi</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">{info.hours} h</td>
                          <td className="px-3 py-2 text-right tabular-nums">{formatMoney(info.rate)}/h</td>
                          <td className="px-3 py-2 text-right tabular-nums">{formatMoney(info.cost)}</td>
                        </tr>
                      ))}
                    {!Object.keys(totals.labor_by_person || {}).length && (
                      <tr>
                        <td colSpan={4} className="px-3 py-4 text-neya-muted text-center">
                          Aucune heure enregistrée pour {year}.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
    </>
  );
}

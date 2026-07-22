'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ChevronLeft, ChevronRight, Palmtree, Clock } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth-context';
import { hasPermission, isAdmin } from '../lib/permissions';

const TIME_OFF_TYPES = [
  { value: 'vacation', label: 'Vacances' },
  { value: 'sick', label: 'Maladie' },
  { value: 'personal', label: 'Personnel' },
  { value: 'other', label: 'Autre' },
];

const TIME_OFF_LABEL = Object.fromEntries(TIME_OFF_TYPES.map(t => [t.value, t.label]));

function pad(n) {
  return String(n).padStart(2, '0');
}

/** Quinzaine de paie (1–15 / 16–fin), comme /paie. */
export function resolvePayPeriod(refDate = new Date()) {
  const d = new Date(refDate);
  if (Number.isNaN(d.getTime())) return resolvePayPeriod(new Date());
  const y = d.getFullYear();
  const m = d.getMonth();
  const day = d.getDate();
  if (day <= 15) {
    return {
      start: `${y}-${pad(m + 1)}-01`,
      end: `${y}-${pad(m + 1)}-15`,
      label: `1–15 ${d.toLocaleDateString('fr-CA', { month: 'long', year: 'numeric' })}`,
    };
  }
  const last = new Date(y, m + 1, 0).getDate();
  return {
    start: `${y}-${pad(m + 1)}-16`,
    end: `${y}-${pad(m + 1)}-${pad(last)}`,
    label: `16–${last} ${d.toLocaleDateString('fr-CA', { month: 'long', year: 'numeric' })}`,
  };
}

function shiftPeriod(startStr, dir) {
  const start = new Date(`${startStr}T12:00:00`);
  if (dir < 0) start.setDate(start.getDate() - 1);
  else start.setDate(start.getDate() + 16);
  return resolvePayPeriod(start);
}

function eachDate(startStr, endStr) {
  const out = [];
  const cur = new Date(`${startStr}T12:00:00`);
  const end = new Date(`${endStr}T12:00:00`);
  while (cur <= end) {
    out.push(cur.toISOString().slice(0, 10));
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

function dayLabel(dateStr) {
  const d = new Date(`${dateStr}T12:00:00`);
  return d.toLocaleDateString('fr-CA', { weekday: 'short' });
}

function formatDay(dateStr) {
  const d = new Date(`${dateStr}T12:00:00`);
  return d.toLocaleDateString('fr-CA', { day: 'numeric', month: 'short' });
}

function isWeekend(dateStr) {
  const d = new Date(`${dateStr}T12:00:00`).getDay();
  return d === 0 || d === 6;
}

function localDayKey(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function hoursOf(entry) {
  if (entry?.hours != null) return Math.round(Number(entry.hours) * 100) / 100;
  if (!entry?.started_at || !entry?.ended_at) return 0;
  const a = new Date(entry.started_at).getTime();
  const b = new Date(entry.ended_at).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return 0;
  return Math.round(((b - a) / 3600000) * 100) / 100;
}

function toIsoDayStart(dateStr, hour = 8) {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}

function timeOffCoversDay(off, dateStr) {
  const start = localDayKey(off.start_at);
  // end_at is exclusive for all-day ranges
  const endExcl = localDayKey(off.end_at);
  if (!start || !endExcl) return false;
  return dateStr >= start && dateStr < endExcl;
}

function TimeOffModal({ data, employees, canManageAll, onClose, onSaved }) {
  const [form, setForm] = useState(data);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    setForm(data);
    setErr('');
  }, [data]);

  async function save() {
    setSaving(true);
    setErr('');
    try {
      const payload = {
        start_date: form.start_date,
        end_date: form.end_date || form.start_date,
        type: form.type || 'vacation',
        notes: form.notes || null,
      };
      if (canManageAll && form.employee_id) payload.employee_id = Number(form.employee_id);
      if (form.id) {
        await api(`/time-off/${form.id}`, { method: 'PATCH', body: JSON.stringify(payload) });
      } else {
        await api('/time-off', { method: 'POST', body: JSON.stringify(payload) });
      }
      onSaved();
      onClose();
    } catch (e) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!form.id || !confirm('Supprimer ce congé ?')) return;
    setSaving(true);
    try {
      await api(`/time-off/${form.id}`, { method: 'DELETE' });
      onSaved();
      onClose();
    } catch (e) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <button type="button" aria-label="Fermer" className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl shadow-xl border border-neya-border">
        <div className="px-5 py-4 border-b border-neya-border flex items-center justify-between">
          <h3 className="font-display text-lg font-semibold">
            {form.id ? 'Modifier le congé' : 'Prévoir un congé'}
          </h3>
          <button type="button" onClick={onClose} className="text-neya-muted text-xl leading-none">×</button>
        </div>
        <div className="p-5 space-y-4">
          {err && <div className="text-sm text-red-700 bg-red-50 px-3 py-2 rounded-lg">{err}</div>}
          {canManageAll ? (
            <div>
              <label className="label">Employé</label>
              <select
                className="input"
                value={form.employee_id || ''}
                onChange={e => setForm({ ...form, employee_id: e.target.value })}
              >
                {employees.map(e => (
                  <option key={e.id} value={e.id}>{e.name}</option>
                ))}
              </select>
            </div>
          ) : null}
          <div>
            <label className="label">Type</label>
            <select
              className="input"
              value={form.type || 'vacation'}
              onChange={e => setForm({ ...form, type: e.target.value })}
            >
              {TIME_OFF_TYPES.map(t => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Du</label>
              <input
                type="date"
                className="input"
                value={form.start_date || ''}
                onChange={e => setForm({ ...form, start_date: e.target.value })}
              />
            </div>
            <div>
              <label className="label">Au</label>
              <input
                type="date"
                className="input"
                value={form.end_date || ''}
                onChange={e => setForm({ ...form, end_date: e.target.value })}
              />
            </div>
          </div>
          <div>
            <label className="label">Notes</label>
            <input
              className="input"
              value={form.notes || ''}
              onChange={e => setForm({ ...form, notes: e.target.value })}
              placeholder="Optionnel"
            />
          </div>
        </div>
        <div className="px-5 py-4 border-t border-neya-border flex flex-wrap gap-2">
          <button type="button" onClick={save} disabled={saving || !form.start_date} className="btn-primary">
            {saving ? '…' : 'Enregistrer'}
          </button>
          {form.id ? (
            <button type="button" onClick={remove} disabled={saving} className="btn-secondary text-red-600">
              Supprimer
            </button>
          ) : null}
          <button type="button" onClick={onClose} className="btn-secondary sm:ml-auto">Annuler</button>
        </div>
      </div>
    </div>
  );
}

export default function BiweeklyTimesheet() {
  const { user } = useAuth();
  const canManage = isAdmin(user) || hasPermission(user, 'team');
  const myEmployeeId = user?.employee_id ? String(user.employee_id) : '';

  const [period, setPeriod] = useState(() => resolvePayPeriod(new Date()));
  const [employees, setEmployees] = useState([]);
  const [employeeId, setEmployeeId] = useState('');
  const [entries, setEntries] = useState([]);
  const [timeOff, setTimeOff] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [busyDay, setBusyDay] = useState(null);
  const [draftHours, setDraftHours] = useState({});
  const [timeOffModal, setTimeOffModal] = useState(null);

  const days = useMemo(
    () => eachDate(period.start, period.end),
    [period.start, period.end]
  );

  const load = useCallback(async () => {
    if (!employeeId) {
      setEntries([]);
      setTimeOff([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setErr('');
    try {
      const from = `${period.start}T00:00:00`;
      const toEnd = new Date(`${period.end}T12:00:00`);
      toEnd.setDate(toEnd.getDate() + 1);
      const to = toEnd.toISOString();
      const qs = `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&employee_id=${employeeId}`;
      const [te, toff] = await Promise.all([
        api(`/time-entries?${qs}`),
        api(`/time-off?${qs}`).catch(() => []),
      ]);
      setEntries(Array.isArray(te) ? te : []);
      setTimeOff(Array.isArray(toff) ? toff : []);
      setDraftHours({});
    } catch (e) {
      setErr(e.message || 'Chargement impossible');
      setEntries([]);
      setTimeOff([]);
    } finally {
      setLoading(false);
    }
  }, [employeeId, period.start, period.end]);

  useEffect(() => {
    api('/employees')
      .then(list => {
        const active = (list || []).filter(e => e.active !== false);
        setEmployees(active);
        setEmployeeId(prev => {
          if (prev) return prev;
          if (myEmployeeId && active.some(e => String(e.id) === myEmployeeId)) return myEmployeeId;
          if (canManage && active[0]) return String(active[0].id);
          return myEmployeeId || '';
        });
      })
      .catch(() => setEmployees([]));
  }, [canManage, myEmployeeId]);

  useEffect(() => {
    load();
  }, [load]);

  const entriesByDay = useMemo(() => {
    const map = new Map();
    for (const e of entries) {
      const key = localDayKey(e.started_at);
      if (!key) continue;
      const list = map.get(key) || [];
      list.push(e);
      map.set(key, list);
    }
    return map;
  }, [entries]);

  function dayHours(dateStr) {
    if (draftHours[dateStr] !== undefined) return draftHours[dateStr];
    const list = entriesByDay.get(dateStr) || [];
    const sum = list.reduce((s, e) => s + hoursOf(e), 0);
    return sum ? String(sum) : '';
  }

  function leaveForDay(dateStr) {
    return timeOff.find(t => timeOffCoversDay(t, dateStr)) || null;
  }

  const periodTotal = useMemo(() => {
    let sum = 0;
    for (const day of days) {
      if (leaveForDay(day)) continue;
      const raw = dayHours(day);
      const n = Number(raw);
      if (Number.isFinite(n) && n > 0) sum += n;
    }
    return Math.round(sum * 100) / 100;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days, entriesByDay, draftHours, timeOff]);

  async function saveDayHours(dateStr) {
    const leave = leaveForDay(dateStr);
    if (leave) return;

    const raw = draftHours[dateStr] !== undefined
      ? draftHours[dateStr]
      : dayHours(dateStr);
    const hours = Number(String(raw).replace(',', '.'));
    const list = entriesByDay.get(dateStr) || [];
    const primary = list[0] || null;

    setBusyDay(dateStr);
    setErr('');
    try {
      if (!Number.isFinite(hours) || hours <= 0) {
        for (const e of list) {
          await api(`/time-entries/${e.id}`, { method: 'DELETE' });
        }
      } else {
        const started_at = toIsoDayStart(dateStr, 8);
        const ended = new Date(started_at);
        ended.setTime(ended.getTime() + hours * 3600000);
        const payload = {
          employee_id: Number(employeeId),
          started_at,
          ended_at: ended.toISOString(),
          source: 'timesheet',
          notes: primary?.notes || null,
          project_id: primary?.project_id || null,
        };
        if (primary) {
          await api(`/time-entries/${primary.id}`, {
            method: 'PATCH',
            body: JSON.stringify(payload),
          });
          for (const e of list.slice(1)) {
            await api(`/time-entries/${e.id}`, { method: 'DELETE' });
          }
        } else {
          await api('/time-entries', {
            method: 'POST',
            body: JSON.stringify(payload),
          });
        }
      }
      setDraftHours(d => {
        const next = { ...d };
        delete next[dateStr];
        return next;
      });
      await load();
    } catch (e) {
      setErr(e.message || 'Enregistrement impossible');
    } finally {
      setBusyDay(null);
    }
  }

  function openLeave(day) {
    const existing = leaveForDay(day);
    if (existing) {
      const start = localDayKey(existing.start_at);
      const endExcl = localDayKey(existing.end_at);
      const endIncl = endExcl
        ? (() => {
            const d = new Date(`${endExcl}T12:00:00`);
            d.setDate(d.getDate() - 1);
            return d.toISOString().slice(0, 10);
          })()
        : start;
      setTimeOffModal({
        id: existing.id,
        employee_id: String(existing.employee_id || employeeId),
        type: existing.type || 'vacation',
        start_date: start,
        end_date: endIncl,
        notes: existing.notes || '',
      });
      return;
    }
    setTimeOffModal({
      id: null,
      employee_id: employeeId,
      type: 'vacation',
      start_date: day,
      end_date: day,
      notes: '',
    });
  }

  if (!canManage && !myEmployeeId) {
    return (
      <div className="rounded-2xl border border-neya-border bg-white p-5 text-sm text-neya-muted">
        Votre compte n’est pas lié à un profil employé. Demandez à un admin dans Paramètres → Utilisateurs.
      </div>
    );
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 justify-between">
        <div>
          <h2 className="font-display text-lg font-semibold text-neya-ink">Feuille de temps</h2>
          <p className="text-sm text-neya-muted mt-0.5">
            Quinzaine de paie · heures du jour + congés prévus
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canManage ? (
            <label className="text-xs text-neya-muted flex items-center gap-2">
              Employé
              <select
                className="input py-1.5 min-w-[140px]"
                value={employeeId}
                onChange={e => setEmployeeId(e.target.value)}
              >
                {employees.map(e => (
                  <option key={e.id} value={e.id}>{e.name}</option>
                ))}
              </select>
            </label>
          ) : null}
          <div className="inline-flex items-center rounded-xl border border-neya-border bg-white overflow-hidden">
            <button
              type="button"
              className="px-2.5 py-2 text-neya-muted hover:bg-neya-surface"
              onClick={() => setPeriod(p => shiftPeriod(p.start, -1))}
              aria-label="Période précédente"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="px-3 py-2 text-sm font-medium text-neya-ink tabular-nums min-w-[160px] text-center">
              {period.label}
            </span>
            <button
              type="button"
              className="px-2.5 py-2 text-neya-muted hover:bg-neya-surface"
              onClick={() => setPeriod(p => shiftPeriod(p.start, 1))}
              aria-label="Période suivante"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
          <button
            type="button"
            className="btn-secondary text-sm gap-1.5"
            onClick={() => openLeave(period.start)}
          >
            <Palmtree className="h-3.5 w-3.5" />
            Congé
          </button>
          <Link href="/paie" className="btn-ghost text-sm">Paie →</Link>
        </div>
      </div>

      {err && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>
      )}

      <div className="overflow-x-auto rounded-2xl border border-neya-border bg-white shadow-sm">
        <table className="w-full min-w-[520px] text-sm">
          <thead>
            <tr className="bg-neya-ink text-white text-left">
              <th className="px-3 py-2.5 font-medium w-[28%]">Date</th>
              <th className="px-3 py-2.5 font-medium w-[14%]">Jour</th>
              <th className="px-3 py-2.5 font-medium w-[22%]">
                <span className="inline-flex items-center gap-1">
                  <Clock className="h-3.5 w-3.5" /> Heures
                </span>
              </th>
              <th className="px-3 py-2.5 font-medium">Statut</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={4} className="px-3 py-8 text-center text-neya-muted">Chargement…</td>
              </tr>
            ) : days.map(day => {
              const leave = leaveForDay(day);
              const weekend = isWeekend(day);
              const busy = busyDay === day;
              return (
                <tr
                  key={day}
                  className={`border-t border-neya-border/70 ${
                    leave ? 'bg-amber-50/50' : weekend ? 'bg-neya-surface/40' : ''
                  }`}
                >
                  <td className="px-3 py-2 font-medium text-neya-ink tabular-nums">
                    {formatDay(day)}
                  </td>
                  <td className="px-3 py-2 text-neya-muted capitalize">{dayLabel(day)}</td>
                  <td className="px-3 py-2">
                    {leave ? (
                      <span className="text-neya-muted tabular-nums">—</span>
                    ) : (
                      <input
                        type="number"
                        min="0"
                        max="24"
                        step="0.5"
                        inputMode="decimal"
                        disabled={busy}
                        className="input py-1.5 w-[88px] tabular-nums"
                        placeholder={weekend ? '0' : '8'}
                        value={dayHours(day)}
                        onChange={e => setDraftHours(d => ({ ...d, [day]: e.target.value }))}
                        onBlur={() => {
                          if (draftHours[day] === undefined) return;
                          saveDayHours(day);
                        }}
                        onKeyDown={e => {
                          if (e.key === 'Enter') {
                            e.currentTarget.blur();
                          }
                        }}
                      />
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {leave ? (
                      <button
                        type="button"
                        onClick={() => openLeave(day)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-900 hover:border-neya-orange"
                      >
                        <Palmtree className="h-3 w-3" />
                        {TIME_OFF_LABEL[leave.type] || 'Congé'}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => openLeave(day)}
                        className="text-xs text-neya-muted hover:text-neya-orange"
                      >
                        + Congé
                      </button>
                    )}
                    {busy ? <span className="ml-2 text-[11px] text-neya-muted">…</span> : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-neya-ink bg-neya-surface/60">
              <td colSpan={2} className="px-3 py-3 text-sm font-semibold text-neya-ink">
                Total période
              </td>
              <td className="px-3 py-3 font-display text-lg font-semibold tabular-nums text-neya-ink">
                {periodTotal} h
              </td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>

      <p className="text-[12px] text-neya-muted">
        Tapez les heures puis quittez la case (ou Entrée) pour enregistrer. Les congés bloquent la saisie
        des heures ce jour-là. Ces heures alimentent{' '}
        <Link href="/paie" className="text-neya-orange hover:underline">la paie</Link>.
      </p>

      {timeOffModal && (
        <TimeOffModal
          data={timeOffModal}
          employees={employees}
          canManageAll={canManage}
          onClose={() => setTimeOffModal(null)}
          onSaved={load}
        />
      )}
    </section>
  );
}

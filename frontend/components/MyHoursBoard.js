'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Clock, Plus } from 'lucide-react';
import { api, formatDate } from '../lib/api';
import { useAuth } from '../lib/auth-context';
import { hasPermission, isAdmin } from '../lib/permissions';
import { toDatetimeLocal, fromDatetimeLocal } from './CalendarTaskModal';

function hoursBetweenLocal(startLocal, endLocal) {
  if (!startLocal || !endLocal) return 0;
  const a = new Date(startLocal).getTime();
  const b = new Date(endLocal).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return 0;
  return Math.round(((b - a) / 3600000) * 100) / 100;
}

function formatHours(n) {
  const v = Number(n) || 0;
  return `${v.toLocaleString('fr-CA', { maximumFractionDigits: 2 })} h`;
}

function formatRange(start, end) {
  if (!start) return '—';
  const s = new Date(start);
  const e = end ? new Date(end) : null;
  const day = s.toLocaleDateString('fr-CA', { weekday: 'short', day: 'numeric', month: 'short' });
  const t1 = s.toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit' });
  const t2 = e ? e.toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit' }) : '…';
  return `${day} · ${t1} – ${t2}`;
}

function defaultForm(employeeId = '') {
  const now = new Date();
  const start = new Date(now);
  start.setHours(8, 0, 0, 0);
  const end = new Date(now);
  end.setHours(16, 0, 0, 0);
  return {
    id: null,
    employee_id: employeeId || '',
    project_id: '',
    shift_id: null,
    started_at: toDatetimeLocal(start.toISOString()),
    ended_at: toDatetimeLocal(end.toISOString()),
    notes: '',
  };
}

function EntryModal({
  data,
  employees,
  projects,
  canManageAll,
  onClose,
  onSaved,
}) {
  const [form, setForm] = useState(data);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    setForm(data);
    setErr('');
  }, [data]);

  // Si la liste arrive après l’ouverture du modal, préremplir l’employé
  useEffect(() => {
    if (!canManageAll || form.employee_id || !employees.length) return;
    setForm(f => (f.employee_id ? f : { ...f, employee_id: String(employees[0].id) }));
  }, [canManageAll, employees, form.employee_id]);

  const duration = hoursBetweenLocal(form.started_at, form.ended_at);

  function applyQuickHours(h) {
    if (!form.started_at) return;
    const start = new Date(form.started_at);
    if (Number.isNaN(start.getTime())) return;
    const end = new Date(start.getTime() + h * 3600000);
    setForm(f => ({ ...f, ended_at: toDatetimeLocal(end.toISOString()) }));
  }

  async function save() {
    setSaving(true);
    setErr('');
    try {
      if (canManageAll && !form.employee_id) {
        setErr('Choisissez un employé.');
        setSaving(false);
        return;
      }
      const payload = {
        started_at: fromDatetimeLocal(form.started_at),
        ended_at: fromDatetimeLocal(form.ended_at),
        project_id: form.project_id ? Number(form.project_id) : null,
        notes: form.notes || null,
      };
      if (canManageAll && form.employee_id) payload.employee_id = Number(form.employee_id);
      if (form.shift_id) payload.shift_id = Number(form.shift_id);

      if (form.id) {
        await api(`/time-entries/${form.id}`, { method: 'PATCH', body: JSON.stringify(payload) });
      } else {
        await api('/time-entries', { method: 'POST', body: JSON.stringify(payload) });
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
    if (!form.id || !confirm('Supprimer cette inscription ?')) return;
    setSaving(true);
    try {
      await api(`/time-entries/${form.id}`, { method: 'DELETE' });
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
      <div className="relative bg-white w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl shadow-xl border border-neya-border max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-neya-border px-5 py-4 flex items-center justify-between">
          <h3 className="font-heading text-lg">
            {form.id ? 'Modifier l’inscription' : form.shift_id ? 'Confirmer le shift' : 'Inscrire un shift'}
          </h3>
          <button type="button" onClick={onClose} className="text-neya-muted hover:text-neya-ink text-xl leading-none">×</button>
        </div>

        <div className="p-5 space-y-4">
          {err && <div className="text-sm text-red-700 bg-red-50 border border-red-200 px-3 py-2 rounded-lg">{err}</div>}

          {canManageAll && (
            <div>
              <label className="label">Employé</label>
              <select
                className="input"
                value={form.employee_id ? String(form.employee_id) : ''}
                onChange={e => setForm({ ...form, employee_id: e.target.value })}
                disabled={Boolean(form.shift_id)}
                required
              >
                <option value="">— Choisir un employé —</option>
                {employees.map(e => (
                  <option key={e.id} value={String(e.id)}>{e.name}</option>
                ))}
              </select>
              {!employees.length && (
                <p className="mt-1.5 text-xs text-amber-800">
                  Aucun employé trouvé. Vérifiez Paramètres → équipe / profils atelier.
                </p>
              )}
            </div>
          )}

          <div>
            <label className="label">Projet (optionnel)</label>
            <select
              className="input"
              value={form.project_id || ''}
              onChange={e => setForm({ ...form, project_id: e.target.value })}
            >
              <option value="">— Aucun —</option>
              {projects.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="label">Début</label>
              <input
                type="datetime-local"
                className="input"
                value={form.started_at || ''}
                onChange={e => setForm({ ...form, started_at: e.target.value })}
              />
            </div>
            <div>
              <label className="label">Fin</label>
              <input
                type="datetime-local"
                className="input"
                value={form.ended_at || ''}
                onChange={e => setForm({ ...form, ended_at: e.target.value })}
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-neya-muted">Durée : <strong className="text-neya-ink tabular-nums">{formatHours(duration)}</strong></span>
            <div className="flex gap-1.5 ml-auto">
              {[4, 6, 8].map(h => (
                <button
                  key={h}
                  type="button"
                  className="btn-secondary text-xs min-h-[32px] px-2.5 py-1"
                  onClick={() => applyQuickHours(h)}
                >
                  {h}h
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="label">Notes</label>
            <textarea
              className="input min-h-[72px]"
              value={form.notes || ''}
              onChange={e => setForm({ ...form, notes: e.target.value })}
              placeholder="Ex. assemblage, finition…"
            />
          </div>
        </div>

        <div className="sticky bottom-0 bg-white border-t border-neya-border px-5 py-4 flex flex-wrap gap-2">
          <button type="button" onClick={save} disabled={saving || duration <= 0} className="btn-primary flex-1 sm:flex-none">
            {saving ? 'Enregistrement…' : form.shift_id && !form.id ? 'Confirmer le shift' : 'Enregistrer'}
          </button>
          {form.id && (
            <button type="button" onClick={remove} disabled={saving} className="btn-secondary text-sm text-red-600 border-red-200 hover:bg-red-50">
              Supprimer
            </button>
          )}
          <button type="button" onClick={onClose} disabled={saving} className="btn-secondary text-sm sm:ml-auto">
            Annuler
          </button>
        </div>
      </div>
    </div>
  );
}

export default function MyHoursBoard() {
  const { user } = useAuth();
  const myEmployeeId = user?.employee_id || null;
  const canManageAll = isAdmin(user) || hasPermission(user, 'team');

  const [employees, setEmployees] = useState([]);
  const [projects, setProjects] = useState([]);
  const [entries, setEntries] = useState([]);
  const [pending, setPending] = useState([]);
  const [filterEmployeeId, setFilterEmployeeId] = useState('');
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [modal, setModal] = useState(null);

  const employeeFilter = canManageAll ? (filterEmployeeId || '') : String(myEmployeeId || '');

  const range = useMemo(() => {
    const from = new Date();
    from.setDate(from.getDate() - 45);
    from.setHours(0, 0, 0, 0);
    const to = new Date();
    to.setDate(to.getDate() + 14);
    to.setHours(23, 59, 59, 999);
    return { from: from.toISOString(), to: to.toISOString() };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const qs = new URLSearchParams({ from: range.from, to: range.to });
      if (employeeFilter) qs.set('employee_id', employeeFilter);

      const [entriesRes, pendingRes, projectsRes] = await Promise.all([
        api(`/time-entries?${qs}`),
        api(`/time-entries/pending-shifts?${qs}`),
        api('/projects').catch(() => []),
      ]);
      setEntries(Array.isArray(entriesRes) ? entriesRes : []);
      setPending(Array.isArray(pendingRes) ? pendingRes : []);
      const projs = Array.isArray(projectsRes) ? projectsRes : [];
      setProjects(projs.filter(p => p.status === 'active' || p.status === 'done' || !p.status));
    } catch (e) {
      setErr(e.message || 'Impossible de charger les heures');
      setEntries([]);
      setPending([]);
    } finally {
      setLoading(false);
    }
  }, [employeeFilter, range.from, range.to]);

  const loadEmployees = useCallback(async () => {
    if (!canManageAll) {
      setEmployees([]);
      return;
    }
    try {
      const list = await api('/employees');
      const active = (Array.isArray(list) ? list : []).filter(e => e.active !== false);
      setEmployees(active);
    } catch (e) {
      setEmployees([]);
      setErr(prev => prev || e.message || 'Impossible de charger les employés');
    }
  }, [canManageAll]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadEmployees(); }, [loadEmployees]);

  const weekHours = useMemo(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    return entries
      .filter(e => new Date(e.started_at) >= start)
      .reduce((s, e) => s + (Number(e.hours) || 0), 0);
  }, [entries]);

  function openNew() {
    const preferred = employeeFilter
      || (myEmployeeId ? String(myEmployeeId) : '')
      || (employees[0] ? String(employees[0].id) : '');
    setModal(defaultForm(preferred));
    if (canManageAll && !employees.length) loadEmployees();
  }

  function openFromShift(shift) {
    setModal({
      id: null,
      employee_id: String(shift.employee_id),
      project_id: shift.project_id ? String(shift.project_id) : '',
      shift_id: shift.id,
      started_at: toDatetimeLocal(shift.start_at),
      ended_at: toDatetimeLocal(shift.end_at),
      notes: shift.notes || '',
    });
  }

  function openEdit(entry) {
    setModal({
      id: entry.id,
      employee_id: String(entry.employee_id),
      project_id: entry.project_id ? String(entry.project_id) : '',
      shift_id: entry.shift_id || null,
      started_at: toDatetimeLocal(entry.started_at),
      ended_at: toDatetimeLocal(entry.ended_at),
      notes: entry.notes || '',
    });
  }

  async function confirmShiftAsIs(shift) {
    try {
      await api('/time-entries', {
        method: 'POST',
        body: JSON.stringify({
          shift_id: shift.id,
          started_at: shift.start_at,
          ended_at: shift.end_at,
          project_id: shift.project_id || null,
          notes: shift.notes || null,
        }),
      });
      load();
    } catch (e) {
      window.alert(e.message || 'Impossible de confirmer le shift');
    }
  }

  if (!canManageAll && !myEmployeeId) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-6 max-w-xl">
        <h2 className="font-display text-lg font-semibold text-neya-ink mb-2">Profil atelier manquant</h2>
        <p className="text-sm text-neya-muted leading-relaxed">
          Votre compte n’est pas lié à un employé (ex. Olive). Demandez à un admin dans{' '}
          <strong>Paramètres → Utilisateurs</strong> de cocher « Profil atelier (congés, shifts) ».
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-neya-muted">
            Cette semaine :{' '}
            <span className="font-display text-xl font-semibold text-neya-ink tabular-nums">{formatHours(weekHours)}</span>
          </p>
          {user?.employee_name && !canManageAll && (
            <p className="text-xs text-neya-muted mt-1">Profil : {user.employee_name}</p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canManageAll && (
            <select
              className="input min-h-[40px] py-1.5 w-auto min-w-[140px]"
              value={filterEmployeeId}
              onChange={e => setFilterEmployeeId(e.target.value)}
              aria-label="Filtrer par employé"
            >
              <option value="">Toute l’équipe</option>
              {employees.map(e => (
                <option key={e.id} value={e.id}>{e.name}</option>
              ))}
            </select>
          )}
          <button type="button" onClick={openNew} className="btn-primary inline-flex items-center gap-1.5">
            <Plus className="h-4 w-4" aria-hidden />
            Inscrire un shift
          </button>
        </div>
      </div>

      {err && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 px-3 py-2 rounded-lg">{err}</div>
      )}

      <section>
        <div className="flex items-center gap-2 mb-3">
          <Clock className="h-4 w-4 text-neya-orange" aria-hidden />
          <h2 className="font-display text-base font-semibold text-neya-ink">
            Shifts à confirmer
            {pending.length > 0 && (
              <span className="ml-2 text-xs font-medium text-neya-muted tabular-nums">({pending.length})</span>
            )}
          </h2>
        </div>
        {loading ? (
          <p className="text-sm text-neya-muted">Chargement…</p>
        ) : pending.length === 0 ? (
          <p className="text-sm text-neya-muted rounded-xl border border-dashed border-neya-border px-4 py-5 bg-white/60">
            Aucun shift planifié en attente. Vous pouvez aussi inscrire des heures manuellement.
          </p>
        ) : (
          <ul className="space-y-2">
            {pending.map(shift => (
              <li
                key={shift.id}
                className="rounded-xl border border-neya-border bg-white px-4 py-3 flex flex-wrap items-center gap-3"
              >
                <span
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: shift.color || '#6B8E6B' }}
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-neya-ink">
                    {canManageAll ? `${shift.employee_name} · ` : ''}
                    {shift.project_name || 'Sans projet'}
                  </p>
                  <p className="text-xs text-neya-muted mt-0.5">
                    {formatRange(shift.start_at, shift.end_at)} · {formatHours(shift.planned_hours)} planifiées
                  </p>
                </div>
                <div className="flex flex-wrap gap-2 shrink-0">
                  <button
                    type="button"
                    className="btn-secondary text-xs min-h-[36px] px-3"
                    onClick={() => openFromShift(shift)}
                  >
                    Ajuster
                  </button>
                  <button
                    type="button"
                    className="btn-primary text-xs min-h-[36px] px-3"
                    onClick={() => confirmShiftAsIs(shift)}
                  >
                    Confirmer
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="font-display text-base font-semibold text-neya-ink mb-3">
          Heures inscrites
        </h2>
        {loading ? (
          <p className="text-sm text-neya-muted">Chargement…</p>
        ) : entries.length === 0 ? (
          <p className="text-sm text-neya-muted rounded-xl border border-dashed border-neya-border px-4 py-5 bg-white/60">
            Aucune heure inscrite sur la période. Utilisez « Inscrire un shift » après une journée d’atelier.
          </p>
        ) : (
          <ul className="space-y-2">
            {entries.map(entry => (
              <li key={entry.id}>
                <button
                  type="button"
                  onClick={() => openEdit(entry)}
                  className="w-full text-left rounded-xl border border-neya-border bg-white px-4 py-3 hover:border-neya-orange/40 transition-colors"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-neya-ink">
                        {canManageAll ? `${entry.employee_name} · ` : ''}
                        {entry.project_name || 'Sans projet'}
                        {entry.shift_id ? (
                          <span className="ml-2 text-[10px] uppercase tracking-wide text-neya-orange font-semibold">Shift</span>
                        ) : null}
                      </p>
                      <p className="text-xs text-neya-muted mt-0.5">{formatRange(entry.started_at, entry.ended_at)}</p>
                      {entry.notes && (
                        <p className="text-xs text-neya-muted/80 mt-1 line-clamp-2">{entry.notes}</p>
                      )}
                    </div>
                    <span className="text-sm font-semibold tabular-nums text-neya-ink shrink-0">
                      {formatHours(entry.hours)}
                    </span>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
        {!loading && entries.length > 0 && (
          <p className="text-[11px] text-neya-muted mt-3">
            Dernière entrée : {formatDate(entries[0].started_at)} — touchez une ligne pour modifier.
          </p>
        )}
      </section>

      {modal && (
        <EntryModal
          data={modal}
          employees={employees}
          projects={projects}
          canManageAll={canManageAll}
          onClose={() => setModal(null)}
          onSaved={load}
        />
      )}
    </div>
  );
}

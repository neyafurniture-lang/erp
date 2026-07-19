'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import FullCalendar from '@fullcalendar/react';
import timeGridPlugin from '@fullcalendar/timegrid';
import dayGridPlugin from '@fullcalendar/daygrid';
import interactionPlugin, { Draggable } from '@fullcalendar/interaction';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth-context';
import { hasPermission, isAdmin } from '../lib/permissions';
import CalendarTaskModal, { toDatetimeLocal, fromDatetimeLocal } from './CalendarTaskModal';

const TIME_OFF_TYPES = [
  { value: 'vacation', label: 'Vacances' },
  { value: 'sick', label: 'Maladie' },
  { value: 'personal', label: 'Personnel' },
  { value: 'other', label: 'Autre' },
];

const TIME_OFF_LABELS = Object.fromEntries(TIME_OFF_TYPES.map(t => [t.value, t.label]));

const DEFAULT_SHIFT_MS = 8 * 60 * 60 * 1000;

function toIso(d) {
  return new Date(d).toISOString();
}

function exclusiveEndToInclusive(endStr) {
  if (!endStr) return '';
  const d = new Date(endStr);
  if (Number.isNaN(d.getTime())) return endStr.slice(0, 10);
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

function timeOffToEvent(t) {
  const start = new Date(t.start_at);
  const end = new Date(t.end_at);
  return {
    id: `timeoff-${t.id}`,
    title: `${TIME_OFF_LABELS[t.type] || 'Congé'} — ${t.employee_name}`,
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
    allDay: true,
    backgroundColor: `${t.color || '#6B8E6B'}cc`,
    borderColor: t.color || '#6B8E6B',
    extendedProps: { kind: 'time_off', timeOffId: t.id },
  };
}

function TimeOffModal({
  data,
  employees,
  myEmployeeId,
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
          <h3 className="font-heading text-lg">{form.id ? 'Modifier le congé' : 'Ajouter un congé'}</h3>
          <button type="button" onClick={onClose} className="text-neya-muted text-xl">×</button>
        </div>
        <div className="p-5 space-y-4">
          {err && <div className="text-sm text-red-700 bg-red-50 px-3 py-2 rounded-lg">{err}</div>}

          {canManageAll ? (
            <div>
              <label className="label">Employé</label>
              <select className="input" value={form.employee_id || ''} onChange={e => setForm({ ...form, employee_id: e.target.value })}>
                {employees.map(e => (
                  <option key={e.id} value={e.id}>{e.name}</option>
                ))}
              </select>
            </div>
          ) : (
            <p className="text-sm text-neya-muted">Congé pour votre profil atelier</p>
          )}

          <div>
            <label className="label">Type</label>
            <select className="input" value={form.type || 'vacation'} onChange={e => setForm({ ...form, type: e.target.value })}>
              {TIME_OFF_TYPES.map(t => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Du</label>
              <input type="date" className="input" value={form.start_date || ''} onChange={e => setForm({ ...form, start_date: e.target.value })} required />
            </div>
            <div>
              <label className="label">Au</label>
              <input type="date" className="input" value={form.end_date || ''} onChange={e => setForm({ ...form, end_date: e.target.value })} required />
            </div>
          </div>

          <div>
            <label className="label">Notes (optionnel)</label>
            <textarea className="input min-h-[64px]" value={form.notes || ''} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder="Ex. voyage, pont…" />
          </div>
        </div>
        <div className="px-5 py-4 border-t border-neya-border flex flex-wrap gap-2">
          <button type="button" onClick={save} disabled={saving || !form.start_date} className="btn-primary flex-1 sm:flex-none">
            {saving ? 'Enregistrement…' : 'Enregistrer'}
          </button>
          {form.id && (
            <button type="button" onClick={remove} disabled={saving} className="btn-secondary text-sm text-red-600">Supprimer</button>
          )}
          <button type="button" onClick={onClose} className="btn-secondary text-sm sm:ml-auto">Annuler</button>
        </div>
      </div>
    </div>
  );
}

function ShiftEventModal({
  data,
  employees,
  projects,
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

  async function save() {
    setSaving(true);
    setErr('');
    try {
      await api(`/shifts/${form.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          employee_id: Number(form.employee_id),
          project_id: form.project_id ? Number(form.project_id) : null,
          start_at: fromDatetimeLocal(form.start_at),
          end_at: fromDatetimeLocal(form.end_at),
          notes: form.notes || null,
        }),
      });
      onSaved();
      onClose();
    } catch (e) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!confirm('Supprimer ce shift ?')) return;
    setSaving(true);
    try {
      await api(`/shifts/${form.id}`, { method: 'DELETE' });
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
          <h3 className="font-heading text-lg">Modifier le shift</h3>
          <button type="button" onClick={onClose} className="text-neya-muted hover:text-neya-ink text-xl leading-none">×</button>
        </div>

        <div className="p-5 space-y-4">
          {err && <div className="text-sm text-red-700 bg-red-50 border border-red-200 px-3 py-2 rounded-lg">{err}</div>}
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
          <div>
            <label className="label">Projet (optionnel)</label>
            <select
              className="input"
              value={form.project_id || ''}
              onChange={e => setForm({ ...form, project_id: e.target.value })}
            >
              <option value="">— Aucun —</option>
              {projects.filter(p => p.status === 'active').map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Début</label>
              <input
                type="datetime-local"
                className="input"
                value={form.start_at || ''}
                onChange={e => setForm({ ...form, start_at: e.target.value })}
              />
            </div>
            <div>
              <label className="label">Fin</label>
              <input
                type="datetime-local"
                className="input"
                value={form.end_at || ''}
                onChange={e => setForm({ ...form, end_at: e.target.value })}
              />
            </div>
          </div>
          <div>
            <label className="label">Notes</label>
            <textarea
              className="input min-h-[72px]"
              value={form.notes || ''}
              onChange={e => setForm({ ...form, notes: e.target.value })}
              placeholder="Optionnel"
            />
          </div>
        </div>

        <div className="sticky bottom-0 bg-white border-t border-neya-border px-5 py-4 flex flex-wrap gap-2">
          <button type="button" onClick={save} disabled={saving} className="btn-primary flex-1 sm:flex-none">
            {saving ? 'Enregistrement…' : 'Enregistrer'}
          </button>
          <button type="button" onClick={remove} disabled={saving} className="btn-secondary text-sm text-red-600 border-red-200 hover:bg-red-50">
            Supprimer
          </button>
          <button type="button" onClick={onClose} disabled={saving} className="btn-secondary text-sm sm:ml-auto">
            Annuler
          </button>
        </div>
      </div>
    </div>
  );
}

export default function WeeklyPlanner({ showTasks = true, showShifts = true, title = 'Planning' }) {
  const { user } = useAuth();
  const calendarRef = useRef(null);
  const [employees, setEmployees] = useState([]);
  const [projects, setProjects] = useState([]);
  const [shifts, setShifts] = useState([]);
  const [timeOff, setTimeOff] = useState([]);
  const [taskEvents, setTaskEvents] = useState([]);
  const [unscheduledTasks, setUnscheduledTasks] = useState([]);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState(null);
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [hint, setHint] = useState('');
  const [editModal, setEditModal] = useState(null);
  const [timeOffModal, setTimeOffModal] = useState(null);

  const myEmployeeId = user?.employee_id || null;
  const canManageAll = isAdmin(user) || hasPermission(user, 'team');
  const canAddTimeOff = canManageAll || !!myEmployeeId;

  function openTimeOffModal(initial = {}) {
    setTimeOffModal({
      id: initial.id || null,
      employee_id: initial.employee_id || myEmployeeId || employees[0]?.id || '',
      start_date: initial.start_date || '',
      end_date: initial.end_date || initial.start_date || '',
      type: initial.type || 'vacation',
      notes: initial.notes || '',
    });
  }

  const load = useCallback(async () => {
    const rangeStart = new Date();
    rangeStart.setDate(rangeStart.getDate() - 7);
    const rangeEnd = new Date();
    rangeEnd.setDate(rangeEnd.getDate() + 21);

    const reqs = [
      api('/employees'),
      api('/projects').catch(() => []),
    ];
    if (showShifts) {
      reqs.push(api(`/shifts?from=${rangeStart.toISOString()}&to=${rangeEnd.toISOString()}`));
    }
    if (canAddTimeOff) {
      reqs.push(api(`/time-off?from=${rangeStart.toISOString()}&to=${rangeEnd.toISOString()}`));
    }
    if (showTasks) {
      reqs.push(api('/tasks/calendar'));
      reqs.push(api('/tasks'));
    }

    const results = await Promise.all(reqs);
    let i = 0;
    setEmployees(results[i++] || []);
    setProjects(results[i++] || []);

    if (showShifts) {
      setShifts(results[i++] || []);
    }
    if (canAddTimeOff) {
      setTimeOff(results[i++] || []);
    }
    if (showTasks) {
      setTaskEvents(results[i++] || []);
      const tasks = results[i++] || [];
      setUnscheduledTasks(tasks.filter(t => !t.start_time && t.project_standard_id));
    }
  }, [showTasks, showShifts, canAddTimeOff]);

  useEffect(() => {
    load();
    window.addEventListener('neya:assistant-action', load);
    return () => window.removeEventListener('neya:assistant-action', load);
  }, [load]);

  useEffect(() => {
    const empEl = document.getElementById('planner-employees');
    const taskEl = document.getElementById('planner-tasks');
    const instances = [];
    if (empEl) {
      instances.push(new Draggable(empEl, { itemSelector: '.planner-employee' }));
    }
    if (taskEl) {
      instances.push(new Draggable(taskEl, { itemSelector: '.planner-task' }));
    }
    return () => instances.forEach(d => d.destroy());
  }, [employees, unscheduledTasks]);

  async function createShift(employeeId, start, end, projectId = null) {
    await api('/shifts', {
      method: 'POST',
      body: JSON.stringify({
        employee_id: Number(employeeId),
        project_id: projectId || selectedProjectId || null,
        start_at: toIso(start),
        end_at: toIso(end),
      }),
    });
    setHint(`Shift créé — ${new Date(start).toLocaleString('fr-CA', { weekday: 'short', hour: '2-digit', minute: '2-digit' })}`);
    load();
  }

  async function moveShift(shiftId, start, end) {
    await api(`/shifts/${shiftId}`, {
      method: 'PATCH',
      body: JSON.stringify({ start_at: toIso(start), end_at: toIso(end) }),
    });
    load();
  }

  async function scheduleTask(taskId, start, end) {
    await api(`/tasks/${taskId}/schedule`, {
      method: 'PATCH',
      body: JSON.stringify({ start_time: toIso(start), end_time: toIso(end) }),
    });
    load();
  }

  const shiftEvents = showShifts
    ? shifts.map(s => ({
        id: `shift-${s.id}`,
        title: s.project_name ? `${s.employee_name} · ${s.project_name}` : s.employee_name,
        start: s.start_at,
        end: s.end_at,
        backgroundColor: s.color || '#D86B30',
        borderColor: s.color || '#D86B30',
        extendedProps: { kind: 'shift', shiftId: s.id },
      }))
    : [];

  const timeOffEvents = canAddTimeOff ? timeOff.map(timeOffToEvent) : [];

  const events = [...shiftEvents, ...timeOffEvents, ...(showTasks ? taskEvents : [])];

  function handleSelect(info) {
    if (info.allDay && canAddTimeOff) {
      const startDate = info.startStr?.slice(0, 10);
      const endDate = exclusiveEndToInclusive(info.endStr) || startDate;
      openTimeOffModal({ start_date: startDate, end_date: endDate });
      calendarRef.current?.getApi()?.unselect();
      return;
    }
    if (!showShifts) return;
    if (!selectedEmployeeId) {
      setHint('Sélectionnez un employé à gauche, puis glissez sur le calendrier.');
      calendarRef.current?.getApi()?.unselect();
      return;
    }
    createShift(selectedEmployeeId, info.start, info.end);
    calendarRef.current?.getApi()?.unselect();
  }

  function handleDrop(info) {
    const empId = info.draggedEl.dataset.employeeId;
    const taskId = info.draggedEl.dataset.taskId;
    const start = info.date;
    const end = new Date(start.getTime() + DEFAULT_SHIFT_MS);

    if (empId && showShifts) {
      createShift(empId, start, end);
      return;
    }
    if (taskId && showTasks) {
      scheduleTask(taskId, start, end);
    }
  }

  function handleEventDrop(info) {
    const { kind, shiftId, timeOffId } = info.event.extendedProps || {};
    if (kind === 'time_off') return info.revert();
    if (kind === 'shift' && shiftId) {
      moveShift(shiftId, info.event.start, info.event.end || new Date(info.event.start.getTime() + DEFAULT_SHIFT_MS));
      return;
    }
    if (showTasks && info.event.id && !String(info.event.id).startsWith('shift-')) {
      api(`/tasks/${info.event.id}/schedule`, {
        method: 'PATCH',
        body: JSON.stringify({
          start_time: toIso(info.event.start),
          end_time: toIso(info.event.end || new Date(info.event.start.getTime() + 3600000)),
        }),
      }).then(load);
    }
  }

  function handleEventResize(info) {
    handleEventDrop(info);
  }

  async function handleEventClick(info) {
    const { kind, shiftId, timeOffId } = info.event.extendedProps || {};
    if (kind === 'time_off' && timeOffId) {
      const row = timeOff.find(t => String(t.id) === String(timeOffId))
        || await api(`/time-off/${timeOffId}`).catch(() => null);
      if (!row) return;
      const start = new Date(row.start_at);
      const end = new Date(row.end_at);
      end.setDate(end.getDate() - 1);
      openTimeOffModal({
        id: row.id,
        employee_id: row.employee_id,
        start_date: start.toISOString().slice(0, 10),
        end_date: end.toISOString().slice(0, 10),
        type: row.type,
        notes: row.notes || '',
      });
      return;
    }
    if (kind === 'shift' && shiftId && showShifts) {
      const shift = shifts.find(s => String(s.id) === String(shiftId))
        || await api(`/shifts/${shiftId}`).catch(() => null);
      if (!shift) return;
      setEditModal({
        kind: 'shift',
        data: {
          id: shift.id,
          employee_id: shift.employee_id,
          project_id: shift.project_id || '',
          start_at: toDatetimeLocal(shift.start_at),
          end_at: toDatetimeLocal(shift.end_at),
          notes: shift.notes || '',
        },
      });
      return;
    }
    if (showTasks && info.event.id && !String(info.event.id).startsWith('shift-')) {
      setEditModal({ kind: 'task', taskId: info.event.id });
    }
  }

  const selectedEmployee = employees.find(e => String(e.id) === String(selectedEmployeeId));

  return (
    <div>
      <p className="text-sm text-neya-muted mb-4">
        {title} — glissez un employé ou une tâche sur le calendrier.
        {canAddTimeOff && <> Sélectionnez une plage en haut du calendrier pour <strong className="text-neya-ink">ajouter un congé</strong>.</>}
        <strong className="text-neya-ink"> Glissez</strong> une tâche pour la déplacer · <strong className="text-neya-ink">cliquez</strong> pour modifier (heures, projet, notes).
      </p>
      {hint && (
        <p className="text-xs text-neya-orange bg-neya-orange/10 px-3 py-2 rounded-lg mb-4">{hint}</p>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        <div className="space-y-4">
          {canAddTimeOff && (
            <div className="card rounded-2xl">
              <h3 className="text-sm font-display font-semibold text-neya-ink mb-1">Congés</h3>
              <p className="text-[10px] text-neya-muted mb-3">
                {myEmployeeId ? 'Ajoutez vos vacances ou absences' : 'Planifiez les congés de l\'équipe'}
              </p>
              <button type="button" onClick={() => openTimeOffModal()} className="btn-primary w-full text-sm">
                + Ajouter un congé
              </button>
              {!myEmployeeId && !canManageAll && (
                <p className="text-[10px] text-neya-error mt-2">Liez votre compte à un employé dans Paramètres → Utilisateurs.</p>
              )}
            </div>
          )}

          {showShifts && (
            <div className="card rounded-2xl">
              <h3 className="text-sm font-display font-semibold text-neya-ink mb-1">Équipe</h3>
              <p className="text-[10px] text-neya-muted mb-3">Cliquez pour sélectionner · glissez sur le calendrier</p>
              <div id="planner-employees" className="space-y-2">
                {employees.map(e => {
                  const active = String(e.id) === String(selectedEmployeeId);
                  return (
                    <div
                      key={e.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => {
                        setSelectedEmployeeId(active ? null : e.id);
                        setHint(active ? '' : `${e.name} sélectionné(e) — glissez sur le calendrier`);
                      }}
                      onKeyDown={ev => ev.key === 'Enter' && setSelectedEmployeeId(e.id)}
                      className={`planner-employee w-full text-left px-3 py-2.5 rounded-lg border text-sm font-medium cursor-grab active:cursor-grabbing transition-colors ${
                        active ? 'border-neya-orange bg-neya-orange/10 text-neya-ink' : 'border-neya-border bg-white hover:bg-neya-surface'
                      }`}
                      data-employee-id={e.id}
                      style={{ borderLeftWidth: 4, borderLeftColor: e.color }}
                    >
                      {e.name}
                      <span className="block text-[10px] font-normal text-neya-muted">{e.hourly_rate}$/h</span>
                    </div>
                  );
                })}
              </div>

              {projects.length > 0 && (
                <div className="mt-4 pt-4 border-t border-neya-border">
                  <label className="label text-xs">Projet (optionnel)</label>
                  <select
                    className="input text-sm"
                    value={selectedProjectId}
                    onChange={e => setSelectedProjectId(e.target.value)}
                  >
                    <option value="">— Aucun —</option>
                    {projects.filter(p => p.status === 'active').map(p => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>
              )}

              {selectedEmployee && (
                <p className="text-xs text-neya-muted mt-3">
                  Shift par défaut : 8 h · couleur {selectedEmployee.name}
                </p>
              )}
            </div>
          )}

          {showTasks && (
            <div className="card rounded-2xl">
              <h3 className="text-sm font-display font-semibold text-neya-ink mb-1">Tâches atelier</h3>
              <p className="text-[10px] text-neya-muted mb-3">Glissez sur le calendrier →</p>
              <div id="planner-tasks" className="space-y-2 max-h-48 overflow-y-auto">
                {unscheduledTasks.map(t => (
                  <div
                    key={t.id}
                    data-task-id={t.id}
                    className="planner-task bg-neya-surface border border-neya-border text-xs px-3 py-2 rounded-lg cursor-grab"
                  >
                    {t.title}
                  </div>
                ))}
                {unscheduledTasks.length === 0 && (
                  <p className="text-xs text-neya-muted">Toutes les tâches catalogue sont planifiées</p>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="card rounded-2xl lg:col-span-3 p-2 overflow-hidden planner-calendar">
          <FullCalendar
            ref={calendarRef}
            plugins={[timeGridPlugin, dayGridPlugin, interactionPlugin]}
            initialView="timeGridWeek"
            headerToolbar={{
              left: 'prev,next today',
              center: 'title',
              right: 'timeGridDay,timeGridWeek',
            }}
            locale="fr"
            firstDay={1}
            slotMinTime="06:00:00"
            slotMaxTime="21:00:00"
            slotDuration="00:30:00"
            snapDuration="00:15:00"
            allDaySlot={canAddTimeOff}
            height="auto"
            expandRows
            nowIndicator
            selectable={showShifts || canAddTimeOff}
            selectMirror
            select={handleSelect}
            editable
            droppable
            events={events}
            drop={handleDrop}
            eventDrop={handleEventDrop}
            eventResize={handleEventResize}
            eventClick={handleEventClick}
            scrollTime="07:00:00"
            businessHours={{ daysOfWeek: [1, 2, 3, 4, 5, 6], startTime: '07:00', endTime: '18:00' }}
          />
        </div>
      </div>

      {timeOffModal && (
        <TimeOffModal
          data={timeOffModal}
          employees={employees}
          myEmployeeId={myEmployeeId}
          canManageAll={canManageAll}
          onClose={() => setTimeOffModal(null)}
          onSaved={load}
        />
      )}

      {editModal?.kind === 'shift' && (
        <ShiftEventModal
          data={editModal.data}
          employees={employees}
          projects={projects}
          onClose={() => setEditModal(null)}
          onSaved={load}
        />
      )}
      {editModal?.kind === 'task' && editModal.taskId && (
        <CalendarTaskModal
          taskId={editModal.taskId}
          projects={projects}
          onClose={() => setEditModal(null)}
          onSaved={load}
        />
      )}
    </div>
  );
}

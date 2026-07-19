'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  Filter,
  Hammer,
  Truck,
  Users,
  Wrench,
  Clock,
} from 'lucide-react';
import AppShell from '../../components/AppShell';
import AuthGuard from '../../components/AuthGuard';
import WeeklyPlanner from '../../components/WeeklyPlanner';
import CalendarTaskModal from '../../components/CalendarTaskModal';
import { api } from '../../lib/api';

const MONTHS_FR = [
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre',
];
const DAYS_FR_SHORT = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
const DAYS_FR = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];

const CATEGORY_META = {
  production: {
    label: 'Production',
    Icon: Hammer,
    dot: 'bg-neya-orange',
    chip: 'bg-neya-orange-soft text-neya-orange border-neya-orange/20',
    bar: 'border-l-neya-orange bg-neya-orange/[0.06]',
  },
  livraison: {
    label: 'Livraison',
    Icon: Truck,
    dot: 'bg-neya-ink',
    chip: 'bg-neya-ink/10 text-neya-ink border-neya-ink/20',
    bar: 'border-l-neya-ink bg-neya-ink/[0.04]',
  },
  client: {
    label: 'Client',
    Icon: Users,
    dot: 'bg-emerald-600',
    chip: 'bg-emerald-600/10 text-emerald-700 border-emerald-600/20',
    bar: 'border-l-emerald-600 bg-emerald-600/5',
  },
  installation: {
    label: 'Installation',
    Icon: Wrench,
    dot: 'bg-amber-600',
    chip: 'bg-amber-600/10 text-amber-700 border-amber-600/20',
    bar: 'border-l-amber-600 bg-amber-600/5',
  },
  conge: {
    label: 'Congé',
    Icon: Clock,
    dot: 'bg-neya-muted',
    chip: 'bg-neya-surface text-neya-muted border-neya-border',
    bar: 'border-l-neya-muted bg-neya-surface/80',
  },
};

function iso(d) {
  const x = new Date(d);
  const y = x.getFullYear();
  const m = String(x.getMonth() + 1).padStart(2, '0');
  const day = String(x.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function addDays(d, n) {
  const c = new Date(d);
  c.setDate(c.getDate() + n);
  return c;
}

function startOfMonthGrid(view) {
  const first = new Date(view.getFullYear(), view.getMonth(), 1);
  const dow = (first.getDay() + 6) % 7;
  return addDays(first, -dow);
}

function hhmm(dateLike) {
  if (!dateLike) return '—';
  const d = new Date(dateLike);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit' });
}

function categorizeTask(task) {
  const title = `${task.title || ''} ${task.extendedProps?.type || ''}`.toLowerCase();
  const type = task.extendedProps?.type || '';
  if (/livr/.test(title)) return 'livraison';
  if (/install/.test(title)) return 'installation';
  if (/rdv|appel|client|consult|showroom/.test(title) || type === 'admin') return 'client';
  return 'production';
}

function FilterChip({ label, active, dot, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] font-medium transition-colors ${
        active
          ? 'border-neya-ink bg-neya-ink text-white'
          : 'border-neya-border bg-white text-neya-ink-light hover:bg-neya-surface'
      }`}
    >
      {dot ? <span className={`h-1.5 w-1.5 rounded-full ${active ? 'bg-white' : dot}`} /> : null}
      {label}
    </button>
  );
}

function formatDayLabel(isoDate) {
  const d = new Date(`${isoDate}T12:00:00`);
  return `${DAYS_FR[d.getDay()]} ${d.getDate()} ${MONTHS_FR[d.getMonth()].toLowerCase()}`;
}

function taskIdFromEvent(ev) {
  if (!ev || ev.category === 'conge') return null;
  return ev.raw?.extendedProps?.taskId || ev.raw?.id || null;
}

function CraftCalendar() {
  const today = useMemo(() => new Date(), []);
  const [view, setView] = useState(() => new Date());
  const [selected, setSelected] = useState(() => iso(new Date()));
  const [filter, setFilter] = useState('all');
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState({ title: '', start: '09:00', end: '10:00', type: 'assemblage' });
  const [editTaskId, setEditTaskId] = useState(null);
  const [dragOverDate, setDragOverDate] = useState(null);
  const dragPayloadRef = useRef(null);
  /** Ignore le click fantôme qui suit parfois un drag HTML5 */
  const suppressClickRef = useRef(false);

  const gridStart = useMemo(() => startOfMonthGrid(view), [view]);
  const days = useMemo(() => Array.from({ length: 42 }, (_, i) => addDays(gridStart, i)), [gridStart]);
  const rangeStart = iso(gridStart);
  const rangeEnd = iso(addDays(gridStart, 42));

  const load = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const [tasks, timeOff] = await Promise.all([
        api(`/tasks/calendar?start=${rangeStart}T00:00:00&end=${rangeEnd}T23:59:59`),
        api(`/time-off?from=${rangeStart}&to=${rangeEnd}`).catch(() => []),
      ]);
      const mapped = (tasks || []).map(t => {
        const start = t.start ? new Date(t.start) : null;
        const end = t.end ? new Date(t.end) : null;
        const date = start ? iso(start) : null;
        const projectName = t.extendedProps?.projectId
          ? (t.title.match(/\(([^)]+)\)/)?.[1] || null)
          : null;
        return {
          id: `t-${t.id}`,
          title: t.title,
          date,
          start: hhmm(start),
          end: hhmm(end),
          category: categorizeTask(t),
          project: projectName,
          raw: t,
        };
      }).filter(e => e.date);

      const offs = (Array.isArray(timeOff) ? timeOff : []).flatMap(to => {
        const start = new Date(to.start_at || to.start);
        const end = new Date(to.end_at || to.end || to.start_at);
        if (Number.isNaN(start.getTime())) return [];
        const daysSpan = Math.max(1, Math.ceil((end - start) / 86400000) + 1);
        return Array.from({ length: Math.min(daysSpan, 14) }, (_, i) => {
          const d = addDays(start, i);
          return {
            id: `off-${to.id}-${i}`,
            title: `Congé — ${to.employee_name || 'Équipe'}`,
            date: iso(d),
            start: i === 0 ? hhmm(start) : '00:00',
            end: i === daysSpan - 1 ? hhmm(end) : '23:59',
            category: 'conge',
            project: to.notes || null,
            href: null,
          };
        });
      });

      setEvents([...mapped, ...offs]);
    } catch (e) {
      setErr(e.message || 'Impossible de charger le calendrier');
    } finally {
      setLoading(false);
    }
  }, [rangeStart, rangeEnd]);

  useEffect(() => { load(); }, [load]);

  const filteredEvents = useMemo(
    () => (filter === 'all' ? events : events.filter(e => e.category === filter)),
    [events, filter]
  );

  const eventsByDate = useMemo(() => {
    const map = new Map();
    for (const e of filteredEvents) {
      const arr = map.get(e.date) || [];
      arr.push(e);
      map.set(e.date, arr);
    }
    for (const [, arr] of map) arr.sort((a, b) => a.start.localeCompare(b.start));
    return map;
  }, [filteredEvents]);

  const selectedEvents = eventsByDate.get(selected) || [];
  const monthLabel = `${MONTHS_FR[view.getMonth()]} ${view.getFullYear()}`;
  const todayIso = iso(today);

  async function createEvent(e) {
    e.preventDefault();
    const title = addForm.title.trim();
    if (!title) return;
    const start = new Date(`${selected}T${addForm.start}:00`);
    const end = new Date(`${selected}T${addForm.end}:00`);
    await api('/tasks', {
      method: 'POST',
      body: JSON.stringify({
        title,
        type: addForm.type,
        status: 'todo',
        start_time: start.toISOString(),
        end_time: end.toISOString(),
        estimated_minutes: Math.max(30, Math.round((end - start) / 60000)),
      }),
    });
    setShowAdd(false);
    setAddForm({ title: '', start: '09:00', end: '10:00', type: 'assemblage' });
    load();
  }

  function openTask(ev) {
    const id = taskIdFromEvent(ev);
    if (id) setEditTaskId(String(id));
  }

  function onTaskDragStart(e, ev) {
    const id = taskIdFromEvent(ev);
    if (!id) {
      e.preventDefault();
      return;
    }
    dragPayloadRef.current = {
      taskId: String(id),
      start: ev.raw?.start || null,
      end: ev.raw?.end || null,
    };
    e.dataTransfer.setData('text/plain', String(id));
    e.dataTransfer.setData('text/task-id', String(id));
    e.dataTransfer.effectAllowed = 'move';
  }

  function onTaskDragEnd() {
    setDragOverDate(null);
    suppressClickRef.current = true;
    setTimeout(() => { suppressClickRef.current = false; }, 300);
  }

  async function moveTaskToDate(taskId, dateKey, startIso, endIso) {
    const baseStart = startIso ? new Date(startIso) : new Date(`${dateKey}T09:00:00`);
    const baseEnd = endIso ? new Date(endIso) : new Date(baseStart.getTime() + 60 * 60 * 1000);
    if (Number.isNaN(baseStart.getTime())) return;

    const [y, m, d] = dateKey.split('-').map(Number);
    const newStart = new Date(baseStart);
    newStart.setFullYear(y, m - 1, d);
    const duration = Math.max(15 * 60 * 1000, baseEnd - baseStart);
    const newEnd = new Date(newStart.getTime() + duration);

    await api(`/tasks/${taskId}/schedule`, {
      method: 'PATCH',
      body: JSON.stringify({
        start_time: newStart.toISOString(),
        end_time: newEnd.toISOString(),
      }),
    });
    setSelected(dateKey);
    await load();
  }

  async function onDayDrop(e, dateKey) {
    e.preventDefault();
    e.stopPropagation();
    setDragOverDate(null);
    const taskId = e.dataTransfer.getData('text/task-id')
      || e.dataTransfer.getData('text/plain')
      || dragPayloadRef.current?.taskId;
    if (!taskId) return;
    suppressClickRef.current = true;
    try {
      await moveTaskToDate(
        taskId,
        dateKey,
        dragPayloadRef.current?.start,
        dragPayloadRef.current?.end
      );
    } catch (errMove) {
      setErr(errMove.message || 'Impossible de déplacer la tâche');
    } finally {
      dragPayloadRef.current = null;
    }
  }

  function onTaskClick(e, ev) {
    e.stopPropagation();
    e.preventDefault();
    if (suppressClickRef.current) return;
    openTask(ev);
  }

  return (
    <div className="space-y-4">
      <p className="text-[12px] text-neya-muted">
        <strong className="text-neya-ink font-medium">Clic</strong> pour modifier une tâche ·{' '}
        <strong className="text-neya-ink font-medium">glisser-déposer</strong> pour la déplacer à un autre jour.
      </p>
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex items-center rounded-lg border border-neya-border bg-white p-0.5">
          <button
            type="button"
            onClick={() => setView(new Date(view.getFullYear(), view.getMonth() - 1, 1))}
            className="grid h-8 w-8 place-items-center rounded-md text-neya-muted hover:bg-neya-surface hover:text-neya-ink"
            aria-label="Mois précédent"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => { setView(new Date(today)); setSelected(todayIso); }}
            className="h-8 rounded-md px-2.5 text-[12px] font-medium text-neya-ink hover:bg-neya-surface"
          >
            Aujourd&apos;hui
          </button>
          <button
            type="button"
            onClick={() => setView(new Date(view.getFullYear(), view.getMonth() + 1, 1))}
            className="grid h-8 w-8 place-items-center rounded-md text-neya-muted hover:bg-neya-surface hover:text-neya-ink"
            aria-label="Mois suivant"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        <h2 className="font-display text-lg font-semibold text-neya-ink">{monthLabel}</h2>
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <span className="hidden sm:inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-neya-muted mr-1">
            <Filter className="h-3 w-3" /> Filtres
          </span>
          <FilterChip label="Tous" active={filter === 'all'} onClick={() => setFilter('all')} />
          {Object.entries(CATEGORY_META).map(([k, meta]) => (
            <FilterChip
              key={k}
              label={meta.label}
              active={filter === k}
              dot={meta.dot}
              onClick={() => setFilter(k)}
            />
          ))}
        </div>
      </div>

      {err && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{err}</div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-4">
        {/* Month grid */}
        <div className="overflow-hidden rounded-2xl border border-neya-border bg-white shadow-sm">
          <div className="grid grid-cols-7 border-b border-neya-border bg-neya-surface/60">
            {DAYS_FR_SHORT.map(d => (
              <div key={d} className="px-2 py-2 text-center text-[11px] font-semibold uppercase tracking-wider text-neya-muted">
                {d}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {days.map((d, i) => {
              const key = iso(d);
              const inMonth = d.getMonth() === view.getMonth();
              const isToday = key === todayIso;
              const isSelected = key === selected;
              const isDropTarget = dragOverDate === key;
              const evts = eventsByDate.get(key) || [];
              return (
                <div
                  key={key + i}
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelected(key)}
                  onKeyDown={ev => {
                    if (ev.key === 'Enter' || ev.key === ' ') {
                      ev.preventDefault();
                      setSelected(key);
                    }
                  }}
                  onDragOver={e => {
                    if (!dragPayloadRef.current && !e.dataTransfer.types.includes('text/task-id')) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                    if (dragOverDate !== key) setDragOverDate(key);
                  }}
                  onDragLeave={e => {
                    if (!e.currentTarget.contains(e.relatedTarget)) {
                      setDragOverDate(prev => (prev === key ? null : prev));
                    }
                  }}
                  onDrop={e => onDayDrop(e, key)}
                  className={[
                    'group relative flex min-h-[86px] flex-col gap-1 border-b border-r border-neya-border p-2 text-left transition-colors lg:min-h-[104px] cursor-pointer',
                    !inMonth ? 'bg-neya-surface/30 text-neya-muted' : 'bg-white',
                    isSelected ? 'bg-neya-orange/[0.06] ring-1 ring-inset ring-neya-orange/30' : 'hover:bg-neya-surface/50',
                    isDropTarget ? 'bg-neya-orange/10 ring-2 ring-inset ring-neya-orange/50' : '',
                    (i + 1) % 7 === 0 ? 'border-r-0' : '',
                    i >= 35 ? 'border-b-0' : '',
                  ].join(' ')}
                >
                  <span className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-[12px] font-semibold tabular-nums ${
                    isToday ? 'bg-neya-orange text-white' : 'text-neya-ink'
                  }`}>
                    {d.getDate()}
                  </span>
                  <div className="flex flex-col gap-0.5 w-full min-w-0">
                    {evts.slice(0, 3).map(e => {
                      const meta = CATEGORY_META[e.category] || CATEGORY_META.production;
                      const canDrag = !!taskIdFromEvent(e);
                      return (
                        <span
                          key={e.id}
                          role={canDrag ? 'button' : undefined}
                          tabIndex={canDrag ? 0 : undefined}
                          draggable={canDrag}
                          onDragStart={ev => onTaskDragStart(ev, e)}
                          onDragEnd={onTaskDragEnd}
                          onClick={ev => onTaskClick(ev, e)}
                          onKeyDown={ev => {
                            if (canDrag && (ev.key === 'Enter' || ev.key === ' ')) {
                              ev.preventDefault();
                              ev.stopPropagation();
                              openTask(e);
                            }
                          }}
                          className={`truncate rounded px-1 py-0.5 text-[10px] font-medium border ${meta.chip} ${
                            canDrag ? 'cursor-grab active:cursor-grabbing hover:brightness-95' : ''
                          }`}
                          title={canDrag ? `${e.start} ${e.title} — glisser pour déplacer, clic pour modifier` : `${e.start} ${e.title}`}
                        >
                          <span className="hidden sm:inline">{e.start} · </span>{e.title}
                        </span>
                      );
                    })}
                    {evts.length > 3 && (
                      <span className="text-[10px] text-neya-muted font-medium">+{evts.length - 3} de plus</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          {loading && (
            <p className="px-4 py-3 text-sm text-neya-muted border-t border-neya-border">Chargement…</p>
          )}
        </div>

        {/* Day detail */}
        <aside className="rounded-2xl border border-neya-border bg-white shadow-sm p-4 sm:p-5 flex flex-col min-h-[320px]">
          <div className="mb-4">
            <h3 className="font-display text-[16px] font-semibold text-neya-ink">
              {formatDayLabel(selected)}
            </h3>
            <p className="text-[12px] text-neya-muted mt-0.5">
              {selectedEvents.length} événement{selectedEvents.length > 1 ? 's' : ''}
            </p>
          </div>

          <button
            type="button"
            onClick={() => setShowAdd(v => !v)}
            className="btn-primary text-sm w-full mb-4 gap-1.5"
          >
            <Plus className="h-4 w-4" /> Ajouter à cette date
          </button>

          {showAdd && (
            <form onSubmit={createEvent} className="mb-4 space-y-2 rounded-xl border border-neya-border bg-neya-surface/40 p-3">
              <input
                className="input text-sm"
                placeholder="Titre (ex. Livraison table…)"
                value={addForm.title}
                onChange={e => setAddForm({ ...addForm, title: e.target.value })}
                required
              />
              <div className="grid grid-cols-2 gap-2">
                <input type="time" className="input text-sm" value={addForm.start} onChange={e => setAddForm({ ...addForm, start: e.target.value })} />
                <input type="time" className="input text-sm" value={addForm.end} onChange={e => setAddForm({ ...addForm, end: e.target.value })} />
              </div>
              <select className="input text-sm" value={addForm.type} onChange={e => setAddForm({ ...addForm, type: e.target.value })}>
                <option value="assemblage">Production</option>
                <option value="debitage">Débitage</option>
                <option value="finition">Finition</option>
                <option value="admin">Client / RDV</option>
              </select>
              <div className="flex gap-2">
                <button type="submit" className="btn-primary text-xs flex-1">Enregistrer</button>
                <button type="button" onClick={() => setShowAdd(false)} className="btn-secondary text-xs">Annuler</button>
              </div>
            </form>
          )}

          <div className="flex-1 space-y-2.5 overflow-y-auto">
            {selectedEvents.length === 0 && !loading && (
              <div className="rounded-xl border border-dashed border-neya-border px-4 py-8 text-center">
                <p className="text-sm font-medium text-neya-ink">Journée libre</p>
                <p className="text-xs text-neya-muted mt-1">Aucun événement planifié.</p>
              </div>
            )}
            {selectedEvents.map(e => {
              const meta = CATEGORY_META[e.category] || CATEGORY_META.production;
              const Icon = meta.Icon;
              const canEdit = !!taskIdFromEvent(e);
              return (
                <button
                  key={e.id}
                  type="button"
                  draggable={canEdit}
                  onDragStart={ev => onTaskDragStart(ev, e)}
                  onDragEnd={onTaskDragEnd}
                  onClick={ev => {
                    if (suppressClickRef.current) return;
                    if (canEdit) openTask(e);
                  }}
                  className={`w-full text-left rounded-xl border border-neya-border border-l-4 px-3 py-2.5 ${meta.bar} ${
                    canEdit ? 'cursor-grab active:cursor-grabbing hover:opacity-90' : 'cursor-default'
                  }`}
                  title={canEdit ? 'Clic pour modifier · glisser vers un jour du calendrier' : undefined}
                >
                  <div className="flex items-start gap-2">
                    <span className={`mt-0.5 grid h-7 w-7 place-items-center rounded-lg border ${meta.chip}`}>
                      <Icon className="h-3.5 w-3.5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-neya-ink leading-snug">{e.title}</p>
                      <p className="text-[12px] text-neya-muted mt-0.5 tabular-nums">
                        {e.start} – {e.end}
                        {e.project ? ` · ${e.project}` : ''}
                      </p>
                      {canEdit && (
                        <p className="text-[11px] text-neya-orange mt-1 font-medium">Modifier · déplacer</p>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </aside>
      </div>

      {editTaskId && (
        <CalendarTaskModal
          taskId={editTaskId}
          onClose={() => setEditTaskId(null)}
          onSaved={load}
        />
      )}
    </div>
  );
}

export default function CalendarPage() {
  const [mode, setMode] = useState('mois'); // mois | equipe

  return (
    <AuthGuard>
      <AppShell
        title="Calendrier"
        subtitle="Planning atelier, livraisons et rendez-vous"
        wide
      >
        <div className="flex flex-wrap items-center gap-2 mb-5">
          <div className="inline-flex rounded-lg border border-neya-border bg-white p-0.5">
            <button
              type="button"
              onClick={() => setMode('mois')}
              className={`h-8 rounded-md px-3 text-[12.5px] font-medium ${
                mode === 'mois' ? 'bg-neya-ink text-white' : 'text-neya-muted hover:text-neya-ink'
              }`}
            >
              Mois
            </button>
            <button
              type="button"
              onClick={() => setMode('equipe')}
              className={`h-8 rounded-md px-3 text-[12.5px] font-medium ${
                mode === 'equipe' ? 'bg-neya-ink text-white' : 'text-neya-muted hover:text-neya-ink'
              }`}
            >
              Équipe / semaine
            </button>
          </div>
        </div>

        {mode === 'mois' ? (
          <CraftCalendar />
        ) : (
          <WeeklyPlanner showTasks showShifts title="Production & équipe" />
        )}
      </AppShell>
    </AuthGuard>
  );
}

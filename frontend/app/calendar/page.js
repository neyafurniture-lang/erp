'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
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
import { api } from '../../lib/api';

const MONTHS_FR = [
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre',
];
const DAYS_FR_SHORT = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
const DAYS_FR = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];

/** Catégories affichées comme Craft Flow Lovable (filtre Congé optionnel en données). */
const CATEGORY_META = {
  production: {
    label: 'Production',
    Icon: Hammer,
    dot: 'bg-neya-orange',
    chip: 'bg-neya-orange-soft text-neya-orange border-neya-orange/20',
    bar: 'border-l-neya-orange bg-neya-orange/[0.05]',
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

const FILTER_KEYS = ['production', 'livraison', 'client', 'installation'];

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
      className={`inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[11.5px] font-medium transition-colors ${
        active
          ? 'border-neya-ink bg-neya-ink text-white'
          : 'border-neya-border bg-white text-neya-muted hover:text-neya-ink'
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
        const projectName = t.extendedProps?.projectName
          || t.title?.match(/\(([^)]+)\)/)?.[1]
          || null;
        return {
          id: `t-${t.id}`,
          title: t.title,
          date,
          start: hhmm(start),
          end: hhmm(end),
          category: categorizeTask(t),
          project: projectName,
          location: t.extendedProps?.location || null,
          href: t.extendedProps?.projectId ? `/projects/${t.extendedProps.projectId}` : null,
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
            location: null,
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

  return (
    <div>
      {/* Toolbar — Craft Flow Lovable */}
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 rounded-lg border border-neya-border bg-white p-1">
          <button
            type="button"
            onClick={() => setView(new Date(view.getFullYear(), view.getMonth() - 1, 1))}
            className="grid h-7 w-7 place-items-center rounded-md text-neya-muted hover:bg-neya-surface hover:text-neya-ink"
            aria-label="Mois précédent"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => { setView(new Date(today)); setSelected(todayIso); }}
            className="h-7 rounded-md px-2.5 text-[12px] font-medium text-neya-ink hover:bg-neya-surface"
          >
            Aujourd&apos;hui
          </button>
          <button
            type="button"
            onClick={() => setView(new Date(view.getFullYear(), view.getMonth() + 1, 1))}
            className="grid h-7 w-7 place-items-center rounded-md text-neya-muted hover:bg-neya-surface hover:text-neya-ink"
            aria-label="Mois suivant"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        <h2 className="font-display text-[17px] font-semibold text-neya-ink">{monthLabel}</h2>

        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <span className="mr-1 hidden items-center gap-1 text-[11px] text-neya-muted sm:inline-flex">
            <Filter className="h-3.5 w-3.5" /> Filtres
          </span>
          <FilterChip label="Tout" active={filter === 'all'} onClick={() => setFilter('all')} />
          {FILTER_KEYS.map(k => (
            <FilterChip
              key={k}
              label={CATEGORY_META[k].label}
              dot={CATEGORY_META[k].dot}
              active={filter === k}
              onClick={() => setFilter(k)}
            />
          ))}
        </div>
      </div>

      {err && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{err}</div>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        {/* Month grid */}
        <div className="overflow-hidden rounded-2xl border border-neya-border bg-white shadow-sm">
          <div className="grid grid-cols-7 border-b border-neya-border bg-neya-surface/40">
            {DAYS_FR_SHORT.map(d => (
              <div
                key={d}
                className="px-2 py-2 text-center text-[10.5px] font-semibold uppercase tracking-[0.14em] text-neya-muted"
              >
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
              const evts = eventsByDate.get(key) || [];
              return (
                <button
                  key={key + i}
                  type="button"
                  onClick={() => setSelected(key)}
                  className={[
                    'group relative flex min-h-[86px] flex-col gap-1 border-b border-r border-neya-border p-2 text-left transition-colors lg:min-h-[104px]',
                    !inMonth ? 'bg-neya-surface/25 text-neya-muted' : '',
                    isSelected ? 'bg-neya-orange/[0.06] ring-1 ring-inset ring-neya-orange/30' : 'hover:bg-neya-surface/40',
                    (i + 1) % 7 === 0 ? 'border-r-0' : '',
                    i >= 35 ? 'border-b-0' : '',
                  ].join(' ')}
                >
                  <span
                    className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-[12px] font-semibold ${
                      isToday
                        ? 'bg-neya-orange text-white'
                        : inMonth
                          ? 'text-neya-ink'
                          : 'text-neya-muted'
                    }`}
                  >
                    {d.getDate()}
                  </span>
                  <div className="flex flex-col gap-0.5">
                    {evts.slice(0, 3).map(e => {
                      const meta = CATEGORY_META[e.category] || CATEGORY_META.production;
                      return (
                        <span
                          key={e.id}
                          className={`flex items-center gap-1 truncate rounded px-1 py-0.5 text-[10.5px] font-medium border ${meta.chip}`}
                          title={`${e.start} ${e.title}`}
                        >
                          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${meta.dot}`} />
                          <span className="hidden truncate lg:inline">{e.title}</span>
                          <span className="truncate lg:hidden">{e.start}</span>
                        </span>
                      );
                    })}
                    {evts.length > 3 && (
                      <span className="px-1 text-[10px] text-neya-muted">
                        +{evts.length - 3} de plus
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
          {loading && (
            <p className="border-t border-neya-border px-4 py-3 text-sm text-neya-muted">Chargement…</p>
          )}
        </div>

        {/* Day detail — Craft Flow */}
        <aside className="flex flex-col gap-3">
          <div className="rounded-2xl border border-neya-border bg-white p-4 shadow-sm">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-neya-muted">
              {formatDayLabel(selected)}
            </p>
            <p className="mt-0.5 font-display text-[22px] font-semibold text-neya-ink">
              {selectedEvents.length} événement{selectedEvents.length > 1 ? 's' : ''}
            </p>
            <button
              type="button"
              onClick={() => setShowAdd(v => !v)}
              className="mt-3 inline-flex h-8 items-center gap-1.5 rounded-lg bg-neya-ink px-3 text-[12.5px] font-medium text-white hover:bg-neya-ink/90"
            >
              <Plus className="h-3.5 w-3.5" /> Ajouter à cette date
            </button>
          </div>

          {showAdd && (
            <form onSubmit={createEvent} className="space-y-2 rounded-2xl border border-neya-border bg-white p-3 shadow-sm">
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

          <div className="flex flex-col gap-2">
            {selectedEvents.length === 0 && !loading && (
              <div className="rounded-2xl border border-dashed border-neya-border bg-white/60 p-6 text-center">
                <Clock className="mx-auto h-5 w-5 text-neya-muted" />
                <p className="mt-2 text-[13px] font-medium text-neya-ink">Journée libre</p>
                <p className="text-[12px] text-neya-muted">Aucun événement planifié.</p>
              </div>
            )}
            {selectedEvents.map(e => {
              const meta = CATEGORY_META[e.category] || CATEGORY_META.production;
              const Icon = meta.Icon;
              const body = (
                <article className={`rounded-xl border border-neya-border border-l-4 bg-white p-3 shadow-sm ${meta.bar}`}>
                  <div className="flex items-start gap-2.5">
                    <span className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg border ${meta.chip}`}>
                      <Icon className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13.5px] font-semibold text-neya-ink">{e.title}</p>
                      <p className="text-[11.5px] text-neya-muted">
                        {e.start} – {e.end}
                        {e.location ? ` · ${e.location}` : ''}
                      </p>
                      {e.project && (
                        <p className="mt-1 inline-flex rounded-md bg-neya-surface px-1.5 py-0.5 text-[10.5px] font-medium text-neya-ink">
                          {e.project}
                        </p>
                      )}
                    </div>
                  </div>
                </article>
              );
              return e.href ? (
                <Link key={e.id} href={e.href} className="block hover:opacity-90">{body}</Link>
              ) : (
                <div key={e.id}>{body}</div>
              );
            })}
          </div>
        </aside>
      </div>
    </div>
  );
}

export default function CalendarPage() {
  const [mode, setMode] = useState('mois');

  return (
    <AuthGuard>
      <AppShell
        title="Calendrier"
        subtitle="Planning atelier · livraisons · rendez-vous"
        wide
      >
        {/* Vue mois = Craft Flow ; équipe conservée en secondaire */}
        <div className="mb-4 flex justify-end">
          <div className="inline-flex rounded-lg border border-neya-border bg-white p-0.5 text-[12px]">
            <button
              type="button"
              onClick={() => setMode('mois')}
              className={`h-7 rounded-md px-2.5 font-medium ${
                mode === 'mois' ? 'bg-neya-ink text-white' : 'text-neya-muted hover:text-neya-ink'
              }`}
            >
              Mois
            </button>
            <button
              type="button"
              onClick={() => setMode('equipe')}
              className={`h-7 rounded-md px-2.5 font-medium ${
                mode === 'equipe' ? 'bg-neya-ink text-white' : 'text-neya-muted hover:text-neya-ink'
              }`}
            >
              Équipe
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

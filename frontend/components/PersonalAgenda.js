'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Plus } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth-context';
import { hasPermission, isAdmin } from '../lib/permissions';
import {
  addDays,
  blockOnDate,
  blockView,
  localISODate,
  monthGridStart,
  shiftMonthKeepingDay,
  slotPayload,
  startOfWeek,
  weekIndexInMonth,
} from '../lib/agenda';
import AgendaBlockModal from './AgendaBlockModal';
import CalendarTaskModal from './CalendarTaskModal';

const START_HOUR = 7;
const END_HOUR = 20;
const HOUR_PX = 46;
const HOUR_PX_MOBILE = 52;
const ROW_H = 56;
const DAYS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

function dayItems(dateKey, blocks, tasks) {
  const colBlocks = blocks.filter(b => blockOnDate(b, dateKey));
  const colTasks = tasks.filter(t => t.start && localISODate(new Date(t.start)) === dateKey);
  return { colBlocks, colTasks };
}

function TimelineColumn({
  dateKey,
  hourPx,
  blocks,
  tasks,
  onSlot,
  onOpenBlock,
  onOpenTask,
  onDrop,
}) {
  const { colBlocks, colTasks } = dayItems(dateKey, blocks, tasks);
  const span = (END_HOUR - START_HOUR) * hourPx;

  return (
    <div
      className="relative border-l border-neya-border"
      style={{ height: span }}
      onClick={e => onSlot(e, dateKey, hourPx)}
      onDragOver={onDrop ? (e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }) : undefined}
      onDrop={onDrop ? (e => onDrop(e, dateKey)) : undefined}
    >
      {Array.from({ length: END_HOUR - START_HOUR }, (_, i) => (
        <div key={i} className="absolute left-0 right-0 border-t border-neya-border/70" style={{ top: i * hourPx }} />
      ))}
      {colTasks.map(t => {
        const start = new Date(t.start);
        const end = t.end ? new Date(t.end) : new Date(start.getTime() + 3600000);
        const top = ((start.getHours() * 60 + start.getMinutes()) - START_HOUR * 60) / 60 * hourPx;
        const height = Math.max(36, ((end - start) / 3600000) * hourPx);
        if (top > span || top + height < 0) return null;
        return (
          <button
            key={`task-${t.id}`}
            type="button"
            data-block
            draggable
            onDragStart={e => {
              e.dataTransfer.setData('application/x-neya-agenda', JSON.stringify({ kind: 'task', id: t.id }));
              e.dataTransfer.setData('text/plain', String(t.id));
              e.dataTransfer.effectAllowed = 'move';
            }}
            onClick={e => { e.stopPropagation(); onOpenTask(t); }}
            className="absolute left-1 right-1 z-10 overflow-hidden rounded-lg border border-neya-ink/15 bg-neya-ink/[0.06] px-2 py-1 text-left"
            style={{ top: Math.max(0, top), height }}
          >
            <span className="block truncate text-[13px] font-medium text-neya-ink">{t.title}</span>
          </button>
        );
      })}
      {colBlocks.map(b => {
        const view = blockView(b);
        const top = ((view.start.getHours() * 60 + view.start.getMinutes()) - START_HOUR * 60) / 60 * hourPx;
        const height = Math.max(40, ((view.end - view.start) / 3600000) * hourPx);
        if (top > span || top + height < 0) return null;
        const tone = b.kind === 'time_entry'
          ? 'border-sky-300 bg-sky-50 text-sky-950'
          : 'border-neya-orange/40 bg-neya-orange/[0.14] text-neya-ink';
        return (
          <button
            key={b.id}
            type="button"
            data-block
            draggable
            onDragStart={e => {
              e.dataTransfer.setData('application/x-neya-agenda', JSON.stringify({ kind: 'hours', id: b.id }));
              e.dataTransfer.setData('text/plain', b.id);
              e.dataTransfer.effectAllowed = 'move';
            }}
            onClick={e => { e.stopPropagation(); onOpenBlock(b); }}
            className={`absolute left-1 right-1 z-20 overflow-hidden rounded-lg border px-2 py-1 text-left shadow-sm ${tone} ${view.inferred ? 'border-dashed' : ''}`}
            style={{ top: Math.max(0, top), height }}
          >
            <span className="block truncate text-[13px] font-semibold leading-tight">{view.startHm} {b.title}</span>
            {height > 48 && (
              <span className="block truncate text-[11px] opacity-80">
                {view.endHm}
                {b.kind === 'time_entry' ? ' · Mes heures' : ' · Projet'}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** Glissement horizontal d’une page (semaine ou mois), ancré comme JTAppleCalendar. */
function useCalendarPager(onCommit) {
  const boxRef = useRef(null);
  const origin = useRef(null);
  const dxRef = useRef(0);
  const pending = useRef(0);
  const timer = useRef(null);
  const commitRef = useRef(onCommit);
  commitRef.current = onCommit;
  const suppressTap = useRef(false);
  const [dx, setDx] = useState(0);
  const [animate, setAnimate] = useState(false);

  const finish = useCallback(() => {
    const dir = pending.current;
    if (!dir) return;
    pending.current = 0;
    window.clearTimeout(timer.current);
    dxRef.current = 0;
    setAnimate(false);
    setDx(0);
    commitRef.current(dir);
  }, []);

  function reset() {
    pending.current = 0;
    window.clearTimeout(timer.current);
    origin.current = null;
    dxRef.current = 0;
    setAnimate(false);
    setDx(0);
  }

  function onPointerDown(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    origin.current = { x: e.clientX, y: e.clientY, lock: null, id: e.pointerId };
    pending.current = 0;
    window.clearTimeout(timer.current);
    setAnimate(false);
  }

  function onPointerMove(e) {
    const o = origin.current;
    if (!o || e.pointerId !== o.id) return;
    const x = e.clientX - o.x;
    const y = e.clientY - o.y;
    if (!o.lock) {
      if (Math.abs(x) < 8 && Math.abs(y) < 8) return;
      o.lock = Math.abs(x) > Math.abs(y) ? 'x' : 'y';
      if (o.lock === 'x') boxRef.current?.setPointerCapture?.(e.pointerId);
    }
    if (o.lock !== 'x') return;
    dxRef.current = x;
    setDx(x);
  }

  function onPointerEnd(e) {
    const o = origin.current;
    if (!o || (e && e.pointerId !== o.id)) return;
    const locked = o.lock;
    origin.current = null;
    if (locked !== 'x') {
      dxRef.current = 0;
      setDx(0);
      return;
    }
    const current = dxRef.current;
    if (Math.abs(current) > 10) {
      suppressTap.current = true;
      window.setTimeout(() => { suppressTap.current = false; }, 400);
    }
    const w = boxRef.current?.clientWidth || 320;
    let dir = 0;
    let target = 0;
    if (current <= -48) {
      dir = 1;
      target = -w;
    } else if (current >= 48) {
      dir = -1;
      target = w;
    }
    pending.current = dir;
    dxRef.current = target;
    setAnimate(true);
    setDx(target);
    window.clearTimeout(timer.current);
    if (dir) timer.current = window.setTimeout(finish, 360);
  }

  function onTransitionEnd(e) {
    if (e.propertyName !== 'transform') return;
    finish();
  }

  return {
    boxRef, dx, animate, suppressTap, reset,
    onPointerDown, onPointerMove, onPointerEnd, onTransitionEnd,
  };
}

function pageCaption(pageDate, rows) {
  if (rows === 6) {
    return pageDate.toLocaleDateString('fr-CA', { month: 'long', year: 'numeric' });
  }
  const start = startOfWeek(pageDate);
  const end = addDays(start, 6);
  const opt = { day: 'numeric', month: 'short' };
  return `${start.toLocaleDateString('fr-CA', opt)} – ${end.toLocaleDateString('fr-CA', opt)}`;
}

function MonthGrid({ pageDate, rows, selectedKey, today, counts, onSelect, animateRows }) {
  const gridStart = monthGridStart(pageDate);
  const cells = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  const weekIndex = weekIndexInMonth(pageDate, pageDate);
  const collapsed = rows === 1;

  return (
    <div
      className="overflow-hidden motion-reduce:transition-none"
      style={{
        height: rows * ROW_H,
        transition: 'height 300ms cubic-bezier(0.22, 1, 0.36, 1)',
      }}
    >
      <div
        className="motion-reduce:transition-none"
        style={{
          transform: collapsed ? `translateY(-${weekIndex * ROW_H}px)` : 'translateY(0px)',
          transition: animateRows ? 'transform 300ms cubic-bezier(0.22, 1, 0.36, 1)' : 'none',
        }}
      >
        {Array.from({ length: 6 }, (_, row) => (
          <div
            key={row}
            className={`grid grid-cols-7 ${rows === 6 && row === weekIndex ? 'bg-neya-orange/[0.06]' : ''}`}
            style={{ height: ROW_H }}
          >
            {cells.slice(row * 7, row * 7 + 7).map(d => {
              const key = localISODate(d);
              const active = key === selectedKey;
              const isToday = key === today;
              const faded = rows === 6 && d.getMonth() !== pageDate.getMonth();
              const count = counts[key] || 0;
              return (
                <button
                  key={key}
                  type="button"
                  aria-pressed={active}
                  aria-label={d.toLocaleDateString('fr-CA', { weekday: 'long', day: 'numeric', month: 'long' })}
                  onClick={() => onSelect(key)}
                  className="flex h-full flex-col items-center justify-center gap-1"
                >
                  <span className={`grid h-9 w-9 place-items-center rounded-full text-[15px] font-semibold tabular-nums ${
                    active
                      ? 'bg-neya-orange text-white'
                      : faded
                        ? 'text-neya-muted/50'
                        : isToday
                          ? 'text-neya-orange ring-1 ring-neya-orange'
                          : 'text-neya-ink'
                  }`}>
                    {d.getDate()}
                  </span>
                  <span className={`h-1.5 w-1.5 rounded-full ${count ? 'bg-neya-orange' : 'bg-transparent'}`} />
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function shiftTask(task, dateKey) {
  const start = new Date(task.start);
  const end = task.end ? new Date(task.end) : new Date(start.getTime() + 3600000);
  const [y, m, d] = dateKey.split('-').map(Number);
  const nextStart = new Date(start);
  nextStart.setFullYear(y, m - 1, d);
  const duration = Math.max(15 * 60000, end - start);
  const nextEnd = new Date(nextStart.getTime() + duration);
  return { start_time: nextStart.toISOString(), end_time: nextEnd.toISOString() };
}

export default function PersonalAgenda({ initialDate }) {
  const { user } = useAuth();
  const canManageAll = isAdmin(user) || hasPermission(user, 'team');
  const [anchor, setAnchor] = useState(() => {
    if (initialDate && /^\d{4}-\d{2}-\d{2}$/.test(initialDate)) {
      return new Date(`${initialDate}T12:00:00`);
    }
    return new Date();
  });
  const [selected, setSelected] = useState(() => (
    initialDate && /^\d{4}-\d{2}-\d{2}$/.test(initialDate) ? initialDate : localISODate()
  ));
  const [blocks, setBlocks] = useState([]);
  const [summary, setSummary] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [projects, setProjects] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [draft, setDraft] = useState(null);
  const [editBlock, setEditBlock] = useState(null);
  const [editTaskId, setEditTaskId] = useState(null);
  const suppressClickRef = useRef(false);
  const swipeRef = useRef(null);
  const mobileScrollRef = useRef(null);
  const handleY = useRef(null);
  const handleDragged = useRef(false);
  const rowTimer = useRef(null);
  /** 6 = mois, 1 = semaine ancrée sur le jour choisi (modèle JTAppleCalendar). */
  const [calendarRows, setCalendarRows] = useState(1);
  const [rowAnim, setRowAnim] = useState(false);

  const weekStart = useMemo(() => startOfWeek(anchor), [anchor]);
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
  const range = useMemo(() => {
    const prev = monthGridStart(new Date(anchor.getFullYear(), anchor.getMonth() - 1, 1, 12));
    const nextEnd = addDays(monthGridStart(new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1, 12)), 41);
    const weekEnd = addDays(weekStart, 6);
    const start = prev < weekStart ? prev : weekStart;
    const end = nextEnd > weekEnd ? nextEnd : weekEnd;
    return { from: localISODate(start), to: localISODate(end) };
  }, [anchor, weekStart]);
  const { from, to } = range;
  const today = localISODate();

  const load = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const [agenda, taskRows] = await Promise.all([
        api(`/agenda?from=${from}&to=${to}`),
        api(`/tasks/calendar?start=${from}T00:00:00&end=${to}T23:59:59`).catch(() => []),
      ]);
      setBlocks(Array.isArray(agenda?.blocks) ? agenda.blocks : []);
      setSummary(agenda?.summary || null);
      setTasks(Array.isArray(taskRows) ? taskRows : []);
    } catch (e) {
      setErr(e.message || 'Impossible de charger l’agenda');
      setBlocks([]);
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    api('/projects').then(list => {
      const rows = (Array.isArray(list) ? list : []).filter(p => {
        const s = String(p.status || 'active').toLowerCase();
        return !['cancelled', 'canceled', 'annule', 'annulé'].includes(s);
      });
      rows.sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'fr'));
      setProjects(rows);
    }).catch(() => setProjects([]));
    if (!canManageAll) return;
    api('/employees').then(list => {
      setEmployees((Array.isArray(list) ? list : []).filter(e => e.active !== false));
    }).catch(() => setEmployees([]));
  }, [canManageAll]);

  const dayBlocks = useMemo(
    () => blocks.filter(b => blockOnDate(b, selected)),
    [blocks, selected]
  );

  function openCreate(date, start = '09:00', end = '12:00') {
    setSelected(date);
    setEditBlock(null);
    setDraft({ date, start, end });
  }

  function openBlock(block) {
    const view = blockView(block);
    setSelected(view.date);
    setDraft(null);
    setEditBlock({ block, initial: { date: view.date, start: view.startHm, end: view.endHm } });
  }

  async function moveBlock(block, dateKey) {
    const view = blockView(block);
    const payload = slotPayload({
      id: block.id,
      date: dateKey,
      start: view.startHm,
      end: view.endHm,
      project_id: block.project_id,
      label: block.label,
      notes: block.notes,
    });
    await api('/agenda/blocks', { method: 'PATCH', body: JSON.stringify(payload) });
    setSelected(dateKey);
    await load();
  }

  async function onDropBlock(e, dateKey) {
    e.preventDefault();
    suppressClickRef.current = true;
    setTimeout(() => { suppressClickRef.current = false; }, 400);
    const raw = e.dataTransfer.getData('application/x-neya-agenda') || e.dataTransfer.getData('text/plain');
    if (!raw) return;
    try {
      const data = JSON.parse(raw);
      if (data.kind === 'task' && data.id) {
        const task = tasks.find(t => String(t.id) === String(data.id));
        if (!task) return;
        await api(`/tasks/${data.id}/schedule`, { method: 'PATCH', body: JSON.stringify(shiftTask(task, dateKey)) });
        setSelected(dateKey);
        await load();
        return;
      }
      const block = blocks.find(b => b.id === data.id);
      if (!block) return;
      await moveBlock(block, dateKey);
    } catch (error) {
      setErr(error.message || 'Déplacement impossible');
    }
  }

  function onColumnClick(e, dateKey, hourPx = HOUR_PX) {
    if (suppressClickRef.current) return;
    if (e.target.closest('[data-block]')) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const hour = Math.min(END_HOUR - 1, Math.max(START_HOUR, START_HOUR + Math.floor(y / hourPx)));
    const endHour = Math.min(END_HOUR, hour + 2);
    openCreate(
      dateKey,
      `${String(hour).padStart(2, '0')}:00`,
      `${String(endHour).padStart(2, '0')}:00`
    );
  }

  function goToDay(dateKey) {
    setSelected(dateKey);
    setAnchor(new Date(`${dateKey}T12:00:00`));
  }

  function shiftDay(delta) {
    const next = addDays(new Date(`${selected}T12:00:00`), delta);
    goToDay(localISODate(next));
  }

  function onSwipeStart(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    swipeRef.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
  }

  function onSwipeEnd(e) {
    const start = swipeRef.current;
    swipeRef.current = null;
    if (!start || (e.pointerId != null && e.pointerId !== start.id)) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (Math.abs(dx) < 56 || Math.abs(dx) < Math.abs(dy) * 1.2) return;
    shiftDay(dx < 0 ? 1 : -1);
  }

  useEffect(() => {
    const el = mobileScrollRef.current;
    if (!el || typeof window === 'undefined' || window.innerWidth >= 1024) return;
    const now = new Date();
    const focus = selected === today ? now.getHours() : 8;
    el.scrollTop = Math.max(0, (focus - START_HOUR - 1) * HOUR_PX_MOBILE);
  }, [selected, today]);

  const weekLabel = `${days[0].toLocaleDateString('fr-CA', { day: 'numeric', month: 'short' })} – ${days[6].toLocaleDateString('fr-CA', { day: 'numeric', month: 'short', year: 'numeric' })}`;
  const selectedDate = new Date(`${selected}T12:00:00`);
  const countsByDay = useMemo(() => {
    const map = {};
    const add = (key) => {
      if (!key) return;
      map[key] = (map[key] || 0) + 1;
    };
    for (const block of blocks) add(blockView(block).date);
    for (const task of tasks) {
      if (task.start) add(localISODate(new Date(task.start)));
    }
    return map;
  }, [blocks, tasks]);

  function dateForOffset(offset) {
    if (calendarRows === 6) return shiftMonthKeepingDay(selected, offset);
    return addDays(new Date(`${selected}T12:00:00`), offset * 7);
  }

  function commitPage(delta) {
    if (calendarRows === 6) goToDay(localISODate(shiftMonthKeepingDay(selected, delta)));
    else goToDay(localISODate(addDays(new Date(`${selected}T12:00:00`), delta * 7)));
  }

  const pager = useCalendarPager(commitPage);

  function toggleRows() {
    setRowAnim(true);
    window.clearTimeout(rowTimer.current);
    rowTimer.current = window.setTimeout(() => setRowAnim(false), 340);
    setCalendarRows(rows => (rows === 6 ? 1 : 6));
    pager.reset();
  }

  function onChevron(delta) {
    if (calendarRows === 6) goToDay(localISODate(shiftMonthKeepingDay(selected, delta)));
    else shiftDay(delta);
  }

  function selectFromGrid(dateKey) {
    if (pager.suppressTap.current) return;
    goToDay(dateKey);
  }

  function onHandleStart(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    handleY.current = e.clientY;
    handleDragged.current = false;
  }

  function onHandleMove(e) {
    if (handleY.current == null) return;
    if (Math.abs(e.clientY - handleY.current) > 12) handleDragged.current = true;
  }

  function onHandleEnd(e) {
    if (handleY.current == null) return;
    const dy = e.clientY - handleY.current;
    handleY.current = null;
    if (Math.abs(dy) > 12) handleDragged.current = true;
    if (dy > 36 && calendarRows === 1) toggleRows();
    else if (dy < -36 && calendarRows === 6) toggleRows();
  }

  function onHandleClick() {
    if (handleDragged.current) {
      handleDragged.current = false;
      return;
    }
    toggleRows();
  }

  return (
    <div className="space-y-4">
      <p className="hidden sm:block text-[12px] text-neya-muted neya-enter">
        Les dates déjà inscrites dans les <strong className="text-neya-ink font-medium">projets</strong> et dans{' '}
        <Link href="/mes-heures" className="text-neya-orange hover:underline">Mes heures</Link> sont placées ici.
        Rien n’est effacé. Un bloc écrit dans le projet et dans les heures, et l’inverse.
        {summary ? ` ${summary.total} bloc${summary.total > 1 ? 's' : ''} cette semaine.` : ''}
      </p>

      <div className="lg:hidden -mx-4">
        <div className="px-4 pb-1 flex items-center gap-2">
          <button
            type="button"
            className="grid h-11 w-11 place-items-center rounded-full border border-neya-border bg-white"
            aria-label={calendarRows === 6 ? 'Mois précédent' : 'Jour précédent'}
            onClick={() => onChevron(-1)}
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button type="button" className="flex-1 text-center min-w-0" onClick={() => goToDay(today)}>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-neya-muted">
              {calendarRows === 6
                ? 'Mois'
                : (selected === today ? "Aujourd’hui" : selectedDate.toLocaleDateString('fr-CA', { weekday: 'long' }))}
            </p>
            <p className="font-display text-[17px] font-semibold text-neya-ink capitalize truncate">
              {calendarRows === 6
                ? selectedDate.toLocaleDateString('fr-CA', { month: 'long', year: 'numeric' })
                : selectedDate.toLocaleDateString('fr-CA', { day: 'numeric', month: 'long' })}
            </p>
          </button>
          <button
            type="button"
            className="grid h-11 w-11 place-items-center rounded-full border border-neya-border bg-white"
            aria-label={calendarRows === 6 ? 'Mois suivant' : 'Jour suivant'}
            onClick={() => onChevron(1)}
          >
            <ChevronRight className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={() => openCreate(selected)}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-neya-orange text-white"
            aria-label="Ajouter un bloc d’heures"
          >
            <Plus className="h-5 w-5" />
          </button>
        </div>

        <div className="grid grid-cols-7 px-1 pb-0.5">
          {DAYS.map(label => (
            <span key={label} className="text-center text-[10px] font-semibold uppercase tracking-wide text-neya-muted">{label}</span>
          ))}
        </div>

        <div
          ref={pager.boxRef}
          className="overflow-hidden touch-pan-y"
          onPointerDown={pager.onPointerDown}
          onPointerMove={pager.onPointerMove}
          onPointerUp={pager.onPointerEnd}
          onPointerCancel={pager.onPointerEnd}
        >
          <div
            className="flex w-[300%] motion-reduce:transition-none"
            style={{
              transform: `translateX(calc(-33.333333% + ${pager.dx}px))`,
              transition: pager.animate ? 'transform 280ms cubic-bezier(0.22, 1, 0.36, 1)' : 'none',
            }}
            onTransitionEnd={pager.onTransitionEnd}
          >
            {[-1, 0, 1].map(offset => {
              const pageDate = dateForOffset(offset);
              return (
                <div key={offset} className="w-1/3">
                  <p className="h-5 px-2 text-center text-[11px] font-semibold capitalize tracking-wide text-neya-muted truncate">
                    {pageCaption(pageDate, calendarRows)}
                  </p>
                  <MonthGrid
                    pageDate={pageDate}
                    rows={calendarRows}
                    selectedKey={localISODate(pageDate)}
                    today={today}
                    counts={countsByDay}
                    animateRows={rowAnim}
                    onSelect={selectFromGrid}
                  />
                </div>
              );
            })}
          </div>
        </div>

        <button
          type="button"
          aria-expanded={calendarRows === 6}
          onClick={onHandleClick}
          onPointerDown={onHandleStart}
          onPointerMove={onHandleMove}
          onPointerUp={onHandleEnd}
          className="flex w-full flex-col items-center gap-1 py-2"
        >
          <span className="h-1 w-9 rounded-full bg-neya-border" />
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-neya-muted">
            {calendarRows === 6 ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            {calendarRows === 6 ? 'Semaine' : 'Mois'}
          </span>
        </button>

        {calendarRows === 6 && (
          <p className="px-4 pb-1 text-[13px] font-semibold capitalize text-neya-ink">
            {selectedDate.toLocaleDateString('fr-CA', { weekday: 'long', day: 'numeric', month: 'long' })}
          </p>
        )}

        <div
          ref={mobileScrollRef}
          className={`${calendarRows === 6 ? 'max-h-[40vh]' : 'max-h-[62vh]'} overflow-y-auto overscroll-contain border-y border-neya-border bg-white`}
          onPointerDown={onSwipeStart}
          onPointerUp={onSwipeEnd}
          onPointerCancel={onSwipeEnd}
        >
          <div className="grid grid-cols-[52px_1fr]">
            <div className="relative" style={{ height: (END_HOUR - START_HOUR) * HOUR_PX_MOBILE }}>
              {Array.from({ length: END_HOUR - START_HOUR }, (_, i) => (
                <div key={i} className="absolute right-1 text-[11px] tabular-nums text-neya-muted" style={{ top: i * HOUR_PX_MOBILE - 7 }}>
                  {String(START_HOUR + i).padStart(2, '0')}
                </div>
              ))}
            </div>
            <TimelineColumn
              dateKey={selected}
              hourPx={HOUR_PX_MOBILE}
              blocks={blocks}
              tasks={tasks}
              onSlot={onColumnClick}
              onOpenBlock={openBlock}
              onOpenTask={t => setEditTaskId(String(t.extendedProps?.taskId || t.id))}
            />
          </div>
          {loading && <p className="px-4 py-3 text-sm text-neya-muted">Chargement…</p>}
        </div>
        <p className="px-4 pt-2 text-[12px] text-neya-muted">
          {calendarRows === 6
            ? 'Glissez pour changer de mois. Touchez un jour, puis une heure vide pour poser un bloc.'
            : 'Glissez le calendrier pour changer de semaine, la journée pour changer de jour. Touchez « Mois » pour déplier les 6 rangées.'}
        </p>
      </div>

      <div className="hidden lg:flex flex-wrap items-center gap-2 neya-enter">
        <div className="neya-segment">
          <button type="button" className="neya-segment-btn !px-2" aria-label="Semaine précédente" onClick={() => setAnchor(addDays(weekStart, -7))}>
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button type="button" className="neya-segment-btn" onClick={() => { setAnchor(new Date()); setSelected(today); }}>
            Aujourd’hui
          </button>
          <button type="button" className="neya-segment-btn !px-2" aria-label="Semaine suivante" onClick={() => setAnchor(addDays(weekStart, 7))}>
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        <h2 className="font-display text-lg font-semibold text-neya-ink capitalize">{weekLabel}</h2>
        <button type="button" className="btn-primary text-sm ml-auto gap-1.5" onClick={() => openCreate(selected)}>
          <Plus className="h-4 w-4" /> Bloc d’heures
        </button>
      </div>

      {err && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{err}</div>}

      <div className="hidden lg:grid lg:grid-cols-[1fr_320px] gap-4">
        <div className="overflow-x-auto rounded-2xl border border-neya-border bg-white shadow-sm">
          <div className="min-w-[840px]">
            <div className="grid grid-cols-[56px_repeat(7,1fr)] border-b border-neya-border bg-neya-surface/60">
              <div />
              {days.map((d, i) => {
                const key = localISODate(d);
                const active = key === selected;
                const isToday = key === today;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setSelected(key)}
                    onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }}
                    onDrop={e => onDropBlock(e, key)}
                    className={`px-2 py-2 text-center border-l border-neya-border ${active ? 'bg-neya-orange/[0.08]' : ''}`}
                  >
                    <span className="block text-[11px] font-semibold uppercase tracking-wider text-neya-muted">{DAYS[i]}</span>
                    <span className={`mt-1 inline-flex h-7 w-7 items-center justify-center rounded-full text-sm font-semibold ${isToday ? 'bg-neya-orange text-white' : 'text-neya-ink'}`}>
                      {d.getDate()}
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="grid grid-cols-[56px_repeat(7,1fr)]">
              <div className="relative" style={{ height: (END_HOUR - START_HOUR) * HOUR_PX }}>
                {Array.from({ length: END_HOUR - START_HOUR }, (_, i) => (
                  <div key={i} className="absolute left-0 right-0 text-[10px] text-neya-muted text-right pr-1.5" style={{ top: i * HOUR_PX - 6 }}>
                    {String(START_HOUR + i).padStart(2, '0')}:00
                  </div>
                ))}
              </div>
              {days.map(d => {
                const key = localISODate(d);
                return (
                  <TimelineColumn
                    key={key}
                    dateKey={key}
                    hourPx={HOUR_PX}
                    blocks={blocks}
                    tasks={tasks}
                    onSlot={onColumnClick}
                    onOpenBlock={openBlock}
                    onOpenTask={t => setEditTaskId(String(t.extendedProps?.taskId || t.id))}
                    onDrop={onDropBlock}
                  />
                );
              })}
            </div>
          </div>
          {loading && <p className="px-4 py-3 text-sm text-neya-muted border-t border-neya-border">Chargement…</p>}
        </div>

        <aside className="cf-panel flex flex-col min-h-[280px]">
          <h3 className="font-display text-[16px] font-semibold text-neya-ink">
            {new Date(`${selected}T12:00:00`).toLocaleDateString('fr-CA', { weekday: 'long', day: 'numeric', month: 'long' })}
          </h3>
          <p className="text-[12px] text-neya-muted mt-0.5 mb-3">
            {dayBlocks.length} bloc{dayBlocks.length > 1 ? 's' : ''} d’heures
          </p>
          <button type="button" className="btn-primary text-sm w-full mb-4 gap-1.5" onClick={() => openCreate(selected)}>
            <Plus className="h-4 w-4" /> Attribuer un bloc
          </button>
          <div className="space-y-2 overflow-y-auto">
            {dayBlocks.length === 0 && !loading && (
              <p className="text-sm text-neya-muted rounded-xl border border-dashed border-neya-border px-3 py-6 text-center">
                Aucune heure placée ce jour. Cliquez la grille ou ajoutez un bloc.
              </p>
            )}
            {dayBlocks.map(b => {
              const view = blockView(b);
              return (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => openBlock(b)}
                  className="w-full text-left rounded-xl border border-neya-border px-3 py-2.5 hover:bg-neya-surface/60"
                >
                  <p className="text-sm font-medium text-neya-ink">{b.title}</p>
                  <p className="text-[12px] text-neya-muted mt-0.5 tabular-nums">
                    {view.startHm} – {view.endHm}
                    {b.hours ? ` · ${b.hours} h` : ''}
                    {view.inferred ? ' · horaire estimé' : ''}
                  </p>
                  <p className="text-[11px] text-neya-orange mt-1 font-medium">
                    {b.kind === 'time_entry' ? 'Mes heures' : 'Projet'}
                    {b.project_id ? ' · modifier' : ' · attribuer à un projet'}
                  </p>
                </button>
              );
            })}
          </div>
        </aside>
      </div>

      {(draft || editBlock) && (
        <AgendaBlockModal
          block={editBlock?.block || null}
          initial={editBlock?.initial || draft}
          projects={projects}
          employees={employees}
          canManageAll={canManageAll}
          defaultEmployeeId={user?.employee_id}
          onClose={() => { setDraft(null); setEditBlock(null); }}
          onSaved={load}
        />
      )}
      {editTaskId && (
        <CalendarTaskModal taskId={editTaskId} onClose={() => setEditTaskId(null)} onSaved={load} />
      )}
    </div>
  );
}

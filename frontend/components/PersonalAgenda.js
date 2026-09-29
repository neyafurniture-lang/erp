'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth-context';
import { hasPermission, isAdmin } from '../lib/permissions';
import { addDays, blockOnDate, blockView, localISODate, slotPayload, startOfWeek } from '../lib/agenda';
import AgendaBlockModal from './AgendaBlockModal';
import CalendarTaskModal from './CalendarTaskModal';

const START_HOUR = 7;
const END_HOUR = 20;
const HOUR_PX = 46;
const DAYS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

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

  const weekStart = useMemo(() => startOfWeek(anchor), [anchor]);
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
  const from = localISODate(days[0]);
  const to = localISODate(days[6]);
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

  function onColumnClick(e, dateKey) {
    if (suppressClickRef.current) return;
    if (e.target.closest('[data-block]')) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const hour = Math.min(END_HOUR - 1, Math.max(START_HOUR, START_HOUR + Math.floor(y / HOUR_PX)));
    const endHour = Math.min(END_HOUR, hour + 2);
    openCreate(
      dateKey,
      `${String(hour).padStart(2, '0')}:00`,
      `${String(endHour).padStart(2, '0')}:00`
    );
  }

  const weekLabel = `${days[0].toLocaleDateString('fr-CA', { day: 'numeric', month: 'short' })} – ${days[6].toLocaleDateString('fr-CA', { day: 'numeric', month: 'short', year: 'numeric' })}`;

  return (
    <div className="space-y-4">
      <p className="text-[12px] text-neya-muted neya-enter">
        Les dates déjà inscrites dans les <strong className="text-neya-ink font-medium">projets</strong> et dans{' '}
        <Link href="/mes-heures" className="text-neya-orange hover:underline">Mes heures</Link> sont placées ici.
        Rien n’est effacé. Un bloc écrit dans le projet et dans les heures, et l’inverse.
        {summary ? ` ${summary.total} bloc${summary.total > 1 ? 's' : ''} cette semaine.` : ''}
      </p>

      <div className="flex flex-wrap items-center gap-2 neya-enter">
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

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-4">
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
                const colBlocks = blocks.filter(b => blockOnDate(b, key));
                const colTasks = tasks.filter(t => t.start && localISODate(new Date(t.start)) === key);
                return (
                  <div
                    key={key}
                    className="relative border-l border-neya-border"
                    style={{ height: (END_HOUR - START_HOUR) * HOUR_PX }}
                    onClick={e => onColumnClick(e, key)}
                    onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }}
                    onDrop={e => onDropBlock(e, key)}
                  >
                    {Array.from({ length: END_HOUR - START_HOUR }, (_, i) => (
                      <div key={i} className="absolute left-0 right-0 border-t border-neya-border/70" style={{ top: i * HOUR_PX }} />
                    ))}
                    {colTasks.map(t => {
                      const start = new Date(t.start);
                      const end = t.end ? new Date(t.end) : new Date(start.getTime() + 3600000);
                      const top = ((start.getHours() * 60 + start.getMinutes()) - START_HOUR * 60) / 60 * HOUR_PX;
                      const height = Math.max(22, ((end - start) / 3600000) * HOUR_PX);
                      if (top > (END_HOUR - START_HOUR) * HOUR_PX || top + height < 0) return null;
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
                          onClick={e => { e.stopPropagation(); setEditTaskId(String(t.extendedProps?.taskId || t.id)); }}
                          className="absolute left-1 right-1 z-10 overflow-hidden rounded-md border border-neya-ink/15 bg-neya-ink/[0.06] px-1.5 py-1 text-left"
                          style={{ top: Math.max(0, top), height }}
                          title={t.title}
                        >
                          <span className="block truncate text-[11px] font-medium text-neya-ink">{t.title}</span>
                        </button>
                      );
                    })}
                    {colBlocks.map(b => {
                      const view = blockView(b);
                      const top = ((view.start.getHours() * 60 + view.start.getMinutes()) - START_HOUR * 60) / 60 * HOUR_PX;
                      const height = Math.max(26, ((view.end - view.start) / 3600000) * HOUR_PX);
                      if (top > (END_HOUR - START_HOUR) * HOUR_PX || top + height < 0) return null;
                      const tone = b.kind === 'time_entry'
                        ? 'border-sky-300 bg-sky-50 text-sky-950'
                        : 'border-neya-orange/40 bg-neya-orange/[0.12] text-neya-ink';
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
                          onClick={e => { e.stopPropagation(); openBlock(b); }}
                          className={`absolute left-1 right-1 z-20 overflow-hidden rounded-md border px-1.5 py-1 text-left shadow-sm ${tone} ${view.inferred ? 'border-dashed' : ''}`}
                          style={{ top: Math.max(0, top), height }}
                          title={`${view.startHm}–${view.endHm} ${b.title}`}
                        >
                          <span className="block truncate text-[11px] font-semibold">{view.startHm} {b.title}</span>
                          {height > 36 && (
                            <span className="block truncate text-[10px] opacity-80">
                              {b.kind === 'time_entry' ? 'Mes heures' : (b.kind === 'linked' ? 'Projet + heures' : 'Carnet projet')}
                              {view.inferred ? ' · estimé' : ''}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
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

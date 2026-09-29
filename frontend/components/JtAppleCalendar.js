'use client';

import { useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import {
  DateOwner,
  isoDate,
  monthConfiguration,
  parseISODate,
  rangeAround,
  shiftMonthKeepingDay,
  visibleCells,
  weekConfiguration,
  buildCalendar,
  addDays,
} from '../lib/jtapple-calendar';

const ROW_H = 48;
const WEEKDAYS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

function DayCell({ cell, selected, today, count, muted, onSelect }) {
  const active = cell.key === selected;
  const isToday = cell.key === today;
  return (
    <button
      type="button"
      data-day={cell.key}
      aria-pressed={active}
      aria-label={cell.date.toLocaleDateString('fr-CA', { weekday: 'long', day: 'numeric', month: 'long' })}
      onClick={() => onSelect(cell.key)}
      className="flex h-12 flex-col items-center justify-center gap-0.5"
    >
      <span className={`grid h-9 w-9 place-items-center rounded-full text-[15px] font-semibold tabular-nums ${
        active
          ? 'bg-neya-orange text-white'
          : muted
            ? 'text-neya-muted/55'
            : isToday
              ? 'text-neya-orange ring-1 ring-neya-orange'
              : 'text-neya-ink'
      }`}>
        {cell.text}
      </span>
      <span className={`h-1.5 w-1.5 rounded-full ${count ? 'bg-neya-orange' : 'bg-transparent'}`} />
    </button>
  );
}

export default function JtAppleCalendar({
  selected,
  numberOfRows = 6,
  counts = {},
  today,
  onSelect,
  onNumberOfRows,
  onAdd,
}) {
  const boxRef = useRef(null);
  const dragRef = useRef(null);
  const suppressRef = useRef(false);
  const [dx, setDx] = useState(0);
  const rows = numberOfRows === 1 ? 1 : 6;
  const anchor = parseISODate(selected);

  const built = useMemo(() => {
    const range = rangeAround(selected, 14, 14);
    const parameters = rows === 1
      ? weekConfiguration(range.startDate, range.endDate)
      : monthConfiguration(range.startDate, range.endDate);
    return buildCalendar(parameters);
  }, [selected, rows]);

  const cells = useMemo(() => visibleCells(built, selected, rows), [built, selected, rows]);
  const monthLabel = anchor.toLocaleDateString('fr-CA', { month: 'long', year: 'numeric' });
  const weekLabel = cells.length
    ? `${cells[0].date.toLocaleDateString('fr-CA', { day: 'numeric', month: 'short' })} – ${cells[cells.length - 1].date.toLocaleDateString('fr-CA', { day: 'numeric', month: 'short' })}`
    : '';

  function page(delta) {
    if (rows === 6) onSelect(isoDate(shiftMonthKeepingDay(anchor, delta)));
    else onSelect(isoDate(addDays(anchor, delta * 7)));
  }

  function selectDay(key) {
    if (suppressRef.current) return;
    onSelect(key);
  }

  function onPointerDown(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    dragRef.current = { x: e.clientX, y: e.clientY, lock: null, id: e.pointerId };
    setDx(0);
  }

  function onPointerMove(e) {
    const drag = dragRef.current;
    if (!drag || e.pointerId !== drag.id) return;
    const x = e.clientX - drag.x;
    const y = e.clientY - drag.y;
    if (!drag.lock) {
      if (Math.abs(x) < 8 && Math.abs(y) < 8) return;
      drag.lock = Math.abs(x) > Math.abs(y) ? 'x' : 'y';
      if (drag.lock === 'x') boxRef.current?.setPointerCapture?.(e.pointerId);
    }
    if (drag.lock === 'x') setDx(x);
  }

  function onPointerUp(e) {
    const drag = dragRef.current;
    if (!drag || e.pointerId !== drag.id) return;
    dragRef.current = null;
    if (drag.lock !== 'x') {
      setDx(0);
      return;
    }
    const x = e.clientX - drag.x;
    if (Math.abs(x) > 10) {
      suppressRef.current = true;
      window.setTimeout(() => { suppressRef.current = false; }, 350);
    }
    setDx(0);
    if (x <= -48) page(1);
    else if (x >= 48) page(-1);
  }

  return (
    <div className="bg-white">
      <div className="flex items-center gap-2 px-3 pb-1 pt-1">
        <button
          type="button"
          className="grid h-11 w-11 place-items-center rounded-full border border-neya-border bg-white"
          aria-label={rows === 6 ? 'Mois précédent' : 'Semaine précédente'}
          onClick={() => page(-1)}
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <button type="button" className="min-w-0 flex-1 text-center" onClick={() => onSelect(today)}>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-neya-muted">
            {rows === 6 ? 'Mois' : (selected === today ? "Aujourd’hui" : 'Semaine')}
          </p>
          <p className="truncate font-display text-[17px] font-semibold capitalize text-neya-ink">
            {rows === 6 ? monthLabel : weekLabel}
          </p>
        </button>
        <button
          type="button"
          className="grid h-11 w-11 place-items-center rounded-full border border-neya-border bg-white"
          aria-label={rows === 6 ? 'Mois suivant' : 'Semaine suivante'}
          onClick={() => page(1)}
        >
          <ChevronRight className="h-5 w-5" />
        </button>
        {onAdd && (
          <button
            type="button"
            onClick={onAdd}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-neya-orange text-white lg:hidden"
            aria-label="Ajouter un bloc d’heures"
          >
            <Plus className="h-5 w-5" />
          </button>
        )}
      </div>

      <div className="grid grid-cols-7 px-1">
        {WEEKDAYS.map(label => (
          <span key={label} className="text-center text-[10px] font-semibold uppercase tracking-wide text-neya-muted">{label}</span>
        ))}
      </div>

      <div
        ref={boxRef}
        className="overflow-hidden touch-pan-y"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div
          className="motion-reduce:transition-none"
          style={{
            height: rows * ROW_H,
            transition: 'height 300ms cubic-bezier(0.22, 1, 0.36, 1)',
          }}
        >
          <div
            className="grid grid-cols-7"
            style={{ transform: `translateX(${dx}px)` }}
          >
            {cells.map(cell => (
              <DayCell
                key={`${cell.monthIndex}-${cell.section}-${cell.item}`}
                cell={cell}
                selected={selected}
                today={today}
                count={counts[cell.key] || 0}
                muted={rows === 6 && cell.owner !== DateOwner.thisMonth}
                onSelect={selectDay}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="flex justify-center px-3 py-2">
        <div className="neya-segment">
          <button
            type="button"
            className={`neya-segment-btn ${rows === 6 ? 'is-active' : ''}`}
            aria-pressed={rows === 6}
            onClick={() => onNumberOfRows(6)}
          >
            Mois
          </button>
          <button
            type="button"
            className={`neya-segment-btn ${rows === 1 ? 'is-active' : ''}`}
            aria-pressed={rows === 1}
            onClick={() => onNumberOfRows(1)}
          >
            Semaine
          </button>
        </div>
      </div>
    </div>
  );
}

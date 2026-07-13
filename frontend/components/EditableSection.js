'use client';

import { useRef } from 'react';

/**
 * Section dashboard déplaçable en mode édition (boutons ↑↓ + long-press mobile).
 */
export default function EditableSection({
  section,
  editMode,
  onMoveUp,
  onMoveDown,
  onHide,
  children,
  className = '',
}) {
  const timerRef = useRef(null);
  const longPressed = useRef(false);

  if (!editMode) {
    return <div className={className}>{children}</div>;
  }

  function clearTimer() {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }

  function onPointerDown() {
    longPressed.current = false;
    timerRef.current = setTimeout(() => {
      longPressed.current = true;
      if (navigator.vibrate) navigator.vibrate(30);
    }, 450);
  }

  function onPointerUp() {
    clearTimer();
  }

  return (
    <div
      className={`relative rounded-2xl transition-shadow ${editMode ? 'ring-2 ring-neya-orange/40 ring-offset-2' : ''} ${className}`}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerCancel={clearTimer}
      onPointerLeave={clearTimer}
    >
      <div className="absolute -top-2 left-2 right-2 z-10 flex items-center justify-between gap-2 pointer-events-none">
        <span className="text-[10px] font-semibold uppercase tracking-wide bg-neya-orange text-white px-2 py-0.5 rounded-full shadow">
          {section.label || section.title || section.id}
        </span>
        <div className="flex gap-1 pointer-events-auto">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onMoveUp?.(section.id); }}
            className="w-9 h-9 rounded-lg bg-white border border-neya-border shadow text-sm font-bold active:bg-neya-cream"
            title="Monter"
          >
            ↑
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onMoveDown?.(section.id); }}
            className="w-9 h-9 rounded-lg bg-white border border-neya-border shadow text-sm font-bold active:bg-neya-cream"
            title="Descendre"
          >
            ↓
          </button>
          {section.type === 'todo' && section.id !== 'todo:main' && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onHide?.(section.id); }}
              className="w-9 h-9 rounded-lg bg-white border border-red-200 text-red-600 shadow text-xs"
              title="Retirer"
            >
              ✕
            </button>
          )}
        </div>
      </div>
      <div className={editMode ? 'pt-5' : ''}>{children}</div>
      {longPressed.current && (
        <p className="text-[10px] text-center text-neya-orange mt-1">Utilisez ↑ ↓ pour déplacer</p>
      )}
    </div>
  );
}

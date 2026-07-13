'use client';

import { useRef } from 'react';

/**
 * Section dashboard déplaçable en mode édition.
 * Chrome sobre (barre latérale) — pas d’anneaux orange arrondis.
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
    timerRef.current = setTimeout(() => {
      if (navigator.vibrate) navigator.vibrate(20);
    }, 450);
  }

  return (
    <div
      className={`dash-edit-section relative ${className}`}
      onPointerDown={onPointerDown}
      onPointerUp={clearTimer}
      onPointerCancel={clearTimer}
      onPointerLeave={clearTimer}
    >
      <div className="dash-edit-toolbar">
        <span className="dash-edit-label">{section.label || section.title || section.id}</span>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onMoveUp?.(section.id); }}
            className="dash-edit-btn"
            title="Monter"
          >
            ↑
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onMoveDown?.(section.id); }}
            className="dash-edit-btn"
            title="Descendre"
          >
            ↓
          </button>
          {section.type === 'todo' && section.id !== 'todo:main' && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onHide?.(section.id); }}
              className="dash-edit-btn dash-edit-btn-danger"
              title="Retirer"
            >
              ✕
            </button>
          )}
        </div>
      </div>
      {children}
    </div>
  );
}

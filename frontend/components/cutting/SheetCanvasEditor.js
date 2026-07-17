'use client';

import { useCallback, useRef, useState } from 'react';
import { sheetUsedArea, trimNum, uid } from '../../lib/cutting-layout';

/**
 * Panneau 4×8 — rectangles glissables + redimensionnables.
 */
export default function SheetCanvasEditor({
  sheet,
  selectedId = null,
  onChange,
  onSelect,
  onRemove,
  placePart = null,
}) {
  const canvasRef = useRef(null);
  const dragRef = useRef(null);
  const [editingId, setEditingId] = useState(null);

  const W = Number(sheet.width) || 96;
  const H = Number(sheet.height) || 48;
  const rects = sheet.rects || [];
  const area = W * H;
  const used = sheetUsedArea(sheet);
  const yieldPct = area ? Math.round((used / area) * 100) : 0;

  const clientToIn = useCallback((clientX, clientY) => {
    const el = canvasRef.current;
    if (!el) return { x: 0, y: 0 };
    const r = el.getBoundingClientRect();
    return {
      x: ((clientX - r.left) / r.width) * W,
      y: ((clientY - r.top) / r.height) * H,
    };
  }, [W, H]);

  function patchRects(next) {
    onChange?.({ ...sheet, rects: next });
  }

  function addRect(at = null) {
    const w = placePart?.w || 24;
    const h = placePart?.h || 18;
    const x = at ? Math.max(0, Math.min(W - w, at.x - w / 2)) : 2;
    const y = at ? Math.max(0, Math.min(H - h, at.y - h / 2)) : 2;
    const rect = {
      id: uid('rect'),
      label: placePart?.label || `${trimNum(w)}×${trimNum(h)}`,
      w,
      h,
      x: Math.round(x * 10) / 10,
      y: Math.round(y * 10) / 10,
      color: placePart?.color || '#0891B2',
      partId: placePart?.id || null,
    };
    patchRects([...rects, rect]);
    onSelect?.(rect.id);
  }

  function onCanvasPointerDown(e) {
    if (e.target !== canvasRef.current && !e.target.classList.contains('cut-sheet__canvas')) return;
    if (placePart) {
      const pt = clientToIn(e.clientX, e.clientY);
      addRect(pt);
      return;
    }
    onSelect?.(null);
  }

  function startMove(rect, e) {
    e.preventDefault();
    e.stopPropagation();
    try {
      e.currentTarget.setPointerCapture?.(e.pointerId);
    } catch {
      /* ignore */
    }
    onSelect?.(rect.id);
    const start = clientToIn(e.clientX, e.clientY);
    dragRef.current = {
      mode: 'move',
      id: rect.id,
      ox: start.x - Number(rect.x),
      oy: start.y - Number(rect.y),
      w: Number(rect.w),
      h: Number(rect.h),
      target: e.currentTarget,
      pointerId: e.pointerId,
    };
    bindDrag();
  }

  function startResize(rect, e) {
    e.preventDefault();
    e.stopPropagation();
    try {
      e.currentTarget.setPointerCapture?.(e.pointerId);
    } catch {
      /* ignore */
    }
    onSelect?.(rect.id);
    dragRef.current = {
      mode: 'resize',
      id: rect.id,
      x0: Number(rect.x),
      y0: Number(rect.y),
      target: e.currentTarget,
      pointerId: e.pointerId,
    };
    bindDrag();
  }

  function bindDrag() {
    function onMove(ev) {
      const d = dragRef.current;
      if (!d) return;
      const pt = clientToIn(ev.clientX, ev.clientY);
      patchRects(
        rects.map((r) => {
          if (r.id !== d.id) return r;
          if (d.mode === 'move') {
            let x = pt.x - d.ox;
            let y = pt.y - d.oy;
            x = Math.max(0, Math.min(W - d.w, x));
            y = Math.max(0, Math.min(H - d.h, y));
            return { ...r, x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 };
          }
          let w = Math.max(1, pt.x - d.x0);
          let h = Math.max(1, pt.y - d.y0);
          w = Math.min(w, W - d.x0);
          h = Math.min(h, H - d.y0);
          return {
            ...r,
            w: Math.round(w * 10) / 10,
            h: Math.round(h * 10) / 10,
            label: r.label?.includes('×') ? `${trimNum(w)}×${trimNum(h)}` : r.label,
          };
        }),
      );
    }
    function onUp(ev) {
      const d = dragRef.current;
      try {
        d?.target?.releasePointerCapture?.(ev.pointerId ?? d.pointerId);
      } catch {
        /* ignore */
      }
      dragRef.current = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  const selected = rects.find((r) => r.id === selectedId);

  return (
    <div className="cut-sheet">
      <div className="cut-board__head">
        <div className="min-w-0">
          <input
            className="cut-board__title"
            value={sheet.label || ''}
            onChange={(e) => onChange?.({ ...sheet, label: e.target.value })}
          />
          <p className="cut-board__meta">
            {sheet.material || 'panneau'} · {trimNum(W)}″ × {trimNum(H)}″ · {rects.length} pièce(s) · rendement {yieldPct}%
          </p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button type="button" className="cut-icon-btn" title="Ajouter un rectangle" onClick={() => addRect()}>+</button>
          <button type="button" className="cut-icon-btn cut-icon-btn--danger" title="Supprimer le panneau" onClick={() => onRemove?.(sheet.id)}>×</button>
        </div>
      </div>

      <div
        ref={canvasRef}
        className={`cut-sheet__canvas ${placePart ? 'cut-sheet__canvas--place' : ''}`}
        style={{ aspectRatio: `${W} / ${H}` }}
        onPointerDown={onCanvasPointerDown}
      >
        {/* grid */}
        <svg className="cut-sheet__grid" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
          {Array.from({ length: Math.floor(W / 12) + 1 }, (_, i) => (
            <line key={`v${i}`} x1={i * 12} y1={0} x2={i * 12} y2={H} stroke="rgba(0,0,0,0.06)" strokeWidth="0.15" />
          ))}
          {Array.from({ length: Math.floor(H / 12) + 1 }, (_, i) => (
            <line key={`h${i}`} x1={0} y1={i * 12} x2={W} y2={i * 12} stroke="rgba(0,0,0,0.06)" strokeWidth="0.15" />
          ))}
        </svg>

        {rects.map((rect) => {
          const sel = selectedId === rect.id;
          return (
            <div
              key={rect.id}
              className={`cut-sheet__rect ${sel ? 'cut-sheet__rect--selected' : ''}`}
              style={{
                left: `${(rect.x / W) * 100}%`,
                top: `${(rect.y / H) * 100}%`,
                width: `${(rect.w / W) * 100}%`,
                height: `${(rect.h / H) * 100}%`,
                background: rect.color || '#0891B2',
              }}
              onPointerDown={(e) => startMove(rect, e)}
              onDoubleClick={(e) => {
                e.stopPropagation();
                setEditingId(rect.id);
              }}
            >
              <span className="cut-sheet__rect-label">
                {rect.w / W > 0.08 && rect.h / H > 0.1
                  ? (rect.label || `${trimNum(rect.w)}×${trimNum(rect.h)}`)
                  : ''}
              </span>
              {sel && (
                <span
                  className="cut-sheet__handle"
                  onPointerDown={(e) => startResize(rect, e)}
                />
              )}
            </div>
          );
        })}

        {!rects.length && (
          <div className="cut-sheet__hint">
            Cliquez + ou choisissez une pièce à gauche puis cliquez sur le panneau
          </div>
        )}
      </div>

      {selected && (
        <div className="cut-board__inspector">
          <label className="cut-field">
            <span>Label</span>
            <input
              className="input !min-h-[36px] !py-1.5 text-sm"
              value={selected.label || ''}
              onChange={(e) => patchRects(rects.map((r) => (r.id === selected.id ? { ...r, label: e.target.value } : r)))}
            />
          </label>
          {['w', 'h', 'x', 'y'].map((k) => (
            <label key={k} className="cut-field">
              <span>{k.toUpperCase()} ″</span>
              <input
                className="input !min-h-[36px] !py-1.5 text-sm"
                type="number"
                step="0.1"
                value={selected[k]}
                onChange={(e) => patchRects(rects.map((r) => (r.id === selected.id ? { ...r, [k]: Number(e.target.value) } : r)))}
              />
            </label>
          ))}
          <label className="cut-field">
            <span>Couleur</span>
            <input
              type="color"
              className="h-9 w-full rounded border border-neya-border"
              value={selected.color || '#0891B2'}
              onChange={(e) => patchRects(rects.map((r) => (r.id === selected.id ? { ...r, color: e.target.value } : r)))}
            />
          </label>
          <button
            type="button"
            className="btn-ghost text-red-600 text-xs"
            onClick={() => {
              patchRects(rects.filter((r) => r.id !== selected.id));
              onSelect?.(null);
            }}
          >
            Retirer
          </button>
        </div>
      )}

      {editingId && selected?.id === editingId && (
        <p className="text-[11px] text-neya-muted mt-1">Éditez W/H dans l’inspecteur ci-dessous, ou glissez la poignée coin.</p>
      )}
    </div>
  );
}

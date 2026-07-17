'use client';

import { useCallback, useRef, useState } from 'react';
import { boardUsed, boardWaste, trimNum, uid } from '../../lib/cutting-layout';

/**
 * Planche 8 pi — segments redimensionnables (style colonnes Word).
 * + ajoute une coupe ; poignées entre segments pour ajuster les longueurs.
 */
export default function BoardStripEditor({
  board,
  kerf = 0.125,
  selectedId = null,
  onChange,
  onSelect,
  onRemove,
}) {
  const trackRef = useRef(null);
  const dragRef = useRef(null);
  const [editingId, setEditingId] = useState(null);
  const [draftLen, setDraftLen] = useState('');

  const length = Number(board.length) || 96;
  const segments = board.segments || [];
  const used = boardUsed(board, kerf);
  const waste = boardWaste(board, kerf);
  const yieldPct = length ? Math.round((used / length) * 100) : 0;

  const pxToIn = useCallback((px) => {
    const el = trackRef.current;
    if (!el) return 0;
    const w = el.getBoundingClientRect().width;
    return w ? (px / w) * length : 0;
  }, [length]);

  function patchSegments(nextSegs) {
    onChange?.({ ...board, segments: nextSegs });
  }

  function startDividerDrag(index, e) {
    e.preventDefault();
    e.stopPropagation();
    try {
      e.currentTarget.setPointerCapture?.(e.pointerId);
    } catch {
      /* ignore */
    }
    const startX = e.clientX;
    const left = segments[index];
    const right = segments[index + 1];
    if (!left) return;

    dragRef.current = {
      index,
      startX,
      left0: Number(left.length),
      right0: right ? Number(right.length) : waste,
      hasRight: Boolean(right),
    };

    function onMove(ev) {
      const d = dragRef.current;
      if (!d) return;
      const delta = pxToIn(ev.clientX - d.startX);
      let leftLen = Math.max(1, Math.round((d.left0 + delta) * 10) / 10);
      const next = segments.map((s) => ({ ...s }));

      if (d.hasRight) {
        let rightLen = Math.max(1, Math.round((d.right0 - delta) * 10) / 10);
        const pair = d.left0 + d.right0;
        if (leftLen + rightLen > pair) {
          // clamp
          if (delta > 0) leftLen = pair - 1;
          rightLen = pair - leftLen;
        }
        next[d.index] = { ...next[d.index], length: leftLen };
        next[d.index + 1] = { ...next[d.index + 1], length: rightLen };
      } else {
        // resize against waste
        const max = d.left0 + d.right0;
        leftLen = Math.min(Math.max(1, leftLen), Math.max(1, max - 0.1));
        next[d.index] = { ...next[d.index], length: leftLen };
      }
      patchSegments(next);
    }

    function onUp(ev) {
      dragRef.current = null;
      try {
        e.currentTarget.releasePointerCapture?.(ev.pointerId);
      } catch {
        /* ignore */
      }
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    }

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  function addSegment() {
    const defaultLen = Math.min(12, Math.max(1, Math.floor(waste * 10) / 10 || 12));
    const color = ['#D97706', '#2563EB', '#059669', '#7C3AED', '#DC2626'][segments.length % 5];
    patchSegments([
      ...segments,
      {
        id: uid('seg'),
        label: `${trimNum(defaultLen)}"`,
        length: defaultLen,
        color,
      },
    ]);
  }

  function removeSegment(id) {
    patchSegments(segments.filter((s) => s.id !== id));
    if (selectedId === id) onSelect?.(null);
  }

  function commitEdit(id) {
    const val = Math.max(0.5, Number(draftLen) || 0);
    patchSegments(
      segments.map((s) => (s.id === id
        ? { ...s, length: Math.round(val * 10) / 10, label: s.label || `${trimNum(val)}"` }
        : s)),
    );
    setEditingId(null);
  }

  return (
    <div className={`cut-board ${selectedId && segments.some((s) => s.id === selectedId) ? 'cut-board--focus' : ''}`}>
      <div className="cut-board__head">
        <div className="min-w-0">
          <input
            className="cut-board__title"
            value={board.label || ''}
            onChange={(e) => onChange?.({ ...board, label: e.target.value })}
          />
          <p className="cut-board__meta">
            {board.material || '2×4'} · {trimNum(length)}″ · utilisé {trimNum(used)}″ · rebut {trimNum(waste)}″ · {yieldPct}%
          </p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button type="button" className="cut-icon-btn" title="Ajouter une coupe" onClick={addSegment}>+</button>
          <button type="button" className="cut-icon-btn cut-icon-btn--danger" title="Supprimer la planche" onClick={() => onRemove?.(board.id)}>×</button>
        </div>
      </div>

      <div className="cut-board__track-wrap">
        <div ref={trackRef} className="cut-board__track" onClick={() => onSelect?.(null)}>
          {segments.map((seg, i) => {
            const wPct = (Number(seg.length) / length) * 100;
            const selected = selectedId === seg.id;
            return (
              <div key={seg.id} className="cut-board__cell-wrap" style={{ width: `${wPct}%` }}>
                <button
                  type="button"
                  className={`cut-board__seg ${selected ? 'cut-board__seg--selected' : ''}`}
                  style={{ background: seg.color || '#64748b' }}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelect?.(seg.id);
                  }}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    setEditingId(seg.id);
                    setDraftLen(String(seg.length));
                  }}
                  title="Double-clic pour éditer la longueur · clic pour sélectionner"
                >
                  {editingId === seg.id ? (
                    <input
                      className="cut-board__seg-input"
                      autoFocus
                      value={draftLen}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => setDraftLen(e.target.value)}
                      onBlur={() => commitEdit(seg.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitEdit(seg.id);
                        if (e.key === 'Escape') setEditingId(null);
                      }}
                    />
                  ) : (
                    <span className="cut-board__seg-label">
                      {wPct > 6 ? (seg.label || `${trimNum(seg.length)}"`) : ''}
                    </span>
                  )}
                  {selected && (
                    <span
                      className="cut-board__seg-del"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeSegment(seg.id);
                      }}
                    >
                      ×
                    </span>
                  )}
                </button>
                {/* Word-style column divider */}
                <div
                  className="cut-board__divider"
                  onPointerDown={(e) => startDividerDrag(i, e)}
                  title="Glisser pour redimensionner (comme colonnes Word)"
                />
              </div>
            );
          })}
          {waste > 0.05 && (
            <div
              className="cut-board__waste"
              style={{ width: `${(waste / length) * 100}%` }}
              title={`Rebut ${trimNum(waste)}"`}
            >
              {waste / length > 0.08 ? `${trimNum(waste)}″` : ''}
            </div>
          )}
          {!segments.length && (
            <button type="button" className="cut-board__empty" onClick={addSegment}>
              + Ajouter une coupe sur cette planche
            </button>
          )}
        </div>
        <div className="cut-board__ruler">
          <span>0″</span>
          <span>{trimNum(length / 2)}″</span>
          <span>{trimNum(length)}″</span>
        </div>
      </div>

      {selectedId && segments.find((s) => s.id === selectedId) && (
        <div className="cut-board__inspector">
          {(() => {
            const seg = segments.find((s) => s.id === selectedId);
            return (
              <>
                <label className="cut-field">
                  <span>Label</span>
                  <input
                    className="input !min-h-[36px] !py-1.5 text-sm"
                    value={seg.label || ''}
                    onChange={(e) => patchSegments(segments.map((s) => (s.id === seg.id ? { ...s, label: e.target.value } : s)))}
                  />
                </label>
                <label className="cut-field">
                  <span>Longueur ″</span>
                  <input
                    className="input !min-h-[36px] !py-1.5 text-sm"
                    type="number"
                    step="0.1"
                    value={seg.length}
                    onChange={(e) => patchSegments(segments.map((s) => (s.id === seg.id ? { ...s, length: Number(e.target.value) } : s)))}
                  />
                </label>
                <label className="cut-field">
                  <span>Couleur</span>
                  <input
                    type="color"
                    className="h-9 w-full rounded border border-neya-border"
                    value={seg.color || '#64748b'}
                    onChange={(e) => patchSegments(segments.map((s) => (s.id === seg.id ? { ...s, color: e.target.value } : s)))}
                  />
                </label>
              </>
            );
          })()}
        </div>
      )}
    </div>
  );
}

'use client';

import { useCallback, useRef, useState } from 'react';
import { formatMoney } from '../lib/api';
import { coerceDecimalInput, finalizeDecimal, parseDecimal } from '../lib/parse-decimal';

const DEFAULT_COLS = [
  { key: 'description', label: 'Description', type: 'text', placeholder: 'Ex. Table chêne…', flex: true },
  { key: 'qty', label: 'Qté', type: 'number', width: 'w-20', step: 'any', min: '0' },
  { key: 'price', label: 'Prix $', type: 'number', width: 'w-28', step: '0.01', min: '0' },
];

const DND_MIME = 'application/x-neya-line';

function emptyRow(cols = DEFAULT_COLS) {
  const row = {};
  for (const c of cols) {
    if (c.key === 'qty') row.qty = 1;
    else if (c.key === 'price') row.price = 0;
    else row[c.key] = '';
  }
  return row;
}

function parsePaste(text) {
  const rows = String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map(line => line.split('\t'));
  return rows;
}

function parseDragPayload(e) {
  try {
    const raw = e.dataTransfer?.getData(DND_MIME) || e.dataTransfer?.getData('text/plain');
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || data.type !== 'neya-line') return null;
    return data;
  } catch {
    return null;
  }
}

/**
 * Tableau éditable simple (devis / factures / matériaux).
 * - Tab / Entrée pour naviguer
 * - Coller depuis Excel / Sheets (Ctrl+V)
 * - Monter / descendre, glisser-déposer (y compris entre tableaux)
 */
export default function EasyTable({
  rows = [],
  onChange,
  columns = DEFAULT_COLS,
  showLineTotal = true,
  minRows = 1,
  className = '',
  allowReorder = true,
  /** Identifiant du tableau (requis pour DnD inter-tableaux) */
  sectionId = null,
  /** Déposer une ligne venant d’un autre tableau : (payload, toIndex) => void */
  onReceiveRow = null,
}) {
  const tableRef = useRef(null);
  const [dropIndex, setDropIndex] = useState(null);
  const [draggingIndex, setDraggingIndex] = useState(null);

  const setRows = useCallback((next) => {
    onChange(next.length ? next : [emptyRow(columns)]);
  }, [onChange, columns]);

  function updateCell(ri, key, value, colType) {
    let nextVal = value;
    if (colType === 'number') {
      nextVal = coerceDecimalInput(value);
    }
    const next = rows.map((r, i) => (i === ri ? { ...r, [key]: nextVal } : r));
    setRows(next);
  }

  function blurNumberCell(ri, key) {
    const raw = rows[ri]?.[key];
    const finalized = finalizeDecimal(raw, key === 'qty' ? 1 : 0);
    if (raw === finalized) return;
    const next = rows.map((r, i) => (i === ri ? { ...r, [key]: finalized } : r));
    setRows(next);
  }

  function addRow(afterIndex = null) {
    const next = [...rows];
    const row = emptyRow(columns);
    if (afterIndex == null || afterIndex >= rows.length - 1) next.push(row);
    else next.splice(afterIndex + 1, 0, row);
    setRows(next);
    return afterIndex == null ? next.length - 1 : afterIndex + 1;
  }

  function duplicateRow(ri) {
    const next = [...rows];
    next.splice(ri + 1, 0, { ...rows[ri] });
    setRows(next);
  }

  function removeRow(ri) {
    if (rows.length <= minRows) {
      setRows([emptyRow(columns)]);
      return;
    }
    setRows(rows.filter((_, i) => i !== ri));
  }

  function moveRow(ri, dir) {
    const target = ri + dir;
    if (target < 0 || target >= rows.length) return;
    const next = [...rows];
    const [row] = next.splice(ri, 1);
    next.splice(target, 0, row);
    setRows(next);
  }

  function reorderLocal(fromIndex, toIndex) {
    if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0) return;
    const next = [...rows];
    const [row] = next.splice(fromIndex, 1);
    const insertAt = fromIndex < toIndex ? toIndex - 1 : toIndex;
    next.splice(Math.max(0, insertAt), 0, row);
    setRows(next);
  }

  function focusCell(ri, ci) {
    requestAnimationFrame(() => {
      const el = tableRef.current?.querySelector(`[data-cell="${ri}-${ci}"]`);
      el?.focus();
      el?.select?.();
    });
  }

  function handleKeyDown(e, ri, ci) {
    const colCount = columns.length;
    if (allowReorder && e.altKey && e.key === 'ArrowUp') {
      e.preventDefault();
      moveRow(ri, -1);
      focusCell(Math.max(0, ri - 1), ci);
      return;
    }
    if (allowReorder && e.altKey && e.key === 'ArrowDown') {
      e.preventDefault();
      moveRow(ri, 1);
      focusCell(Math.min(rows.length - 1, ri + 1), ci);
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (ri === rows.length - 1) {
        const newRi = addRow();
        focusCell(newRi, 0);
      } else {
        focusCell(ri + 1, ci);
      }
      return;
    }
    if (e.key === 'Tab' && !e.shiftKey && ci === colCount - 1 && ri === rows.length - 1) {
      e.preventDefault();
      const newRi = addRow();
      focusCell(newRi, 0);
      return;
    }
    if (e.key === 'ArrowDown' && !e.altKey) {
      e.preventDefault();
      if (ri < rows.length - 1) focusCell(ri + 1, ci);
      else {
        const newRi = addRow();
        focusCell(newRi, ci);
      }
    }
    if (e.key === 'ArrowUp' && !e.altKey && ri > 0) {
      e.preventDefault();
      focusCell(ri - 1, ci);
    }
  }

  function handlePaste(e, ri, ci) {
    const text = e.clipboardData?.getData('text/plain');
    if (!text || (!text.includes('\t') && !text.includes('\n'))) return;
    e.preventDefault();
    const pasted = parsePaste(text);
    if (!pasted.length) return;

    const next = rows.map(r => ({ ...r }));
    pasted.forEach((cells, pr) => {
      const targetRi = ri + pr;
      while (next.length <= targetRi) next.push(emptyRow(columns));
      cells.forEach((val, pc) => {
        const col = columns[ci + pc];
        if (!col) return;
        let v = String(val).trim();
        if (col.type === 'number') {
          v = parseDecimal(v, 0);
        }
        next[targetRi] = { ...next[targetRi], [col.key]: v };
      });
    });
    setRows(next);
  }

  function handleDragStart(e, ri) {
    if (!allowReorder || !sectionId) return;
    // Ne pas démarrer un drag depuis un champ de saisie
    if (e.target?.closest?.('input, textarea, select')) {
      e.preventDefault();
      return;
    }
    const payload = {
      type: 'neya-line',
      sectionId,
      index: ri,
      row: { ...rows[ri] },
    };
    const json = JSON.stringify(payload);
    e.dataTransfer.setData(DND_MIME, json);
    e.dataTransfer.setData('text/plain', json);
    e.dataTransfer.effectAllowed = 'move';
    setDraggingIndex(ri);
  }

  function handleDragEnd() {
    setDraggingIndex(null);
    setDropIndex(null);
  }

  function handleDragOverRow(e, ri) {
    if (!allowReorder) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    const rect = e.currentTarget.getBoundingClientRect();
    const before = e.clientY < rect.top + rect.height / 2;
    setDropIndex(before ? ri : ri + 1);
  }

  function handleDragOverEnd(e) {
    if (!allowReorder) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDropIndex(rows.length);
  }

  function handleDropAt(e, toIndex) {
    if (!allowReorder) return;
    e.preventDefault();
    e.stopPropagation();
    const target = toIndex ?? dropIndex ?? rows.length;
    setDropIndex(null);
    setDraggingIndex(null);
    const payload = parseDragPayload(e);
    if (!payload) return;

    if (payload.sectionId === sectionId) {
      reorderLocal(payload.index, target);
      return;
    }
    if (typeof onReceiveRow === 'function') {
      onReceiveRow(payload, target);
    }
  }

  function handleDragLeaveTable(e) {
    if (!e.currentTarget.contains(e.relatedTarget)) {
      setDropIndex(null);
    }
  }

  const canDrag = allowReorder && !!sectionId;

  return (
    <div className={className}>
      <div
        className={`overflow-x-auto border border-neya-border rounded-none transition-shadow ${
          dropIndex != null ? 'ring-1 ring-neya-orange/50' : ''
        }`}
        onDragLeave={handleDragLeaveTable}
        onDragOver={handleDragOverEnd}
        onDrop={(e) => handleDropAt(e, dropIndex ?? rows.length)}
      >
        <table ref={tableRef} className="w-full text-sm min-w-[480px]">
          <thead>
            <tr className="bg-neya-cream/70 text-left text-neya-muted border-b border-neya-border">
              {canDrag && <th className="px-1 py-2 w-7" title="Glisser" />}
              <th className="px-2 py-2 w-8 text-center text-[10px] font-normal">#</th>
              {columns.map(col => (
                <th key={col.key} className={`px-2 py-2 font-medium text-xs ${col.width || ''}`}>
                  {col.label}
                </th>
              ))}
              {showLineTotal && (
                <th className="px-2 py-2 text-right font-medium text-xs w-28">Total</th>
              )}
              <th className="px-2 py-2 w-20" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => {
              const lineTotal = parseDecimal(row.qty, 0) * parseDecimal(row.price, 0);
              const showDropBefore = dropIndex === ri;
              return (
                <tr
                  key={ri}
                  draggable={canDrag}
                  onDragStart={(e) => handleDragStart(e, ri)}
                  onDragEnd={handleDragEnd}
                  onDragOver={(e) => handleDragOverRow(e, ri)}
                  onDrop={(e) => handleDropAt(e, dropIndex ?? ri)}
                  className={`border-b border-neya-border last:border-0 hover:bg-neya-cream/20 ${
                    canDrag ? 'cursor-grab active:cursor-grabbing' : ''
                  } ${draggingIndex === ri ? 'opacity-40' : ''} ${
                    showDropBefore ? 'shadow-[inset_0_2px_0_0_#D86B30]' : ''
                  }`}
                >
                  {canDrag && (
                    <td className="px-0.5 py-1 align-middle text-center">
                      <span
                        className="inline-block text-neya-muted px-1 py-2 text-sm leading-none select-none"
                        title="Glisser pour déplacer"
                        aria-hidden
                      >
                        ⠿
                      </span>
                    </td>
                  )}
                  <td className="px-2 py-1 text-center text-neya-muted text-xs select-none">{ri + 1}</td>
                  {columns.map((col, ci) => (
                    <td key={col.key} className={`px-1 py-1 ${col.flex ? '' : col.width || ''}`}>
                      <input
                        data-cell={`${ri}-${ci}`}
                        type="text"
                        inputMode={col.type === 'number' ? 'decimal' : 'text'}
                        autoComplete="off"
                        draggable={false}
                        onMouseDown={(e) => e.stopPropagation()}
                        className="input border-0 bg-transparent shadow-none focus:bg-white focus:ring-1 focus:ring-neya-orange/40 rounded-none px-2 py-1.5 text-sm w-full min-h-[36px] cursor-text"
                        placeholder={col.placeholder}
                        value={row[col.key] ?? ''}
                        onChange={e => updateCell(ri, col.key, e.target.value, col.type)}
                        onBlur={() => {
                          if (col.type === 'number') blurNumberCell(ri, col.key);
                        }}
                        onKeyDown={e => handleKeyDown(e, ri, ci)}
                        onPaste={e => handlePaste(e, ri, ci)}
                      />
                    </td>
                  ))}
                  {showLineTotal && (
                    <td className="px-2 py-1 text-right text-neya-muted whitespace-nowrap">
                      {formatMoney(lineTotal)}
                    </td>
                  )}
                  <td className="px-1 py-1" onMouseDown={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-end gap-0.5">
                      {allowReorder && (
                        <>
                          <button
                            type="button"
                            title="Monter (Alt↑)"
                            onClick={() => moveRow(ri, -1)}
                            disabled={ri === 0}
                            className="text-neya-muted hover:text-neya-ink px-1 py-1 text-xs disabled:opacity-25"
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            title="Descendre (Alt↓)"
                            onClick={() => moveRow(ri, 1)}
                            disabled={ri === rows.length - 1}
                            className="text-neya-muted hover:text-neya-ink px-1 py-1 text-xs disabled:opacity-25"
                          >
                            ↓
                          </button>
                        </>
                      )}
                      <button
                        type="button"
                        title="Dupliquer"
                        onClick={() => duplicateRow(ri)}
                        className="text-neya-muted hover:text-neya-orange px-1.5 py-1 text-xs"
                      >
                        ⧉
                      </button>
                      <button
                        type="button"
                        title="Supprimer"
                        onClick={() => removeRow(ri)}
                        className="text-neya-muted hover:text-neya-error px-1.5 py-1 text-sm"
                        disabled={rows.length <= minRows && !String(row.description || '').trim()}
                      >
                        ×
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {dropIndex === rows.length && (
              <tr className="pointer-events-none">
                <td
                  colSpan={(canDrag ? 1 : 0) + 2 + columns.length + (showLineTotal ? 1 : 0)}
                  className="h-1 bg-neya-orange/80 p-0"
                />
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-3 mt-2">
        <button type="button" onClick={() => addRow()} className="text-sm text-neya-orange hover:underline">
          + Ajouter une ligne
        </button>
        <span className="text-[11px] text-neya-muted">
          Glisser une ligne (⠿) pour réordonner ou changer de tableau · Alt↑↓
        </span>
      </div>
    </div>
  );
}

export { emptyRow, DEFAULT_COLS as LINE_TABLE_COLS, DND_MIME };

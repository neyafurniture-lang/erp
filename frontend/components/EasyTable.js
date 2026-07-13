'use client';

import { useCallback, useRef } from 'react';
import { formatMoney } from '../lib/api';

const DEFAULT_COLS = [
  { key: 'description', label: 'Description', type: 'text', placeholder: 'Ex. Table chêne…', flex: true },
  { key: 'qty', label: 'Qté', type: 'number', width: 'w-20', step: 'any', min: '0' },
  { key: 'price', label: 'Prix $', type: 'number', width: 'w-28', step: '0.01', min: '0' },
];

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

/**
 * Tableau éditable simple (devis / factures / matériaux).
 * - Tab / Entrée pour naviguer
 * - Coller depuis Excel / Sheets (Ctrl+V)
 * - Boutons + ligne, dupliquer, supprimer
 */
export default function EasyTable({
  rows = [],
  onChange,
  columns = DEFAULT_COLS,
  showLineTotal = true,
  minRows = 1,
  className = '',
}) {
  const tableRef = useRef(null);

  const setRows = useCallback((next) => {
    onChange(next.length ? next : [emptyRow(columns)]);
  }, [onChange, columns]);

  function updateCell(ri, key, value) {
    const next = rows.map((r, i) => (i === ri ? { ...r, [key]: value } : r));
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

  function focusCell(ri, ci) {
    requestAnimationFrame(() => {
      const el = tableRef.current?.querySelector(`[data-cell="${ri}-${ci}"]`);
      el?.focus();
      el?.select?.();
    });
  }

  function handleKeyDown(e, ri, ci) {
    const colCount = columns.length;
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
          v = v.replace(/\s/g, '').replace(',', '.').replace(/\$/g, '');
          const n = Number(v);
          v = Number.isFinite(n) ? n : 0;
        }
        next[targetRi] = { ...next[targetRi], [col.key]: v };
      });
    });
    setRows(next);
  }

  return (
    <div className={className}>
      <div className="overflow-x-auto border border-neya-border rounded-lg">
        <table ref={tableRef} className="w-full text-sm min-w-[480px]">
          <thead>
            <tr className="bg-neya-cream/70 text-left text-neya-muted border-b border-neya-border">
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
              const lineTotal = (Number(row.qty) || 0) * (Number(row.price) || 0);
              return (
                <tr key={ri} className="border-b border-neya-border last:border-0 hover:bg-neya-cream/20">
                  <td className="px-2 py-1 text-center text-neya-muted text-xs">{ri + 1}</td>
                  {columns.map((col, ci) => (
                    <td key={col.key} className={`px-1 py-1 ${col.flex ? '' : col.width || ''}`}>
                      <input
                        data-cell={`${ri}-${ci}`}
                        type={col.type === 'number' ? 'number' : 'text'}
                        step={col.step}
                        min={col.min}
                        className="input border-0 bg-transparent shadow-none focus:bg-white focus:ring-1 focus:ring-neya-orange/40 rounded px-2 py-1.5 text-sm w-full min-h-[36px]"
                        placeholder={col.placeholder}
                        value={row[col.key] ?? ''}
                        onChange={e => updateCell(ri, col.key, col.type === 'number' ? e.target.value : e.target.value)}
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
                  <td className="px-1 py-1">
                    <div className="flex items-center justify-end gap-0.5">
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
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-3 mt-2">
        <button type="button" onClick={() => addRow()} className="text-sm text-neya-orange hover:underline">
          + Ajouter une ligne
        </button>
        <span className="text-[11px] text-neya-muted">
          Entrée = ligne suivante · Coller depuis Excel / Sheets
        </span>
      </div>
    </div>
  );
}

export { emptyRow, DEFAULT_COLS as LINE_TABLE_COLS };

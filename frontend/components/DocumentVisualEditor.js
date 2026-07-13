'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import EasyTable from './EasyTable';
import { formatMoney, calcTaxes, calcLineSubtotal } from '../lib/api';

function emptyLine() {
  return { description: '', qty: 1, price: 0 };
}

function normalizeLines(lines) {
  if (!lines?.length) return [emptyLine()];
  return lines.map(l => ({
    description: l.description || '',
    qty: l.qty ?? 1,
    price: l.price ?? 0,
  }));
}

/**
 * Aperçu document facture / devis — clic sur un champ = édition inline.
 */
export default function DocumentVisualEditor({
  kind = 'invoice',
  numberLabel,
  statusLabel,
  clientName,
  clientHref,
  value,
  onChange,
  onSave,
  saving = false,
  readOnly = false,
  autoSaveOnBlur = true,
}) {
  const [draft, setDraft] = useState(() => ({
    title: value?.title || '',
    subtitle: value?.subtitle || '',
    notes: value?.notes || value?.order_summary || '',
    due_date: value?.due_date ? String(value.due_date).slice(0, 10) : '',
    lines: normalizeLines(value?.lines),
  }));
  const [dirty, setDirty] = useState(false);
  const [focusKey, setFocusKey] = useState(null);
  const savingRef = useRef(false);

  useEffect(() => {
    if (dirty) return;
    setDraft({
      title: value?.title || '',
      subtitle: value?.subtitle || '',
      notes: value?.notes || value?.order_summary || '',
      due_date: value?.due_date ? String(value.due_date).slice(0, 10) : '',
      lines: normalizeLines(value?.lines),
    });
  }, [value, dirty]);

  const patch = useCallback((partial) => {
    if (readOnly) return;
    setDraft(prev => {
      const next = { ...prev, ...partial };
      onChange?.(next);
      return next;
    });
    setDirty(true);
  }, [readOnly, onChange]);

  const handleSave = useCallback(async () => {
    if (!onSave || readOnly || savingRef.current) return;
    savingRef.current = true;
    try {
      await onSave(draft);
      setDirty(false);
    } finally {
      savingRef.current = false;
    }
  }, [onSave, readOnly, draft]);

  const blurSave = useCallback(async () => {
    if (!autoSaveOnBlur || !dirty || readOnly) return;
    await handleSave();
  }, [autoSaveOnBlur, dirty, readOnly, handleSave]);

  useEffect(() => {
    if (readOnly) return;
    function onKey(e) {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        if (dirty) handleSave();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [readOnly, dirty, handleSave]);

  function updateLines(lines) {
    patch({ lines: normalizeLines(lines) });
  }

  function exitLinesMode() {
    setFocusKey(null);
    if (autoSaveOnBlur && dirty) handleSave();
  }

  const taxes = calcTaxes(calcLineSubtotal(draft.lines));
  const notesLabel = kind === 'quote' ? 'Portée / notes' : 'Résumé / notes';
  const editingLines = focusKey === 'lines' && !readOnly;

  return (
    <div className="doc-visual">
      <div className="doc-visual-toolbar">
        <p className="text-xs text-neya-muted">
          {readOnly ? 'Aperçu' : 'Cliquez un champ pour modifier'}
          {dirty && !readOnly ? ' · non enregistré' : ''}
        </p>
        {!readOnly && (
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !dirty}
            className="btn-primary text-sm min-h-[36px] disabled:opacity-40"
          >
            {saving ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        )}
      </div>

      <article className="doc-sheet">
        <header className="doc-sheet-head">
          <div>
            <p className="doc-kicker">{kind === 'quote' ? 'Devis' : 'Facture'} {numberLabel}</p>
            {focusKey === 'title' && !readOnly ? (
              <input
                autoFocus
                className="doc-input doc-title-input"
                value={draft.title}
                onChange={e => patch({ title: e.target.value })}
                onBlur={() => { setFocusKey(null); blurSave(); }}
                placeholder="Titre du projet"
              />
            ) : (
              <h1
                className={`doc-title ${readOnly ? '' : 'doc-editable'}`}
                onClick={() => !readOnly && setFocusKey('title')}
              >
                {draft.title || 'Sans titre'}
              </h1>
            )}
            {focusKey === 'subtitle' && !readOnly ? (
              <input
                autoFocus
                className="doc-input mt-1"
                value={draft.subtitle}
                onChange={e => patch({ subtitle: e.target.value })}
                onBlur={() => { setFocusKey(null); blurSave(); }}
                placeholder="Sous-titre (ex. acompte 50 %)"
              />
            ) : (
              <p
                className={`doc-subtitle ${readOnly ? '' : 'doc-editable'}`}
                onClick={() => !readOnly && setFocusKey('subtitle')}
              >
                {draft.subtitle || (readOnly ? '' : 'Ajouter un sous-titre…')}
              </p>
            )}
          </div>
          <div className="text-right">
            {statusLabel && <span className="doc-status">{statusLabel}</span>}
            {kind === 'invoice' && (
              focusKey === 'due_date' && !readOnly ? (
                <input
                  autoFocus
                  type="date"
                  className="doc-input mt-2 text-right"
                  value={draft.due_date}
                  onChange={e => patch({ due_date: e.target.value })}
                  onBlur={() => { setFocusKey(null); blurSave(); }}
                />
              ) : (
                <p
                  className={`text-xs text-neya-muted mt-2 ${readOnly ? '' : 'doc-editable'}`}
                  onClick={() => !readOnly && setFocusKey('due_date')}
                >
                  Échéance : {draft.due_date || '—'}
                </p>
              )
            )}
          </div>
        </header>

        {clientName && (
          <p className="doc-client">
            Client{' '}
            {clientHref ? (
              <Link href={clientHref} className="text-neya-ink underline-offset-2 hover:underline">
                {clientName}
              </Link>
            ) : (
              <span className="font-medium text-neya-ink">{clientName}</span>
            )}
          </p>
        )}

        <div className="doc-notes-block">
          <p className="doc-label">{notesLabel}</p>
          {focusKey === 'notes' && !readOnly ? (
            <textarea
              autoFocus
              className="doc-input doc-textarea"
              rows={4}
              value={draft.notes}
              onChange={e => patch({ notes: e.target.value })}
              onBlur={() => { setFocusKey(null); blurSave(); }}
              placeholder="Description, portée des travaux…"
            />
          ) : (
            <p
              className={`doc-notes ${readOnly ? '' : 'doc-editable'}`}
              onClick={() => !readOnly && setFocusKey('notes')}
            >
              {draft.notes || (readOnly ? '—' : 'Cliquer pour ajouter des notes…')}
            </p>
          )}
        </div>

        <div className="doc-lines-block">
          <div className="flex items-center justify-between gap-2 mb-2">
            <p className="doc-label mb-0">Lignes</p>
            {!readOnly && !editingLines && (
              <button
                type="button"
                className="text-[11px] text-neya-muted hover:text-neya-ink"
                onClick={() => setFocusKey('lines')}
              >
                Modifier le tableau
              </button>
            )}
            {editingLines && (
              <button
                type="button"
                className="text-[11px] text-neya-muted hover:text-neya-ink"
                onClick={exitLinesMode}
              >
                Terminer
              </button>
            )}
          </div>

          {editingLines ? (
            <EasyTable
              rows={draft.lines}
              onChange={updateLines}
              variant="flat"
              className="doc-lines-table"
            />
          ) : (
            <table
              className={`doc-lines ${readOnly ? '' : 'doc-editable'}`}
              onClick={() => !readOnly && setFocusKey('lines')}
            >
              <thead>
                <tr>
                  <th>Description</th>
                  <th className="text-right w-16">Qté</th>
                  <th className="text-right w-24">Prix</th>
                  <th className="text-right w-28">Total</th>
                </tr>
              </thead>
              <tbody>
                {draft.lines.map((line, i) => {
                  const lineTotal = (Number(line.qty) || 0) * (Number(line.price) || 0);
                  const hasContent = line.description || line.qty !== 1 || line.price;
                  if (!hasContent && i === draft.lines.length - 1 && draft.lines.length > 1) return null;
                  return (
                    <tr key={i}>
                      <td>{line.description || '—'}</td>
                      <td className="text-right text-neya-muted tabular-nums">{line.qty}</td>
                      <td className="text-right tabular-nums">{formatMoney(line.price)}</td>
                      <td className="text-right font-medium tabular-nums">{formatMoney(lineTotal)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <footer className="doc-totals">
          <div className="doc-totals-row"><span>Sous-total</span><span className="tabular-nums">{formatMoney(taxes.subtotal)}</span></div>
          <div className="doc-totals-row"><span>TPS 5 %</span><span className="tabular-nums">{formatMoney(taxes.gst)}</span></div>
          <div className="doc-totals-row"><span>TVQ 9,975 %</span><span className="tabular-nums">{formatMoney(taxes.qst)}</span></div>
          <div className="doc-totals-row doc-totals-total"><span>Total</span><span className="tabular-nums">{formatMoney(taxes.total)}</span></div>
        </footer>
      </article>
    </div>
  );
}

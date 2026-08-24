'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { formatMoney, calcTaxes, calcLineSubtotal, resolveUploadUrl } from '../lib/api';
import {
  emptyLine,
  emptySection,
  normalizeQuoteDocument,
  flattenQuoteLines,
  serializeQuoteDocument,
  isMeaningfulLine,
} from '../lib/quote-document';
import EasyTable from './EasyTable';
import { coerceDecimalInput, finalizeDecimal, parseDecimal } from '../lib/parse-decimal';

const LINE_COLS = [
  { key: 'description', label: 'Description', type: 'text', placeholder: 'Description…', flex: true },
  { key: 'qty', label: 'Qté', type: 'number', width: 'w-20', step: 'any', min: '0' },
  { key: 'price', label: 'Prix unit.', type: 'number', width: 'w-28', step: '0.01', min: '0' },
];

/** Lignes pour EasyTable : au moins une ligne éditable. */
function editorRows(lines) {
  const list = Array.isArray(lines) ? lines.map(l => ({
    description: l.description || '',
    qty: l.qty ?? '',
    price: l.price ?? '',
  })) : [];
  return list.length ? list : [emptyLine()];
}

function normalizeLineNumbers(line) {
  return {
    description: String(line?.description || ''),
    qty: finalizeDecimal(line?.qty, 1),
    price: finalizeDecimal(line?.price, 0),
  };
}

/**
 * Aperçu document facture / devis — édition inline.
 * Devis : blocs client, tableaux titulés, notes, photos (drag), signature, paiement.
 */
export default function DocumentVisualEditor({
  kind = 'invoice',
  numberLabel,
  statusLabel,
  clientName,
  clientHref,
  client = null,
  companyPayment = null,
  quoteTerms = [],
  value,
  onChange,
  onSave,
  onUploadPhotos,
  saving = false,
  readOnly = false,
}) {
  const isQuote = kind === 'quote';

  const [draft, setDraft] = useState(() => buildDraft(value, isQuote));
  const [dirty, setDirty] = useState(false);
  const [focusKey, setFocusKey] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [draggingSectionId, setDraggingSectionId] = useState(null);
  const [dropSectionIndex, setDropSectionIndex] = useState(null);
  const fileRef = useRef(null);

  useEffect(() => {
    if (dirty) return;
    setDraft(buildDraft(value, isQuote));
  }, [value, dirty, isQuote]);

  function patch(partial) {
    if (readOnly) return;
    setDraft(prev => {
      const next = { ...prev, ...partial };
      onChange?.(next);
      return next;
    });
    setDirty(true);
  }

  function patchSection(sectionId, partial) {
    patch({
      sections: draft.sections.map(s => (s.id === sectionId ? { ...s, ...partial } : s)),
    });
  }

  function setSectionLines(sectionId, rows) {
    const next = (Array.isArray(rows) ? rows : []).map(l => ({
      description: String(l?.description || ''),
      qty: l?.qty === '' || l?.qty == null ? '' : coerceDecimalInput(l.qty),
      price: l?.price === '' || l?.price == null ? '' : coerceDecimalInput(l.price),
    }));
    patchSection(sectionId, { lines: next.length ? next : [emptyLine()] });
  }

  function addSection() {
    if (readOnly) return;
    const sections = draft.sections || [];
    patch({ sections: [...sections, emptySection(`Tableau ${sections.length + 1}`)] });
  }

  function removeSection(sectionId) {
    if (readOnly) return;
    const sections = draft.sections || [];
    if (sections.length <= 1) {
      patchSection(sectionId, { title: '', lines: [emptyLine()] });
      return;
    }
    patch({ sections: sections.filter(s => s.id !== sectionId) });
  }

  function moveSection(sectionId, dir) {
    if (readOnly) return;
    const sections = [...(draft.sections || [])];
    const idx = sections.findIndex(s => s.id === sectionId);
    const target = idx + dir;
    if (idx < 0 || target < 0 || target >= sections.length) return;
    const [sec] = sections.splice(idx, 1);
    sections.splice(target, 0, sec);
    patch({ sections });
  }

  function reorderSectionTo(fromId, toIndex) {
    if (readOnly) return;
    const sections = [...(draft.sections || [])];
    const fromIdx = sections.findIndex(s => s.id === fromId);
    if (fromIdx < 0) return;
    let insertAt = toIndex;
    if (fromIdx < insertAt) insertAt -= 1;
    if (insertAt === fromIdx || insertAt < 0) return;
    const [sec] = sections.splice(fromIdx, 1);
    sections.splice(Math.min(insertAt, sections.length), 0, sec);
    patch({ sections });
  }

  function onSectionDragStart(e, sectionId) {
    if (readOnly) return;
    if (e.target?.closest?.('input, textarea, button:not([data-section-drag])')) {
      e.preventDefault();
      return;
    }
    const payload = JSON.stringify({ type: 'neya-section', sectionId });
    e.dataTransfer.setData('application/x-neya-section', payload);
    e.dataTransfer.setData('text/plain', payload);
    e.dataTransfer.effectAllowed = 'move';
    setDraggingSectionId(sectionId);
  }

  function onSectionDragOver(e, sIdx) {
    if (readOnly || !draggingSectionId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const rect = e.currentTarget.getBoundingClientRect();
    const before = e.clientY < rect.top + rect.height / 2;
    setDropSectionIndex(before ? sIdx : sIdx + 1);
  }

  function onSectionDrop(e, sIdx) {
    if (readOnly || !draggingSectionId) return;
    e.preventDefault();
    let fromId = draggingSectionId;
    try {
      const raw = e.dataTransfer.getData('application/x-neya-section') || e.dataTransfer.getData('text/plain');
      const data = JSON.parse(raw);
      if (data?.type === 'neya-section') fromId = data.sectionId;
      if (data?.type === 'neya-line') return;
    } catch { /* ignore */ }
    const toIndex = dropSectionIndex ?? sIdx;
    setDraggingSectionId(null);
    setDropSectionIndex(null);
    if (fromId) reorderSectionTo(fromId, toIndex);
  }

  function onSectionDragEnd() {
    setDraggingSectionId(null);
    setDropSectionIndex(null);
  }

  /** Glisser une ligne d’un tableau vers un autre (ou réordonner via EasyTable en interne). */
  function receiveRowFromOtherSection(toSectionId, payload, toIndex) {
    if (readOnly || !payload?.row) return;
    const fromId = payload.sectionId;
    const fromIndex = Number(payload.index);
    if (!fromId || fromId === toSectionId || Number.isNaN(fromIndex)) return;

    const sections = (draft.sections || []).map(s => ({
      ...s,
      lines: [...(s.lines || [])],
    }));
    const fromSec = sections.find(s => s.id === fromId);
    const toSec = sections.find(s => s.id === toSectionId);
    if (!fromSec || !toSec) return;
    if (fromIndex < 0 || fromIndex >= fromSec.lines.length) return;

    const [row] = fromSec.lines.splice(fromIndex, 1);
    const insertAt = Math.max(0, Math.min(toIndex ?? toSec.lines.length, toSec.lines.length));
    toSec.lines.splice(insertAt, 0, {
      description: String(row.description || ''),
      qty: finalizeDecimal(row.qty, 1),
      price: finalizeDecimal(row.price, 0),
    });
    if (!fromSec.lines.length) fromSec.lines = [emptyLine()];
    patch({ sections });
  }

  async function handleSave() {
    if (!onSave || readOnly) return;
    try {
      await onSave(draft);
      setDirty(false);
    } catch {
      /* toast géré par la page parent */
    }
  }

  async function handleFiles(fileList) {
    if (!onUploadPhotos || readOnly) return;
    const files = Array.from(fileList || []).filter(f => f.type.startsWith('image/'));
    if (!files.length) return;
    setUploading(true);
    try {
      const photos = await onUploadPhotos(files);
      if (Array.isArray(photos) && photos.length) {
        patch({ photos: [...(draft.photos || []), ...photos] });
      }
    } finally {
      setUploading(false);
      setDragOver(false);
    }
  }

  function removePhoto(index) {
    patch({ photos: (draft.photos || []).filter((_, i) => i !== index) });
  }

  const lineSource = flattenQuoteLines({ sections: draft.sections }).map(normalizeLineNumbers);
  const taxes = calcTaxes(calcLineSubtotal(lineSource));
  const notesLabel = isQuote ? 'Portée des travaux' : 'Résumé';
  const sections = draft.sections || [];

  return (
    <div className="doc-visual">
      <div className="doc-visual-toolbar">
        <p className="text-xs text-neya-muted">
          {readOnly
            ? 'Aperçu'
            : 'Glisser les lignes (⠿) ou les tableaux · Alt↑↓ · + Ajouter un tableau · HT'}
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
            <p className="doc-kicker">{isQuote ? 'Devis' : 'Facture'} {numberLabel}</p>
            {focusKey === 'title' && !readOnly ? (
              <input
                autoFocus
                className="doc-input doc-title-input"
                value={draft.title}
                onChange={e => patch({ title: e.target.value })}
                onBlur={() => setFocusKey(null)}
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
                value={draft.subtitle || ''}
                onChange={e => patch({ subtitle: e.target.value })}
                onBlur={() => setFocusKey(null)}
                placeholder={isQuote ? 'Référence / sous-titre' : 'Sous-titre (ex. acompte 50 %)'}
              />
            ) : (
              <p
                className={`doc-subtitle ${readOnly ? '' : 'doc-editable'}`}
                onClick={() => !readOnly && setFocusKey('subtitle')}
              >
                {draft.subtitle || (readOnly ? '' : 'Ajouter une référence…')}
              </p>
            )}
          </div>
          <div className="text-right space-y-2">
            {statusLabel && <span className="doc-status">{statusLabel}</span>}
            {isQuote ? (
              focusKey === 'valid_until' && !readOnly ? (
                <input
                  autoFocus
                  type="date"
                  className="doc-input text-right"
                  value={draft.valid_until || ''}
                  onChange={e => patch({ valid_until: e.target.value })}
                  onBlur={() => setFocusKey(null)}
                />
              ) : (
                <p
                  className={`text-xs text-neya-muted ${readOnly ? '' : 'doc-editable'}`}
                  onClick={() => !readOnly && setFocusKey('valid_until')}
                >
                  Valide jusqu’au : {draft.valid_until || '—'}
                </p>
              )
            ) : (
              focusKey === 'due_date' && !readOnly ? (
                <input
                  autoFocus
                  type="date"
                  className="doc-input text-right"
                  value={draft.due_date || ''}
                  onChange={e => patch({ due_date: e.target.value })}
                  onBlur={() => setFocusKey(null)}
                />
              ) : (
                <p
                  className={`text-xs text-neya-muted ${readOnly ? '' : 'doc-editable'}`}
                  onClick={() => !readOnly && setFocusKey('due_date')}
                >
                  Échéance : {draft.due_date || '—'}
                </p>
              )
            )}
          </div>
        </header>

        <div className="doc-client-grid">
          <div>
            <p className="doc-label">Facturé à</p>
            <p className="font-medium text-neya-ink">
              {clientHref ? (
                <Link href={clientHref} className="hover:underline">{clientName || '—'}</Link>
              ) : (clientName || '—')}
            </p>
            {client?.contact && <p className="text-sm text-neya-muted mt-1">Attn : {client.contact}</p>}
            {client?.address && <p className="text-sm text-neya-muted">{client.address}</p>}
            {client?.city && <p className="text-sm text-neya-muted">{client.city}</p>}
            {client?.email && <p className="text-sm text-neya-muted">{client.email}</p>}
            {client?.phone && <p className="text-sm text-neya-muted">{client.phone}</p>}
            {!client?.address && !client?.email && !client?.phone && !client?.contact && (
              <p className="text-xs text-amber-800 mt-2">
                Complétez fiche client (adresse, email, téléphone) pour le PDF.
              </p>
            )}
          </div>
          <div className="doc-details-card">
            <p className="doc-label">{isQuote ? 'Détails du devis' : 'Détails de la facture'}</p>
            <div className="doc-details-rows text-sm space-y-1">
              <div className="flex justify-between gap-3">
                <span className="text-neya-muted">{isQuote ? 'Nº devis' : 'Nº facture'}</span>
                <span className="font-medium">{numberLabel || '—'}</span>
              </div>
              {isQuote ? (
                <div className="flex justify-between gap-3">
                  <span className="text-neya-muted">Valide jusqu’au</span>
                  <span className="font-medium">{draft.valid_until || '—'}</span>
                </div>
              ) : (
                <div className="flex justify-between gap-3">
                  <span className="text-neya-muted">Échéance</span>
                  <span className="font-medium">{draft.due_date || '—'}</span>
                </div>
              )}
              {statusLabel && (
                <div className="flex justify-between gap-3">
                  <span className="text-neya-muted">Statut</span>
                  <span className="font-medium">{statusLabel}</span>
                </div>
              )}
            </div>
            {isQuote && !readOnly && (
              <div className="doc-options mt-4">
                <p className="doc-label">Options document</p>
                {[
                  ['show_signature', 'Zone signature'],
                  ['show_acceptance_date', 'Date d’acceptation'],
                  ['show_payment', 'Informations de paiement'],
                ].map(([key, label]) => (
                  <label key={key} className="flex items-center gap-2 text-sm text-neya-ink py-0.5">
                    <input
                      type="checkbox"
                      checked={draft.options?.[key] !== false}
                      onChange={e => patch({ options: { ...draft.options, [key]: e.target.checked } })}
                    />
                    {label}
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="doc-notes-block">
          <p className="doc-label">{notesLabel}</p>
          {focusKey === 'notes' && !readOnly ? (
            <textarea
              autoFocus
              className="doc-input doc-textarea"
              rows={4}
              value={draft.notes}
              onChange={e => patch({ notes: e.target.value })}
              onBlur={() => setFocusKey(null)}
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

        {sections.map((section, sIdx) => {
          const meaningful = (section.lines || []).filter(isMeaningfulLine);
          if (readOnly && !meaningful.length && !String(section.title || '').trim()) {
            return null;
          }
          const showDropBefore = dropSectionIndex === sIdx && draggingSectionId;
          return (
            <div
              key={section.id}
              className={`doc-section ${draggingSectionId === section.id ? 'opacity-50' : ''} ${
                showDropBefore ? 'shadow-[inset_0_3px_0_0_#D86B30]' : ''
              }`}
              onDragOver={(e) => onSectionDragOver(e, sIdx)}
              onDrop={(e) => onSectionDrop(e, sIdx)}
            >
              <div
                className={`doc-section-head ${!readOnly ? 'cursor-grab active:cursor-grabbing' : ''}`}
                draggable={!readOnly}
                onDragStart={(e) => onSectionDragStart(e, section.id)}
                onDragEnd={onSectionDragEnd}
              >
                {!readOnly && (
                  <span
                    data-section-drag
                    className="text-neya-muted text-sm px-1 select-none"
                    title="Glisser le tableau"
                    aria-hidden
                  >
                    ⠿
                  </span>
                )}
                {focusKey === `title-${section.id}` && !readOnly ? (
                  <input
                    autoFocus
                    className="doc-input font-medium"
                    value={section.title}
                    onChange={e => patchSection(section.id, { title: e.target.value })}
                    onBlur={() => setFocusKey(null)}
                    onMouseDown={(e) => e.stopPropagation()}
                    placeholder="Titre du tableau (optionnel)"
                  />
                ) : (
                  <h3
                    className={`doc-section-title ${readOnly ? '' : 'doc-editable'}`}
                    onClick={() => !readOnly && setFocusKey(`title-${section.id}`)}
                    onMouseDown={(e) => {
                      // Clic pour éditer le titre : ne pas démarrer un drag
                      if (!readOnly) e.stopPropagation();
                    }}
                  >
                    {section.title || (readOnly ? '' : 'Titre du tableau…')}
                  </h3>
                )}
                {!readOnly && (
                  <div className="flex items-center gap-2 shrink-0" onMouseDown={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      className="text-xs text-neya-muted hover:text-neya-ink disabled:opacity-25"
                      title="Monter le tableau"
                      disabled={sIdx === 0}
                      onClick={() => moveSection(section.id, -1)}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="text-xs text-neya-muted hover:text-neya-ink disabled:opacity-25"
                      title="Descendre le tableau"
                      disabled={sIdx === sections.length - 1}
                      onClick={() => moveSection(section.id, 1)}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      className="text-xs text-neya-muted hover:text-neya-error"
                      onClick={() => removeSection(section.id)}
                    >
                      Supprimer tableau
                    </button>
                  </div>
                )}
              </div>

              {readOnly ? (
                meaningful.length ? (
                  <table className="doc-lines">
                    <thead>
                      <tr>
                        <th>Description</th>
                        <th className="text-right w-16">Qté</th>
                        <th className="text-right w-24">Prix unit.</th>
                        <th className="text-right w-28">Montant</th>
                      </tr>
                    </thead>
                    <tbody>
                      {meaningful.map((line, i) => {
                        const lineTotal = parseDecimal(line.qty) * parseDecimal(line.price);
                        return (
                          <tr key={i}>
                            <td>{line.description}</td>
                            <td className="text-right text-neya-muted tabular-nums">{line.qty}</td>
                            <td className="text-right tabular-nums">{formatMoney(parseDecimal(line.price))}</td>
                            <td className="text-right font-medium tabular-nums">{formatMoney(lineTotal)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                ) : (
                  <p className="text-sm text-neya-muted py-2">Aucune ligne</p>
                )
              ) : (
                <EasyTable
                  columns={LINE_COLS}
                  rows={editorRows(section.lines)}
                  onChange={(rows) => setSectionLines(section.id, rows)}
                  minRows={1}
                  showLineTotal
                  allowReorder
                  sectionId={section.id}
                  onReceiveRow={(payload, toIndex) => receiveRowFromOtherSection(section.id, payload, toIndex)}
                  className="doc-table"
                  variant="doc"
                />
              )}
            </div>
          );
        })}

        {!readOnly && (
          <div className="doc-add-section">
            <button type="button" onClick={addSection} className="btn-secondary text-sm min-h-[36px]">
              + Ajouter un tableau
            </button>
          </div>
        )}

        <footer className="doc-totals">
          <div className="doc-totals-row"><span>Sous-total</span><span className="tabular-nums">{formatMoney(taxes.subtotal)}</span></div>
          <div className="doc-totals-row"><span>TPS 5 %</span><span className="tabular-nums">{formatMoney(taxes.gst)}</span></div>
          <div className="doc-totals-row"><span>TVQ 9,975 %</span><span className="tabular-nums">{formatMoney(taxes.qst)}</span></div>
          <div className="doc-totals-row doc-totals-total"><span>Solde à payer</span><span className="tabular-nums">{formatMoney(taxes.total)}</span></div>
        </footer>

        {!readOnly && (
          <p className="text-[11px] text-neya-muted mt-3 leading-relaxed">
            Les prix sont hors taxes. Pour une dépense refacturée (magasin, quincaillerie), saisissez le montant
            <strong> avant taxes</strong> — sinon TPS/TVQ seraient ajoutées une seconde fois. Réclamez les CTI/RTI
            sur vos achats.
          </p>
        )}

        {isQuote && (
          <>
            <div className="doc-notes-block mt-8">
              <p className="doc-label">Notes additionnelles</p>
              {focusKey === 'additional_notes' && !readOnly ? (
                <textarea
                  autoFocus
                  className="doc-input doc-textarea"
                  rows={3}
                  value={draft.additional_notes || ''}
                  onChange={e => patch({ additional_notes: e.target.value })}
                  onBlur={() => setFocusKey(null)}
                  placeholder="Conditions particulières, délai, bois fourni…"
                />
              ) : (
                <p
                  className={`doc-notes ${readOnly ? '' : 'doc-editable'}`}
                  onClick={() => !readOnly && setFocusKey('additional_notes')}
                >
                  {draft.additional_notes || (readOnly ? '—' : 'Cliquer pour ajouter…')}
                </p>
              )}
            </div>

            <div
              className={`doc-photos ${dragOver ? 'doc-photos--drag' : ''}`}
              onDragOver={(e) => { e.preventDefault(); if (!readOnly) setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                handleFiles(e.dataTransfer.files);
              }}
            >
              <div className="flex items-center justify-between gap-2 mb-2">
                <p className="doc-label mb-0">Photos</p>
                {!readOnly && (
                  <>
                    <input
                      ref={fileRef}
                      type="file"
                      accept="image/*"
                      multiple
                      className="hidden"
                      onChange={e => handleFiles(e.target.files)}
                    />
                    <button
                      type="button"
                      className="text-xs text-neya-muted hover:text-neya-ink"
                      onClick={() => fileRef.current?.click()}
                      disabled={uploading}
                    >
                      {uploading ? 'Envoi…' : 'Ajouter / glisser ici'}
                    </button>
                  </>
                )}
              </div>
              {(draft.photos || []).length === 0 ? (
                <p className="text-sm text-neya-muted py-6 text-center border border-dashed border-neya-border">
                  Glissez des photos dans cette zone
                </p>
              ) : (
                <div className="doc-photo-grid">
                  {(draft.photos || []).map((photo, i) => (
                    <figure key={`${photo.url}-${i}`} className="doc-photo">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={resolveUploadUrl(photo.url)} alt={photo.caption || ''} />
                      {!readOnly && (
                        <button type="button" className="doc-photo-remove" onClick={() => removePhoto(i)}>✕</button>
                      )}
                      {photo.caption && <figcaption>{photo.caption}</figcaption>}
                    </figure>
                  ))}
                </div>
              )}
            </div>

            {!!quoteTerms?.length && (
              <div className="mt-8">
                <p className="doc-label">Conditions</p>
                <ul className="text-sm text-neya-muted space-y-1 list-disc pl-5">
                  {quoteTerms.map((t, i) => <li key={i}>{t}</li>)}
                </ul>
              </div>
            )}

            {draft.options?.show_payment !== false && companyPayment && (
              <div className="mt-8 doc-payment">
                <p className="doc-label">Paiement</p>
                <p className="text-sm text-neya-muted mb-3">{companyPayment.intro}</p>
                <div className="grid sm:grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="font-medium text-neya-ink">{companyPayment.interac?.label}</p>
                    <p className="text-neya-muted">{companyPayment.interac?.email}</p>
                    <p className="text-xs text-neya-muted mt-1">{companyPayment.interac?.note}</p>
                  </div>
                  <div>
                    <p className="font-medium text-neya-ink">{companyPayment.bank?.label}</p>
                    <p className="text-neya-muted">{companyPayment.bank?.institution}</p>
                    <p className="text-neya-muted text-xs mt-1">
                      Transit {companyPayment.bank?.transit} · Inst. {companyPayment.bank?.institutionNumber} · Compte {companyPayment.bank?.account}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {draft.options?.show_signature !== false && (
              <div className="mt-8 doc-signature">
                <p className="doc-label">Acceptation</p>
                <p className="text-sm text-neya-muted mb-4">
                  Signature client pour confirmer la commande
                </p>
                <div className="doc-signature-line">Signature : ______________________________________</div>
                {draft.options?.show_acceptance_date !== false && (
                  focusKey === 'acceptance_date' && !readOnly ? (
                    <input
                      autoFocus
                      type="date"
                      className="doc-input mt-3 max-w-[220px]"
                      value={draft.acceptance_date || ''}
                      onChange={e => patch({ acceptance_date: e.target.value })}
                      onBlur={() => setFocusKey(null)}
                    />
                  ) : (
                    <p
                      className={`text-sm text-neya-muted mt-3 ${readOnly ? '' : 'doc-editable inline-block'}`}
                      onClick={() => !readOnly && setFocusKey('acceptance_date')}
                    >
                      Date d’acceptation : {draft.acceptance_date || '______________'}
                    </p>
                  )
                )}
              </div>
            )}
          </>
        )}
      </article>
    </div>
  );
}

function buildDraft(value, isQuote) {
  if (isQuote) {
    const doc = normalizeQuoteDocument(value?.document || value?.lines || value);
    return {
      title: value?.title || '',
      subtitle: value?.reference || value?.subtitle || '',
      notes: value?.notes || '',
      valid_until: value?.valid_until ? String(value.valid_until).slice(0, 10) : '',
      acceptance_date: value?.acceptance_date ? String(value.acceptance_date).slice(0, 10) : '',
      additional_notes: value?.additional_notes || doc.additional_notes || '',
      sections: doc.sections,
      photos: doc.photos || [],
      options: doc.options,
    };
  }
  const doc = normalizeQuoteDocument(value?.lines);
  const sections = (doc.sections || []).map((s, i) => ({
    ...s,
    // Anciennes factures plates : pas de titre de section forcé
    title: (doc.sections.length === 1 && /^(Travaux|Travaux \/ produit)$/i.test(String(s.title || '')))
      ? ''
      : (s.title || ''),
  }));
  return {
    title: value?.title || '',
    subtitle: value?.subtitle || '',
    notes: value?.notes || value?.order_summary || '',
    due_date: value?.due_date ? String(value.due_date).slice(0, 10) : '',
    sections: sections.length ? sections : [emptySection('')],
  };
}

export { serializeQuoteDocument };

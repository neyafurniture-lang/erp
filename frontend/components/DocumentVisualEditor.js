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
} from '../lib/quote-document';

function normalizeInvoiceLines(lines) {
  if (!lines?.length) return [emptyLine()];
  return lines.map(l => ({
    description: l.description || '',
    qty: l.qty ?? 1,
    price: l.price ?? 0,
  }));
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

  function updateLine(sectionId, index, partial) {
    const sections = draft.sections.map(s => {
      if (s.id !== sectionId) return s;
      return {
        ...s,
        lines: s.lines.map((l, i) => (i === index ? { ...l, ...partial } : l)),
      };
    });
    patch({ sections });
  }

  function addLine(sectionId) {
    const sections = draft.sections.map(s => (
      s.id === sectionId ? { ...s, lines: [...s.lines, emptyLine()] } : s
    ));
    patch({ sections });
  }

  function removeLine(sectionId, index) {
    const sections = draft.sections.map(s => {
      if (s.id !== sectionId) return s;
      const lines = s.lines.filter((_, i) => i !== index);
      return { ...s, lines: lines.length ? lines : [emptyLine()] };
    });
    patch({ sections });
  }

  function addSection() {
    patch({ sections: [...draft.sections, emptySection(`Tableau ${draft.sections.length + 1}`)] });
  }

  function removeSection(sectionId) {
    if (draft.sections.length <= 1) return;
    patch({ sections: draft.sections.filter(s => s.id !== sectionId) });
  }

  function updateInvoiceLine(index, partial) {
    const lines = draft.lines.map((l, i) => (i === index ? { ...l, ...partial } : l));
    patch({ lines });
  }

  async function handleSave() {
    if (!onSave || readOnly) return;
    await onSave(draft);
    setDirty(false);
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

  const lineSource = isQuote
    ? flattenQuoteLines({ sections: draft.sections })
    : draft.lines;
  const taxes = calcTaxes(calcLineSubtotal(lineSource));
  const notesLabel = isQuote ? 'Portée des travaux' : 'Résumé / notes';

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
            <p className="doc-label">Client</p>
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
          {isQuote && !readOnly && (
            <div className="doc-options">
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

        {(isQuote ? draft.sections : [{ id: 'inv', title: null, lines: draft.lines }]).map((section) => (
          <div key={section.id} className="doc-section">
            {isQuote && (
              <div className="doc-section-head">
                {focusKey === `title-${section.id}` && !readOnly ? (
                  <input
                    autoFocus
                    className="doc-input font-medium"
                    value={section.title}
                    onChange={e => patchSection(section.id, { title: e.target.value })}
                    onBlur={() => setFocusKey(null)}
                    placeholder="Titre du tableau"
                  />
                ) : (
                  <h3
                    className={`doc-section-title ${readOnly ? '' : 'doc-editable'}`}
                    onClick={() => !readOnly && setFocusKey(`title-${section.id}`)}
                  >
                    {section.title || 'Sans titre'}
                  </h3>
                )}
                {!readOnly && draft.sections.length > 1 && (
                  <button type="button" className="text-xs text-neya-muted hover:text-neya-error" onClick={() => removeSection(section.id)}>
                    Retirer tableau
                  </button>
                )}
              </div>
            )}

            <table className="doc-lines">
              <thead>
                <tr>
                  <th>Description</th>
                  <th className="text-right w-16">Qté</th>
                  <th className="text-right w-24">Prix</th>
                  <th className="text-right w-28">Total</th>
                  {!readOnly && <th className="w-8" />}
                </tr>
              </thead>
              <tbody>
                {section.lines.map((line, i) => {
                  const lineTotal = (Number(line.qty) || 0) * (Number(line.price) || 0);
                  const editing = focusKey === `line-${section.id}-${i}` && !readOnly;
                  return (
                    <tr
                      key={i}
                      className={readOnly ? '' : 'doc-line-row'}
                      onClick={() => !readOnly && !editing && setFocusKey(`line-${section.id}-${i}`)}
                    >
                      {editing ? (
                        <>
                          <td>
                            <input
                              autoFocus
                              className="doc-input"
                              value={line.description}
                              onChange={e => (isQuote
                                ? updateLine(section.id, i, { description: e.target.value })
                                : updateInvoiceLine(i, { description: e.target.value }))}
                              placeholder="Description"
                            />
                          </td>
                          <td>
                            <input
                              type="number"
                              step="any"
                              min="0"
                              className="doc-input text-right"
                              value={line.qty}
                              onChange={e => (isQuote
                                ? updateLine(section.id, i, { qty: e.target.value })
                                : updateInvoiceLine(i, { qty: e.target.value }))}
                            />
                          </td>
                          <td>
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              className="doc-input text-right"
                              value={line.price}
                              onChange={e => (isQuote
                                ? updateLine(section.id, i, { price: e.target.value })
                                : updateInvoiceLine(i, { price: e.target.value }))}
                            />
                          </td>
                          <td className="text-right text-sm tabular-nums">{formatMoney(lineTotal)}</td>
                          <td>
                            <button
                              type="button"
                              className="text-neya-muted hover:text-neya-error text-xs"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (isQuote) removeLine(section.id, i);
                                else {
                                  const lines = draft.lines.filter((_, idx) => idx !== i);
                                  patch({ lines: lines.length ? lines : [emptyLine()] });
                                }
                              }}
                            >
                              ✕
                            </button>
                          </td>
                        </>
                      ) : (
                        <>
                          <td className="doc-editable">{line.description || '—'}</td>
                          <td className="text-right text-neya-muted tabular-nums">{line.qty}</td>
                          <td className="text-right tabular-nums">{formatMoney(line.price)}</td>
                          <td className="text-right font-medium tabular-nums">{formatMoney(lineTotal)}</td>
                          {!readOnly && <td />}
                        </>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {!readOnly && (
              <button
                type="button"
                onClick={() => (isQuote ? addLine(section.id) : patch({ lines: [...draft.lines, emptyLine()] }))}
                className="doc-add-line"
              >
                + Ajouter une ligne
              </button>
            )}
          </div>
        ))}

        {isQuote && !readOnly && (
          <button type="button" onClick={addSection} className="doc-add-line mt-2">
            + Ajouter un tableau
          </button>
        )}

        <footer className="doc-totals">
          <div className="doc-totals-row"><span>Sous-total</span><span className="tabular-nums">{formatMoney(taxes.subtotal)}</span></div>
          <div className="doc-totals-row"><span>TPS 5 %</span><span className="tabular-nums">{formatMoney(taxes.gst)}</span></div>
          <div className="doc-totals-row"><span>TVQ 9,975 %</span><span className="tabular-nums">{formatMoney(taxes.qst)}</span></div>
          <div className="doc-totals-row doc-totals-total"><span>Total</span><span className="tabular-nums">{formatMoney(taxes.total)}</span></div>
        </footer>

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
  return {
    title: value?.title || '',
    subtitle: value?.subtitle || '',
    notes: value?.notes || value?.order_summary || '',
    due_date: value?.due_date ? String(value.due_date).slice(0, 10) : '',
    lines: normalizeInvoiceLines(value?.lines),
  };
}

export { serializeQuoteDocument };

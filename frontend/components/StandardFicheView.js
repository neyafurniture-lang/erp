'use client';

import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { PHASE_LABELS, parseMeta, parseSteps } from '../lib/standards';
import { productImageUrl, stepImageUrl, resolveImageUrl } from '../lib/fiche-images';
import { api, downloadPdf } from '../lib/api';

function newBlockId() {
  return `b_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function EditPencil({ onClick, title = 'Modifier' }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className="shrink-0 p-1 rounded-md text-neya-muted hover:text-neya-orange hover:bg-neya-orange/10 transition-colors text-sm leading-none"
    >
      ✎
    </button>
  );
}

function InlineEdit({ value, placeholder, onSave, multiline = false }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value || '');
  const [saving, setSaving] = useState(false);

  async function commit() {
    setSaving(true);
    try {
      await onSave(draft.trim());
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    const Input = multiline ? 'textarea' : 'input';
    return (
      <div className="flex flex-col gap-2 mt-1">
        <Input
          className={`input text-sm ${multiline ? 'min-h-[72px]' : ''}`}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          placeholder={placeholder}
          autoFocus
          onKeyDown={e => {
            if (!multiline && e.key === 'Enter') { e.preventDefault(); commit(); }
            if (e.key === 'Escape') setEditing(false);
          }}
        />
        <div className="flex gap-2">
          <button type="button" onClick={commit} disabled={saving} className="btn-primary text-xs py-1.5 px-3">
            {saving ? '…' : 'Enregistrer'}
          </button>
          <button type="button" onClick={() => setEditing(false)} className="btn-secondary text-xs py-1.5 px-3">
            Annuler
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-1 group">
      {value ? (
        <p className="text-sm text-neya-ink font-medium flex-1">{value}</p>
      ) : (
        <p className="text-sm text-neya-muted italic flex-1">{placeholder || '—'}</p>
      )}
      <EditPencil onClick={() => { setDraft(value || ''); setEditing(true); }} />
    </div>
  );
}

function MetaRowEditable({ label, value, placeholder, onSave }) {
  return (
    <div className="border-b border-neya-border py-3">
      <p className="text-[10px] uppercase tracking-wider text-neya-muted mb-0.5">{label}</p>
      <InlineEdit value={value} placeholder={placeholder} onSave={onSave} />
    </div>
  );
}

function FicheImage({ src, alt, className = '' }) {
  if (!src) return null;
  return (
    <div className={`relative overflow-hidden rounded-xl border border-neya-border bg-neya-cream/30 ${className}`}>
      <Image
        src={src}
        alt={alt}
        width={800}
        height={500}
        className="w-full h-auto object-contain"
        unoptimized
      />
    </div>
  );
}

function DebitageCell({ value, placeholder, onSave }) {
  return <InlineEdit value={value} placeholder={placeholder} onSave={onSave} />;
}

function DebitageTable({ rows, note, onSaveRow, onSaveNote, onAddRow, onDeleteRow }) {
  if (!rows?.length && !onAddRow) return null;
  return (
    <div className="mb-8">
      <div className="flex items-center justify-between gap-2 mb-1">
        <h2 className="font-heading text-base text-neya-ink">Débitage</h2>
        {onAddRow && (
          <button type="button" onClick={onAddRow} className="text-xs text-neya-orange hover:underline">
            + Ligne débitage
          </button>
        )}
      </div>
      {(note || onSaveNote) && (
        <div className="mb-3">
          {onSaveNote ? (
            <InlineEdit value={note} placeholder="Note débitage (optionnel)" onSave={onSaveNote} multiline />
          ) : (
            <p className="text-xs text-neya-muted italic">{note}</p>
          )}
        </div>
      )}
      <div className="overflow-x-auto rounded-xl border border-neya-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-neya-cream text-left">
              <th className="px-3 py-2 text-[10px] uppercase tracking-wider text-neya-muted font-semibold">Pièce</th>
              <th className="px-3 py-2 text-[10px] uppercase tracking-wider text-neya-muted font-semibold">Essence</th>
              <th className="px-3 py-2 text-[10px] uppercase tracking-wider text-neya-muted font-semibold">Qté</th>
              <th className="px-3 py-2 text-[10px] uppercase tracking-wider text-neya-muted font-semibold">Dimensions (É × L × Lo)</th>
              <th className="px-3 py-2 text-[10px] uppercase tracking-wider text-neya-muted font-semibold">Notes</th>
              {onDeleteRow && <th className="w-8" />}
            </tr>
          </thead>
          <tbody>
            {(rows || []).map((row, i) => (
              <tr key={i} className="border-t border-neya-border align-top">
                <td className="px-3 py-2">
                  {onSaveRow ? (
                    <DebitageCell value={row.piece} placeholder="Pièce" onSave={v => onSaveRow(i, 'piece', v)} />
                  ) : (
                    <span className="font-medium text-neya-ink">{row.piece}</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  {onSaveRow ? (
                    <DebitageCell value={row.wood} placeholder="Essence" onSave={v => onSaveRow(i, 'wood', v)} />
                  ) : (
                    <span className="text-neya-muted">{row.wood}</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  {onSaveRow ? (
                    <DebitageCell value={row.qty} placeholder="Qté" onSave={v => onSaveRow(i, 'qty', v)} />
                  ) : (
                    <span className="text-neya-muted">{row.qty}</span>
                  )}
                </td>
                <td className="px-3 py-2 min-w-[140px]">
                  {onSaveRow ? (
                    <DebitageCell value={row.dimensions} placeholder="É × L × Lo" onSave={v => onSaveRow(i, 'dimensions', v)} />
                  ) : (
                    <span className="text-neya-ink">{row.dimensions}</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  {onSaveRow ? (
                    <DebitageCell value={row.notes} placeholder="Notes" onSave={v => onSaveRow(i, 'notes', v)} />
                  ) : (
                    <span className="text-neya-muted text-xs">{row.notes}</span>
                  )}
                </td>
                {onDeleteRow && (
                  <td className="px-2 py-2">
                    <button type="button" onClick={() => onDeleteRow(i)} className="text-neya-muted hover:text-red-600 text-xs" title="Supprimer">✕</button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {onAddRow && !rows?.length && (
        <p className="text-xs text-neya-muted mt-2 italic">Aucune ligne — cliquez « + Ligne débitage »</p>
      )}
    </div>
  );
}

function CustomBlock({ block, standardId, onUpdate, onDelete, onMove, isFirst, isLast }) {
  async function uploadImage(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const fd = new FormData();
    fd.append('image', file);
    const { url } = await api(`/standards/${standardId}/upload`, { method: 'POST', body: fd });
    onUpdate({ url });
  }

  return (
    <div className="bg-white rounded-xl border border-neya-border p-4 text-sm">
      <div className="flex items-start justify-between gap-2 mb-3">
        <span className="text-[10px] uppercase tracking-wider text-neya-muted font-semibold">
          {block.type === 'text' && 'Bloc texte'}
          {block.type === 'note' && 'Note'}
          {block.type === 'checklist' && 'Liste à cocher'}
          {block.type === 'image' && 'Image'}
        </span>
        <div className="flex gap-1 shrink-0">
          {!isFirst && <button type="button" onClick={() => onMove(-1)} className="text-xs text-neya-muted hover:text-neya-orange px-1">↑</button>}
          {!isLast && <button type="button" onClick={() => onMove(1)} className="text-xs text-neya-muted hover:text-neya-orange px-1">↓</button>}
          <button type="button" onClick={onDelete} className="text-xs text-neya-muted hover:text-red-600 px-1">✕</button>
        </div>
      </div>

      {block.type !== 'note' && (
        <div className="mb-2">
          <InlineEdit value={block.title} placeholder="Titre du bloc" onSave={v => onUpdate({ title: v })} />
        </div>
      )}

      {block.type === 'text' && (
        <InlineEdit value={block.content} placeholder="Contenu…" onSave={v => onUpdate({ content: v })} multiline />
      )}

      {block.type === 'note' && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
          <InlineEdit value={block.content} placeholder="Note importante…" onSave={v => onUpdate({ content: v })} multiline />
        </div>
      )}

      {block.type === 'checklist' && (
        <ul className="space-y-2">
          {(block.items || []).map((item, i) => (
            <li key={i} className="flex items-center gap-2">
              <span className="text-neya-orange">☐</span>
              <div className="flex-1 min-w-0">
                <InlineEdit
                  value={item}
                  placeholder="Élément…"
                  onSave={v => {
                    const items = [...(block.items || [])];
                    items[i] = v;
                    onUpdate({ items });
                  }}
                />
              </div>
              <button
                type="button"
                className="text-xs text-neya-muted hover:text-red-600"
                onClick={() => onUpdate({ items: (block.items || []).filter((_, j) => j !== i) })}
              >✕</button>
            </li>
          ))}
          <button
            type="button"
            className="text-xs text-neya-orange hover:underline"
            onClick={() => onUpdate({ items: [...(block.items || []), ''] })}
          >
            + Élément
          </button>
        </ul>
      )}

      {block.type === 'image' && (
        <div className="space-y-2">
          <InlineEdit value={block.url} placeholder="URL image ou téléverser ci-dessous" onSave={v => onUpdate({ url: v })} />
          <label className="btn-secondary text-xs py-1.5 px-3 inline-block cursor-pointer">
            Téléverser une photo
            <input type="file" accept="image/*" className="hidden" onChange={uploadImage} />
          </label>
          {block.url && (
            <FicheImage src={resolveImageUrl(block.url)} alt={block.title || 'Bloc image'} className="max-w-md" />
          )}
        </div>
      )}
    </div>
  );
}

const CIRCLED = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧'];

export default function StandardFicheView({ standard, onStandardChange, onCreateProject }) {
  const meta = parseMeta(standard.meta);
  const steps = parseSteps(standard.steps);
  const totalMin = steps.reduce((sum, st) => sum + (st.estimated_minutes || 0), 0);
  const isGuide = standard.product_type === 'guide';
  const sku = meta.sku && meta.sku !== 'GUIDE' ? meta.sku : null;
  const displayName = standard.name.replace(/^[A-Z0-9ÕÄÜ]+\s+—\s+/, '');
  const productImage = productImageUrl(meta);

  const fabStepsWithIndex = steps
    .map((step, i) => ({ step, i }))
    .filter(({ step }) => !(step.phase === 'finition' && step.description.includes('Cardon')));

  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfError, setPdfError] = useState(null);
  const [saveError, setSaveError] = useState(null);
  const [photoLoading, setPhotoLoading] = useState(false);

  const blocks = meta.blocks || [];

  async function persistStandard(nextMeta, nextSteps = steps) {
    setSaveError(null);
    try {
      const updated = await api(`/standards/${standard.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          name: standard.name,
          product_type: standard.product_type,
          meta: nextMeta,
          steps: nextSteps,
        }),
      });
      onStandardChange?.(updated);
    } catch (err) {
      setSaveError(err.message || 'Erreur lors de la sauvegarde');
      throw err;
    }
  }

  async function saveMetaField(field, value) {
    await persistStandard({ ...meta, [field]: value });
  }

  async function saveDebitageRow(index, field, value) {
    const debitage = [...(meta.debitage || [])];
    debitage[index] = { ...debitage[index], [field]: value };
    await persistStandard({ ...meta, debitage });
  }

  async function addDebitageRow() {
    const debitage = [...(meta.debitage || []), { piece: '', wood: '', qty: '', dimensions: '', notes: '' }];
    await persistStandard({ ...meta, debitage });
  }

  async function deleteDebitageRow(index) {
    await persistStandard({ ...meta, debitage: (meta.debitage || []).filter((_, i) => i !== index) });
  }

  async function addBlock(type) {
    const block = {
      id: newBlockId(),
      type,
      title: type === 'note' ? 'Note' : '',
      content: '',
      items: type === 'checklist' ? [''] : [],
      url: '',
    };
    await persistStandard({ ...meta, blocks: [...blocks, block] });
  }

  async function updateBlock(id, patch) {
    await persistStandard({
      ...meta,
      blocks: blocks.map(b => (b.id === id ? { ...b, ...patch } : b)),
    });
  }

  async function deleteBlock(id) {
    await persistStandard({ ...meta, blocks: blocks.filter(b => b.id !== id) });
  }

  async function moveBlock(id, dir) {
    const next = [...blocks];
    const i = next.findIndex(b => b.id === id);
    const j = i + dir;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    await persistStandard({ ...meta, blocks: next });
  }

  async function addStep() {
    const newStep = {
      phase: 'usinage',
      description: 'Nouvelle étape',
      instructions: '',
      estimated_minutes: 60,
      tools: [],
    };
    await persistStandard(meta, [...steps, newStep]);
  }

  async function saveStepField(index, field, value) {
    const next = steps.map((s, i) => (i === index ? { ...s, [field]: value } : s));
    await persistStandard(meta, next);
  }

  async function deleteStep(index) {
    if (!window.confirm('Supprimer cette étape ?')) return;
    await persistStandard(meta, steps.filter((_, i) => i !== index));
  }

  async function refreshPhoto() {
    setPhotoLoading(true);
    setSaveError(null);
    try {
      const updated = await api(`/standards/${standard.id}/sync-photo`, { method: 'POST' });
      onStandardChange?.(updated);
    } catch (err) {
      setSaveError(err.message || 'Impossible de récupérer la photo');
    } finally {
      setPhotoLoading(false);
    }
  }

  async function handlePdf() {
    setPdfError(null);
    setPdfLoading(true);
    try {
      const filename = `Fiche_${sku || standard.id}.pdf`;
      await downloadPdf(`/standards/${standard.id}/pdf`, filename);
    } catch (err) {
      setPdfError(err.message || 'Impossible de générer le PDF');
    } finally {
      setPdfLoading(false);
    }
  }

  return (
    <div className="max-w-3xl">
      <div className="mb-6">
        {productImage && (
          <FicheImage
            src={productImage}
            alt={displayName}
            className="mb-3"
          />
        )}
        {!isGuide && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={refreshPhoto}
              disabled={photoLoading}
              className="btn-secondary text-sm disabled:opacity-50"
            >
              {photoLoading ? 'Mise à jour…' : '↻ Photo depuis le site'}
            </button>
            {meta.photos_synced_at && (
              <span className="text-xs text-neya-muted">
                Sync : {new Date(meta.photos_synced_at).toLocaleString('fr-CA')}
              </span>
            )}
          </div>
        )}
      </div>
      <div className="bg-white rounded-2xl border-2 border-neya-orange/30 overflow-hidden mb-6">
        <div className="bg-neya-cream px-6 py-4 border-b border-neya-border">
          <p className="text-[10px] tracking-[0.2em] uppercase text-neya-muted">Neya — Fiche fabrication</p>
          <div className="flex items-start justify-between gap-4 mt-2">
            <div>
              {sku && (
                <span className="inline-block text-sm font-bold bg-neya-orange text-white px-3 py-1 rounded-full mb-2">
                  {sku}
                </span>
              )}
              <h1 className="font-heading text-2xl text-neya-ink">{displayName}</h1>
              {meta.web_permalink && (
                <a
                  href={meta.web_permalink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-neya-orange hover:underline mt-2 inline-block"
                >
                  Voir sur le site web ↗
                </a>
              )}
            </div>
            <div className="text-right text-xs text-neya-muted shrink-0">
              <p>{steps.length} étapes</p>
              <p>~{Math.round(totalMin / 60)}h</p>
            </div>
          </div>
        </div>

        {!isGuide && (
          <div className="px-6 grid grid-cols-1 sm:grid-cols-2">
            <MetaRowEditable label="Prix public" value={meta.price} placeholder="Ex. 380 $" onSave={v => saveMetaField('price', v)} />
            <MetaRowEditable label="Essence(s)" value={meta.wood} placeholder="Ex. Noyer massif" onSave={v => saveMetaField('wood', v)} />
            <MetaRowEditable label="Dimensions" value={meta.dimensions} placeholder="Ex. 60&quot; × 30&quot; × 18&quot;" onSave={v => saveMetaField('dimensions', v)} />
            <MetaRowEditable label="Finition" value={meta.finish} placeholder="Ex. Vernis à l'eau" onSave={v => saveMetaField('finish', v)} />
            <MetaRowEditable label="Délai" value={meta.lead_time} placeholder="Ex. 2-3 semaines" onSave={v => saveMetaField('lead_time', v)} />
            {meta.related && (
              <div className="border-b border-neya-border py-3">
                <p className="text-[10px] uppercase tracking-wider text-neya-muted mb-0.5">Lié à</p>
                <p className="text-sm text-neya-ink font-medium">{meta.related}</p>
              </div>
            )}
          </div>
        )}

        {meta.source && (
          <p className="px-6 py-3 text-[10px] text-neya-muted border-t border-neya-border bg-neya-cream/50">
            {meta.source}
          </p>
        )}
      </div>

      {!isGuide && (
        <DebitageTable
          rows={meta.debitage}
          note={meta.debitage_note}
          onSaveRow={saveDebitageRow}
          onSaveNote={v => saveMetaField('debitage_note', v)}
          onAddRow={addDebitageRow}
          onDeleteRow={deleteDebitageRow}
        />
      )}

      <div className="mb-8">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <h2 className="font-heading text-base text-neya-ink">Blocs personnalisés</h2>
          <div className="flex flex-wrap gap-1">
            <button type="button" onClick={() => addBlock('text')} className="text-xs btn-secondary py-1 px-2">+ Texte</button>
            <button type="button" onClick={() => addBlock('note')} className="text-xs btn-secondary py-1 px-2">+ Note</button>
            <button type="button" onClick={() => addBlock('checklist')} className="text-xs btn-secondary py-1 px-2">+ Liste</button>
            <button type="button" onClick={() => addBlock('image')} className="text-xs btn-secondary py-1 px-2">+ Image</button>
          </div>
        </div>
        {blocks.length === 0 ? (
          <p className="text-xs text-neya-muted italic">Ajoutez des blocs pour enrichir la fiche (notes, photos, listes…)</p>
        ) : (
          <div className="space-y-3">
            {blocks.map((block, i) => (
              <CustomBlock
                key={block.id}
                block={block}
                standardId={standard.id}
                onUpdate={patch => updateBlock(block.id, patch)}
                onDelete={() => deleteBlock(block.id)}
                onMove={dir => moveBlock(block.id, dir)}
                isFirst={i === 0}
                isLast={i === blocks.length - 1}
              />
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <h2 className="font-heading text-base text-neya-ink">
          {isGuide ? 'Guides atelier' : 'Étapes de fabrication'}
        </h2>
        <button type="button" onClick={addStep} className="text-xs text-neya-orange hover:underline">
          + Étape
        </button>
      </div>
      <ol className="space-y-3 mb-8">
        {fabStepsWithIndex.map(({ step, i: stepIndex }, displayIndex) => {
          const circled = step.num != null ? CIRCLED[step.num - 1] : CIRCLED[displayIndex];
          return (
            <li key={stepIndex} className="bg-white rounded-xl border border-neya-border p-4 text-sm list-none">
              <div className="flex items-start gap-3">
                <span className="shrink-0 text-neya-orange font-bold text-base leading-7 w-6 text-center">
                  {circled || `${displayIndex + 1}.`}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 mb-1.5">
                    <select
                      className="text-xs border border-neya-border rounded-full px-2 py-0.5 bg-white"
                      value={step.phase}
                      onChange={e => saveStepField(stepIndex, 'phase', e.target.value)}
                    >
                      {Object.entries(PHASE_LABELS).map(([k, v]) => (
                        <option key={k} value={k}>{v}</option>
                      ))}
                    </select>
                    <input
                      type="number"
                      className="text-xs border border-neya-border rounded px-2 py-0.5 w-16"
                      value={step.estimated_minutes}
                      onChange={e => saveStepField(stepIndex, 'estimated_minutes', Number(e.target.value) || 0)}
                      title="Minutes"
                    />
                    <span className="text-xs text-neya-muted">min</span>
                    <button
                      type="button"
                      onClick={() => deleteStep(stepIndex)}
                      className="text-xs text-neya-muted hover:text-red-600 ml-auto"
                    >Supprimer</button>
                  </div>
                  <InlineEdit
                    value={step.description}
                    placeholder="Description de l'étape"
                    onSave={v => saveStepField(stepIndex, 'description', v)}
                  />
                  <div className="mt-2">
                    <InlineEdit
                      value={step.instructions}
                      placeholder="Instructions détaillées…"
                      onSave={v => saveStepField(stepIndex, 'instructions', v)}
                      multiline
                    />
                  </div>
                  {stepImageUrl(step) && (
                    <FicheImage
                      src={stepImageUrl(step)}
                      alt={step.description}
                      className="mt-3 max-w-md"
                    />
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ol>

      {!isGuide && meta.domino && (
        <div className="card mb-8 bg-neya-cream/40">
          <h3 className="font-heading text-sm text-neya-ink mb-2">{meta.domino.title}</h3>
          <p className="text-xs text-neya-muted mb-2">{meta.domino.note}</p>
          {meta.domino.images?.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-3">
              {meta.domino.images.map((src, i) => (
                <FicheImage key={i} src={src} alt={`Domino ${i + 1}`} className="!rounded-lg" />
              ))}
            </div>
          )}
          <ul className="text-xs text-neya-muted space-y-1">
            {meta.domino.checklist?.map((c, i) => <li key={i}>☐ {c}</li>)}
          </ul>
        </div>
      )}

      <div className="mt-8 flex flex-wrap gap-3 items-center">
        <button
          type="button"
          onClick={handlePdf}
          disabled={pdfLoading}
          className="btn-primary disabled:opacity-60"
        >
          {pdfLoading ? 'Génération…' : 'PDF remplissable (atelier)'}
        </button>
        {pdfError && (
          <p className="text-sm text-red-600 w-full">{pdfError}</p>
        )}
        {saveError && (
          <p className="text-sm text-red-600 w-full">{saveError}</p>
        )}
        {!isGuide && onCreateProject && (
          <button type="button" onClick={onCreateProject} className="btn-secondary">
            Créer un projet
          </button>
        )}
        {!isGuide && (
          <Link href="/settings?tab=web" className="btn-secondary">
            Sync site web
          </Link>
        )}
        <Link href="/standards" className="btn-secondary">
          Retour au catalogue
        </Link>
      </div>
    </div>
  );
}

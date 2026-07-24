'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ExternalLink, FileText } from 'lucide-react';
import AppShell from '../../components/AppShell';
import AuthGuard from '../../components/AuthGuard';
import { api } from '../../lib/api';

/** Catalogue local — le tableau s’affiche même si l’API n’a pas encore le tracker. */
export const DEFAULT_FRAME_CATALOG = [
  { sku: 'H2013', label: '20" × 13" Underbench', qty: 20 },
  { sku: 'H2026', label: '20" × 26" Standard', qty: 20 },
  { sku: 'H2226', label: '22" × 26" Standard', qty: 10 },
  { sku: 'H2626', label: '26" × 26" Standard', qty: 10 },
  { sku: 'H3313', label: '33" × 13" Underbench', qty: 10 },
  { sku: 'H3326', label: '33" × 26" Standard', qty: 10 },
  { sku: 'H3726', label: '37" × 26" Standard', qty: 10 },
  { sku: 'FS750', label: 'Full-spectrum', qty: 10 },
];

/** BOM Cutting Plan Sierra — pièces par frame (2 longs + 2 shorts + traverses). */
export const SIERRA_BOM = {
  H2013: { long_in: 13, short_in: 20, long_count: 2, short_count: 2, traverse_in: 20, traverse_count: 2 },
  H2026: { long_in: 26, short_in: 20, long_count: 2, short_count: 2, traverse_in: 20, traverse_count: 4 },
  H2226: { long_in: 26, short_in: 22, long_count: 2, short_count: 2, traverse_in: 22, traverse_count: 4 },
  H3313: { long_in: 33, short_in: 13, long_count: 2, short_count: 2, traverse_in: 13, traverse_count: 2 },
  H3726: { long_in: 37, short_in: 26, long_count: 2, short_count: 2, traverse_in: 26, traverse_count: 4 },
};

const STAGES = [
  { key: 'debited', label: 'Débité', hint: 'Bois débité', color: 'amber' },
  { key: 'in_progress', label: 'En cours', hint: 'En assemblage', color: 'sky' },
  { key: 'done', label: 'Terminé', hint: 'Fabriqué / prêt', color: 'emerald' },
  { key: 'delivered', label: 'Livré', hint: 'Expédié / livré', color: 'green' },
];

/** Couleurs par étape — vert = fini (terminé / livré). */
const STAGE_STYLE = {
  debited: {
    th: 'bg-amber-100 text-amber-950 border-amber-200/80',
    cell: 'bg-amber-50/80',
    input: 'border-amber-200 focus:border-amber-400 focus:ring-amber-200/50',
    card: 'border-amber-200 bg-amber-50',
  },
  in_progress: {
    th: 'bg-sky-100 text-sky-950 border-sky-200/80',
    cell: 'bg-sky-50/80',
    input: 'border-sky-200 focus:border-sky-400 focus:ring-sky-200/50',
    card: 'border-sky-200 bg-sky-50',
  },
  done: {
    th: 'bg-emerald-200 text-emerald-950 border-emerald-300/80',
    cell: 'bg-emerald-50',
    input: 'border-emerald-300 focus:border-emerald-500 focus:ring-emerald-200/50',
    card: 'border-emerald-300 bg-emerald-50',
  },
  delivered: {
    th: 'bg-green-300 text-green-950 border-green-400/70',
    cell: 'bg-green-50',
    input: 'border-green-300 focus:border-green-500 focus:ring-green-200/50',
    card: 'border-green-300 bg-green-50',
  },
};

const SIERRA_PDF = '/docs/Cutting_Plan_Sierra_EN.pdf';

/** BOM produit en pouces → affichage atelier en cm. */
export function inchesToCm(inches) {
  const n = Number(inches);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 2.54 * 10) / 10;
}

export function formatLengthCm(inches) {
  const cm = inchesToCm(inches);
  if (cm == null) return '';
  return `${Number.isInteger(cm) ? cm : cm} cm`;
}

function emptyCounts() {
  return { debited: 0, in_progress: 0, done: 0, delivered: 0 };
}

function emptySizeLogs() {
  return { sides: {}, traverses: {} };
}

function piecesPerFrame(bom) {
  if (!bom) return 0;
  return (bom.long_count || 0) + (bom.short_count || 0) + (bom.traverse_count || 0);
}

/** Côtés de cadre = longs + shorts (périmètre du cadre). */
function sidesPerFrame(bom) {
  if (!bom) return 0;
  return (bom.long_count || 0) + (bom.short_count || 0);
}

function traversesPerFrame(bom) {
  if (!bom) return 0;
  return bom.traverse_count || 0;
}

function framesNotReached(row, stageKey) {
  const qty = Number(row.qty) || 0;
  const idx = STAGES.findIndex((s) => s.key === stageKey);
  if (idx < 0) return qty;
  const reached = STAGES.slice(idx).reduce((s, st) => s + (Number(row.counts?.[st.key]) || 0), 0);
  return Math.max(0, qty - reached);
}

function expandLengths(sku, frameCount) {
  const n = Math.max(0, Math.round(Number(frameCount) || 0));
  const bom = SIERRA_BOM[sku];
  const by = {};
  if (!bom || !n) return { pieces: 0, structural: 0, traverses: 0, by_length: by };
  const add = (inches, count) => {
    if (!inches || !count) return;
    const key = formatLengthCm(inches);
    by[key] = (by[key] || 0) + count;
  };
  add(bom.long_in, bom.long_count * n);
  add(bom.short_in, bom.short_count * n);
  add(bom.traverse_in, bom.traverse_count * n);
  const structural = (bom.long_count + bom.short_count) * n;
  const traverses = bom.traverse_count * n;
  return { pieces: structural + traverses, structural, traverses, by_length: by };
}

/** Agrège tailles BOM pour côtés (longs+shorts) ou traverses. */
export function aggregatePieceSizes(frames = [], kind = 'sides') {
  const by = new Map();
  for (const row of frames) {
    const bom = SIERRA_BOM[row.sku];
    if (!bom) continue;
    const qty = Math.max(0, Math.round(Number(row.qty) || 0));
    if (!qty) continue;
    const add = (inches, count, role) => {
      if (!inches || !count) return;
      const length = formatLengthCm(inches);
      const cm = inchesToCm(inches);
      const prev = by.get(length) || { length, inches: Number(inches), cm, qty: 0, roles: {}, skus: [] };
      const pieceQty = count * qty;
      prev.qty += pieceQty;
      prev.roles[role] = (prev.roles[role] || 0) + pieceQty;
      if (!prev.skus.includes(row.sku)) prev.skus.push(row.sku);
      by.set(length, prev);
    };
    if (kind === 'traverses') {
      add(bom.traverse_in, bom.traverse_count, 'traverse');
    } else {
      add(bom.long_in, bom.long_count, 'long');
      add(bom.short_in, bom.short_count, 'short');
    }
  }
  return [...by.values()].sort((a, b) => (b.cm || 0) - (a.cm || 0));
}

function buildLocalFrames(apiFrames) {
  const bySku = new Map();
  for (const row of apiFrames || []) {
    if (row?.sku) bySku.set(String(row.sku).toUpperCase(), row);
  }
  return DEFAULT_FRAME_CATALOG.map((cat) => {
    const prev = bySku.get(cat.sku);
    const counts = { ...emptyCounts(), ...(prev?.counts || {}) };
    const qty = Number(prev?.qty) > 0 ? Number(prev.qty) : cat.qty;
    const placed = STAGES.reduce((s, st) => s + (Number(counts[st.key]) || 0), 0);
    const remaining = Math.max(0, qty - placed);
    const bom = SIERRA_BOM[cat.sku] || null;
    const ppf = piecesPerFrame(bom);
    const spf = sidesPerFrame(bom);
    const tpf = traversesPerFrame(bom);
    const debitedCount = Number(counts.debited) || 0;
    return {
      sku: cat.sku,
      label: prev?.label || cat.label,
      qty,
      counts,
      placed,
      remaining,
      bom,
      pieces_per_frame: ppf,
      sides_per_frame: spf,
      traverses_per_frame: tpf,
      pieces_total: qty * ppf,
      sides_total: qty * spf,
      traverses_total: qty * tpf,
      pieces_missing: remaining * ppf,
      sides_missing: remaining * spf,
      traverses_missing: remaining * tpf,
      sides_cut: placed * spf,
      traverses_cut: placed * tpf,
      sides_debited: debitedCount * spf,
      traverses_debited: debitedCount * tpf,
    };
  });
}

function summarize(frames) {
  const qty = frames.reduce((s, f) => s + (f.qty || 0), 0);
  const delivered = frames.reduce((s, f) => s + (f.counts?.delivered || 0), 0);
  const done = frames.reduce((s, f) => s + (f.counts?.done || 0), 0);
  const in_progress = frames.reduce((s, f) => s + (f.counts?.in_progress || 0), 0);
  const debited = frames.reduce((s, f) => s + (f.counts?.debited || 0), 0);
  const remaining = frames.reduce((s, f) => s + (f.remaining || 0), 0);
  const pieces_missing = frames.reduce((s, f) => s + (f.pieces_missing || 0), 0);
  const sides_missing = frames.reduce((s, f) => s + (f.sides_missing || 0), 0);
  const traverses_missing = frames.reduce((s, f) => s + (f.traverses_missing || 0), 0);
  const pieces_total = frames.reduce((s, f) => s + (f.pieces_total || 0), 0);
  const sides_total = frames.reduce((s, f) => s + (f.sides_total || 0), 0);
  const traverses_total = frames.reduce((s, f) => s + (f.traverses_total || 0), 0);
  const sides_debited = frames.reduce((s, f) => s + (f.sides_debited || 0), 0);
  const traverses_debited = frames.reduce((s, f) => s + (f.traverses_debited || 0), 0);
  const sides_cut = frames.reduce((s, f) => s + (f.sides_cut || 0), 0);
  const traverses_cut = frames.reduce((s, f) => s + (f.traverses_cut || 0), 0);
  const pct = qty ? Math.min(100, Math.round((delivered / qty) * 100)) : 0;
  return {
    qty,
    remaining,
    debited,
    in_progress,
    done,
    delivered,
    pieces_missing,
    sides_missing,
    traverses_missing,
    pieces_total,
    sides_total,
    traverses_total,
    sides_debited,
    traverses_debited,
    sides_cut,
    traverses_cut,
    pct,
    complete: qty > 0 && delivered >= qty,
  };
}

function computeSierraLocal(frames) {
  const by_stage = {};
  for (const st of STAGES) {
    by_stage[st.key] = { key: st.key, label: st.label, frames: 0, pieces: 0, structural: 0, traverses: 0, by_length: {} };
  }
  for (const row of frames) {
    for (const st of STAGES) {
      const n = framesNotReached(row, st.key);
      const exp = expandLengths(row.sku, n);
      const b = by_stage[st.key];
      b.frames += n;
      b.pieces += exp.pieces;
      b.structural += exp.structural;
      b.traverses += exp.traverses;
      for (const [k, v] of Object.entries(exp.by_length)) {
        b.by_length[k] = (b.by_length[k] || 0) + v;
      }
    }
  }
  const to_cut = by_stage.debited;
  const orderSides = frames.reduce((s, f) => s + (f.sides_total || 0), 0);
  const orderTrav = frames.reduce((s, f) => s + (f.traverses_total || 0), 0);
  const orderFrames = frames.reduce((s, f) => s + (f.qty || 0), 0);
  return {
    by_stage,
    cut: {
      frames: Math.max(0, orderFrames - (to_cut.frames || 0)),
      sides: Math.max(0, orderSides - (to_cut.structural || 0)),
      traverses: Math.max(0, orderTrav - (to_cut.traverses || 0)),
      pieces: Math.max(0, orderSides + orderTrav - (to_cut.pieces || 0)),
    },
    to_cut: {
      frames: to_cut.frames,
      pieces: to_cut.pieces,
      structural: to_cut.structural,
      sides: to_cut.structural,
      traverses: to_cut.traverses,
      by_length: Object.entries(to_cut.by_length)
        .map(([length, qty]) => ({ length, qty, cm: parseFloat(length) || 0 }))
        .sort((a, b) => b.cm - a.cm),
    },
  };
}

function QtyInput({ value, onCommit, disabled, className = '' }) {
  const [local, setLocal] = useState(String(value ?? 0));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setLocal(String(value ?? 0));
  }, [value, focused]);

  function commit() {
    const n = Math.max(0, Math.round(Number(local) || 0));
    setLocal(String(n));
    if (n !== Number(value || 0)) onCommit(n);
  }

  return (
    <input
      type="number"
      min="0"
      inputMode="numeric"
      disabled={disabled}
      className={`w-16 mx-auto text-center input py-1.5 text-sm tabular-nums disabled:bg-neya-surface/50 disabled:text-neya-muted ${className}`}
      value={local}
      onChange={(e) => setLocal(e.target.value)}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false);
        commit();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
      }}
    />
  );
}

function SummaryCard({ label, value, accent, sub }) {
  return (
    <div className={`rounded-2xl border border-neya-border bg-white px-4 py-3 ${accent || ''}`}>
      <p className="text-[11px] uppercase tracking-wide text-neya-muted">{label}</p>
      <p className="text-2xl font-display font-semibold tabular-nums text-neya-ink">{value}</p>
      {sub ? <p className="text-[11px] text-neya-muted mt-0.5">{sub}</p> : null}
    </div>
  );
}

/** Panneau : cliquer un total → noter les tailles (par longueur). */
function SizeNotesPanel({ kind, title, sizes, notes, onChangeNote, onClose, saving }) {
  const total = sizes.reduce((s, r) => s + (r.qty || 0), 0);
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <button type="button" className="absolute inset-0 bg-black/40" aria-label="Fermer" onClick={onClose} />
      <div className="relative w-full sm:max-w-lg max-h-[88vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl border border-neya-border bg-white shadow-xl">
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-neya-border bg-white px-5 py-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-neya-orange">{title}</p>
            <p className="font-display text-2xl font-semibold tabular-nums text-neya-ink">{total}</p>
            <p className="text-xs text-neya-muted mt-0.5">
              Longueurs en cm — note essence, refente, défauts…
              {saving ? ' · Enregistrement…' : ''}
            </p>
          </div>
          <button type="button" className="btn-secondary text-xs shrink-0" onClick={onClose}>
            Fermer
          </button>
        </div>
        <div className="p-4 space-y-3">
          {sizes.length === 0 ? (
            <p className="text-sm text-neya-muted px-1">Aucune taille Sierra pour cette sélection.</p>
          ) : (
            sizes.map((row) => {
              const roleHint = Object.entries(row.roles || {})
                .map(([role, n]) => `${n} ${role === 'long' ? 'longs' : role === 'short' ? 'shorts' : 'trav.'}`)
                .join(' · ');
              return (
                <div key={row.length} className="rounded-xl border border-neya-border bg-neya-surface/30 p-3">
                  <div className="flex items-baseline justify-between gap-3 mb-2">
                    <p className="font-mono text-lg font-semibold text-neya-ink">{row.length}</p>
                    <p className="font-display text-xl font-semibold tabular-nums text-neya-orange">× {row.qty}</p>
                  </div>
                  <p className="text-[11px] text-neya-muted mb-2">
                    {roleHint}
                    {row.skus?.length ? ` · ${row.skus.join(', ')}` : ''}
                  </p>
                  <textarea
                    className="input text-sm min-h-[64px] resize-y w-full"
                    placeholder={`Notes taille ${row.length} — essence, refente, défauts…`}
                    value={notes?.[row.length] || ''}
                    onChange={(e) => onChangeNote(kind, row.length, e.target.value)}
                  />
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

export default function SaunaCloudPage() {
  const [board, setBoard] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [savingSku, setSavingSku] = useState('');
  const [projectNotes, setProjectNotes] = useState('');
  const [sizePanel, setSizePanel] = useState(null); // 'sides' | 'traverses' | null
  const [sizeLogs, setSizeLogs] = useState(emptySizeLogs());
  const [savingSizes, setSavingSizes] = useState(false);
  const notesTimer = useRef(null);
  const sizeTimer = useRef(null);

  async function load() {
    setLoading(true);
    try {
      const data = await api('/sauna-cloud');
      setBoard(data);
      setProjectNotes(data.project?.notes || '');
      setSizeLogs({
        sides: { ...(data.tracker?.size_logs?.sides || {}) },
        traverses: { ...(data.tracker?.size_logs?.traverses || {}) },
      });
      setError('');
    } catch (e) {
      setError(e.message || 'Chargement impossible');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    return () => {
      if (notesTimer.current) clearTimeout(notesTimer.current);
      if (sizeTimer.current) clearTimeout(sizeTimer.current);
    };
  }, []);

  const frames = useMemo(
    () => buildLocalFrames(board?.tracker?.frames),
    [board]
  );
  const totals = useMemo(() => summarize(frames), [frames]);
  const sierra = useMemo(() => {
    // Préférer le calcul API si présent, sinon local (optimistic)
    if (board?.sierra?.to_cut && !savingSku) return board.sierra;
    if (board?.tracker?.sierra?.to_cut && !savingSku) return board.tracker.sierra;
    return computeSierraLocal(frames);
  }, [board, frames, savingSku]);

  const sizeBreakdown = useMemo(() => ({
    sides: board?.tracker?.size_breakdown?.sides?.length
      ? board.tracker.size_breakdown.sides
      : aggregatePieceSizes(frames, 'sides'),
    traverses: board?.tracker?.size_breakdown?.traverses?.length
      ? board.tracker.size_breakdown.traverses
      : aggregatePieceSizes(frames, 'traverses'),
  }), [board, frames]);

  function scheduleProjectNotes(value) {
    setProjectNotes(value);
    if (notesTimer.current) clearTimeout(notesTimer.current);
    notesTimer.current = setTimeout(async () => {
      try {
        const res = await api('/sauna-cloud/notes', {
          method: 'PATCH',
          body: JSON.stringify({ notes: value }),
        });
        setBoard(res.board);
      } catch (e) {
        setError(e.message);
      }
    }, 600);
  }

  function scheduleSizeLogs(nextLogs) {
    setSizeLogs(nextLogs);
    if (sizeTimer.current) clearTimeout(sizeTimer.current);
    sizeTimer.current = setTimeout(async () => {
      setSavingSizes(true);
      try {
        const res = await api('/sauna-cloud/tracker', {
          method: 'PATCH',
          body: JSON.stringify({ size_logs: nextLogs }),
        });
        setBoard(res);
        setSizeLogs({
          sides: { ...(res.tracker?.size_logs?.sides || {}) },
          traverses: { ...(res.tracker?.size_logs?.traverses || {}) },
        });
      } catch (e) {
        setError(e.message || 'Notes tailles non enregistrées');
      } finally {
        setSavingSizes(false);
      }
    }, 500);
  }

  function onChangeSizeNote(kind, length, value) {
    const next = {
      sides: { ...(sizeLogs.sides || {}) },
      traverses: { ...(sizeLogs.traverses || {}) },
      [kind]: {
        ...(sizeLogs[kind] || {}),
        [length]: value,
      },
    };
    scheduleSizeLogs(next);
  }

  async function setCount(sku, stageKey, value) {
    setSavingSku(sku);
    setError('');
    setBoard((prev) => {
      const base = buildLocalFrames(prev?.tracker?.frames);
      const nextFrames = base.map((row) => {
        if (row.sku !== sku) return row;
        const counts = { ...row.counts, [stageKey]: value };
        const placed = STAGES.reduce((s, st) => s + (Number(counts[st.key]) || 0), 0);
        const remaining = Math.max(0, row.qty - placed);
        return {
          ...row,
          counts,
          placed,
          remaining,
          pieces_total: row.qty * (row.pieces_per_frame || 0),
          sides_total: row.qty * (row.sides_per_frame || 0),
          traverses_total: row.qty * (row.traverses_per_frame || 0),
          pieces_missing: remaining * (row.pieces_per_frame || 0),
          sides_missing: remaining * (row.sides_per_frame || 0),
          traverses_missing: remaining * (row.traverses_per_frame || 0),
          sides_cut: placed * (row.sides_per_frame || 0),
          traverses_cut: placed * (row.traverses_per_frame || 0),
          sides_debited: (Number(counts.debited) || 0) * (row.sides_per_frame || 0),
          traverses_debited: (Number(counts.debited) || 0) * (row.traverses_per_frame || 0),
        };
      });
      return {
        ...(prev || {}),
        tracker: { frames: nextFrames, stages: STAGES, totals: summarize(nextFrames) },
        sierra: computeSierraLocal(nextFrames),
      };
    });
    try {
      const res = await api('/sauna-cloud/tracker', {
        method: 'PATCH',
        body: JSON.stringify({ sku, [stageKey]: value }),
      });
      setBoard(res);
    } catch (e) {
      setError(e.message || 'Enregistrement impossible — rebuild / merge requis si l’API manque');
      load();
    } finally {
      setSavingSku('');
    }
  }

  async function setQty(sku, qty) {
    setSavingSku(sku);
    setError('');
    try {
      const res = await api('/sauna-cloud/tracker', {
        method: 'PATCH',
        body: JSON.stringify({ sku, qty }),
      });
      setBoard(res);
    } catch (e) {
      setError(e.message || 'Enregistrement impossible');
      load();
    } finally {
      setSavingSku('');
    }
  }

  async function resetTracker() {
    if (!confirm('Remettre tous les compteurs à zéro (quantités catalogue conservées) ?')) return;
    setError('');
    try {
      const res = await api('/sauna-cloud/tracker/reset', {
        method: 'POST',
        body: JSON.stringify({ confirm: true }),
      });
      setBoard(res);
    } catch (e) {
      setError(e.message || 'Réinitialisation impossible');
    }
  }

  const stageMissing = STAGES.map((s) => ({
    ...s,
    ...(sierra?.by_stage?.[s.key] || { frames: 0, pieces: 0 }),
  }));

  return (
    <AuthGuard>
      <AppShell title="Sauna Cloud" subtitle="Tableau de suivi des frames — pièces manquantes (plan Sierra)" wide>
        <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
          <div>
            <p className="text-sm text-neya-muted max-w-xl">
              Saisissez les quantités par étape. Les <strong className="font-medium text-neya-ink">éléments manquants</strong> se
              recalculent selon l’avancement (BOM Cutting Plan Sierra).
            </p>
            <div className="flex flex-wrap items-center gap-3 mt-2">
              {board?.project?.id && (
                <Link href={`/projects/${board.project.id}`} className="text-xs text-neya-orange hover:underline">
                  Voir le projet ERP →
                  {board.project.status === 'done' ? ' (complété)' : ''}
                </Link>
              )}
              <a
                href={SIERRA_PDF}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs text-neya-ink hover:text-neya-orange"
              >
                <FileText className="h-3.5 w-3.5" />
                Cutting Plan Sierra (PDF)
                <ExternalLink className="h-3 w-3 opacity-60" />
              </a>
            </div>
            {loading && <p className="text-xs text-neya-muted mt-1">Synchronisation…</p>}
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right">
              <p className="text-2xl font-display font-semibold text-neya-orange tabular-nums">{totals.pct}%</p>
              <p className="text-xs text-neya-muted">
                {totals.delivered} / {totals.qty} livrées
                {totals.complete ? ' · complet' : ''}
              </p>
            </div>
            <button type="button" className="btn-secondary text-xs" onClick={resetTracker}>
              Remettre à zéro
            </button>
          </div>
        </div>

        {error && (
          <div className="mb-4 text-sm text-red-700 bg-red-50 border border-red-100 px-3 py-2 rounded-xl">
            {error}
          </div>
        )}

        <div className="h-2.5 bg-neya-surface rounded-full overflow-hidden mb-6">
          <div className="h-full bg-neya-orange transition-all" style={{ width: `${totals.pct}%` }} />
        </div>

        {/* Totaux commande — cliquables pour noter les tailles */}
        <div className="grid sm:grid-cols-2 gap-3 mb-4">
          <button
            type="button"
            onClick={() => setSizePanel('sides')}
            className="text-left rounded-2xl border-2 border-neya-orange/50 bg-neya-orange/[0.07] px-5 py-4 hover:border-neya-orange transition-colors"
          >
            <p className="text-[12px] font-semibold uppercase tracking-wide text-neya-orange">
              Côtés de cadre
            </p>
            <p className="mt-1 text-4xl font-display font-semibold tabular-nums text-neya-ink">
              {totals.sides_total}
            </p>
            <p className="mt-1 text-sm text-neya-muted">
              Clique pour noter les tailles
              {totals.sides_missing > 0 ? ` · ${totals.sides_missing} à couper` : ''}
            </p>
            {Object.values(sizeLogs.sides || {}).some(Boolean) ? (
              <p className="mt-1 text-[11px] text-neya-orange font-medium">Notes enregistrées</p>
            ) : null}
          </button>
          <button
            type="button"
            onClick={() => setSizePanel('traverses')}
            className="text-left rounded-2xl border-2 border-neya-orange/50 bg-neya-orange/[0.07] px-5 py-4 hover:border-neya-orange transition-colors"
          >
            <p className="text-[12px] font-semibold uppercase tracking-wide text-neya-orange">
              Traverses
            </p>
            <p className="mt-1 text-4xl font-display font-semibold tabular-nums text-neya-ink">
              {totals.traverses_total}
            </p>
            <p className="mt-1 text-sm text-neya-muted">
              Clique pour noter les tailles
              {totals.traverses_missing > 0 ? ` · ${totals.traverses_missing} à couper` : ''}
            </p>
            {Object.values(sizeLogs.traverses || {}).some(Boolean) ? (
              <p className="mt-1 text-[11px] text-neya-orange font-medium">Notes enregistrées</p>
            ) : null}
          </button>
        </div>

        {/* Bois déjà débité vs encore à couper */}
        <div className="grid sm:grid-cols-2 gap-3 mb-4">
          <div className={`rounded-2xl border px-5 py-4 ${STAGE_STYLE.debited.card}`}>
            <p className="text-[12px] font-semibold uppercase tracking-wide text-amber-900">
              Déjà débités
            </p>
            <div className="mt-2 grid grid-cols-2 gap-3">
              <div>
                <p className="text-3xl font-display font-semibold tabular-nums text-neya-ink">
                  {totals.sides_cut}
                </p>
                <p className="text-sm text-amber-900/80">côtés</p>
              </div>
              <div>
                <p className="text-3xl font-display font-semibold tabular-nums text-neya-ink">
                  {totals.traverses_cut}
                </p>
                <p className="text-sm text-amber-900/80">traverses</p>
              </div>
            </div>
            <p className="mt-2 text-[11px] text-neya-muted">
              Frames placées (≥ Débité) · colonne Débité seule : {totals.sides_debited} côtés · {totals.traverses_debited} trav.
            </p>
          </div>
          <div className="rounded-2xl border border-neya-border bg-neya-cream/30 px-5 py-4">
            <p className="text-[12px] font-semibold uppercase tracking-wide text-neya-muted">
              Encore à débiter
            </p>
            <div className="mt-2 grid grid-cols-2 gap-3">
              <div>
                <p className="text-3xl font-display font-semibold tabular-nums text-neya-ink">
                  {totals.sides_missing}
                </p>
                <p className="text-sm text-neya-muted">côtés</p>
              </div>
              <div>
                <p className="text-3xl font-display font-semibold tabular-nums text-neya-ink">
                  {totals.traverses_missing}
                </p>
                <p className="text-sm text-neya-muted">traverses</p>
              </div>
            </div>
            <p className="mt-2 text-[11px] text-neya-muted">
              Frames encore « À faire » · {totals.remaining} frame{totals.remaining !== 1 ? 's' : ''}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3 mb-6">
          <SummaryCard label="Commande" value={totals.qty} />
          <SummaryCard label="À faire" value={totals.remaining} />
          <SummaryCard
            label="Pièces à couper"
            value={totals.pieces_missing}
            sub={`${totals.pieces_total} au total`}
          />
          <SummaryCard
            label="Débité"
            value={totals.debited}
            accent={STAGE_STYLE.debited.card}
            sub={`${totals.sides_debited} côtés · ${totals.traverses_debited} trav.`}
          />
          <SummaryCard label="En cours" value={totals.in_progress} accent={STAGE_STYLE.in_progress.card} />
          <SummaryCard label="Terminé" value={totals.done} accent={STAGE_STYLE.done.card} />
          <SummaryCard label="Livré" value={totals.delivered} accent={STAGE_STYLE.delivered.card} />
        </div>

        <div className="rounded-2xl border border-neya-border bg-white overflow-x-auto mb-6 shadow-sm">
          <table className="w-full text-sm min-w-[1020px]">
            <thead>
              <tr className="border-b border-neya-border bg-neya-cream/40">
                <th className="px-4 py-3 text-left font-medium">SKU</th>
                <th className="px-4 py-3 text-left font-medium">Frame</th>
                <th className="px-3 py-3 text-center font-medium" title="Quantité commandée">Qty</th>
                <th className="px-3 py-3 text-center font-medium">
                  <button
                    type="button"
                    className="font-medium hover:text-neya-orange hover:underline underline-offset-2"
                    title="Clique pour noter les tailles des côtés"
                    onClick={() => setSizePanel('sides')}
                  >
                    Côtés
                  </button>
                </th>
                <th className="px-3 py-3 text-center font-medium">
                  <button
                    type="button"
                    className="font-medium hover:text-neya-orange hover:underline underline-offset-2"
                    title="Clique pour noter les tailles des traverses"
                    onClick={() => setSizePanel('traverses')}
                  >
                    Traverses
                  </button>
                </th>
                <th className="px-3 py-3 text-center font-medium">À faire</th>
                {STAGES.map((s) => (
                  <th
                    key={s.key}
                    className={`px-3 py-3 text-center font-semibold border-b ${STAGE_STYLE[s.key].th}`}
                    title={s.hint}
                  >
                    <span className="block">{s.label}</span>
                    {s.key === 'debited' ? (
                      <span className="block text-[10px] font-medium tabular-nums opacity-80 mt-0.5">
                        {totals.sides_debited} côt. · {totals.traverses_debited} trav.
                      </span>
                    ) : null}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {frames.map((row) => {
                const busy = savingSku === row.sku;
                const over = row.placed > row.qty;
                const bomHint = row.bom
                  ? `${row.sides_per_frame} côtés/frame + ${row.traverses_per_frame} trav./frame · L${formatLengthCm(row.bom.long_in)}×${row.bom.long_count} + S${formatLengthCm(row.bom.short_in)}×${row.bom.short_count} + T${formatLengthCm(row.bom.traverse_in)}×${row.bom.traverse_count}`
                  : 'Hors plan Sierra';
                const doneish = (row.counts?.done || 0) + (row.counts?.delivered || 0) > 0
                  && row.remaining === 0;
                return (
                  <tr
                    key={row.sku}
                    className={`border-b border-neya-border/60 ${
                      over ? 'bg-red-50/60' : doneish ? 'bg-emerald-50/40' : 'hover:bg-neya-surface/40'
                    }`}
                  >
                    <td className="px-4 py-3 font-mono text-xs font-semibold text-neya-ink">{row.sku}</td>
                    <td className="px-4 py-3 text-neya-ink">
                      <span>{row.label}</span>
                      {row.bom ? (
                        <span className="block text-[11px] text-neya-muted tabular-nums mt-0.5">
                          {row.sides_per_frame} côtés · {row.traverses_per_frame} trav. / frame
                        </span>
                      ) : (
                        <span className="block text-[11px] text-neya-muted mt-0.5">Hors plan Sierra</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <QtyInput value={row.qty} disabled={busy} onCommit={(n) => setQty(row.sku, n)} />
                    </td>
                    <td className="px-3 py-3 text-center bg-neya-orange/[0.07]">
                      <button
                        type="button"
                        disabled={!row.bom}
                        title={bomHint}
                        onClick={() => setSizePanel('sides')}
                        className={`inline-block min-w-[2.5rem] font-display text-lg font-semibold tabular-nums ${
                          !row.bom ? 'text-neya-muted cursor-default' : 'text-neya-ink hover:text-neya-orange underline-offset-2 hover:underline'
                        }`}
                      >
                        {row.bom ? row.sides_total : '—'}
                      </button>
                      {row.bom ? (
                        <span className="block text-[10px] text-neya-muted tabular-nums">
                          {row.sides_per_frame}/f
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-3 text-center bg-neya-orange/[0.07]">
                      <button
                        type="button"
                        disabled={!row.bom}
                        title={bomHint}
                        onClick={() => setSizePanel('traverses')}
                        className={`inline-block min-w-[2.5rem] font-display text-lg font-semibold tabular-nums ${
                          !row.bom ? 'text-neya-muted cursor-default' : 'text-neya-ink hover:text-neya-orange underline-offset-2 hover:underline'
                        }`}
                      >
                        {row.bom ? row.traverses_total : '—'}
                      </button>
                      {row.bom ? (
                        <span className="block text-[10px] text-neya-muted tabular-nums">
                          {row.traverses_per_frame}/f
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-3 text-center bg-neya-cream/20">
                      <span
                        className={`inline-block min-w-[2.5rem] font-display font-semibold tabular-nums ${
                          row.remaining === 0 ? 'text-emerald-700' : 'text-neya-ink'
                        }`}
                      >
                        {row.remaining}
                      </span>
                    </td>
                    {STAGES.map((s) => (
                      <td key={s.key} className={`px-3 py-2 text-center ${STAGE_STYLE[s.key].cell}`}>
                        <QtyInput
                          value={row.counts?.[s.key] || 0}
                          disabled={busy}
                          className={STAGE_STYLE[s.key].input}
                          onCommit={(n) => setCount(row.sku, s.key, n)}
                        />
                        {s.key === 'debited' && row.bom && (row.counts?.debited || 0) > 0 ? (
                          <span className="block text-[10px] text-amber-900/80 tabular-nums mt-0.5">
                            {row.sides_debited} côt. · {row.traverses_debited} trav.
                          </span>
                        ) : null}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="bg-neya-surface/50 font-medium">
                <td className="px-4 py-3" colSpan={2}>
                  Total commande
                  {savingSku ? <span className="ml-2 text-[10px] text-neya-muted font-normal">Enregistrement…</span> : null}
                </td>
                <td className="px-3 py-3 text-center tabular-nums">{totals.qty}</td>
                <td className="px-3 py-3 text-center tabular-nums bg-neya-orange/[0.07] text-neya-orange text-base">
                  <button type="button" className="hover:underline" onClick={() => setSizePanel('sides')}>
                    {totals.sides_total}
                  </button>
                </td>
                <td className="px-3 py-3 text-center tabular-nums bg-neya-orange/[0.07] text-neya-orange text-base">
                  <button type="button" className="hover:underline" onClick={() => setSizePanel('traverses')}>
                    {totals.traverses_total}
                  </button>
                </td>
                <td className="px-3 py-3 text-center tabular-nums bg-neya-cream/20">{totals.remaining}</td>
                <td className={`px-3 py-3 text-center tabular-nums ${STAGE_STYLE.debited.cell}`}>
                  <span className="block">{totals.debited}</span>
                  <span className="block text-[10px] font-normal text-amber-900/80">
                    {totals.sides_debited} côt. · {totals.traverses_debited} trav.
                  </span>
                </td>
                <td className={`px-3 py-3 text-center tabular-nums ${STAGE_STYLE.in_progress.cell}`}>{totals.in_progress}</td>
                <td className={`px-3 py-3 text-center tabular-nums font-semibold text-emerald-800 ${STAGE_STYLE.done.cell}`}>{totals.done}</td>
                <td className={`px-3 py-3 text-center tabular-nums font-semibold text-green-900 ${STAGE_STYLE.delivered.cell}`}>{totals.delivered}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        {frames.some((f) => f.placed > f.qty) && (
          <p className="text-xs text-red-700 mb-6">
            Une ligne a plus de frames placées que la quantité commandée — vérifiez les compteurs.
          </p>
        )}

        {/* Plan Sierra — manquants par étape + longueurs */}
        <section className="mb-8 rounded-2xl border border-neya-border bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
            <div>
              <h2 className="font-display font-semibold text-base text-neya-ink">
                Plan Sierra — éléments manquants
              </h2>
              <p className="text-xs text-neya-muted mt-1 max-w-2xl">
                Selon l’étape atteinte : combien de frames (et pièces bois) restent avant d’y arriver.
                « Avant Débité » = encore à couper.
              </p>
            </div>
            <a href={SIERRA_PDF} target="_blank" rel="noreferrer" className="btn-secondary text-xs inline-flex items-center gap-1.5">
              <FileText className="h-3.5 w-3.5" />
              Ouvrir le PDF
            </a>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
            <div className={`rounded-xl border px-3 py-3 sm:col-span-2 ${STAGE_STYLE.debited.card}`}>
              <p className="text-[11px] uppercase tracking-wide text-amber-900/80">Déjà débités (Sierra)</p>
              <div className="mt-1 flex flex-wrap gap-6">
                <p className="text-xl font-display font-semibold tabular-nums text-neya-ink">
                  {sierra?.cut?.sides ?? totals.sides_cut}
                  <span className="text-sm font-normal text-neya-muted"> côtés</span>
                </p>
                <p className="text-xl font-display font-semibold tabular-nums text-neya-ink">
                  {sierra?.cut?.traverses ?? totals.traverses_cut}
                  <span className="text-sm font-normal text-neya-muted"> traverses</span>
                </p>
              </div>
              <p className="text-[11px] text-neya-muted mt-1">
                {sierra?.cut?.frames ?? totals.qty - totals.remaining} frame(s) · encore à couper :{' '}
                {sierra?.to_cut?.sides ?? totals.sides_missing} côt. / {sierra?.to_cut?.traverses ?? totals.traverses_missing} trav.
              </p>
            </div>
            {stageMissing.map((s) => (
              <div
                key={s.key}
                className={`rounded-xl border px-3 py-3 ${STAGE_STYLE[s.key]?.card || 'border-neya-border bg-neya-surface/40'}`}
              >
                <p className="text-[11px] uppercase tracking-wide text-neya-muted">Avant {s.label}</p>
                <p className="text-xl font-display font-semibold tabular-nums text-neya-ink">
                  {s.pieces}
                  <span className="text-sm font-normal text-neya-muted"> pcs</span>
                </p>
                <p className="text-[11px] text-neya-muted mt-0.5">
                  {s.frames} frame{s.frames !== 1 ? 's' : ''}
                  {s.structural != null
                    ? ` · ${s.structural} côtés · ${s.traverses || 0} trav.`
                    : ''}
                </p>
              </div>
            ))}
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-neya-muted mb-2">
              Longueurs encore à débiter (cm) — frames « À faire »
            </p>
            {(sierra?.to_cut?.by_length || []).length === 0 ? (
              <p className="text-sm text-neya-muted">Rien à couper — toutes les frames Sierra sont placées.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {(sierra.to_cut.by_length || []).map((item) => (
                  <span
                    key={item.length}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-neya-border bg-white px-3 py-1.5 text-sm"
                  >
                    <span className="font-mono font-semibold text-neya-ink">{item.length}</span>
                    <span className="text-neya-muted">×</span>
                    <span className="font-display font-semibold tabular-nums text-neya-orange">{item.qty}</span>
                  </span>
                ))}
              </div>
            )}
            <p className="text-[11px] text-neya-muted mt-3">
              Total à couper : <strong className="text-neya-ink">{sierra?.to_cut?.pieces || 0}</strong> pièces
              — <strong className="text-neya-ink">{(sierra?.to_cut?.sides ?? sierra?.to_cut?.structural) || 0}</strong> côtés de cadre
              + <strong className="text-neya-ink">{sierra?.to_cut?.traverses || 0}</strong> traverses
              pour {sierra?.to_cut?.frames || 0} frame(s).
            </p>
          </div>
        </section>

        <div className="grid lg:grid-cols-2 gap-4">
          <div className="card rounded-2xl">
            <h2 className="font-display font-semibold text-base mb-2">Notes projet</h2>
            <textarea
              className="input text-sm min-h-[120px] resize-y"
              placeholder="Mesures, délais, problèmes atelier…"
              value={projectNotes}
              onChange={(e) => scheduleProjectNotes(e.target.value)}
            />
          </div>
          <div className="rounded-2xl border border-neya-border bg-neya-surface p-4 text-sm text-neya-muted space-y-2">
            <p className="font-medium text-neya-ink">Comment remplir</p>
            <p>Chaque frame ne compte que dans <em>une</em> colonne à la fois.</p>
            <p>1. Débit → <span className="text-amber-800 font-medium">Débité</span> (ambre)</p>
            <p>2. Assemblage → <span className="text-sky-800 font-medium">En cours</span> (bleu)</p>
            <p>3. Prête → <span className="text-emerald-800 font-medium">Terminé</span> (vert)</p>
            <p>4. Expédiée → <span className="text-green-900 font-medium">Livré</span> (vert fort, % progress)</p>
            <p className="pt-1 border-t border-neya-border/60">
              Clique les totaux <strong className="text-neya-ink">Côtés</strong> / <strong className="text-neya-ink">Traverses</strong> pour noter les tailles.
            </p>
            <p className="pt-1 border-t border-neya-border/60">
              BOM Sierra : H2013, H2026, H2226, H3313, H3726. FS750 / autres = hors plan coupe (1×6).
            </p>
          </div>
        </div>
      {sizePanel && (
        <SizeNotesPanel
          kind={sizePanel}
          title={sizePanel === 'sides' ? 'Côtés de cadre — tailles' : 'Traverses — tailles'}
          sizes={sizeBreakdown[sizePanel] || []}
          notes={sizeLogs[sizePanel] || {}}
          onChangeNote={onChangeSizeNote}
          onClose={() => setSizePanel(null)}
          saving={savingSizes}
        />
      )}
      </AppShell>
    </AuthGuard>
  );
}

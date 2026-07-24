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
  { key: 'debited', label: 'Débité', hint: 'Bois débité' },
  { key: 'in_progress', label: 'En cours', hint: 'En assemblage' },
  { key: 'done', label: 'Terminé', hint: 'Fabriqué / prêt' },
  { key: 'delivered', label: 'Livré', hint: 'Expédié / livré' },
];

const SIERRA_PDF = '/docs/Cutting_Plan_Sierra_EN.pdf';

function emptyCounts() {
  return { debited: 0, in_progress: 0, done: 0, delivered: 0 };
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
    const key = `${inches}"`;
    by[key] = (by[key] || 0) + count;
  };
  add(bom.long_in, bom.long_count * n);
  add(bom.short_in, bom.short_count * n);
  add(bom.traverse_in, bom.traverse_count * n);
  const structural = (bom.long_count + bom.short_count) * n;
  const traverses = bom.traverse_count * n;
  return { pieces: structural + traverses, structural, traverses, by_length: by };
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
      pieces_missing: remaining * ppf,
      sides_missing: remaining * spf,
      traverses_missing: remaining * tpf,
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
  return {
    by_stage,
    to_cut: {
      frames: to_cut.frames,
      pieces: to_cut.pieces,
      structural: to_cut.structural,
      sides: to_cut.structural,
      traverses: to_cut.traverses,
      by_length: Object.entries(to_cut.by_length)
        .map(([length, qty]) => ({ length, qty }))
        .sort((a, b) => parseFloat(b.length) - parseFloat(a.length)),
    },
  };
}

function QtyInput({ value, onCommit, disabled }) {
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
      className="w-16 mx-auto text-center input py-1.5 text-sm tabular-nums disabled:bg-neya-surface/50 disabled:text-neya-muted"
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

export default function SaunaCloudPage() {
  const [board, setBoard] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [savingSku, setSavingSku] = useState('');
  const [projectNotes, setProjectNotes] = useState('');
  const notesTimer = useRef(null);

  async function load() {
    setLoading(true);
    try {
      const data = await api('/sauna-cloud');
      setBoard(data);
      setProjectNotes(data.project?.notes || '');
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
          pieces_missing: remaining * (row.pieces_per_frame || 0),
          sides_missing: remaining * (row.sides_per_frame || 0),
          traverses_missing: remaining * (row.traverses_per_frame || 0),
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

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-9 gap-3 mb-6">
          <SummaryCard label="Commande" value={totals.qty} />
          <SummaryCard label="À faire" value={totals.remaining} />
          <SummaryCard
            label="Côtés de cadre"
            value={totals.sides_missing}
            accent="border-neya-orange/40"
            sub="à couper (longs + shorts)"
          />
          <SummaryCard
            label="Traverses"
            value={totals.traverses_missing}
            accent="border-neya-orange/40"
            sub="à couper"
          />
          <SummaryCard
            label="Éléments à couper"
            value={totals.pieces_missing}
            sub="total pièces Sierra"
          />
          <SummaryCard label="Débité" value={totals.debited} />
          <SummaryCard label="En cours" value={totals.in_progress} />
          <SummaryCard label="Terminé" value={totals.done} />
          <SummaryCard label="Livré" value={totals.delivered} />
        </div>

        <div className="rounded-2xl border border-neya-border bg-white overflow-x-auto mb-6 shadow-sm">
          <table className="w-full text-sm min-w-[980px]">
            <thead>
              <tr className="border-b border-neya-border bg-neya-cream/40">
                <th className="px-4 py-3 text-left font-medium">SKU</th>
                <th className="px-4 py-3 text-left font-medium">Frame</th>
                <th className="px-3 py-3 text-center font-medium" title="Quantité commandée">Qty</th>
                <th className="px-3 py-3 text-center font-medium" title="Frames pas encore placées">À faire</th>
                <th
                  className="px-3 py-3 text-center font-medium"
                  title="Côtés de cadre encore à débiter (longs + shorts × à faire)"
                >
                  Côtés
                </th>
                <th
                  className="px-3 py-3 text-center font-medium"
                  title="Traverses encore à débiter (BOM Sierra × à faire)"
                >
                  Traverses
                </th>
                <th
                  className="px-3 py-3 text-center font-medium"
                  title="Pièces bois encore à débiter (BOM Sierra × à faire)"
                >
                  Total
                </th>
                {STAGES.map((s) => (
                  <th key={s.key} className="px-3 py-3 text-center font-medium" title={s.hint}>
                    {s.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {frames.map((row) => {
                const busy = savingSku === row.sku;
                const over = row.placed > row.qty;
                const bomHint = row.bom
                  ? `${row.sides_per_frame} côtés/frame + ${row.traverses_per_frame} trav./frame · L${row.bom.long_in}"×${row.bom.long_count} + S${row.bom.short_in}"×${row.bom.short_count} + T${row.bom.traverse_in}"×${row.bom.traverse_count}`
                  : 'Hors plan Sierra';
                return (
                  <tr key={row.sku} className={`border-b border-neya-border/60 ${over ? 'bg-red-50/60' : 'hover:bg-neya-surface/40'}`}>
                    <td className="px-4 py-3 font-mono text-xs font-semibold text-neya-ink">{row.sku}</td>
                    <td className="px-4 py-3 text-neya-ink">{row.label}</td>
                    <td className="px-3 py-2 text-center">
                      <QtyInput value={row.qty} disabled={busy} onCommit={(n) => setQty(row.sku, n)} />
                    </td>
                    <td className="px-3 py-3 text-center bg-neya-cream/20">
                      <span
                        className={`inline-block min-w-[2.5rem] font-display font-semibold tabular-nums ${
                          row.remaining === 0 ? 'text-neya-muted' : 'text-neya-ink'
                        }`}
                      >
                        {row.remaining}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-center bg-neya-orange/[0.06]" title={bomHint}>
                      <span
                        className={`inline-block min-w-[2.5rem] font-display font-semibold tabular-nums ${
                          !row.bom || row.sides_missing === 0 ? 'text-neya-muted' : 'text-neya-orange'
                        }`}
                      >
                        {row.bom ? row.sides_missing : '—'}
                      </span>
                      {row.bom && row.sides_per_frame > 0 ? (
                        <span className="block text-[10px] text-neya-muted tabular-nums">
                          {row.sides_per_frame}/f
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-3 text-center bg-neya-orange/[0.06]" title={bomHint}>
                      <span
                        className={`inline-block min-w-[2.5rem] font-display font-semibold tabular-nums ${
                          !row.bom || row.traverses_missing === 0 ? 'text-neya-muted' : 'text-neya-orange'
                        }`}
                      >
                        {row.bom ? row.traverses_missing : '—'}
                      </span>
                      {row.bom && row.traverses_per_frame > 0 ? (
                        <span className="block text-[10px] text-neya-muted tabular-nums">
                          {row.traverses_per_frame}/f
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-3 text-center" title={bomHint}>
                      <span
                        className={`inline-block min-w-[2.5rem] font-display font-semibold tabular-nums ${
                          !row.bom || row.pieces_missing === 0 ? 'text-neya-muted' : 'text-neya-ink'
                        }`}
                      >
                        {row.bom ? row.pieces_missing : '—'}
                      </span>
                    </td>
                    {STAGES.map((s) => (
                      <td key={s.key} className="px-3 py-2 text-center">
                        <QtyInput
                          value={row.counts?.[s.key] || 0}
                          disabled={busy}
                          onCommit={(n) => setCount(row.sku, s.key, n)}
                        />
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="bg-neya-surface/50 font-medium">
                <td className="px-4 py-3" colSpan={2}>
                  Total
                  {savingSku ? <span className="ml-2 text-[10px] text-neya-muted font-normal">Enregistrement…</span> : null}
                </td>
                <td className="px-3 py-3 text-center tabular-nums">{totals.qty}</td>
                <td className="px-3 py-3 text-center tabular-nums bg-neya-cream/20">{totals.remaining}</td>
                <td className="px-3 py-3 text-center tabular-nums bg-neya-orange/[0.06] text-neya-orange">
                  {totals.sides_missing}
                </td>
                <td className="px-3 py-3 text-center tabular-nums bg-neya-orange/[0.06] text-neya-orange">
                  {totals.traverses_missing}
                </td>
                <td className="px-3 py-3 text-center tabular-nums">{totals.pieces_missing}</td>
                <td className="px-3 py-3 text-center tabular-nums">{totals.debited}</td>
                <td className="px-3 py-3 text-center tabular-nums">{totals.in_progress}</td>
                <td className="px-3 py-3 text-center tabular-nums">{totals.done}</td>
                <td className="px-3 py-3 text-center tabular-nums">{totals.delivered}</td>
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
            {stageMissing.map((s) => (
              <div key={s.key} className="rounded-xl border border-neya-border bg-neya-surface/40 px-3 py-3">
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
              Longueurs encore à débiter (frames « À faire »)
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
            <p>1. Débit → <span className="text-neya-ink">Débité</span> (les éléments manquants baissent)</p>
            <p>2. Assemblage → <span className="text-neya-ink">En cours</span></p>
            <p>3. Prête → <span className="text-neya-ink">Terminé</span></p>
            <p>4. Expédiée → <span className="text-neya-ink">Livré</span> (fait monter le %)</p>
            <p className="pt-1 border-t border-neya-border/60">
              BOM Sierra : H2013, H2026, H2226, H3313, H3726. FS750 / autres = hors plan coupe (1×6).
            </p>
          </div>
        </div>
      </AppShell>
    </AuthGuard>
  );
}

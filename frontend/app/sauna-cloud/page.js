'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
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

const STAGES = [
  { key: 'debited', label: 'Débité', hint: 'Bois débité' },
  { key: 'in_progress', label: 'En cours', hint: 'En assemblage' },
  { key: 'done', label: 'Terminé', hint: 'Fabriqué / prêt' },
  { key: 'delivered', label: 'Livré', hint: 'Expédié / livré' },
];

function emptyCounts() {
  return { debited: 0, in_progress: 0, done: 0, delivered: 0 };
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
    return {
      sku: cat.sku,
      label: prev?.label || cat.label,
      qty,
      counts,
      placed,
      remaining: Math.max(0, qty - placed),
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
  const pct = qty ? Math.min(100, Math.round((delivered / qty) * 100)) : 0;
  return {
    qty,
    remaining,
    debited,
    in_progress,
    done,
    delivered,
    pct,
    complete: qty > 0 && delivered >= qty,
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

function SummaryCard({ label, value, accent }) {
  return (
    <div className={`rounded-2xl border border-neya-border bg-white px-4 py-3 ${accent || ''}`}>
      <p className="text-[11px] uppercase tracking-wide text-neya-muted">{label}</p>
      <p className="text-2xl font-display font-semibold tabular-nums text-neya-ink">{value}</p>
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
    // Optimistic UI
    setBoard((prev) => {
      const base = buildLocalFrames(prev?.tracker?.frames);
      const nextFrames = base.map((row) => {
        if (row.sku !== sku) return row;
        const counts = { ...row.counts, [stageKey]: value };
        const placed = STAGES.reduce((s, st) => s + (Number(counts[st.key]) || 0), 0);
        return { ...row, counts, placed, remaining: Math.max(0, row.qty - placed) };
      });
      return {
        ...(prev || {}),
        tracker: { frames: nextFrames, stages: STAGES, totals: summarize(nextFrames) },
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

  return (
    <AuthGuard>
      <AppShell title="Sauna Cloud" subtitle="Tableau de suivi des frames — 100 % = tout livré" wide>
        <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
          <div>
            <p className="text-sm text-neya-muted max-w-xl">
              Saisissez les quantités par étape. Le projet est à <strong className="font-medium text-neya-ink">100 %</strong> seulement
              quand toutes les frames sont en colonne <strong className="font-medium text-neya-ink">Livré</strong>.
            </p>
            {board?.project?.id && (
              <Link href={`/projects/${board.project.id}`} className="text-xs text-neya-orange hover:underline">
                Voir le projet ERP →
                {board.project.status === 'done' ? ' (complété)' : ''}
              </Link>
            )}
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

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
          <SummaryCard label="Commande" value={totals.qty} />
          <SummaryCard label="À faire" value={totals.remaining} />
          <SummaryCard label="Débité" value={totals.debited} />
          <SummaryCard label="En cours" value={totals.in_progress} />
          <SummaryCard label="Terminé" value={totals.done} />
          <SummaryCard label="Livré" value={totals.delivered} accent="border-neya-orange/40" />
        </div>

        <div className="rounded-2xl border border-neya-border bg-white overflow-x-auto mb-8 shadow-sm">
          <table className="w-full text-sm min-w-[720px]">
            <thead>
              <tr className="border-b border-neya-border bg-neya-cream/40">
                <th className="px-4 py-3 text-left font-medium">SKU</th>
                <th className="px-4 py-3 text-left font-medium">Frame</th>
                <th className="px-3 py-3 text-center font-medium" title="Quantité commandée">Qty</th>
                <th className="px-3 py-3 text-center font-medium" title="Reste à produire">À faire</th>
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
            <p>1. Débit → <span className="text-neya-ink">Débité</span></p>
            <p>2. Assemblage → <span className="text-neya-ink">En cours</span></p>
            <p>3. Prête → <span className="text-neya-ink">Terminé</span></p>
            <p>4. Expédiée → <span className="text-neya-ink">Livré</span> (fait monter le %)</p>
          </div>
        </div>
      </AppShell>
    </AuthGuard>
  );
}

'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import AppShell from '../../components/AppShell';
import AuthGuard from '../../components/AuthGuard';
import { api } from '../../lib/api';

const STAGE_META = {
  remaining: { label: 'À faire', hint: 'Reste à produire', readonly: true },
  debited: { label: 'Débité', hint: 'Bois débité' },
  in_progress: { label: 'En cours', hint: 'En assemblage' },
  done: { label: 'Terminé', hint: 'Fabriqué / prêt' },
  delivered: { label: 'Livré', hint: 'Expédié / livré' },
};

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
        if (e.key === 'Enter') {
          e.currentTarget.blur();
        }
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
  const [savingSku, setSavingSku] = useState('');
  const [projectNotes, setProjectNotes] = useState('');
  const notesTimer = useRef(null);

  async function load() {
    try {
      const data = await api('/sauna-cloud');
      setBoard(data);
      setProjectNotes(data.project?.notes || '');
      setError('');
    } catch (e) {
      setError(e.message);
    }
  }

  useEffect(() => {
    load();
    return () => {
      if (notesTimer.current) clearTimeout(notesTimer.current);
    };
  }, []);

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
    try {
      const res = await api('/sauna-cloud/tracker', {
        method: 'PATCH',
        body: JSON.stringify({ sku, [stageKey]: value }),
      });
      setBoard(res);
    } catch (e) {
      setError(e.message || 'Enregistrement impossible');
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

  if (!board && !error) {
    return (
      <AuthGuard>
        <AppShell title="Sauna Cloud" subtitle="Suivi fabrication des frames">
          <p className="text-neya-muted py-12">Chargement…</p>
        </AppShell>
      </AuthGuard>
    );
  }

  const frames = board?.tracker?.frames || [];
  const totals = board?.tracker?.totals || {
    qty: 0,
    remaining: 0,
    debited: 0,
    in_progress: 0,
    done: 0,
    delivered: 0,
    pct: 0,
  };
  const stages = board?.tracker?.stages || [
    { key: 'debited' },
    { key: 'in_progress' },
    { key: 'done' },
    { key: 'delivered' },
  ];

  return (
    <AuthGuard>
      <AppShell title="Sauna Cloud" subtitle="Tableau de suivi des frames — quantités par étape" wide>
        <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
          <div>
            <p className="text-sm text-neya-muted max-w-xl">
              Entrez le nombre de frames dans chaque colonne. « À faire » = commande − (débité + en cours + terminé + livré).
            </p>
            {board?.project?.id && (
              <Link href={`/projects/${board.project.id}`} className="text-xs text-neya-orange hover:underline">
                Voir le projet ERP →
              </Link>
            )}
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right">
              <p className="text-2xl font-display font-semibold text-neya-orange tabular-nums">{totals.pct}%</p>
              <p className="text-xs text-neya-muted">
                {totals.delivered + totals.done} / {totals.qty} terminées ou livrées
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

        <div className="cf-table-wrap overflow-x-auto mb-8">
          <table className="w-full text-sm min-w-[720px]">
            <thead>
              <tr>
                <th className="px-4 py-3 text-left">SKU</th>
                <th className="px-4 py-3 text-left">Frame</th>
                <th className="px-3 py-3 text-center" title="Quantité commandée">Qty</th>
                <th className="px-3 py-3 text-center bg-neya-cream/40" title={STAGE_META.remaining.hint}>
                  {STAGE_META.remaining.label}
                </th>
                {stages.map((s) => (
                  <th key={s.key} className="px-3 py-3 text-center" title={STAGE_META[s.key]?.hint || s.label}>
                    {STAGE_META[s.key]?.label || s.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {frames.map((row) => {
                const busy = savingSku === row.sku;
                const over = row.placed > row.qty;
                return (
                  <tr key={row.sku} className={over ? 'bg-red-50/60' : undefined}>
                    <td className="px-4 py-3 font-mono text-xs font-semibold text-neya-ink">{row.sku}</td>
                    <td className="px-4 py-3 text-neya-ink">{row.label}</td>
                    <td className="px-3 py-2 text-center">
                      <QtyInput value={row.qty} disabled={busy} onCommit={(n) => setQty(row.sku, n)} />
                    </td>
                    <td className="px-3 py-3 text-center bg-neya-cream/30">
                      <span
                        className={`inline-block min-w-[2.5rem] font-display font-semibold tabular-nums ${
                          row.remaining === 0 ? 'text-neya-muted' : 'text-neya-ink'
                        }`}
                      >
                        {row.remaining}
                      </span>
                    </td>
                    {stages.map((s) => (
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
              <tr className="border-t border-neya-border bg-neya-surface/40 font-medium">
                <td className="px-4 py-3" colSpan={2}>
                  Total
                  {savingSku ? <span className="ml-2 text-[10px] text-neya-muted font-normal">Enregistrement…</span> : null}
                </td>
                <td className="px-3 py-3 text-center tabular-nums">{totals.qty}</td>
                <td className="px-3 py-3 text-center tabular-nums bg-neya-cream/30">{totals.remaining}</td>
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
            <p>1. Débitez le bois → augmentez <strong className="text-neya-ink font-medium">Débité</strong>.</p>
            <p>2. Passez en assemblage → <strong className="text-neya-ink font-medium">En cours</strong>.</p>
            <p>3. Frame prête → <strong className="text-neya-ink font-medium">Terminé</strong>.</p>
            <p>4. Chez le client / expédiée → <strong className="text-neya-ink font-medium">Livré</strong>.</p>
            <p className="text-xs pt-1">Les nombres se sauvent automatiquement au blur / Entrée.</p>
          </div>
        </div>
      </AppShell>
    </AuthGuard>
  );
}

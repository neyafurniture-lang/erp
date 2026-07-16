'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import AppShell from '../../components/AppShell';
import AuthGuard from '../../components/AuthGuard';
import { api, formatMoney, getApiUrl, getToken } from '../../lib/api';

const emptySku = () => ({
  sku: '',
  label: '',
  qty: 1,
  long_in: 26,
  short_in: 20,
  long_count: 2,
  short_count: 2,
  traverse_in: 20,
  traverse_count: 2,
});

const emptyStock = () => ({
  length_in: 20,
  qty: 1,
  rip_factor: 2,
  stock: 'structural',
  note: '',
});

const emptySheet = () => ({
  label: '',
  w_in: 24,
  h_in: 24,
  qty: 1,
  sku: '',
});

function BoardBar({ pattern, boardLength = 96 }) {
  const total = boardLength || 96;
  return (
    <div className="space-y-1">
      <div className="flex h-7 w-full overflow-hidden rounded-md border border-neya-border bg-slate-100">
        {(pattern.segments || []).map((seg, i) => (
          <div
            key={i}
            title={`${seg.label || seg.length}"`}
            style={{
              width: `${(seg.length / total) * 100}%`,
              background: seg.color,
            }}
            className="flex items-center justify-center text-[10px] font-semibold text-white"
          >
            {seg.length / total > 0.08 ? (seg.label || seg.length) : ''}
          </div>
        ))}
        {pattern.wasteSegment && pattern.wasteSegment.length > 0.2 && (
          <div
            title={`Rebut ${pattern.wasteSegment.length.toFixed(1)}"`}
            style={{ width: `${(pattern.wasteSegment.length / total) * 100}%` }}
            className="bg-slate-300"
          />
        )}
      </div>
    </div>
  );
}

function PatternBlock({ title, pack }) {
  if (!pack?.patterns?.length) {
    return (
      <div className="card text-sm text-neya-muted">Aucun pattern {title.toLowerCase()}.</div>
    );
  }
  return (
    <div className="card space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-semibold text-neya-ink">{title}</h3>
        <p className="text-xs text-neya-muted">
          {pack.board_needed} planche(s) · +marge → {pack.board_with_margin} · {pack.rip_label}
        </p>
      </div>
      <div className="space-y-3">
        {pack.patterns.map((p) => (
          <div key={p.id}>
            <div className="mb-1 flex justify-between text-xs">
              <span className="font-medium text-neya-ink">
                {p.id} · ×{p.count}
              </span>
              <span className="text-neya-muted">rebut {Number(p.waste).toFixed(1)}″</span>
            </div>
            <BoardBar pattern={p} boardLength={pack.boardLength} />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function CuttingPlansPage() {
  const [list, setList] = useState([]);
  const [planId, setPlanId] = useState(null);
  const [title, setTitle] = useState('Plan de coupe');
  const [projectLabel, setProjectLabel] = useState('');
  const [notes, setNotes] = useState('');
  const [skus, setSkus] = useState([emptySku()]);
  const [stock, setStock] = useState([]);
  const [sheets, setSheets] = useState([]);
  const [materials, setMaterials] = useState({
    board_2x4_price: 17.95,
    board_1x6_price: 16.95,
    extra_1x6_qty: 0,
    sheet_price: 0,
    tax_rate: 0.14975,
    uhaul: 0,
    gas: 0,
  });
  const [margin, setMargin] = useState(0.12);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('editor'); // editor | result | list

  const planInput = useMemo(() => ({
    title,
    project_label: projectLabel,
    notes,
    margin: Number(margin) || 0,
    kerf: 0.125,
    structural_rip_yield: 2,
    traverse_rip_yield: 4,
    skus: skus.filter((s) => s.sku || s.qty),
    existing_stock: stock,
    sheet_parts: sheets.filter((s) => s.qty && s.w_in && s.h_in),
    materials,
  }), [title, projectLabel, notes, margin, skus, stock, sheets, materials]);

  const loadList = useCallback(async () => {
    try {
      const rows = await api('/cutting-plans');
      setList(rows);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        await loadList();
      } finally {
        setLoading(false);
      }
    })();
  }, [loadList]);

  function applyInput(input, cachedResult = null) {
    setTitle(input.title || 'Plan de coupe');
    setProjectLabel(input.project_label || '');
    setNotes(input.notes || '');
    setMargin(input.margin ?? 0.12);
    setSkus(input.skus?.length ? input.skus : [emptySku()]);
    setStock(input.existing_stock || []);
    setSheets(input.sheet_parts || []);
    setMaterials({
      board_2x4_price: 17.95,
      board_1x6_price: 16.95,
      extra_1x6_qty: 0,
      sheet_price: 0,
      tax_rate: 0.14975,
      uhaul: 0,
      gas: 0,
      ...(input.materials || {}),
    });
    setResult(cachedResult);
  }

  async function loadSierra() {
    setBusy(true);
    setError('');
    try {
      const data = await api('/cutting-plans/example/sierra');
      setPlanId(null);
      applyInput(data.plan_input, data.result);
      setTab('result');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function runOptimize() {
    setBusy(true);
    setError('');
    try {
      const data = await api('/cutting-plans/optimize', {
        method: 'POST',
        body: JSON.stringify({ plan_input: planInput }),
      });
      setResult(data.result);
      setTab('result');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function savePlan() {
    setBusy(true);
    setError('');
    try {
      const body = {
        title,
        project_label: projectLabel,
        notes,
        plan_input: planInput,
      };
      let saved;
      if (planId) {
        saved = await api(`/cutting-plans/${planId}`, {
          method: 'PUT',
          body: JSON.stringify(body),
        });
      } else {
        saved = await api('/cutting-plans', {
          method: 'POST',
          body: JSON.stringify(body),
        });
        setPlanId(saved.id);
      }
      setResult(saved.result_cache);
      await loadList();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function openPlan(id) {
    setBusy(true);
    setError('');
    try {
      const row = await api(`/cutting-plans/${id}`);
      setPlanId(row.id);
      applyInput(row.plan_input || {}, row.result_cache);
      setTab('editor');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function deletePlan(id) {
    if (!confirm('Supprimer ce plan ?')) return;
    await api(`/cutting-plans/${id}`, { method: 'DELETE' });
    if (planId === id) {
      setPlanId(null);
      setResult(null);
    }
    await loadList();
  }

  async function downloadPdf() {
    setBusy(true);
    setError('');
    try {
      const token = getToken();
      const res = await fetch(`${getApiUrl()}/cutting-plans/pdf`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ plan_input: planInput, result }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Erreur ${res.status}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${(title || 'cutting-plan').replace(/[^\w.-]+/g, '_')}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function updateSku(i, key, value) {
    setSkus((prev) => prev.map((s, idx) => (idx === i ? { ...s, [key]: value } : s)));
  }

  function updateStock(i, key, value) {
    setStock((prev) => prev.map((s, idx) => (idx === i ? { ...s, [key]: value } : s)));
  }

  function updateSheet(i, key, value) {
    setSheets((prev) => prev.map((s, idx) => (idx === i ? { ...s, [key]: value } : s)));
  }

  return (
    <AuthGuard>
      <AppShell>
        <div className="space-y-4 max-w-6xl mx-auto pb-24">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-xl font-semibold text-neya-ink">Plans de coupe</h1>
              <p className="text-sm text-neya-muted mt-1">
                Planches 8 pi · feuilles 4×8 · patterns colorés · PDF exportable
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn-secondary text-sm" disabled={busy} onClick={loadSierra}>
                Exemple Sierra
              </button>
              <button type="button" className="btn-secondary text-sm" disabled={busy} onClick={runOptimize}>
                Optimiser
              </button>
              <button type="button" className="btn-secondary text-sm" disabled={busy} onClick={savePlan}>
                {planId ? 'Enregistrer' : 'Créer'}
              </button>
              <button type="button" className="btn-primary text-sm" disabled={busy} onClick={downloadPdf}>
                PDF
              </button>
            </div>
          </div>

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              {error}
            </div>
          )}

          <div className="flex gap-1 border-b border-neya-border">
            {[
              ['editor', 'Éditeur'],
              ['result', 'Résultat'],
              ['list', `Plans (${list.length})`],
            ].map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                className={`px-3 py-2 text-sm border-b-2 -mb-px ${
                  tab === id
                    ? 'border-neya-orange text-neya-ink font-medium'
                    : 'border-transparent text-neya-muted'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {loading ? (
            <p className="text-sm text-neya-muted">Chargement…</p>
          ) : null}

          {tab === 'list' && (
            <div className="card divide-y divide-neya-border">
              {!list.length && (
                <p className="text-sm text-neya-muted py-4">Aucun plan enregistré. Chargez l’exemple Sierra ou créez-en un.</p>
              )}
              {list.map((row) => (
                <div key={row.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                  <div>
                    <button
                      type="button"
                      className="text-sm font-medium text-neya-ink hover:underline"
                      onClick={() => openPlan(row.id)}
                    >
                      {row.title}
                    </button>
                    <p className="text-xs text-neya-muted">
                      {row.project_label || '—'} · {row.board_qty ? `${row.board_qty} × 2×4` : '—'}
                      {row.grand_total ? ` · ${formatMoney(Number(row.grand_total))}` : ''}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button type="button" className="btn-secondary text-xs" onClick={() => openPlan(row.id)}>
                      Ouvrir
                    </button>
                    <button type="button" className="text-xs text-red-600" onClick={() => deletePlan(row.id)}>
                      Suppr.
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {tab === 'editor' && (
            <div className="space-y-4">
              <div className="card grid gap-3 sm:grid-cols-2">
                <label className="text-sm space-y-1">
                  <span className="text-neya-muted">Titre</span>
                  <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
                </label>
                <label className="text-sm space-y-1">
                  <span className="text-neya-muted">Projet / client</span>
                  <input className="input" value={projectLabel} onChange={(e) => setProjectLabel(e.target.value)} />
                </label>
                <label className="text-sm space-y-1 sm:col-span-2">
                  <span className="text-neya-muted">Notes</span>
                  <textarea className="input min-h-[60px]" value={notes} onChange={(e) => setNotes(e.target.value)} />
                </label>
                <label className="text-sm space-y-1">
                  <span className="text-neya-muted">Marge planches (ex. 0.12 = +12%)</span>
                  <input
                    className="input"
                    type="number"
                    step="0.01"
                    value={margin}
                    onChange={(e) => setMargin(e.target.value)}
                  />
                </label>
              </div>

              <div className="card space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="font-semibold">SKU frames</h2>
                  <button type="button" className="btn-secondary text-xs" onClick={() => setSkus((s) => [...s, emptySku()])}>
                    + SKU
                  </button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-neya-muted">
                        <th className="p-1">SKU</th>
                        <th className="p-1">Label</th>
                        <th className="p-1">Qty</th>
                        <th className="p-1">Long″</th>
                        <th className="p-1">Short″</th>
                        <th className="p-1">Trav″</th>
                        <th className="p-1">Trav×</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {skus.map((s, i) => (
                        <tr key={i}>
                          {['sku', 'label', 'qty', 'long_in', 'short_in', 'traverse_in', 'traverse_count'].map((k) => (
                            <td key={k} className="p-1">
                              <input
                                className="input text-xs py-1 px-1.5 w-full min-w-[3rem]"
                                value={s[k] ?? ''}
                                onChange={(e) => updateSku(i, k, k === 'sku' || k === 'label' ? e.target.value : Number(e.target.value))}
                              />
                            </td>
                          ))}
                          <td className="p-1">
                            <button type="button" className="text-red-600" onClick={() => setSkus((prev) => prev.filter((_, j) => j !== i))}>
                              ×
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="card space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="font-semibold">Stock atelier existant</h2>
                  <button type="button" className="btn-secondary text-xs" onClick={() => setStock((s) => [...s, emptyStock()])}>
                    + Stock
                  </button>
                </div>
                {!stock.length && <p className="text-xs text-neya-muted">Aucune pièce en stock. Ajoutez des longueurs déjà coupées (rip ×2 si pleine section).</p>}
                {stock.map((s, i) => (
                  <div key={i} className="grid grid-cols-2 sm:grid-cols-6 gap-2 items-end">
                    <label className="text-xs space-y-1">
                      <span className="text-neya-muted">Longueur ″</span>
                      <input className="input text-xs" type="number" value={s.length_in} onChange={(e) => updateStock(i, 'length_in', Number(e.target.value))} />
                    </label>
                    <label className="text-xs space-y-1">
                      <span className="text-neya-muted">Qty</span>
                      <input className="input text-xs" type="number" value={s.qty} onChange={(e) => updateStock(i, 'qty', Number(e.target.value))} />
                    </label>
                    <label className="text-xs space-y-1">
                      <span className="text-neya-muted">Rip</span>
                      <input className="input text-xs" type="number" value={s.rip_factor} onChange={(e) => updateStock(i, 'rip_factor', Number(e.target.value))} />
                    </label>
                    <label className="text-xs space-y-1">
                      <span className="text-neya-muted">Stock</span>
                      <select className="input text-xs" value={s.stock} onChange={(e) => updateStock(i, 'stock', e.target.value)}>
                        <option value="structural">structural</option>
                        <option value="traverse">traverse</option>
                      </select>
                    </label>
                    <label className="text-xs space-y-1 sm:col-span-1">
                      <span className="text-neya-muted">Note</span>
                      <input className="input text-xs" value={s.note || ''} onChange={(e) => updateStock(i, 'note', e.target.value)} />
                    </label>
                    <button type="button" className="text-red-600 text-sm pb-2" onClick={() => setStock((prev) => prev.filter((_, j) => j !== i))}>
                      Retirer
                    </button>
                  </div>
                ))}
              </div>

              <div className="card space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="font-semibold">Feuilles 4×8 (optionnel)</h2>
                  <button type="button" className="btn-secondary text-xs" onClick={() => setSheets((s) => [...s, emptySheet()])}>
                    + Pièce
                  </button>
                </div>
                {sheets.map((s, i) => (
                  <div key={i} className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                    {[['label', 'Label'], ['w_in', 'Larg ″'], ['h_in', 'Haut ″'], ['qty', 'Qty']].map(([k, lab]) => (
                      <label key={k} className="text-xs space-y-1">
                        <span className="text-neya-muted">{lab}</span>
                        <input
                          className="input text-xs"
                          value={s[k] ?? ''}
                          onChange={(e) => updateSheet(i, k, k === 'label' ? e.target.value : Number(e.target.value))}
                        />
                      </label>
                    ))}
                    <button type="button" className="text-red-600 text-sm self-end pb-2" onClick={() => setSheets((prev) => prev.filter((_, j) => j !== i))}>
                      ×
                    </button>
                  </div>
                ))}
              </div>

              <div className="card grid gap-3 sm:grid-cols-3">
                <h2 className="font-semibold sm:col-span-3">Prix & extras</h2>
                {[
                  ['board_2x4_price', 'Prix 2×4'],
                  ['board_1x6_price', 'Prix 1×6'],
                  ['extra_1x6_qty', 'Qty 1×6'],
                  ['sheet_price', 'Prix feuille'],
                  ['tax_rate', 'Taxe (0.14975)'],
                  ['uhaul', 'U-Haul $'],
                  ['gas', 'Essence $'],
                ].map(([k, lab]) => (
                  <label key={k} className="text-sm space-y-1">
                    <span className="text-neya-muted">{lab}</span>
                    <input
                      className="input"
                      type="number"
                      step="0.01"
                      value={materials[k] ?? 0}
                      onChange={(e) => setMaterials((m) => ({ ...m, [k]: Number(e.target.value) }))}
                    />
                  </label>
                ))}
              </div>
            </div>
          )}

          {tab === 'result' && (
            <div className="space-y-4">
              {!result ? (
                <div className="card text-sm text-neya-muted">
                  Lancez <strong>Optimiser</strong> ou chargez l’exemple Sierra pour voir les patterns.
                </div>
              ) : (
                <>
                  <div className="grid gap-3 sm:grid-cols-4">
                    <div className="card">
                      <p className="text-xs text-neya-muted">2×4 à acheter</p>
                      <p className="text-2xl font-semibold">{result.purchase.board_2x4_qty}</p>
                    </div>
                    <div className="card">
                      <p className="text-xs text-neya-muted">1×6</p>
                      <p className="text-2xl font-semibold">{result.purchase.board_1x6_qty}</p>
                    </div>
                    <div className="card">
                      <p className="text-xs text-neya-muted">Feuilles 4×8</p>
                      <p className="text-2xl font-semibold">{result.purchase.sheet_qty}</p>
                    </div>
                    <div className="card">
                      <p className="text-xs text-neya-muted">Total taxé</p>
                      <p className="text-2xl font-semibold">{formatMoney(result.purchase.grand_taxed)}</p>
                    </div>
                  </div>

                  {(result.legend || []).length > 0 && (
                    <div className="card flex flex-wrap gap-3">
                      {result.legend.map((leg) => (
                        <div key={leg.length} className="flex items-center gap-2 text-xs">
                          <span className="w-4 h-4 rounded" style={{ background: leg.color }} />
                          {leg.label}
                        </div>
                      ))}
                    </div>
                  )}

                  {(result.existing_stock || []).some((s) => s.used > 0) && (
                    <div className="card space-y-2">
                      <h3 className="font-semibold">Stock utilisé</h3>
                      <ul className="text-sm space-y-1">
                        {result.existing_stock.filter((s) => s.used > 0).map((s, i) => (
                          <li key={i} className="text-neya-muted">
                            {s.qty_on_hand}× {s.length_in}″ rip×{s.rip_factor} → {s.used} pièces ({s.stock}) {s.note && `· ${s.note}`}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <PatternBlock title="Patterns structurels" pack={result.structural} />
                  <PatternBlock title="Patterns traverses" pack={result.traverse} />

                  {(result.sheets?.sheets || []).length > 0 && (
                    <div className="card space-y-2">
                      <h3 className="font-semibold">Feuilles 4×8</h3>
                      <p className="text-xs text-neya-muted">
                        {result.sheets.sheet_needed} feuille(s) · +marge → {result.sheets.sheet_with_margin}
                      </p>
                      <ul className="text-sm">
                        {result.sheets.sheets.map((s) => (
                          <li key={s.id}>{s.id} · rebut {s.wastePct}%</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <div className="card overflow-x-auto">
                    <h3 className="font-semibold mb-2">Besoins par longueur</h3>
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-left text-neya-muted">
                          <th className="p-1">Stock</th>
                          <th className="p-1">Longueur</th>
                          <th className="p-1">Brut</th>
                          <th className="p-1">Après stock</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(result.needs || []).map((n) => {
                          const rem = (result.remaining_needs || []).find(
                            (r) => r.stock === n.stock && r.length === n.length,
                          );
                          return (
                            <tr key={`${n.stock}-${n.length}`}>
                              <td className="p-1">{n.stock}</td>
                              <td className="p-1">{n.length}″</td>
                              <td className="p-1">{n.qty}</td>
                              <td className="p-1">{rem?.qty ?? 0}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </AppShell>
    </AuthGuard>
  );
}

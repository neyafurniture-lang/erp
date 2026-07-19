'use client';

import { useEffect, useMemo, useState } from 'react';
import BoardStripEditor from './BoardStripEditor';
import SheetCanvasEditor from './SheetCanvasEditor';
import {
  BOARD_LEN,
  DEFAULT_KERF,
  SHEET_H,
  SHEET_W,
  demoLayout,
  emptyBoard,
  emptyLinearPart,
  emptyPanelPart,
  emptySheet,
  layoutStats,
  packLinearLocal,
  packPanelsLocal,
  trimNum,
} from '../../lib/cutting-layout';
import { api, formatMoney, getApiUrl, getToken } from '../../lib/api';

/**
 * Studio de coupe type CutList Optimizer :
 * gauche = pièces demandées, centre = canvas éditable, haut = stats + actions.
 */
export default function CuttingStudio() {
  const [doc, setDoc] = useState(() => ({
    title: 'Nouveau plan de coupe',
    project_label: '',
    notes: '',
    kerf: DEFAULT_KERF,
    boardLength: BOARD_LEN,
    sheetW: SHEET_W,
    sheetH: SHEET_H,
    linearParts: [emptyLinearPart({ length: 26, qty: 4 })],
    panelParts: [],
    boards: [emptyBoard({ label: 'Planche 1' })],
    sheets: [],
  }));
  const [mode, setMode] = useState('1d'); // 1d | 2d
  const [selectedId, setSelectedId] = useState(null);
  const [placePartId, setPlacePartId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [planId, setPlanId] = useState(null);
  const [savedList, setSavedList] = useState([]);
  const [showSaved, setShowSaved] = useState(false);
  const [mobilePane, setMobilePane] = useState('canvas'); // input | canvas

  const stats = useMemo(() => layoutStats(doc, doc.kerf), [doc]);
  const placePart = useMemo(
    () => (doc.panelParts || []).find((p) => p.id === placePartId) || null,
    [doc.panelParts, placePartId],
  );

  useEffect(() => {
    api('/cutting-plans').then(setSavedList).catch(() => {});
  }, []);

  function patch(partial) {
    setDoc((d) => ({ ...d, ...partial }));
  }

  function updateBoard(board) {
    patch({ boards: doc.boards.map((b) => (b.id === board.id ? board : b)) });
  }

  function updateSheet(sheet) {
    patch({ sheets: doc.sheets.map((s) => (s.id === sheet.id ? sheet : s)) });
  }

  async function runOptimize() {
    setBusy(true);
    setError('');
    try {
      // Prefer server/Python; fall back to local packer
      const payload = {
        mode,
        kerf: doc.kerf,
        board_length_in: doc.boardLength,
        sheet_w_in: doc.sheetW,
        sheet_h_in: doc.sheetH,
        linear_parts: doc.linearParts,
        panel_parts: doc.panelParts,
      };
      try {
        const res = await api('/cutting-plans/studio/optimize', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        if (mode === '1d' && res.boards?.length) {
          patch({ boards: res.boards });
        } else if (mode === '2d' && res.sheets?.length) {
          patch({ sheets: res.sheets });
        } else if (res.boards || res.sheets) {
          patch({
            boards: res.boards || doc.boards,
            sheets: res.sheets || doc.sheets,
          });
        } else {
          throw new Error('Réponse vide');
        }
      } catch {
        if (mode === '1d') {
          patch({ boards: packLinearLocal(doc.linearParts, { boardLength: doc.boardLength, kerf: doc.kerf }) });
        } else {
          patch({ sheets: packPanelsLocal(doc.panelParts, { sheetW: doc.sheetW, sheetH: doc.sheetH, kerf: doc.kerf }) });
        }
      }
      setSelectedId(null);
      setPlacePartId(null);
      setMobilePane('canvas');
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
      const plan_input = {
        title: doc.title,
        project_label: doc.project_label,
        notes: doc.notes,
        studio: true,
        kerf: doc.kerf,
        board_length_in: doc.boardLength,
        layout: {
          boards: doc.boards,
          sheets: doc.sheets,
          linearParts: doc.linearParts,
          panelParts: doc.panelParts,
        },
      };
      const body = {
        title: doc.title,
        project_label: doc.project_label,
        notes: doc.notes,
        plan_input,
      };
      let saved;
      if (planId) {
        saved = await api(`/cutting-plans/${planId}`, { method: 'PUT', body: JSON.stringify(body) });
      } else {
        saved = await api('/cutting-plans', { method: 'POST', body: JSON.stringify(body) });
        setPlanId(saved.id);
      }
      setSavedList(await api('/cutting-plans'));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
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
        body: JSON.stringify({
          plan_input: {
            title: doc.title,
            project_label: doc.project_label,
            notes: doc.notes,
            studio: true,
            kerf: doc.kerf,
            layout: { boards: doc.boards, sheets: doc.sheets },
          },
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Erreur ${res.status}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${(doc.title || 'cutting-plan').replace(/[^\w.-]+/g, '_')}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function openSaved(id) {
    setBusy(true);
    try {
      const row = await api(`/cutting-plans/${id}`);
      const layout = row.plan_input?.layout;
      setPlanId(row.id);
      if (layout?.boards || layout?.sheets) {
        setDoc((d) => ({
          ...d,
          title: row.title || d.title,
          project_label: row.project_label || '',
          notes: row.notes || '',
          kerf: row.plan_input?.kerf ?? d.kerf,
          linearParts: layout.linearParts || d.linearParts,
          panelParts: layout.panelParts || d.panelParts,
          boards: layout.boards || d.boards,
          sheets: layout.sheets || d.sheets,
        }));
      }
      setShowSaved(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function loadDemo() {
    const d = demoLayout();
    setPlanId(null);
    setDoc(d);
    setMode('1d');
    setSelectedId(null);
    setPlacePartId(null);
  }

  return (
    <div className="cut-studio">
      {/* Top bar */}
      <header className="cut-studio__top">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <button type="button" className="cut-icon-btn" title="Plans enregistrés" onClick={() => setShowSaved((v) => !v)}>
            ☰
          </button>
          <input
            className="cut-studio__title"
            value={doc.title}
            onChange={(e) => patch({ title: e.target.value })}
          />
        </div>

        <div className="cut-studio__modes">
          <button type="button" className={mode === '1d' ? 'is-active' : ''} onClick={() => setMode('1d')}>
            Planches 8 pi
          </button>
          <button type="button" className={mode === '2d' ? 'is-active' : ''} onClick={() => setMode('2d')}>
            Panneaux 4×8
          </button>
        </div>

        <div className="cut-studio__stats">
          {mode === '1d' ? (
            <>
              <span><b>{stats.boards}</b> planches</span>
              <span><b>{stats.segments}</b> coupes</span>
              <span><b>{Math.round(stats.boardYield * 100)}%</b> rendement</span>
              <span className="text-neya-muted">rebut {trimNum(stats.boardWasteIn)}″</span>
            </>
          ) : (
            <>
              <span><b>{stats.sheets}</b> panneaux</span>
              <span><b>{stats.rects}</b> pièces</span>
              <span><b>{Math.round(stats.sheetYield * 100)}%</b> rendement</span>
            </>
          )}
        </div>

        <div className="cut-studio__actions">
          <button type="button" className="btn-ghost text-xs hidden sm:inline-flex" disabled={busy} onClick={loadDemo}>
            Démo
          </button>
          <button type="button" className="btn-secondary text-xs !min-h-[40px]" disabled={busy} onClick={runOptimize}>
            Optimiser
          </button>
          <button type="button" className="btn-secondary text-xs !min-h-[40px]" disabled={busy} onClick={savePlan}>
            Sauver
          </button>
          <button type="button" className="btn-primary text-xs !min-h-[40px]" disabled={busy} onClick={downloadPdf}>
            PDF
          </button>
        </div>
      </header>

      {error && (
        <div className="mx-3 mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </div>
      )}

      {/* Mobile pane switch */}
      <div className="cut-studio__mobile-tabs sm:hidden">
        <button type="button" className={mobilePane === 'input' ? 'is-active' : ''} onClick={() => setMobilePane('input')}>
          Pièces
        </button>
        <button type="button" className={mobilePane === 'canvas' ? 'is-active' : ''} onClick={() => setMobilePane('canvas')}>
          Canvas
        </button>
      </div>

      <div className="cut-studio__body">
        {/* Left input */}
        <aside className={`cut-studio__sidebar ${mobilePane === 'input' ? 'is-open' : ''}`}>
          {/* Réglages panneau toujours visibles — pas besoin de défiler */}
          <section className="cut-side-block cut-side-block--pinned">
            <h3>Réglages panneau</h3>
            {mode === '1d' ? (
              <label className="cut-field !mb-1.5">
                <span>Longueur planche (″)</span>
                <input
                  className="input !min-h-[36px] !py-1.5 text-sm"
                  type="number"
                  value={doc.boardLength}
                  onChange={(e) => patch({ boardLength: Number(e.target.value) })}
                />
              </label>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <label className="cut-field !mb-1.5">
                  <span>Larg. ″</span>
                  <input
                    className="input !min-h-[36px] !py-1.5 text-sm"
                    type="number"
                    value={doc.sheetW}
                    onChange={(e) => patch({ sheetW: Number(e.target.value) })}
                  />
                </label>
                <label className="cut-field !mb-1.5">
                  <span>Haut. ″</span>
                  <input
                    className="input !min-h-[36px] !py-1.5 text-sm"
                    type="number"
                    value={doc.sheetH}
                    onChange={(e) => patch({ sheetH: Number(e.target.value) })}
                  />
                </label>
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              <label className="cut-field !mb-0">
                <span>Kerf (″)</span>
                <input
                  className="input !min-h-[36px] !py-1.5 text-sm"
                  type="number"
                  step="0.01"
                  value={doc.kerf}
                  onChange={(e) => patch({ kerf: Number(e.target.value) })}
                />
              </label>
              <label className="cut-field !mb-0">
                <span>Projet / note</span>
                <input
                  className="input !min-h-[36px] !py-1.5 text-sm"
                  value={doc.project_label}
                  onChange={(e) => patch({ project_label: e.target.value })}
                  placeholder="Haltigan #153"
                />
              </label>
            </div>
          </section>

          {/* Seule la liste des pièces défile */}
          <div className="cut-studio__sidebar-scroll">
            {mode === '1d' ? (
              <section className="cut-side-block">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <h3 className="!mb-0">Pièces à couper</h3>
                  <button
                    type="button"
                    className="cut-icon-btn"
                    onClick={() => patch({ linearParts: [...doc.linearParts, emptyLinearPart()] })}
                  >
                    +
                  </button>
                </div>
                <p className="text-[11px] text-neya-muted mb-2">
                  Entrez les longueurs, puis <b>Optimiser</b> — ou posez à la main sur les planches.
                </p>
                <div className="space-y-2">
                  {doc.linearParts.map((p, i) => (
                    <div key={p.id} className="cut-part-row">
                      <span className="cut-swatch" style={{ background: p.color }} />
                      <input
                        className="cut-part-input flex-[1.2]"
                        placeholder="Label"
                        value={p.label}
                        onChange={(e) => {
                          const linearParts = doc.linearParts.map((x, j) => (j === i ? { ...x, label: e.target.value } : x));
                          patch({ linearParts });
                        }}
                      />
                      <input
                        className="cut-part-input w-14"
                        type="number"
                        title="Longueur ″"
                        value={p.length}
                        onChange={(e) => {
                          const length = Number(e.target.value);
                          const linearParts = doc.linearParts.map((x, j) => (
                            j === i ? { ...x, length, color: x.color } : x
                          ));
                          patch({ linearParts });
                        }}
                      />
                      <input
                        className="cut-part-input w-12"
                        type="number"
                        title="Qty"
                        value={p.qty}
                        onChange={(e) => {
                          const linearParts = doc.linearParts.map((x, j) => (j === i ? { ...x, qty: Number(e.target.value) } : x));
                          patch({ linearParts });
                        }}
                      />
                      <button
                        type="button"
                        className="text-neya-muted hover:text-red-600 text-sm"
                        onClick={() => patch({ linearParts: doc.linearParts.filter((_, j) => j !== i) })}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            ) : (
              <section className="cut-side-block">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <h3 className="!mb-0">Pièces panneau</h3>
                  <button
                    type="button"
                    className="cut-icon-btn"
                    onClick={() => patch({ panelParts: [...doc.panelParts, emptyPanelPart()] })}
                  >
                    +
                  </button>
                </div>
                <p className="text-[11px] text-neya-muted mb-2">
                  Cliquez une pièce pour la charger, puis le panneau pour la poser. Ou Optimiser.
                </p>
                <div className="space-y-2">
                  {doc.panelParts.map((p, i) => (
                    <button
                      key={p.id}
                      type="button"
                      className={`cut-part-row cut-part-row--btn ${placePartId === p.id ? 'is-active' : ''}`}
                      onClick={() => setPlacePartId(placePartId === p.id ? null : p.id)}
                    >
                      <span className="cut-swatch" style={{ background: p.color }} />
                      <input
                        className="cut-part-input flex-1"
                        placeholder="Label"
                        value={p.label}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => {
                          const panelParts = doc.panelParts.map((x, j) => (j === i ? { ...x, label: e.target.value } : x));
                          patch({ panelParts });
                        }}
                      />
                      <input
                        className="cut-part-input w-12"
                        type="number"
                        value={p.w}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => {
                          const panelParts = doc.panelParts.map((x, j) => (j === i ? { ...x, w: Number(e.target.value) } : x));
                          patch({ panelParts });
                        }}
                      />
                      <span className="text-neya-muted text-xs">×</span>
                      <input
                        className="cut-part-input w-12"
                        type="number"
                        value={p.h}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => {
                          const panelParts = doc.panelParts.map((x, j) => (j === i ? { ...x, h: Number(e.target.value) } : x));
                          patch({ panelParts });
                        }}
                      />
                      <input
                        className="cut-part-input w-10"
                        type="number"
                        value={p.qty}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => {
                          const panelParts = doc.panelParts.map((x, j) => (j === i ? { ...x, qty: Number(e.target.value) } : x));
                          patch({ panelParts });
                        }}
                      />
                    </button>
                  ))}
                </div>
              </section>
            )}
          </div>

          <div className="cut-studio__sidebar-foot">
            <button type="button" className="btn-primary w-full" disabled={busy} onClick={runOptimize}>
              Optimiser le placement
            </button>
            <p className="text-[10px] text-neya-muted mt-1.5 text-center">
              Local + Python si dispo · ajustable à la main
            </p>
          </div>
        </aside>

        {/* Canvas */}
        <main className={`cut-studio__canvas ${mobilePane === 'canvas' ? 'is-open' : ''}`}>
          {mode === '1d' ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-neya-ink">Planches ({doc.boards.length})</h2>
                <button
                  type="button"
                  className="btn-secondary text-xs !min-h-[36px]"
                  onClick={() => patch({
                    boards: [...doc.boards, emptyBoard({
                      label: `Planche ${doc.boards.length + 1}`,
                      length: doc.boardLength,
                    })],
                  })}
                >
                  + Planche
                </button>
              </div>
              {doc.boards.map((board) => (
                <BoardStripEditor
                  key={board.id}
                  board={board}
                  kerf={doc.kerf}
                  selectedId={selectedId}
                  onChange={updateBoard}
                  onSelect={setSelectedId}
                  onRemove={(id) => {
                    patch({ boards: doc.boards.filter((b) => b.id !== id) });
                    setSelectedId(null);
                  }}
                />
              ))}
              {!doc.boards.length && (
                <div className="cut-empty">
                  <p>Aucune planche. Ajoutez-en une ou lancez Optimiser depuis vos pièces.</p>
                  <button type="button" className="btn-primary" onClick={() => patch({ boards: [emptyBoard()] })}>
                    + Planche 8 pi
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-neya-ink">
                  Panneaux ({doc.sheets.length})
                  {placePart && (
                    <span className="ml-2 text-xs font-normal text-neya-orange">
                      Placement : {placePart.label || `${placePart.w}×${placePart.h}`}
                    </span>
                  )}
                </h2>
                <button
                  type="button"
                  className="btn-secondary text-xs !min-h-[36px]"
                  onClick={() => patch({
                    sheets: [...doc.sheets, emptySheet({
                      label: `Panneau ${doc.sheets.length + 1}`,
                      width: doc.sheetW,
                      height: doc.sheetH,
                    })],
                  })}
                >
                  + Panneau
                </button>
              </div>
              <div className="grid gap-4 lg:grid-cols-2">
                {doc.sheets.map((sheet) => (
                  <SheetCanvasEditor
                    key={sheet.id}
                    sheet={sheet}
                    selectedId={selectedId}
                    placePart={placePart}
                    onChange={updateSheet}
                    onSelect={setSelectedId}
                    onRemove={(id) => {
                      patch({ sheets: doc.sheets.filter((s) => s.id !== id) });
                      setSelectedId(null);
                    }}
                  />
                ))}
              </div>
              {!doc.sheets.length && (
                <div className="cut-empty">
                  <p>Aucun panneau 4×8. Ajoutez-en un ou Optimiser vos pièces.</p>
                  <button type="button" className="btn-primary" onClick={() => patch({ sheets: [emptySheet()] })}>
                    + Panneau 4×8
                  </button>
                </div>
              )}
            </div>
          )}
        </main>
      </div>

      {/* Saved drawer */}
      {showSaved && (
        <div className="cut-drawer">
          <div className="cut-drawer__panel">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold">Plans enregistrés</h3>
              <button type="button" className="btn-ghost" onClick={() => setShowSaved(false)}>Fermer</button>
            </div>
            <div className="space-y-2 max-h-[60vh] overflow-y-auto">
              {!savedList.length && <p className="text-sm text-neya-muted">Aucun plan sauvé.</p>}
              {savedList.map((row) => (
                <button
                  key={row.id}
                  type="button"
                  className="w-full text-left card-flat hover:border-neya-orange transition-colors"
                  onClick={() => openSaved(row.id)}
                >
                  <div className="text-sm font-medium">{row.title}</div>
                  <div className="text-xs text-neya-muted">
                    {row.project_label || '—'}
                    {row.grand_total ? ` · ${formatMoney(Number(row.grand_total))}` : ''}
                  </div>
                </button>
              ))}
            </div>
          </div>
          <button type="button" className="cut-drawer__backdrop" aria-label="Fermer" onClick={() => setShowSaved(false)} />
        </div>
      )}
    </div>
  );
}

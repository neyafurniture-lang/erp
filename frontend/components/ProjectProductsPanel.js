'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { SAUNA_CLOUD_PRODUCTS } from '../lib/project-products';

function emptyRow() {
  return { sku: '', dimensions: '', model: '', qty: 0 };
}

function normalizeRows(rows) {
  return (rows || []).map(r => ({
    sku: String(r.sku || '').trim(),
    dimensions: String(r.dimensions || '').trim(),
    model: String(r.model || '').trim(),
    qty: Number(r.qty) || 0,
  }));
}

export default function ProjectProductsPanel({ project, onReload }) {
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [dirty, setDirty] = useState(false);

  const loadFromProject = useCallback(() => {
    const meta = typeof project.meta === 'string'
      ? (() => { try { return JSON.parse(project.meta || '{}'); } catch { return {}; } })()
      : (project.meta || {});
    const products = Array.isArray(meta.products) ? meta.products : [];
    if (products.length) {
      setRows(normalizeRows(products));
      setDirty(false);
    } else if (/sauna\s*cloud/i.test(project.name || '')) {
      setRows(normalizeRows(SAUNA_CLOUD_PRODUCTS));
      setDirty(true);
    } else {
      setRows([]);
      setDirty(false);
    }
    setErr('');
    setOk('');
  }, [project]);

  useEffect(() => { loadFromProject(); }, [loadFromProject]);

  function patchRows(next) {
    setRows(next);
    setDirty(true);
    setOk('');
  }

  function updateRow(index, field, value) {
    patchRows(rows.map((row, i) => (i === index ? { ...row, [field]: value } : row)));
  }

  function addRow() {
    patchRows([...rows, emptyRow()]);
  }

  function removeRow(index) {
    if (!confirm('Retirer cette ligne du catalogue ?')) return;
    patchRows(rows.filter((_, i) => i !== index));
  }

  async function save() {
    setBusy('save');
    setErr('');
    setOk('');
    try {
      const products = normalizeRows(rows).filter(r => r.sku);
      await api(`/projects/${project.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          name: project.name,
          client_id: project.client_id,
          status: project.status,
          deadline: project.deadline,
          budget_estimated: project.budget_estimated,
          budget_real: project.budget_real,
          notes: project.notes,
          meta: { products },
        }),
      });
      setDirty(false);
      setOk('Catalogue produits enregistré.');
      onReload?.();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy('');
    }
  }

  const totalQty = rows.reduce((s, r) => s + (Number(r.qty) || 0), 0);

  return (
    <div className="space-y-4">
      <div className="border border-neya-border bg-neya-surface/40 px-4 py-3">
        <p className="text-sm text-neya-ink">
          Catalogue SKU du projet — références, dimensions, modèles et quantités commandées.
          Lia utilise ce tableau pour répondre aux questions sur les produits du projet.
        </p>
      </div>

      {err && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 px-4 py-3">{err}</div>
      )}
      {ok && (
        <div className="text-sm text-green-800 bg-green-50 border border-green-200 px-4 py-3">{ok}</div>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={save}
          disabled={!!busy || !dirty}
          className="btn-primary text-sm min-h-[36px] disabled:opacity-40"
        >
          {busy === 'save' ? 'Enregistrement…' : 'Enregistrer le catalogue'}
        </button>
        <button type="button" onClick={addRow} disabled={!!busy} className="btn-ghost text-sm">
          + Ligne SKU
        </button>
      </div>

      <div className="card !p-0 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-neya-border bg-neya-surface/50 text-left text-xs uppercase tracking-wide text-neya-muted">
              <th className="px-3 py-2 font-semibold min-w-[90px]">SKU</th>
              <th className="px-3 py-2 font-semibold min-w-[120px]">Dimensions</th>
              <th className="px-3 py-2 font-semibold min-w-[130px]">Modèle</th>
              <th className="px-3 py-2 font-semibold w-24 text-right">Qté</th>
              <th className="px-3 py-2 font-semibold w-16" />
            </tr>
          </thead>
          <tbody className="divide-y divide-neya-border">
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-8 text-center text-neya-muted">
                  Aucun produit — ajoutez les SKU du projet ci-dessus.
                </td>
              </tr>
            )}
            {rows.map((row, i) => (
              <tr key={`${row.sku}-${i}`} className="hover:bg-neya-surface/30">
                <td className="px-3 py-2 align-top">
                  <input
                    className="input text-sm py-1.5 font-mono font-semibold"
                    value={row.sku}
                    placeholder="H2013"
                    onChange={e => updateRow(i, 'sku', e.target.value)}
                  />
                </td>
                <td className="px-3 py-2 align-top">
                  <input
                    className="input text-sm py-1.5"
                    value={row.dimensions}
                    placeholder='20" x 13"'
                    onChange={e => updateRow(i, 'dimensions', e.target.value)}
                  />
                </td>
                <td className="px-3 py-2 align-top">
                  <input
                    className="input text-sm py-1.5"
                    value={row.model}
                    placeholder="Underbench"
                    onChange={e => updateRow(i, 'model', e.target.value)}
                  />
                </td>
                <td className="px-3 py-2 align-top">
                  <input
                    type="number"
                    min={0}
                    step={1}
                    className="input text-sm py-1.5 text-right tabular-nums"
                    value={row.qty || ''}
                    placeholder="0"
                    onChange={e => updateRow(i, 'qty', e.target.value)}
                  />
                </td>
                <td className="px-3 py-2 align-top text-right">
                  <button type="button" onClick={() => removeRow(i)} className="text-xs text-neya-muted hover:text-red-700">
                    Retirer
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr className="border-t border-neya-border bg-neya-surface/40 font-medium">
                <td className="px-3 py-2" colSpan={3}>Total unités</td>
                <td className="px-3 py-2 text-right tabular-nums">{totalQty}</td>
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

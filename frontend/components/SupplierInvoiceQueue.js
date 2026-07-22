'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { api } from '../lib/api';
import { decodeHtmlEntities } from '../lib/mail-text';

function groupPendingBySupplier(items = []) {
  const map = new Map();
  for (const item of items) {
    const key = item.supplier_label || 'Fournisseur';
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b, 'fr'))
    .map(([label, list]) => ({ label, items: list }));
}

function AssignModal({ item, projects, onClose, onDone }) {
  const [projectId, setProjectId] = useState(item.suggested_project_id || '');
  const [amount, setAmount] = useState('');
  const [remember, setRemember] = useState(true);
  const [keyword, setKeyword] = useState(item.keywords?.[0] || '');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  async function submit(e) {
    e.preventDefault();
    if (!projectId) return;
    setSaving(true);
    setErr('');
    try {
      await api(`/supplier-invoices/${item.id}/assign`, {
        method: 'POST',
        body: JSON.stringify({
          project_id: Number(projectId),
          amount: amount ? Number(amount) : null,
          category: 'materiaux',
          remember_rule: remember,
          keyword_pattern: keyword.trim() || undefined,
        }),
      });
      onDone();
      onClose();
    } catch (e) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function dismiss() {
    await api(`/supplier-invoices/${item.id}/dismiss`, { method: 'POST' });
    onDone();
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <button type="button" aria-label="Fermer" className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white w-full sm:max-w-lg rounded sm:rounded border border-neya-border p-5">
        <h3 className="font-heading text-lg mb-1">Où va cette facture ?</h3>
        <p className="text-sm text-neya-muted mb-4">
          <span className="font-medium text-neya-ink">{item.supplier_label}</span>
          {' — '}{item.subject}
        </p>
        {item.snippet && <p className="text-xs text-neya-muted mb-4 line-clamp-2">{decodeHtmlEntities(item.snippet)}</p>}

        {err && <div className="text-sm text-red-700 bg-red-50 px-3 py-2 rounded-lg mb-3">{err}</div>}

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="label">Projet</label>
            <select className="input" value={projectId} onChange={e => setProjectId(e.target.value)} required>
              <option value="">— Choisir un projet —</option>
              {projects.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            {item.suggested_project_name && !projectId && (
              <p className="text-xs text-neya-muted mt-1">Suggestion : {item.suggested_project_name}</p>
            )}
          </div>
          <div>
            <label className="label">Montant (optionnel)</label>
            <input type="number" step="0.01" min="0" className="input" placeholder="0.00 $" value={amount} onChange={e => setAmount(e.target.value)} />
          </div>
          <label className="flex items-start gap-2 cursor-pointer">
            <input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} className="mt-1 accent-neya-orange" />
            <span className="text-sm">
              Mémoriser pour la prochaine fois
              {keyword && (
                <span className="block text-xs text-neya-muted mt-0.5">
                  {item.supplier_label} + « {keyword} » → ce projet
                </span>
              )}
            </span>
          </label>
          {remember && (
            <div>
              <label className="label text-xs">Mot-clé à retenir</label>
              <input className="input text-sm" value={keyword} onChange={e => setKeyword(e.target.value)} placeholder="ex. cedre, sauna, vis..." />
            </div>
          )}
          <div className="flex flex-wrap gap-2 pt-2">
            <button type="submit" disabled={saving || !projectId} className="btn-primary flex-1 sm:flex-none">
              {saving ? 'Enregistrement…' : 'Classer la facture'}
            </button>
            <button type="button" onClick={dismiss} className="btn-secondary text-sm">Ignorer</button>
            <Link href="/mail" className="btn-secondary text-sm">Voir dans Gmail</Link>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function SupplierInvoiceQueue({ compact = false, onChange }) {
  const [pending, setPending] = useState([]);
  const [projects, setProjects] = useState([]);
  const [active, setActive] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [scanInfo, setScanInfo] = useState('');
  const [scanErr, setScanErr] = useState('');
  // Compact : replié par défaut pour ne pas monopoliser l'écran Courriel
  const [expanded, setExpanded] = useState(!compact);
  const grouped = useMemo(() => groupPendingBySupplier(pending), [pending]);

  async function load() {
    try {
      const [list, projs] = await Promise.all([
        api('/supplier-invoices/pending').catch(() => []),
        api('/projects').catch(() => []),
      ]);
      setPending(list);
      setProjects(projs.filter(p => p.status === 'active'));
      onChange?.(list.length);
    } catch {
      setPending([]);
    }
  }

  useEffect(() => {
    load();
    // Scan auto à chaque visite /mail pour stocker les factures reçues
    api('/supplier-invoices/scan', { method: 'POST' })
      .then((result) => {
        if (result.scanned != null) {
          const todoBit = result.admin_todos?.created
            ? ` · ${result.admin_todos.created} todo(s) admin`
            : '';
          setScanInfo(`${result.ingested || 0} facture(s) détectée(s) sur ${result.scanned} message(s) scanné(s)${todoBit}`);
          if ((result.ingested || 0) > 0 && compact) setExpanded(true);
        }
        if (result.errors?.length) {
          setScanErr(result.errors[0].error);
        }
        return load();
      })
      .catch((e) => setScanErr(e.message));
    return undefined;
  }, [compact]);

  async function scan() {
    setScanning(true);
    setScanErr('');
    setScanInfo('');
    try {
      const result = await api('/supplier-invoices/scan', { method: 'POST' });
      const todoBit = result.admin_todos?.created
        ? ` · ${result.admin_todos.created} todo(s) admin`
        : '';
      setScanInfo(`${result.ingested || 0} facture(s) détectée(s) sur ${result.scanned || 0} message(s) scanné(s)${todoBit}`);
      if (result.errors?.length) {
        setScanErr(`${result.errors.length} message(s) en erreur — ${result.errors[0].error}`);
      }
      await load();
      if (compact && (result.ingested || 0) > 0) setExpanded(true);
    } catch (e) {
      setScanErr(e.message);
    } finally {
      setScanning(false);
    }
  }

  if (!pending.length && compact) return null;

  if (compact) {
    return (
      <>
        <div className="border border-neya-border bg-neya-surface/40 mb-3">
          <div className="flex items-center gap-2 px-3 py-1.5">
            <button
              type="button"
              onClick={() => setExpanded(v => !v)}
              className="flex-1 min-w-0 flex items-center gap-2 text-left"
              aria-expanded={expanded}
            >
              <span className="text-neya-muted text-xs tabular-nums w-3">{expanded ? '▾' : '▸'}</span>
              <span className="text-xs font-medium text-neya-ink truncate">
                {pending.length > 0
                  ? `${pending.length} facture${pending.length !== 1 ? 's' : ''} à classer`
                  : 'Factures fournisseurs'}
              </span>
              {pending.length > 0 && !expanded && (
                <span className="text-[10px] text-neya-muted shrink-0">Cliquer pour ouvrir</span>
              )}
            </button>
            <button type="button" onClick={scan} disabled={scanning} className="text-[11px] text-neya-muted hover:text-neya-ink shrink-0 px-1">
              {scanning ? '…' : 'Scanner'}
            </button>
          </div>

          {expanded && (
            <div className="px-3 pb-2.5 border-t border-neya-border/70">
              {scanErr && (
                <p className="text-xs text-red-700 bg-red-50 px-2 py-1.5 rounded mt-2">{scanErr}</p>
              )}
              {scanInfo && !scanErr && (
                <p className="text-[11px] text-neya-muted mt-2">{scanInfo}</p>
              )}
              {pending.length === 0 ? (
                <p className="text-xs text-neya-muted py-2">Aucune facture en attente</p>
              ) : (
                <div className="space-y-2 mt-2">
                  {grouped.map(group => (
                    <div key={group.label}>
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-neya-muted px-1 mb-1">
                        {group.label} · {group.items.length}
                      </p>
                      <ul className="space-y-1">
                        {group.items.map(item => (
                          <li key={item.id} className="flex items-center justify-between gap-2 px-2 py-1.5 border border-neya-border bg-white">
                            <p className="text-xs font-medium truncate min-w-0 flex-1">{item.subject}</p>
                            <button type="button" onClick={() => setActive(item)} className="btn-primary text-[11px] shrink-0 min-h-[28px] py-0.5 px-2">
                              Classer
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {active && (
          <AssignModal
            item={active}
            projects={projects}
            onClose={() => setActive(null)}
            onDone={load}
          />
        )}
      </>
    );
  }

  return (
    <>
      <div className="card mb-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-heading text-lg">
              {pending.length > 0
                ? `${pending.length} facture${pending.length !== 1 ? 's' : ''} à classer`
                : 'Factures fournisseurs'}
            </h2>
            <p className="text-xs text-neya-muted mt-0.5">
              Home Depot, Rona, etc.
            </p>
          </div>
          <button type="button" onClick={scan} disabled={scanning} className="btn-secondary text-xs shrink-0 min-h-[36px]">
            {scanning ? 'Scan…' : 'Scanner Gmail'}
          </button>
        </div>

        {scanErr && (
          <p className="text-xs text-red-700 bg-red-50 px-3 py-2 rounded-lg mt-3">{scanErr}</p>
        )}
        {scanInfo && !scanErr && (
          <p className="text-xs text-neya-muted mt-3">{scanInfo}</p>
        )}

        {pending.length === 0 && (
          <p className="text-sm text-neya-muted py-2 mt-2">Aucune facture en attente de classement</p>
        )}

        {pending.length > 0 && (
          <div className="space-y-3 mt-4">
            {grouped.map(group => (
              <div key={group.label}>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-neya-muted mb-1.5">
                  {group.label} · {group.items.length}
                </p>
                <ul className="space-y-2">
                  {group.items.map(item => (
                    <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 p-2.5 sm:p-3 border border-neya-border bg-white">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">{item.subject}</p>
                        <p className="text-xs text-neya-muted truncate">{item.from_email}</p>
                      </div>
                      <button type="button" onClick={() => setActive(item)} className="btn-primary text-xs shrink-0 min-h-[36px]">
                        Classer
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>

      {active && (
        <AssignModal
          item={active}
          projects={projects}
          onClose={() => setActive(null)}
          onDone={load}
        />
      )}
    </>
  );
}

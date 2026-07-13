'use client';

import { useEffect, useRef, useState } from 'react';
import { api, formatMoney, resolveUploadUrl, EXPENSE_CATEGORIES } from '../lib/api';

const CATEGORY_LABELS = {
  materiaux: 'Matériaux',
  outils: 'Outils',
  transport: 'Transport',
  atelier: 'Atelier',
  admin: 'Admin',
};

function ConfirmReceiptModal({ item, projects, onClose, onDone }) {
  const [projectId, setProjectId] = useState('');
  const [amount, setAmount] = useState(item.amount != null ? String(item.amount) : '');
  const [category, setCategory] = useState(item.category || 'materiaux');
  const [description, setDescription] = useState(item.description || '');
  const [purchaseDate, setPurchaseDate] = useState(item.purchase_date?.slice?.(0, 10) || '');
  const [uploadDrive, setUploadDrive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    setErr('');
    try {
      await api(`/receipts/${item.id}/confirm`, {
        method: 'POST',
        body: JSON.stringify({
          project_id: projectId ? Number(projectId) : null,
          amount: Number(amount),
          category,
          description,
          purchase_date: purchaseDate || null,
          upload_to_drive: uploadDrive,
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
    await api(`/receipts/${item.id}/dismiss`, { method: 'POST' });
    onDone();
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <button type="button" aria-label="Fermer" className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl shadow-xl border border-neya-border max-h-[92vh] overflow-y-auto">
        <div className="p-5 border-b border-neya-border">
          <h3 className="font-heading text-lg">Classer le ticket</h3>
          <p className="text-sm text-neya-muted mt-1">
            {item.vendor || 'Magasin inconnu'}
            {item.confidence != null && (
              <span className="text-xs ml-2">· confiance {Math.round(Number(item.confidence) * 100)}%</span>
            )}
          </p>
        </div>

        <div className="p-5 grid sm:grid-cols-2 gap-4">
          <div className="sm:col-span-1">
            {item.receipt_url && (
              <img
                src={resolveUploadUrl(item.receipt_url)}
                alt="Ticket"
                className="w-full rounded-lg border border-neya-border object-contain max-h-48 bg-neya-surface"
              />
            )}
          </div>

          <form onSubmit={submit} className="sm:col-span-1 space-y-3">
            {err && <div className="text-sm text-red-700 bg-red-50 px-3 py-2 rounded-lg">{err}</div>}

            <div>
              <label className="label">Montant TTC ($)</label>
              <input type="number" step="0.01" min="0" className="input" value={amount} onChange={e => setAmount(e.target.value)} required />
            </div>
            <div>
              <label className="label">Date d&apos;achat</label>
              <input type="date" className="input" value={purchaseDate} onChange={e => setPurchaseDate(e.target.value)} />
            </div>
            <div>
              <label className="label">Catégorie</label>
              <select className="input" value={category} onChange={e => setCategory(e.target.value)}>
                {EXPENSE_CATEGORIES.map(c => (
                  <option key={c} value={c}>{CATEGORY_LABELS[c] || c}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Projet</label>
              <select className="input" value={projectId} onChange={e => setProjectId(e.target.value)}>
                <option value="">— Général atelier —</option>
                {projects.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Description</label>
              <input className="input" value={description} onChange={e => setDescription(e.target.value)} />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={uploadDrive} onChange={e => setUploadDrive(e.target.checked)} className="accent-neya-orange" />
              Envoyer la photo sur Drive (dossier projet si lié)
            </label>

            <div className="flex flex-wrap gap-2 pt-2">
              <button type="submit" disabled={saving} className="btn-primary flex-1">
                {saving ? 'Enregistrement…' : 'Créer la dépense'}
              </button>
              <button type="button" onClick={dismiss} disabled={saving} className="btn-secondary text-sm">Ignorer</button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

export default function ReceiptScanner({ compact = false, onChange }) {
  const fileRef = useRef(null);
  const [pending, setPending] = useState([]);
  const [projects, setProjects] = useState([]);
  const [scanning, setScanning] = useState(false);
  const [err, setErr] = useState('');
  const [selected, setSelected] = useState(null);

  const load = () => {
    Promise.all([
      api('/receipts/pending').catch(() => []),
      api('/projects').catch(() => []),
    ]).then(([r, p]) => {
      setPending(r);
      setProjects(p);
      onChange?.();
    });
  };

  useEffect(() => { load(); }, []);

  async function scanFile(file) {
    if (!file) return;
    setScanning(true);
    setErr('');
    try {
      const form = new FormData();
      form.append('receipt', file);
      await api('/receipts/scan', { method: 'POST', body: form });
      load();
    } catch (e) {
      setErr(e.message);
    } finally {
      setScanning(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  return (
    <div className={compact ? '' : 'card mb-6'}>
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <h2 className="font-heading text-lg">Tickets de caisse</h2>
          <p className="text-sm text-neya-muted">
            Photo → transcription automatique (OpenAI Vision) → dépense + Drive
          </p>
        </div>
        <div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={e => scanFile(e.target.files?.[0])}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={scanning}
            className="btn-primary"
          >
            {scanning ? 'Analyse…' : '📷 Scanner un ticket'}
          </button>
        </div>
      </div>

      {err && <p className="text-sm text-neya-error bg-red-50 px-3 py-2 rounded-lg mb-3">{err}</p>}

      {pending.length === 0 ? (
        <p className="text-sm text-neya-muted">
          Aucun ticket en attente. Prenez une photo du reçu avec votre téléphone.
        </p>
      ) : (
        <div className="space-y-2">
          {pending.map(item => (
            <button
              key={item.id}
              type="button"
              onClick={() => setSelected(item)}
              className="w-full text-left flex items-center gap-3 p-3 rounded-lg border border-neya-border hover:border-neya-orange hover:bg-neya-orange/5 transition-colors"
            >
              {item.receipt_url && (
                <img
                  src={resolveUploadUrl(item.receipt_url)}
                  alt=""
                  className="w-12 h-12 rounded object-cover border border-neya-border shrink-0"
                />
              )}
              <div className="min-w-0 flex-1">
                <p className="font-medium text-sm truncate">{item.vendor || 'Ticket'}</p>
                <p className="text-xs text-neya-muted truncate">{item.description || '—'}</p>
              </div>
              <div className="text-right shrink-0">
                <p className="font-medium text-sm">{item.amount != null ? formatMoney(item.amount) : '?'}</p>
                <p className="text-[10px] text-neya-muted">{CATEGORY_LABELS[item.category] || item.category}</p>
              </div>
            </button>
          ))}
        </div>
      )}

      {selected && (
        <ConfirmReceiptModal
          item={selected}
          projects={projects}
          onClose={() => setSelected(null)}
          onDone={load}
        />
      )}
    </div>
  );
}

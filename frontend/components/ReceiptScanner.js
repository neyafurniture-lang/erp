'use client';

import { useEffect, useRef, useState } from 'react';
import { Camera, FolderKanban, Loader2 } from 'lucide-react';
import { api, formatMoney, resolveUploadUrl, EXPENSE_CATEGORIES } from '../lib/api';
import { prepareReceiptImage } from '../lib/receipt-image';

const CATEGORY_LABELS = {
  materiaux: 'Matériaux',
  outils: 'Outils',
  transport: 'Transport',
  atelier: 'Atelier',
  admin: 'Admin',
};

function ConfirmReceiptModal({ item, projects, onClose, onDone }) {
  const [projectId, setProjectId] = useState(item.project_id ? String(item.project_id) : '');
  const [vendor, setVendor] = useState(item.vendor || '');
  const [amount, setAmount] = useState(item.amount != null ? String(item.amount) : '');
  const [category, setCategory] = useState(item.category || 'materiaux');
  const [description, setDescription] = useState(item.description || '');
  const [notes, setNotes] = useState('');
  const [purchaseDate, setPurchaseDate] = useState(item.purchase_date?.slice?.(0, 10) || '');
  const [uploadDrive, setUploadDrive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    setErr('');
    try {
      const parts = [];
      if (vendor.trim()) parts.push(vendor.trim());
      if (description.trim()) parts.push(description.trim());
      if (notes.trim()) parts.push(notes.trim());
      const fullDescription = parts.join(' — ') || 'Ticket de caisse';

      await api(`/receipts/${item.id}/confirm`, {
        method: 'POST',
        body: JSON.stringify({
          project_id: projectId ? Number(projectId) : null,
          amount: Number(amount),
          category,
          description: fullDescription,
          purchase_date: purchaseDate || null,
          upload_to_drive: uploadDrive,
          vendor: vendor.trim() || null,
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
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-neya-muted">Étape 2 · Compléter</p>
          <h3 className="font-display text-lg font-semibold text-neya-ink mt-0.5">Classer le ticket</h3>
          <p className="text-sm text-neya-muted mt-1">
            Vérifiez le montant, liez un projet, ajoutez des détails.
            {item.confidence != null && (
              <span className="text-xs ml-1">· IA {Math.round(Number(item.confidence) * 100)}%</span>
            )}
          </p>
        </div>

        <form onSubmit={submit} className="p-5 space-y-4">
          {item.receipt_url && (
            <img
              src={resolveUploadUrl(item.receipt_url)}
              alt="Ticket"
              className="w-full rounded-xl border border-neya-border object-contain max-h-40 bg-neya-surface"
            />
          )}

          {err && <div className="text-sm text-red-700 bg-red-50 px-3 py-2 rounded-lg">{err}</div>}

          <div className="rounded-xl border border-neya-orange/25 bg-neya-orange-soft/40 p-3 space-y-2">
            <label className="label flex items-center gap-1.5 mb-0">
              <FolderKanban className="h-3.5 w-3.5 text-neya-orange" />
              Projet <span className="text-neya-muted font-normal">(recommandé)</span>
            </label>
            <select
              className="input"
              value={projectId}
              onChange={e => setProjectId(e.target.value)}
              autoFocus
            >
              <option value="">— Général atelier —</option>
              {projects.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <p className="text-[11px] text-neya-muted">
              Lie le ticket au bon chantier. La photo ira dans le Drive du projet si activé.
            </p>
          </div>

          <div>
            <label className="label">Magasin / fournisseur</label>
            <input className="input" value={vendor} onChange={e => setVendor(e.target.value)} placeholder="Ex. Home Depot, Rona…" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Montant TTC ($)</label>
              <input type="number" step="0.01" min="0" className="input" value={amount} onChange={e => setAmount(e.target.value)} required />
            </div>
            <div>
              <label className="label">Date d&apos;achat</label>
              <input type="date" className="input" value={purchaseDate} onChange={e => setPurchaseDate(e.target.value)} />
            </div>
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
            <label className="label">Description (articles)</label>
            <input
              className="input"
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Ex. Vis 2&quot;, colle Titebond…"
            />
          </div>

          <div>
            <label className="label">Détails / notes</label>
            <textarea
              className="input min-h-[88px] resize-y"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Pourquoi cet achat, n° de commande, remarques…"
            />
          </div>

          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={uploadDrive} onChange={e => setUploadDrive(e.target.checked)} className="accent-neya-orange mt-0.5" />
            <span>Envoyer la photo sur Drive (dossier du projet si lié)</span>
          </label>

          <div className="flex flex-wrap gap-2 pt-1">
            <button type="submit" disabled={saving} className="btn-primary flex-1 min-h-[44px]">
              {saving ? 'Enregistrement…' : 'Créer la dépense'}
            </button>
            <button type="button" onClick={dismiss} disabled={saving} className="btn-secondary text-sm min-h-[44px]">
              Ignorer
            </button>
          </div>
        </form>
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
  const [hint, setHint] = useState('');

  const load = (opts = {}) => {
    Promise.all([
      api('/receipts/pending').catch(() => []),
      api('/projects').catch(() => []),
    ]).then(([r, p]) => {
      setPending(r);
      setProjects(Array.isArray(p) ? p.filter(x => x.status !== 'cancelled') : []);
      onChange?.();
      if (opts.openLatest && r?.[0]) setSelected(r[0]);
    });
  };

  useEffect(() => { load(); }, []);

  async function scanFile(file) {
    if (!file) return;
    setScanning(true);
    setErr('');
    setHint('Préparation de la photo…');
    try {
      const ready = await prepareReceiptImage(file);
      setHint('Lecture IA du ticket (10–40 s)…');
      const form = new FormData();
      form.append('receipt', ready);
      await api('/receipts/scan', { method: 'POST', body: form, timeoutMs: 120000 });
      setHint('Ticket lu — choisissez le projet et validez.');
      load({ openLatest: true });
    } catch (e) {
      setErr(e.message || 'Scan impossible');
      setHint('');
    } finally {
      setScanning(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  return (
    <div className={compact ? '' : 'rounded-2xl border border-neya-border bg-white shadow-sm mb-6 p-4 sm:p-5'}>
      <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
        <div>
          <h2 className="font-display text-lg font-semibold text-neya-ink">Tickets de caisse</h2>
          <p className="text-sm text-neya-muted mt-0.5">
            1. Photo → 2. Projet + détails → 3. Dépense créée
          </p>
        </div>
        <div>
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/heic,image/heif,image/*"
            capture="environment"
            className="hidden"
            onChange={e => scanFile(e.target.files?.[0])}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={scanning}
            className="btn-primary min-h-[48px] gap-2 px-5 text-[15px]"
          >
            {scanning ? (
              <><Loader2 className="h-4 w-4 animate-spin" /> Analyse…</>
            ) : (
              <><Camera className="h-4 w-4" /> Scanner un ticket</>
            )}
          </button>
        </div>
      </div>
      <p className="text-[11px] text-neya-muted mb-3 -mt-1">
        Préférez l’appareil photo (JPG). Les photos HEIC de la galerie sont converties si possible.
      </p>

      <ol className="mb-4 grid grid-cols-3 gap-2 text-[11px] sm:text-xs">
        {[
          { n: '1', t: 'Photo' },
          { n: '2', t: 'Projet & détails' },
          { n: '3', t: 'Dépense' },
        ].map(s => (
          <li key={s.n} className="rounded-lg border border-neya-border bg-neya-surface/60 px-2 py-2 text-center">
            <span className="font-semibold text-neya-orange">{s.n}.</span>{' '}
            <span className="text-neya-ink-light">{s.t}</span>
          </li>
        ))}
      </ol>

      {hint && !err && (
        <p className="text-sm text-neya-ink bg-neya-orange-soft/50 border border-neya-orange/20 px-3 py-2 rounded-lg mb-3">
          {hint}
        </p>
      )}

      {err && (
        <div className="text-sm text-red-800 bg-red-50 border border-red-100 px-3 py-2.5 rounded-lg mb-3 space-y-1">
          <p className="font-medium">Scan impossible</p>
          <p className="text-red-700/90">{err}</p>
          <p className="text-[11px] text-red-600/80">
            Astuce : photo nette, bien cadrée. Clés IA dans Paramètres → Assistant IA.
          </p>
        </div>
      )}

      {pending.length === 0 ? (
        <p className="text-sm text-neya-muted">
          Aucun ticket en attente. Sur téléphone : appuyez sur « Scanner un ticket » pour ouvrir l’appareil photo.
        </p>
      ) : (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-neya-muted">
            {pending.length} ticket{pending.length > 1 ? 's' : ''} à classer
          </p>
          {pending.map(item => (
            <button
              key={item.id}
              type="button"
              onClick={() => setSelected(item)}
              className="w-full text-left flex items-center gap-3 p-3 rounded-xl border border-neya-border hover:border-neya-orange hover:bg-neya-orange/5 transition-colors"
            >
              {item.receipt_url && (
                <img
                  src={resolveUploadUrl(item.receipt_url)}
                  alt=""
                  className="w-14 h-14 rounded-lg object-cover border border-neya-border shrink-0"
                />
              )}
              <div className="min-w-0 flex-1">
                <p className="font-medium text-sm truncate">{item.vendor || 'Ticket'}</p>
                <p className="text-xs text-neya-muted truncate">{item.description || '—'}</p>
                <p className="text-[11px] text-neya-orange font-medium mt-0.5">Toucher pour choisir le projet →</p>
              </div>
              <div className="text-right shrink-0">
                <p className="font-semibold text-sm tabular-nums">{item.amount != null ? formatMoney(item.amount) : '?'}</p>
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
          onClose={() => { setSelected(null); setHint(''); }}
          onDone={() => { load(); setHint('Dépense créée.'); }}
        />
      )}
    </div>
  );
}

'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  api,
  downloadPdf,
  formatDate,
  formatMoney,
  getApiUrl,
  getToken,
  QUOTE_STATUS,
  resolveUploadUrl,
} from '../lib/api';

function formatSize(n) {
  const size = Number(n) || 0;
  if (!size) return '';
  if (size < 1024) return `${size} o`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} Ko`;
  return `${(size / (1024 * 1024)).toFixed(1)} Mo`;
}

async function openAuthUrl(path, { downloadName } = {}) {
  const token = getToken();
  const res = await fetch(`${getApiUrl()}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Erreur ${res.status}`);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  if (downloadName) {
    const a = document.createElement('a');
    a.href = url;
    a.download = downloadName;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } else {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
  setTimeout(() => URL.revokeObjectURL(url), 120000);
}

export default function ProjectDocumentsPanel({ project, onReload }) {
  const router = useRouter();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [creatingQuote, setCreatingQuote] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [linkQuotes, setLinkQuotes] = useState([]);
  const [linkId, setLinkId] = useState('');
  const [linking, setLinking] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const docs = await api(`/projects/${project.id}/documents`);
      setData(docs);
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }, [project.id]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!project.client_id) {
      setLinkQuotes([]);
      return;
    }
    api(`/invoices/quotes?client_id=${project.client_id}`)
      .then((rows) => {
        setLinkQuotes((rows || []).filter(q => !q.project_id || Number(q.project_id) === Number(project.id)));
      })
      .catch(() => setLinkQuotes([]));
  }, [project.client_id, project.id]);

  async function createQuote() {
    if (!project.client_id) {
      setErr('Liez d’abord un client au projet pour créer un devis.');
      return;
    }
    setCreatingQuote(true);
    setErr('');
    try {
      const quote = await api('/invoices/quotes', {
        method: 'POST',
        body: JSON.stringify({
          client_id: project.client_id,
          project_id: project.id,
          title: project.name || 'Devis',
          lines: [{ description: project.name || 'Fabrication', qty: 1, price: 0 }],
        }),
      });
      router.push(`/invoices/quotes/${quote.id}`);
    } catch (e) {
      setErr(e.message);
    } finally {
      setCreatingQuote(false);
    }
  }

  async function linkExistingQuote() {
    if (!linkId) return;
    setLinking(true);
    setErr('');
    try {
      await api(`/invoices/quotes/${linkId}`, {
        method: 'PUT',
        body: JSON.stringify({ project_id: project.id }),
      });
      setLinkId('');
      setMsg('Devis lié au projet.');
      await load();
      onReload?.();
    } catch (e) {
      setErr(e.message);
    } finally {
      setLinking(false);
    }
  }

  async function scanMails() {
    setScanning(true);
    setErr('');
    setMsg('');
    try {
      const result = await api(`/projects/${project.id}/documents/scan-mail`, {
        method: 'POST',
        body: JSON.stringify({ auto_file: true }),
      });
      const nFound = result.found?.length || 0;
      const nFiled = result.filed?.length || 0;
      setMsg(
        nFound === 0
          ? `Aucun document trouvé dans ${result.scanned_messages || 0} mail(s) lié(s). Liez des courriels dans l’onglet Courriel.`
          : `${nFound} document(s) trouvé(s) · ${nFiled} classé(s) dans le projet.`
      );
      await load();
      onReload?.();
    } catch (e) {
      setErr(e.message);
    } finally {
      setScanning(false);
    }
  }

  async function openMailAttachment(file) {
    try {
      const isSkp = /\.skp$/i.test(file.name || file.url || '') || /sketchup/i.test(file.mimeType || '');
      if (file.drive_web_view && !isSkp) {
        window.open(file.drive_web_view, '_blank', 'noopener,noreferrer');
        return;
      }
      if (file.url?.startsWith('/uploads/')) {
        if (isSkp) {
          const token = getToken();
          const res = await fetch(resolveUploadUrl(file.url), {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
          });
          if (!res.ok) throw new Error(`Erreur ${res.status}`);
          const blob = await res.blob();
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = file.name || 'modele.skp';
          document.body.appendChild(a);
          a.click();
          a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 60_000);
          return;
        }
        window.open(resolveUploadUrl(file.url), '_blank', 'noopener,noreferrer');
        return;
      }
      if (file.gmail_message_id && file.gmail_attachment_id) {
        await openAuthUrl(
          `/gmail/messages/${encodeURIComponent(file.gmail_message_id)}/attachments/${encodeURIComponent(file.gmail_attachment_id)}${isSkp ? '' : '?inline=1'}`,
          isSkp ? { downloadName: file.name || 'modele.skp' } : undefined
        );
        return;
      }
      setErr('Impossible d’ouvrir ce fichier.');
    } catch (e) {
      setErr(e.message);
    }
  }

  if (loading && !data) {
    return <p className="text-sm text-neya-muted py-8 text-center">Chargement des documents…</p>;
  }

  const quotes = data?.quotes || [];
  const mailFiles = data?.mail_files || [];
  const plans = data?.plans || [];
  const sketchupFiles = data?.sketchup_files || [];
  const emails = data?.emails || [];
  const unlinkedClientQuotes = linkQuotes.filter(q => !q.project_id);

  return (
    <div className="space-y-8">
      {err && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{err}</div>
      )}
      {msg && (
        <div className="rounded-xl border border-neya-border bg-neya-surface px-4 py-3 text-sm text-neya-ink">{msg}</div>
      )}

      {/* Devis */}
      <section className="card space-y-4 rounded-2xl">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-semibold text-neya-ink">Devis</h2>
            <p className="text-sm text-neya-muted">Devis liés à ce projet — PDF et fiche devis.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-primary text-sm" disabled={creatingQuote || !project.client_id} onClick={createQuote}>
              {creatingQuote ? 'Création…' : '+ Nouveau devis'}
            </button>
          </div>
        </div>

        {!project.client_id && (
          <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            Liez un client (vue d’ensemble) pour créer ou rattacher un devis.
          </p>
        )}

        {unlinkedClientQuotes.length > 0 && (
          <div className="flex flex-wrap gap-2 items-end border border-neya-border rounded-xl p-3 bg-neya-surface/40">
            <label className="flex-1 min-w-[200px]">
              <span className="label">Rattacher un devis du client</span>
              <select className="input text-sm mt-1" value={linkId} onChange={e => setLinkId(e.target.value)}>
                <option value="">— Choisir —</option>
                {unlinkedClientQuotes.map(q => (
                  <option key={q.id} value={q.id}>
                    {q.quote_number} — {q.title || 'Sans titre'} ({formatMoney(q.total)})
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className="btn-secondary text-sm min-h-[40px]" disabled={!linkId || linking} onClick={linkExistingQuote}>
              {linking ? '…' : 'Lier'}
            </button>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neya-border text-left text-neya-muted">
                <th className="pb-2 pr-3">N°</th>
                <th className="pb-2 pr-3">Titre</th>
                <th className="pb-2 pr-3">Date</th>
                <th className="pb-2 pr-3">Total</th>
                <th className="pb-2 pr-3">Statut</th>
                <th className="pb-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {!quotes.length ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-neya-muted">Aucun devis lié</td>
                </tr>
              ) : quotes.map(q => {
                const st = QUOTE_STATUS[q.status] || QUOTE_STATUS.draft;
                return (
                  <tr key={q.id} className="border-b border-neya-border/60">
                    <td className="py-3 pr-3">
                      <Link href={`/invoices/quotes/${q.id}`} className="text-neya-orange font-medium hover:underline">
                        {q.quote_number}
                      </Link>
                    </td>
                    <td className="py-3 pr-3">{q.title || '—'}</td>
                    <td className="py-3 pr-3 text-neya-muted">{formatDate(q.created_at)}</td>
                    <td className="py-3 pr-3 font-medium">{formatMoney(q.total)}</td>
                    <td className="py-3 pr-3">
                      <span className={`text-xs px-2 py-0.5 rounded ${st.color}`}>{st.label}</span>
                    </td>
                    <td className="py-3">
                      <div className="flex flex-wrap gap-2">
                        <Link href={`/invoices/quotes/${q.id}`} className="text-xs font-medium text-neya-ink hover:underline">
                          Ouvrir
                        </Link>
                        <button
                          type="button"
                          className="text-xs font-medium text-neya-orange hover:underline"
                          onClick={() => downloadPdf(`/invoices/quotes/${q.id}/pdf`, `devis-${q.quote_number}.pdf`)}
                        >
                          PDF
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Docs depuis les mails */}
      <section className="card space-y-4 rounded-2xl">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-semibold text-neya-ink">Documents depuis les mails</h2>
            <p className="text-sm text-neya-muted">
              PDF / devis / plans trouvés dans les courriels liés ({emails.length} mail(s) lié(s)).
            </p>
          </div>
          <button type="button" className="btn-secondary text-sm" disabled={scanning} onClick={scanMails}>
            {scanning ? 'Recherche…' : 'Chercher dans les mails'}
          </button>
        </div>

        {!mailFiles.length ? (
          <p className="text-sm text-neya-muted py-4 text-center border border-dashed border-neya-border rounded-xl">
            Aucun fichier classé. Liez des mails (onglet Courriel), ouvrez une PJ, ou cliquez « Chercher dans les mails ».
          </p>
        ) : (
          <ul className="space-y-2">
            {mailFiles.map((f, i) => (
              <li
                key={f.id || `${f.gmail_attachment_id || f.url}-${i}`}
                className="flex items-center gap-3 rounded-xl border border-neya-border bg-neya-surface/50 px-3 py-2.5"
              >
                <span className="text-lg" aria-hidden>📄</span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-neya-ink truncate">{f.name || 'Document'}</p>
                  <p className="text-[11px] text-neya-muted truncate">
                    {[f.source_subject, f.size_label || formatSize(f.size), f.filed_at && formatDate(f.filed_at)]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                </div>
                <button
                  type="button"
                  className="btn-secondary text-xs min-h-[32px] shrink-0"
                  onClick={() => openMailAttachment(f)}
                >
                  Ouvrir
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Plans résumé */}
      {plans.length > 0 && (
        <section className="card space-y-3 rounded-2xl">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-display text-lg font-semibold text-neya-ink">Plans ({plans.length})</h2>
            <Link href={`?tab=plans`} className="text-xs font-medium text-neya-orange hover:underline">
              Voir l’onglet Plans →
            </Link>
          </div>
          <ul className="grid gap-2 sm:grid-cols-2">
            {plans.slice(0, 6).map((p, i) => (
              <li key={p.id || i}>
                <a
                  href={resolveUploadUrl(p.url)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block rounded-lg border border-neya-border px-3 py-2 text-sm hover:border-neya-orange"
                >
                  {p.name || `Plan ${i + 1}`}
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      {sketchupFiles.length > 0 && (
        <section className="card space-y-3 rounded-2xl">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-display text-lg font-semibold text-neya-ink">
              SketchUp ({sketchupFiles.length})
            </h2>
            <Link href={`?tab=plans`} className="text-xs font-medium text-neya-orange hover:underline">
              Gérer →
            </Link>
          </div>
          <ul className="space-y-2">
            {sketchupFiles.map((f, i) => (
              <li
                key={f.id || i}
                className="flex items-center gap-3 rounded-xl border border-neya-border px-3 py-2.5"
              >
                <span className="text-xs font-bold text-neya-ink">SKP</span>
                <p className="min-w-0 flex-1 truncate text-sm font-medium text-neya-ink">{f.name}</p>
                <Link
                  href={`?tab=plans`}
                  className="btn-secondary text-xs min-h-[32px] shrink-0 inline-flex items-center"
                >
                  Ouvrir
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

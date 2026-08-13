'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Sparkles } from 'lucide-react';
import AppShell from '../../../../components/AppShell';
import AuthGuard from '../../../../components/AuthGuard';
import DocumentVisualEditor, { serializeQuoteDocument } from '../../../../components/DocumentVisualEditor';
import SendDocumentModal from '../../../../components/SendDocumentModal';
import DocumentPdfPreviewModal from '../../../../components/DocumentPdfPreviewModal';
import {
  api, formatMoney, QUOTE_STATUS, downloadPdf, getToken, getApiUrl,
} from '../../../../lib/api';
import { useRegisterChatContext } from '../../../../lib/chat-context';

const PRICE_VERDICT = {
  ok: { label: 'Cohérent', className: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
  low: { label: 'Trop bas', className: 'bg-amber-50 text-amber-900 border-amber-200' },
  high: { label: 'Trop cher', className: 'bg-red-50 text-red-800 border-red-200' },
  mixed: { label: 'Mitigé', className: 'bg-neya-cream text-neya-ink border-neya-border' },
};

function PriceReviewPanel({ review }) {
  const overall = PRICE_VERDICT[review.overall] || PRICE_VERDICT.ok;
  return (
    <div className="space-y-3 mb-3">
      <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${overall.className}`}>
        {overall.label}
      </span>
      {review.summary && <p className="text-xs text-neya-ink leading-relaxed">{review.summary}</p>}
      {review.total_comment && (
        <p className="text-[11px] text-neya-muted">{review.total_comment}</p>
      )}
      <ul className="space-y-2 max-h-[320px] overflow-y-auto">
        {(review.lines || []).map((line, i) => {
          const st = PRICE_VERDICT[line.verdict] || PRICE_VERDICT.ok;
          return (
            <li key={i} className="border border-neya-border p-2 text-xs">
              <div className="flex items-start justify-between gap-2">
                <p className="font-medium text-neya-ink min-w-0">{line.description || '—'}</p>
                <span className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${st.className}`}>
                  {st.label}
                </span>
              </div>
              <p className="text-neya-muted mt-1 tabular-nums">
                {formatMoney(line.unit_price)}
                {line.suggested_price != null ? ` → ${formatMoney(line.suggested_price)}` : ''}
              </p>
              {line.reason && <p className="mt-1 text-neya-ink-light">{line.reason}</p>}
              {line.comparable && <p className="mt-0.5 text-[10px] text-neya-muted">{line.comparable}</p>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default function QuoteDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const [quote, setQuote] = useState(null);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [showSend, setShowSend] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [convertForm, setConvertForm] = useState(null);
  const [converting, setConverting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [clients, setClients] = useState([]);
  const [clientSaving, setClientSaving] = useState(false);
  const [spellchecking, setSpellchecking] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [priceReview, setPriceReview] = useState(null);
  const [editorRev, setEditorRev] = useState(0);

  function load() {
    if (!id) return;
    api(`/invoices/quotes/${id}`)
      .then(setQuote)
      .catch(() => setError('Devis introuvable'));
  }

  useEffect(() => { load(); }, [id]);

  useEffect(() => {
    api('/clients').then(setClients).catch(() => setClients([]));
  }, []);

  useRegisterChatContext(quote ? {
    type: 'quote',
    id: quote.id,
    label: quote.title || quote.quote_number,
    meta: {
      quote_number: quote.quote_number,
      client_name: quote.client_name,
      status: quote.status,
      total: quote.total,
    },
  } : null);

  useEffect(() => {
    const onAction = (e) => {
      const types = (e.detail || []).map(a => a.type);
      if (types.some(t => ['update_quote', 'create_quote', 'send_quote', 'convert_quote', 'memory_saved'].includes(t))) {
        load();
      }
    };
    window.addEventListener('neya:assistant-action', onAction);
    return () => window.removeEventListener('neya:assistant-action', onAction);
  }, [id]);

  function showToast(msg) {
    setToast(msg);
    setTimeout(() => setToast(''), 4000);
  }

  async function updateStatus(status) {
    await api(`/invoices/quotes/${id}`, { method: 'PUT', body: JSON.stringify({ status }) });
    load();
    showToast('Statut mis à jour');
  }

  async function updateClient(clientId) {
    const nextId = clientId ? Number(clientId) : null;
    if (nextId === quote?.client_id) return;
    setClientSaving(true);
    try {
      const updated = await api(`/invoices/quotes/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ client_id: nextId }),
      });
      setQuote(updated);
      showToast('Client mis à jour');
    } catch (err) {
      showToast(err.message || 'Impossible de changer le client');
    } finally {
      setClientSaving(false);
    }
  }

  async function spellcheckQuote() {
    setSpellchecking(true);
    try {
      const result = await api(`/invoices/quotes/${id}/spellcheck`, { method: 'POST', timeoutMs: 90000 });
      if (result.quote) setQuote(result.quote);
      else load();
      setEditorRev(n => n + 1);
      const n = result.changes?.length || 0;
      showToast(result.unchanged || n === 0
        ? 'Aucune faute détectée'
        : `${n} correction${n > 1 ? 's' : ''} appliquée${n > 1 ? 's' : ''}`);
    } catch (err) {
      showToast(err.message || 'Correction impossible');
    } finally {
      setSpellchecking(false);
    }
  }

  async function reviewPrices() {
    setReviewing(true);
    try {
      const result = await api(`/invoices/quotes/${id}/price-review`, { method: 'POST', timeoutMs: 90000 });
      setPriceReview(result);
    } catch (err) {
      showToast(err.message || 'Analyse impossible');
    } finally {
      setReviewing(false);
    }
  }

  async function saveDocument(draft) {
    setSaving(true);
    try {
      const document = serializeQuoteDocument({
        sections: draft.sections,
        photos: draft.photos,
        additional_notes: draft.additional_notes,
        options: draft.options,
      });
      await api(`/invoices/quotes/${id}`, {
        method: 'PUT',
        body: JSON.stringify({
          title: draft.title,
          reference: draft.subtitle || null,
          notes: draft.notes,
          valid_until: draft.valid_until || null,
          acceptance_date: draft.acceptance_date || null,
          additional_notes: draft.additional_notes || null,
          document,
        }),
      });
      load();
      showToast('Devis enregistré');
    } catch (err) {
      showToast(err.message);
      throw err;
    } finally {
      setSaving(false);
    }
  }

  async function uploadPhotos(files) {
    const uploaded = [];
    for (const file of files) {
      const form = new FormData();
      form.append('photo', file);
      const res = await fetch(`${getApiUrl()}/invoices/quotes/${id}/photos`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${getToken()}` },
        body: form,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`);
      uploaded.push({ url: data.url, caption: data.caption || '' });
    }
    return uploaded;
  }

  async function handlePdf() {
    setPdfLoading(true);
    try {
      await downloadPdf(`/invoices/quotes/${id}/pdf`, `devis-${quote.quote_number}.pdf`);
    } catch (err) {
      showToast(err.message);
    } finally {
      setPdfLoading(false);
    }
  }

  async function confirmConvert(e) {
    e.preventDefault();
    setConverting(true);
    try {
      const inv = await api(`/invoices/from-quote/${id}`, {
        method: 'POST',
        body: JSON.stringify({
          deposit_percent: Number(convertForm.deposit_percent),
          subtitle: convertForm.subtitle,
        }),
      });
      setConvertForm(null);
      showToast(`Facture #${inv.invoice_number} créée`);
      router.push(`/invoices/${inv.id}`);
    } catch (err) {
      showToast(err.message);
    } finally {
      setConverting(false);
    }
  }

  if (error) {
    return (
      <AuthGuard>
        <AppShell title="Devis">
          <p className="text-neya-muted mb-4">{error}</p>
          <Link href="/invoices" className="btn-secondary">Retour à la facturation</Link>
        </AppShell>
      </AuthGuard>
    );
  }

  if (!quote) {
    return (
      <AuthGuard>
        <AppShell title="Devis">
          <p className="text-neya-muted">Chargement…</p>
        </AppShell>
      </AuthGuard>
    );
  }

  const st = QUOTE_STATUS[quote.status] || { label: quote.status, color: 'bg-gray-100 text-gray-700' };

  return (
    <AuthGuard>
      <AppShell title={`Devis ${quote.quote_number}`} wide>
        {toast && (
          <div className="fixed top-4 right-4 z-50 bg-neya-ink text-white px-4 py-2 text-sm">
            {toast}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
          <Link href="/invoices" className="text-sm text-neya-muted hover:text-neya-ink">
            ← Facturation
          </Link>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={quote.status}
              onChange={e => updateStatus(e.target.value)}
              className={`text-xs px-3 py-1.5 border-0 ${st.color}`}
            >
              <option value="draft">Brouillon</option>
              <option value="sent">Envoyé</option>
              <option value="accepted">Accepté</option>
              <option value="rejected">Refusé</option>
            </select>
            <button type="button" onClick={spellcheckQuote} disabled={spellchecking} className="btn-secondary text-sm min-h-[36px] gap-1.5" title="Corrige l’orthographe du devis enregistré">
              <Sparkles className="h-3.5 w-3.5" />
              {spellchecking ? 'Correction…' : 'Corriger les fautes'}
            </button>
            <button type="button" onClick={reviewPrices} disabled={reviewing} className="btn-secondary text-sm min-h-[36px]">
              {reviewing ? 'Analyse…' : 'Analyser les prix'}
            </button>
            <button type="button" onClick={() => setShowPreview(true)} className="btn-secondary text-sm min-h-[36px]">
              Prévisualiser
            </button>
            <button type="button" onClick={handlePdf} disabled={pdfLoading} className="btn-secondary text-sm min-h-[36px]">
              {pdfLoading ? 'PDF…' : 'Télécharger PDF'}
            </button>
            <button type="button" onClick={() => setShowSend(true)} className="btn-primary text-sm min-h-[36px]">
              Envoyer par courriel
            </button>
            {quote.invoice_id ? (
              <Link href={`/invoices/${quote.invoice_id}`} className="btn-secondary text-sm min-h-[36px] flex items-center">
                → Facture #{quote.invoice_number}
              </Link>
            ) : (
              <button
                type="button"
                onClick={() => setConvertForm({
                  deposit_percent: 100,
                  subtitle: '',
                  subtotal: quote.subtotal,
                })}
                className="btn-secondary text-sm min-h-[36px]"
              >
                Convertir
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_280px] gap-8 items-start">
          <DocumentVisualEditor
            key={`${quote.id}-${editorRev}`}
            kind="quote"
            numberLabel={quote.quote_number}
            statusLabel={st.label}
            clientName={quote.client_name}
            clientHref={quote.client_id ? `/clients/${quote.client_id}` : null}
            client={{
              contact: quote.contact,
              email: quote.email,
              phone: quote.client_phone,
              address: quote.client_address,
              city: quote.client_city,
            }}
            companyPayment={quote.company_payment}
            quoteTerms={quote.quote_terms}
            value={quote}
            onSave={saveDocument}
            onUploadPhotos={uploadPhotos}
            saving={saving}
          />

          <aside className="space-y-6">
            <div className="border border-neya-border p-4">
              <h2 className="text-sm font-semibold mb-3">Client</h2>
              <select
                className="input text-sm w-full"
                value={quote.client_id || ''}
                disabled={clientSaving}
                onChange={e => updateClient(e.target.value)}
              >
                <option value="">— Aucun client —</option>
                {clients.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              {quote.client_id && (
                <Link
                  href={`/clients/${quote.client_id}`}
                  className="inline-block text-xs text-neya-orange hover:underline mt-2"
                >
                  Voir la fiche client →
                </Link>
              )}
              {clientSaving && (
                <p className="text-xs text-neya-muted mt-2">Mise à jour…</p>
              )}
            </div>

            <div className="border border-neya-border p-4">
              <h2 className="text-sm font-semibold mb-2">Prix (IA)</h2>
              {!priceReview && (
                <p className="text-xs text-neya-muted mb-3">
                  Vérifie si les lignes sont trop basses, cohérentes ou trop chères. Les montants ne sont pas modifiés.
                </p>
              )}
              {priceReview && (
                <PriceReviewPanel review={priceReview} />
              )}
              <button
                type="button"
                onClick={reviewPrices}
                disabled={reviewing}
                className="btn-secondary text-sm w-full mt-2"
              >
                {reviewing ? 'Analyse…' : priceReview ? 'Relancer l’analyse' : 'Analyser les prix'}
              </button>
            </div>
          </aside>
        </div>

        {convertForm && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
            <form onSubmit={confirmConvert} className="bg-white p-6 w-full max-w-md shadow-xl border border-neya-border">
              <h3 className="font-heading text-lg mb-4">Convertir en facture</h3>
              <div className="space-y-4 mb-6">
                <div>
                  <label className="label">Type de facture</label>
                  <div className="flex gap-2">
                    {[
                      { pct: 100, label: 'Complète' },
                      { pct: 50, label: 'Acompte 50%' },
                      { pct: 30, label: 'Acompte 30%' },
                    ].map(opt => (
                      <button key={opt.pct} type="button"
                        onClick={() => setConvertForm({
                          ...convertForm,
                          deposit_percent: opt.pct,
                          subtitle: opt.pct < 100 ? `${opt.pct}% Deposit · ${quote.title || 'Order'}` : '',
                        })}
                        className={`flex-1 py-2 text-sm border ${
                          convertForm.deposit_percent === opt.pct
                            ? 'bg-neya-orange text-white border-neya-orange'
                            : 'bg-white border-neya-border'
                        }`}>
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
                {convertForm.deposit_percent < 100 && (
                  <div>
                    <label className="label">Sous-titre facture</label>
                    <input className="input" value={convertForm.subtitle}
                      onChange={e => setConvertForm({ ...convertForm, subtitle: e.target.value })} />
                  </div>
                )}
                <div className="bg-neya-surface p-3 text-sm">
                  <p className="text-neya-muted">Montant estimé (TTC)</p>
                  <p className="font-heading text-xl text-neya-orange">
                    {formatMoney((Number(convertForm.subtotal) || 0) * (convertForm.deposit_percent / 100) * 1.14975)}
                  </p>
                </div>
              </div>
              <div className="flex gap-2">
                <button type="submit" disabled={converting} className="btn-primary flex-1">
                  {converting ? 'Création…' : 'Créer la facture'}
                </button>
                <button type="button" onClick={() => setConvertForm(null)} className="btn-secondary">Annuler</button>
              </div>
            </form>
          </div>
        )}

        {showSend && (
          <SendDocumentModal
            type="quote"
            docId={id}
            onClose={() => setShowSend(false)}
            onSent={() => {
              showToast('Devis envoyé par courriel');
              load();
            }}
          />
        )}

        {showPreview && (
          <DocumentPdfPreviewModal
            type="quote"
            docId={id}
            title={`Devis ${quote.quote_number}${quote.client_name ? ` · ${quote.client_name}` : ''}`}
            filename={`devis-${quote.quote_number}.pdf`}
            onClose={() => setShowPreview(false)}
          />
        )}
      </AppShell>
    </AuthGuard>
  );
}

'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import AppShell from '../../../../components/AppShell';
import AuthGuard from '../../../../components/AuthGuard';
import DocumentVisualEditor, { serializeQuoteDocument } from '../../../../components/DocumentVisualEditor';
import SendDocumentModal from '../../../../components/SendDocumentModal';
import {
  api, formatMoney, QUOTE_STATUS, downloadPdf, getToken, getApiUrl,
} from '../../../../lib/api';
import { useRegisterChatContext } from '../../../../lib/chat-context';

export default function QuoteDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const [quote, setQuote] = useState(null);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [showSend, setShowSend] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [convertForm, setConvertForm] = useState(null);
  const [converting, setConverting] = useState(false);
  const [saving, setSaving] = useState(false);

  function load() {
    if (!id) return;
    api(`/invoices/quotes/${id}`)
      .then(setQuote)
      .catch(() => setError('Devis introuvable'));
  }

  useEffect(() => { load(); }, [id]);

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
    try {
      await api(`/invoices/quotes/${id}`, { method: 'PUT', body: JSON.stringify({ status }) });
      load();
      showToast('Statut mis à jour');
    } catch (err) {
      showToast(err.message || 'Statut non mis à jour');
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

        <DocumentVisualEditor
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
      </AppShell>
    </AuthGuard>
  );
}

'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import AppShell from '../../../components/AppShell';
import AuthGuard from '../../../components/AuthGuard';
import InvoicePaymentModal, { paymentMethodLabel } from '../../../components/InvoicePaymentModal';
import DocumentVisualEditor, { serializeQuoteDocument } from '../../../components/DocumentVisualEditor';
import SendDocumentModal from '../../../components/SendDocumentModal';
import DocumentPdfPreviewModal from '../../../components/DocumentPdfPreviewModal';
import {
  api, formatMoney, formatDate, INVOICE_STATUS, downloadPdf,
} from '../../../lib/api';
import { useRegisterChatContext } from '../../../lib/chat-context';
import { flattenQuoteLines } from '../../../lib/quote-document';
import { finalizeDecimal } from '../../../lib/parse-decimal';

function parseLines(lines) {
  if (!lines) return [];
  if (typeof lines === 'string') {
    try { return JSON.parse(lines); } catch { return []; }
  }
  return lines;
}

export default function InvoiceDetailPage() {
  const { id } = useParams();
  const [invoice, setInvoice] = useState(null);
  const [payments, setPayments] = useState([]);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [showSend, setShowSend] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [showPayment, setShowPayment] = useState(false);
  const [saving, setSaving] = useState(false);
  const [clients, setClients] = useState([]);
  const [clientSaving, setClientSaving] = useState(false);

  const load = useCallback(() => {
    if (!id) return;
    api(`/invoices/${id}`)
      .then(setInvoice)
      .catch(() => setError('Facture introuvable'));
    api(`/payments?invoice_id=${id}`)
      .then(setPayments)
      .catch(() => setPayments([]));
  }, [id]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    api('/clients').then(setClients).catch(() => setClients([]));
  }, []);

  useRegisterChatContext(invoice ? {
    type: 'invoice',
    id: invoice.id,
    label: invoice.title || invoice.invoice_number,
    meta: {
      invoice_number: invoice.invoice_number,
      client_name: invoice.client_name,
      status: invoice.status,
      total: invoice.total,
    },
  } : null);

  useEffect(() => {
    const onAction = (e) => {
      const types = (e.detail || []).map(a => a.type);
      if (types.some(t => ['update_invoice', 'create_invoice', 'send_invoice', 'demande_modification_erp'].includes(t))) {
        load();
      }
    };
    window.addEventListener('neya:assistant-action', onAction);
    return () => window.removeEventListener('neya:assistant-action', onAction);
  }, [load]);

  function showToast(msg) {
    setToast(msg);
    setTimeout(() => setToast(''), 4000);
  }

  async function handlePdf() {
    setPdfLoading(true);
    try {
      await downloadPdf(`/invoices/${id}/pdf`, `facture-${invoice.invoice_number}.pdf`);
    } catch (err) {
      showToast(err.message);
    } finally {
      setPdfLoading(false);
    }
  }

  async function submitPayment(payload) {
    await api('/payments', { method: 'POST', body: JSON.stringify(payload) });
    setShowPayment(false);
    load();
    showToast('Paiement enregistré');
  }

  async function removePayment(paymentId) {
    if (!confirm('Supprimer ce paiement ?')) return;
    try {
      await api(`/payments/${paymentId}`, { method: 'DELETE' });
      load();
      showToast('Paiement supprimé');
    } catch (err) {
      showToast(err.message);
    }
  }

  async function updateClient(clientId) {
    const nextId = clientId ? Number(clientId) : null;
    if (nextId === invoice?.client_id) return;
    setClientSaving(true);
    try {
      const updated = await api(`/invoices/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ client_id: nextId }),
      });
      setInvoice(updated);
      showToast('Client mis à jour');
    } catch (err) {
      showToast(err.message || 'Impossible de changer le client');
    } finally {
      setClientSaving(false);
    }
  }

  async function saveDocument(draft) {
    setSaving(true);
    try {
      const document = serializeQuoteDocument({
        sections: draft.sections,
      });
      // Une seule section sans titre → tableau plat (compat installation-billing / anciennes factures)
      const multi = (document.sections || []).length > 1
        || (document.sections || []).some(s => String(s.title || '').trim());
      const lines = multi
        ? document
        : flattenQuoteLines(document).map(l => ({
          description: String(l.description || '').trim(),
          qty: finalizeDecimal(l.qty, 1),
          price: finalizeDecimal(l.price, 0),
        }));
      const payloadLines = Array.isArray(lines) && !lines.length
        ? [{ description: '', qty: 1, price: 0 }]
        : lines;
      await api(`/invoices/${id}`, {
        method: 'PUT',
        body: JSON.stringify({
          title: draft.title,
          subtitle: draft.subtitle,
          notes: draft.notes,
          order_summary: draft.notes,
          due_date: draft.due_date || null,
          lines: payloadLines,
        }),
      });
      load();
      showToast('Facture enregistrée');
    } catch (err) {
      showToast(err.message);
      throw err;
    } finally {
      setSaving(false);
    }
  }

  if (error) {
    return (
      <AuthGuard>
        <AppShell title="Facture">
          <p className="text-neya-muted mb-4">{error}</p>
          <Link href="/invoices" className="btn-secondary">Retour à la facturation</Link>
        </AppShell>
      </AuthGuard>
    );
  }

  if (!invoice) {
    return (
      <AuthGuard>
        <AppShell title="Facture">
          <p className="text-neya-muted">Chargement…</p>
        </AppShell>
      </AuthGuard>
    );
  }

  const st = INVOICE_STATUS[invoice.status] || { label: invoice.status, color: 'bg-gray-100 text-gray-700' };
  const paid = Number(invoice.amount_paid) || 0;
  const balance = Math.max(0, Math.round(((Number(invoice.total) || 0) - paid) * 100) / 100);
  const paidPct = (Number(invoice.total) || 0) > 0
    ? Math.min(100, Math.round((paid / Number(invoice.total)) * 100))
    : 0;

  const editorValue = {
    title: invoice.title,
    subtitle: invoice.subtitle,
    notes: invoice.order_summary || invoice.notes,
    due_date: invoice.due_date,
    lines: parseLines(invoice.lines),
  };

  return (
    <AuthGuard>
      <AppShell title={`Facture ${invoice.invoice_number}`} wide>
        {toast && (
          <div className="fixed top-4 right-4 z-50 bg-neya-ink text-white px-4 py-2 text-sm">
            {toast}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
          <Link href="/invoices" className="text-sm text-neya-muted hover:text-neya-ink">
            ← Facturation
          </Link>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setShowPreview(true)} className="btn-secondary text-sm min-h-[36px]">
              Prévisualiser
            </button>
            <button type="button" onClick={handlePdf} disabled={pdfLoading} className="btn-secondary text-sm min-h-[36px]">
              {pdfLoading ? 'PDF…' : 'Télécharger PDF'}
            </button>
            <button type="button" onClick={() => setShowSend(true)} className="btn-primary text-sm min-h-[36px]">
              Envoyer par courriel
            </button>
            {balance > 0 && (
              <button type="button" onClick={() => setShowPayment(true)} className="btn-secondary text-sm min-h-[36px]">
                Paiement
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_280px] gap-8 items-start">
          <DocumentVisualEditor
            kind="invoice"
            numberLabel={invoice.invoice_number}
            statusLabel={st.label}
            clientName={invoice.client_name}
            clientHref={invoice.client_id ? `/clients/${invoice.client_id}` : null}
            client={{
              contact: invoice.contact,
              email: invoice.email,
              phone: invoice.client_phone || invoice.phone,
              address: invoice.client_address,
              city: invoice.client_city,
            }}
            value={editorValue}
            onSave={saveDocument}
            saving={saving}
          />

          <aside className="space-y-6">
            <div className="border border-neya-border p-4">
              <h2 className="text-sm font-semibold mb-3">Client</h2>
              <select
                className="input text-sm w-full"
                value={invoice.client_id || ''}
                disabled={clientSaving}
                onChange={e => updateClient(e.target.value)}
              >
                <option value="">— Aucun client —</option>
                {clients.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              {invoice.client_id && (
                <Link
                  href={`/clients/${invoice.client_id}`}
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
              <h2 className="text-sm font-semibold mb-3">Paiements</h2>
              <div className="space-y-2 text-sm mb-3">
                <div className="flex justify-between"><span className="text-neya-muted">Total</span><span className="tabular-nums font-medium">{formatMoney(invoice.total)}</span></div>
                <div className="flex justify-between"><span className="text-neya-muted">Payé</span><span className="tabular-nums text-neya-success">{formatMoney(paid)}</span></div>
                <div className="flex justify-between"><span className="text-neya-muted">Reste</span><span className={`tabular-nums font-medium ${balance > 0 ? 'text-neya-error' : 'text-neya-success'}`}>{formatMoney(balance)}</span></div>
              </div>
              <div className="h-1.5 bg-neya-border overflow-hidden mb-1">
                <div className={`h-full ${balance <= 0 ? 'bg-neya-success' : 'bg-neya-ink'}`} style={{ width: `${paidPct}%` }} />
              </div>
              <p className="text-[11px] text-neya-muted mb-3">{paidPct}% · créé {formatDate(invoice.created_at)}</p>

              {payments.length === 0 ? (
                <p className="text-xs text-neya-muted">Aucun paiement</p>
              ) : (
                <ul className="divide-y divide-neya-border border border-neya-border">
                  {payments.map(p => (
                    <li key={p.id} className="flex justify-between gap-2 px-2.5 py-2 text-xs">
                      <div>
                        <p className="font-medium">{formatMoney(p.amount)}</p>
                        <p className="text-neya-muted">{formatDate(p.date)} · {paymentMethodLabel(p.method)}</p>
                      </div>
                      <button type="button" onClick={() => removePayment(p.id)} className="text-neya-muted hover:text-neya-error">✕</button>
                    </li>
                  ))}
                </ul>
              )}

              {invoice.quote_id && (
                <Link href={`/invoices/quotes/${invoice.quote_id}`} className="dash-link inline-block mt-3">
                  Devis source →
                </Link>
              )}
            </div>
          </aside>
        </div>

        {showPayment && (
          <InvoicePaymentModal
            invoice={invoice}
            onClose={() => setShowPayment(false)}
            onSubmit={submitPayment}
          />
        )}

        {showSend && (
          <SendDocumentModal
            type="invoice"
            docId={id}
            onClose={() => setShowSend(false)}
            onSent={() => {
              showToast('Facture envoyée par courriel');
              load();
            }}
          />
        )}

        {showPreview && (
          <DocumentPdfPreviewModal
            type="invoice"
            docId={id}
            title={`Facture ${invoice.invoice_number}${invoice.client_name ? ` · ${invoice.client_name}` : ''}`}
            filename={`facture-${invoice.invoice_number}.pdf`}
            onClose={() => setShowPreview(false)}
          />
        )}
      </AppShell>
    </AuthGuard>
  );
}

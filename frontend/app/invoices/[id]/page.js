'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import AppShell from '../../../components/AppShell';
import AuthGuard from '../../../components/AuthGuard';
import {
  api, formatMoney, formatDate, INVOICE_STATUS, downloadPdf, calcTaxes,
} from '../../../lib/api';

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
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [sending, setSending] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [paymentForm, setPaymentForm] = useState(null);

  function load() {
    if (!id) return;
    api(`/invoices/${id}`)
      .then(setInvoice)
      .catch(() => setError('Facture introuvable'));
  }

  useEffect(() => { load(); }, [id]);

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

  async function handleSend() {
    setSending(true);
    try {
      const result = await api(`/invoices/${id}/send`, { method: 'POST' });
      showToast(result.message || 'Facture envoyée par courriel');
      load();
    } catch (err) {
      showToast(err.message);
    } finally {
      setSending(false);
    }
  }

  async function addPayment(e) {
    e.preventDefault();
    try {
      await api('/payments', {
        method: 'POST',
        body: JSON.stringify({ invoice_id: invoice.id, amount: Number(paymentForm.amount) }),
      });
      setPaymentForm(null);
      load();
      showToast('Paiement enregistré');
    } catch (err) {
      showToast(err.message);
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

  const lines = parseLines(invoice.lines);
  const st = INVOICE_STATUS[invoice.status] || { label: invoice.status, color: 'bg-gray-100 text-gray-700' };
  const taxes = calcTaxes(Number(invoice.subtotal) || 0);
  const balance = (Number(invoice.total) || 0) - (Number(invoice.amount_paid) || 0);

  return (
    <AuthGuard>
      <AppShell title={`Facture ${invoice.invoice_number}`}>
        {toast && (
          <div className="fixed top-4 right-4 z-50 bg-neya-ink text-white px-4 py-2 rounded-lg shadow-lg text-sm">
            {toast}
          </div>
        )}

        <Link href="/invoices" className="text-sm text-neya-orange hover:underline mb-4 inline-block">
          ← Retour à la facturation
        </Link>

        <div className="card mb-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs text-neya-muted uppercase tracking-wider">Facture {invoice.invoice_number}</p>
              <h1 className="font-heading text-2xl text-neya-ink mt-1">{invoice.title || '—'}</h1>
              {invoice.subtitle && <p className="text-sm text-neya-muted mt-1">{invoice.subtitle}</p>}
              {invoice.client_id && (
                <Link href={`/clients/${invoice.client_id}`} className="text-sm text-neya-orange hover:underline mt-2 inline-block">
                  {invoice.client_name}
                </Link>
              )}
            </div>
            <div className="text-right">
              <span className={`text-xs px-3 py-1.5 rounded-full ${st.color}`}>{st.label}</span>
              <p className="text-xs text-neya-muted mt-2">{formatDate(invoice.created_at)}</p>
              {invoice.due_date && (
                <p className="text-xs text-neya-muted">Échéance : {formatDate(invoice.due_date)}</p>
              )}
            </div>
          </div>

          {(invoice.order_summary || invoice.notes) && (
            <p className="text-sm text-neya-muted mt-4 pt-4 border-t border-neya-border whitespace-pre-wrap">
              {invoice.order_summary || invoice.notes}
            </p>
          )}

          {invoice.quote_id && (
            <p className="text-sm mt-4 pt-4 border-t border-neya-border">
              <Link href={`/invoices/quotes/${invoice.quote_id}`} className="text-neya-orange hover:underline">
                ← Voir le devis source
              </Link>
            </p>
          )}
        </div>

        <div className="card mb-6 overflow-x-auto">
          <h2 className="font-heading text-lg mb-4">Lignes</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neya-border text-left text-neya-muted">
                <th className="pb-3 pr-4">Description</th>
                <th className="pb-3 pr-4 text-right">Qté</th>
                <th className="pb-3 pr-4 text-right">Prix unit.</th>
                <th className="pb-3 text-right">Sous-total</th>
              </tr>
            </thead>
            <tbody>
              {lines.length === 0 ? (
                <tr><td colSpan={4} className="py-6 text-center text-neya-muted">Aucune ligne</td></tr>
              ) : (
                lines.map((line, i) => (
                  <tr key={i} className="border-b border-neya-border">
                    <td className="py-3 pr-4">{line.description || '—'}</td>
                    <td className="py-3 pr-4 text-right text-neya-muted">{line.qty}</td>
                    <td className="py-3 pr-4 text-right">{formatMoney(line.price)}</td>
                    <td className="py-3 text-right font-medium">
                      {formatMoney((Number(line.qty) || 0) * (Number(line.price) || 0))}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>

          <div className="mt-4 pt-4 border-t border-neya-border grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div><span className="text-neya-muted">Sous-total</span><p className="font-medium">{formatMoney(taxes.subtotal)}</p></div>
            <div><span className="text-neya-muted">TPS 5%</span><p className="font-medium">{formatMoney(taxes.gst)}</p></div>
            <div><span className="text-neya-muted">TVQ 9,975%</span><p className="font-medium">{formatMoney(taxes.qst)}</p></div>
            <div><span className="text-neya-muted">Total TTC</span><p className="font-heading text-lg text-neya-orange">{formatMoney(invoice.total)}</p></div>
          </div>

          {(invoice.amount_paid > 0 || invoice.status !== 'paid') && (
            <div className="mt-4 pt-4 border-t border-neya-border flex flex-wrap gap-6 text-sm">
              <div>
                <span className="text-neya-muted">Payé</span>
                <p className="font-medium text-neya-success">{formatMoney(invoice.amount_paid || 0)}</p>
              </div>
              {balance > 0 && (
                <div>
                  <span className="text-neya-muted">Solde dû</span>
                  <p className="font-medium text-neya-error">{formatMoney(balance)}</p>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex flex-wrap gap-3">
          <button type="button" onClick={handlePdf} disabled={pdfLoading} className="btn-secondary">
            {pdfLoading ? 'Téléchargement…' : 'Télécharger PDF'}
          </button>
          <button type="button" onClick={handleSend} disabled={sending} className="btn-primary">
            {sending ? 'Envoi…' : 'Envoyer par courriel'}
          </button>
          {invoice.status !== 'paid' && balance > 0 && (
            <button
              type="button"
              onClick={() => setPaymentForm({ amount: balance.toFixed(2) })}
              className="btn-secondary"
            >
              Enregistrer paiement
            </button>
          )}
        </div>

        {paymentForm && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
            <form onSubmit={addPayment} className="bg-white rounded-xl p-6 w-96">
              <h3 className="font-heading text-lg mb-4">Enregistrer paiement</h3>
              <input type="number" step="0.01" className="input mb-4" value={paymentForm.amount}
                onChange={e => setPaymentForm({ amount: e.target.value })} />
              <div className="flex gap-2">
                <button type="submit" className="btn-primary">Confirmer</button>
                <button type="button" onClick={() => setPaymentForm(null)} className="btn-secondary">Annuler</button>
              </div>
            </form>
          </div>
        )}
      </AppShell>
    </AuthGuard>
  );
}

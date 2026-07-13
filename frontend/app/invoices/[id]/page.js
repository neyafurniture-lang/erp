'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import AppShell from '../../../components/AppShell';
import AuthGuard from '../../../components/AuthGuard';
import InvoicePaymentModal, { paymentMethodLabel } from '../../../components/InvoicePaymentModal';
import EasyTable from '../../../components/EasyTable';
import {
  api, formatMoney, formatDate, INVOICE_STATUS, downloadPdf, calcTaxes, calcLineSubtotal,
} from '../../../lib/api';

function parseLines(lines) {
  if (!lines) return [];
  if (typeof lines === 'string') {
    try { return JSON.parse(lines); } catch { return []; }
  }
  return Array.isArray(lines) ? lines : [];
}

function normalizeLines(lines) {
  const parsed = parseLines(lines);
  if (!parsed.length) return [{ description: '', qty: 1, price: 0 }];
  return parsed.map(l => ({
    description: l.description || '',
    qty: l.qty ?? 1,
    price: l.price ?? 0,
  }));
}

export default function InvoiceDetailPage() {
  const { id } = useParams();
  const [invoice, setInvoice] = useState(null);
  const [payments, setPayments] = useState([]);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [sending, setSending] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [showPayment, setShowPayment] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editLines, setEditLines] = useState([]);
  const [saving, setSaving] = useState(false);

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

  function startEdit() {
    setEditLines(normalizeLines(invoice.lines));
    setEditing(true);
  }

  async function saveLines() {
    setSaving(true);
    try {
      const cleaned = editLines
        .map(l => ({
          description: String(l.description || '').trim(),
          qty: Number(l.qty) || 0,
          price: Number(l.price) || 0,
        }))
        .filter(l => l.description || l.qty || l.price);
      await api(`/invoices/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ lines: cleaned.length ? cleaned : [{ description: '', qty: 1, price: 0 }] }),
      });
      setEditing(false);
      load();
      showToast('Tableau enregistré');
    } catch (err) {
      showToast(err.message);
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

  const lines = parseLines(invoice.lines);
  const st = INVOICE_STATUS[invoice.status] || { label: invoice.status, color: 'bg-gray-100 text-gray-700' };
  const previewSub = editing ? calcLineSubtotal(editLines) : (Number(invoice.subtotal) || 0);
  const taxes = calcTaxes(previewSub);
  const total = editing ? taxes.total : (Number(invoice.total) || 0);
  const paid = Number(invoice.amount_paid) || 0;
  const balance = Math.max(0, Math.round(((Number(invoice.total) || 0) - paid) * 100) / 100);
  const paidPct = (Number(invoice.total) || 0) > 0
    ? Math.min(100, Math.round((paid / Number(invoice.total)) * 100))
    : 0;

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

        {/* Paiements : déjà payé / reste */}
        <div className="card mb-6">
          <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
            <h2 className="font-heading text-lg">Paiements</h2>
            {balance > 0 && (
              <button type="button" onClick={() => setShowPayment(true)} className="btn-primary text-sm min-h-[36px]">
                + Enregistrer un paiement
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm mb-4">
            <div className="rounded-lg border border-neya-border bg-white p-3">
              <p className="text-[10px] uppercase tracking-wider text-neya-muted">Total TTC</p>
              <p className="font-heading text-xl text-neya-ink mt-1">{formatMoney(total)}</p>
            </div>
            <div className="rounded-lg border border-neya-border bg-white p-3">
              <p className="text-[10px] uppercase tracking-wider text-neya-muted">Déjà payé</p>
              <p className="font-heading text-xl text-neya-success mt-1">{formatMoney(paid)}</p>
            </div>
            <div className="rounded-lg border border-neya-border bg-white p-3">
              <p className="text-[10px] uppercase tracking-wider text-neya-muted">Reste à payer</p>
              <p className={`font-heading text-xl mt-1 ${balance > 0 ? 'text-neya-error' : 'text-neya-success'}`}>
                {formatMoney(balance)}
              </p>
            </div>
          </div>

          <div className="h-2 rounded-full bg-neya-border overflow-hidden mb-1">
            <div
              className={`h-full transition-all ${balance <= 0 ? 'bg-neya-success' : 'bg-neya-orange'}`}
              style={{ width: `${paidPct}%` }}
            />
          </div>
          <p className="text-xs text-neya-muted mb-4">{paidPct}% payé</p>

          {payments.length === 0 ? (
            <p className="text-sm text-neya-muted">Aucun paiement enregistré.</p>
          ) : (
            <ul className="divide-y divide-neya-border border border-neya-border rounded-lg overflow-hidden">
              {payments.map(p => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-sm bg-white">
                  <div>
                    <p className="font-medium">{formatMoney(p.amount)}</p>
                    <p className="text-xs text-neya-muted">
                      {formatDate(p.date)} · {paymentMethodLabel(p.method)}
                      {p.notes ? ` · ${p.notes}` : ''}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => removePayment(p.id)}
                    className="text-xs text-neya-muted hover:text-neya-error"
                  >
                    Supprimer
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="card mb-6">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
            <h2 className="font-heading text-lg">Lignes</h2>
            {!editing ? (
              <button type="button" onClick={startEdit} className="btn-secondary text-sm min-h-[36px]">
                Modifier le tableau
              </button>
            ) : (
              <div className="flex gap-2">
                <button type="button" onClick={saveLines} disabled={saving} className="btn-primary text-sm min-h-[36px]">
                  {saving ? 'Enregistrement…' : 'Enregistrer'}
                </button>
                <button type="button" onClick={() => setEditing(false)} className="btn-secondary text-sm min-h-[36px]">
                  Annuler
                </button>
              </div>
            )}
          </div>

          {editing ? (
            <EasyTable rows={editLines} onChange={setEditLines} />
          ) : (
            <div className="overflow-x-auto">
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
            </div>
          )}

          <div className="mt-4 pt-4 border-t border-neya-border grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div><span className="text-neya-muted">Sous-total</span><p className="font-medium">{formatMoney(taxes.subtotal)}</p></div>
            <div><span className="text-neya-muted">TPS 5%</span><p className="font-medium">{formatMoney(taxes.gst)}</p></div>
            <div><span className="text-neya-muted">TVQ 9,975%</span><p className="font-medium">{formatMoney(taxes.qst)}</p></div>
            <div>
              <span className="text-neya-muted">Total TTC</span>
              <p className="font-heading text-lg text-neya-orange">
                {formatMoney(editing ? taxes.total : invoice.total)}
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          <button type="button" onClick={handlePdf} disabled={pdfLoading} className="btn-secondary">
            {pdfLoading ? 'Téléchargement…' : 'Télécharger PDF'}
          </button>
          <button type="button" onClick={handleSend} disabled={sending} className="btn-primary">
            {sending ? 'Envoi…' : 'Envoyer par courriel'}
          </button>
          {balance > 0 && (
            <button type="button" onClick={() => setShowPayment(true)} className="btn-secondary">
              Enregistrer paiement
            </button>
          )}
        </div>

        {showPayment && (
          <InvoicePaymentModal
            invoice={invoice}
            onClose={() => setShowPayment(false)}
            onSubmit={submitPayment}
          />
        )}
      </AppShell>
    </AuthGuard>
  );
}

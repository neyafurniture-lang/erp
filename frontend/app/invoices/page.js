'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import AppShell from '../../components/AppShell';
import AuthGuard from '../../components/AuthGuard';
import {
  api, formatMoney, formatDate, INVOICE_STATUS, QUOTE_STATUS,
  downloadPdf, calcLineSubtotal, calcTaxes,
} from '../../lib/api';

const EMPTY_FORM = {
  client_id: '',
  title: '',
  subtitle: '',
  reference: '',
  order_summary: '',
  notes: '',
  due_date: '',
  terms: 'Net 30',
  lines: [{ description: '', qty: 1, price: 0 }],
};

export default function InvoicesPage() {
  const [invoices, setInvoices] = useState([]);
  const [quotes, setQuotes] = useState([]);
  const [clients, setClients] = useState([]);
  const [tab, setTab] = useState('quotes');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [paymentForm, setPaymentForm] = useState(null);
  const [convertForm, setConvertForm] = useState(null);
  const [toast, setToast] = useState('');

  const load = () => {
    api('/invoices').then(setInvoices);
    api('/invoices/quotes').then(setQuotes);
    api('/clients').then(setClients);
  };

  useEffect(() => { load(); }, []);

  function showToast(msg) {
    setToast(msg);
    setTimeout(() => setToast(''), 4000);
  }

  function addLine() {
    setForm({ ...form, lines: [...form.lines, { description: '', qty: 1, price: 0 }] });
  }

  function updateLine(i, field, val) {
    const lines = [...form.lines];
    lines[i] = { ...lines[i], [field]: val };
    setForm({ ...form, lines });
  }

  function openCreateForm() {
    setForm({ ...EMPTY_FORM });
    setShowForm(true);
  }

  async function createDoc(e) {
    e.preventDefault();
    const endpoint = tab === 'quotes' ? '/invoices/quotes' : '/invoices';
    await api(endpoint, { method: 'POST', body: JSON.stringify(form) });
    setShowForm(false);
    setForm({ ...EMPTY_FORM });
    showToast(tab === 'quotes' ? 'Devis créé' : 'Facture créée');
    load();
  }

  async function updateQuoteStatus(id, status) {
    await api(`/invoices/quotes/${id}`, { method: 'PUT', body: JSON.stringify({ status }) });
    load();
  }

  async function confirmConvert(e) {
    e.preventDefault();
    try {
      const inv = await api(`/invoices/from-quote/${convertForm.id}`, {
        method: 'POST',
        body: JSON.stringify({
          deposit_percent: Number(convertForm.deposit_percent),
          subtitle: convertForm.subtitle,
        }),
      });
      setConvertForm(null);
      setTab('invoices');
      showToast(`Facture #${inv.invoice_number} créée depuis le devis`);
      load();
    } catch (err) {
      showToast(err.message);
    }
  }

  async function addPayment(e) {
    e.preventDefault();
    await api('/payments', {
      method: 'POST',
      body: JSON.stringify({ invoice_id: paymentForm.id, amount: Number(paymentForm.amount) }),
    });
    setPaymentForm(null);
    load();
  }

  async function openPdf(id, type) {
    const path = type === 'quote' ? `/invoices/quotes/${id}/pdf` : `/invoices/${id}/pdf`;
    await downloadPdf(path, `${type}-${id}.pdf`);
  }

  const list = tab === 'invoices' ? invoices : quotes;
  const preview = calcTaxes(calcLineSubtotal(form.lines));

  return (
    <AuthGuard>
      <AppShell title="Facturation">
        {toast && (
          <div className="fixed top-4 right-4 z-50 bg-neya-ink text-white px-4 py-2 rounded-lg shadow-lg text-sm">
            {toast}
          </div>
        )}

        {/* Workflow guide */}
        <div className="card mb-6 bg-neya-cream/50 border-neya-orange/30">
          <p className="text-sm text-neya-muted">
            <span className="font-medium text-neya-orange">1. Devis</span> → créer et envoyer au client
            <span className="mx-2">→</span>
            <span className="font-medium text-neya-orange">2. Convertir</span> en facture (complète ou acompte 50%)
            <span className="mx-2">→</span>
            <span className="font-medium text-neya-orange">3. PDF</span> + paiement
          </p>
        </div>

        <div className="flex gap-4 mb-6">
          <button onClick={() => { setTab('quotes'); setShowForm(false); }}
            className={`px-4 py-2 rounded-lg text-sm ${tab === 'quotes' ? 'bg-neya-orange text-white' : 'bg-white border'}`}>
            Devis ({quotes.length})
          </button>
          <button onClick={() => { setTab('invoices'); setShowForm(false); }}
            className={`px-4 py-2 rounded-lg text-sm ${tab === 'invoices' ? 'bg-neya-orange text-white' : 'bg-white border'}`}>
            Factures ({invoices.length})
          </button>
          <div className="flex-1" />
          <button onClick={openCreateForm} className="btn-primary">
            + {tab === 'quotes' ? 'Nouveau devis' : 'Nouvelle facture'}
          </button>
        </div>

        {showForm && (
          <form onSubmit={createDoc} className="card mb-6 space-y-4">
            <h3 className="font-heading text-lg">{tab === 'quotes' ? 'Nouveau devis' : 'Nouvelle facture'}</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="label">Client *</label>
                <select className="input" value={form.client_id} onChange={e => setForm({ ...form, client_id: e.target.value })} required>
                  <option value="">Sélectionner</option>
                  {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Titre projet *</label>
                <input className="input" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="ex: Sierra Frames" required />
              </div>
              {tab === 'invoices' && (
                <>
                  <div>
                    <label className="label">Sous-titre</label>
                    <input className="input" value={form.subtitle} onChange={e => setForm({ ...form, subtitle: e.target.value })} placeholder="ex: 50% Deposit" />
                  </div>
                  <div>
                    <label className="label">Échéance</label>
                    <input type="date" className="input" value={form.due_date} onChange={e => setForm({ ...form, due_date: e.target.value })} />
                  </div>
                </>
              )}
            </div>
            <div>
              <label className="label">{tab === 'quotes' ? 'Portée des travaux' : 'Résumé de commande'}</label>
              <textarea className="input" rows={3} value={tab === 'quotes' ? form.notes : form.order_summary}
                onChange={e => setForm({ ...form, [tab === 'quotes' ? 'notes' : 'order_summary']: e.target.value })}
                placeholder="Description détaillée du projet…" />
            </div>

            <div>
              <label className="label">Lignes</label>
              <div className="space-y-2">
                {form.lines.map((line, i) => (
                  <div key={i} className="flex gap-2">
                    <input className="input flex-1" placeholder="Description" value={line.description} onChange={e => updateLine(i, 'description', e.target.value)} />
                    <input type="number" className="input w-20" placeholder="Qté" value={line.qty} onChange={e => updateLine(i, 'qty', e.target.value)} min="0" step="any" />
                    <input type="number" className="input w-28" placeholder="Prix $" value={line.price} onChange={e => updateLine(i, 'price', e.target.value)} min="0" step="0.01" />
                    <button type="button" onClick={() => setForm({ ...form, lines: form.lines.filter((_, j) => j !== i) })}
                      className="text-neya-muted hover:text-neya-error px-2" disabled={form.lines.length === 1}>×</button>
                  </div>
                ))}
                <button type="button" onClick={addLine} className="text-sm text-neya-orange">+ Ajouter une ligne</button>
              </div>
            </div>

            <div className="bg-neya-cream rounded-lg p-4 text-sm grid grid-cols-2 md:grid-cols-4 gap-2">
              <div><span className="text-neya-muted">Sous-total</span><p className="font-medium">{formatMoney(preview.subtotal)}</p></div>
              <div><span className="text-neya-muted">TPS 5%</span><p className="font-medium">{formatMoney(preview.gst)}</p></div>
              <div><span className="text-neya-muted">TVQ 9,975%</span><p className="font-medium">{formatMoney(preview.qst)}</p></div>
              <div><span className="text-neya-muted">Total</span><p className="font-heading text-lg text-neya-orange">{formatMoney(preview.total)}</p></div>
            </div>

            <div className="flex gap-2">
              <button type="submit" className="btn-primary">Créer le {tab === 'quotes' ? 'devis' : 'facture'}</button>
              <button type="button" onClick={() => setShowForm(false)} className="btn-secondary">Annuler</button>
            </div>
          </form>
        )}

        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neya-border text-left text-neya-muted">
                <th className="pb-3 pr-4">Numéro</th>
                <th className="pb-3 pr-4">Projet / Client</th>
                <th className="pb-3 pr-4">Date</th>
                <th className="pb-3 pr-4">Total TTC</th>
                <th className="pb-3 pr-4">Statut</th>
                <th className="pb-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {list.length === 0 && (
                <tr><td colSpan={6} className="py-8 text-center text-neya-muted">
                  {tab === 'quotes' ? 'Aucun devis — cliquez « Nouveau devis »' : 'Aucune facture'}
                </td></tr>
              )}
              {list.map(item => {
                const st = tab === 'quotes'
                  ? (QUOTE_STATUS[item.status] || { label: item.status, color: 'bg-gray-100' })
                  : (INVOICE_STATUS[item.status] || { label: item.status, color: 'bg-gray-100' });
                const num = item.invoice_number || item.quote_number;
                const detailHref = tab === 'quotes'
                  ? `/invoices/quotes/${item.id}`
                  : `/invoices/${item.id}`;
                return (
                  <tr key={item.id} className="border-b border-neya-border hover:bg-neya-cream/30">
                    <td className="py-3 pr-4 font-medium">
                      <Link href={detailHref} className="text-neya-orange hover:underline">{num}</Link>
                    </td>
                    <td className="py-3 pr-4">
                      <Link href={detailHref} className="hover:text-neya-orange">
                        <p className="font-medium">{item.title || item.project_name || '—'}</p>
                      </Link>
                      <p className="text-xs text-neya-muted">{item.client_name}</p>
                    </td>
                    <td className="py-3 pr-4 text-neya-muted">{formatDate(item.created_at)}</td>
                    <td className="py-3 pr-4 font-medium">{formatMoney(item.total)}</td>
                    <td className="py-3 pr-4">
                      {tab === 'quotes' ? (
                        <select value={item.status} onChange={e => updateQuoteStatus(item.id, e.target.value)}
                          className={`text-xs px-2 py-1 rounded-full border-0 ${st.color}`}>
                          <option value="draft">Brouillon</option>
                          <option value="sent">Envoyé</option>
                          <option value="accepted">Accepté</option>
                          <option value="rejected">Refusé</option>
                        </select>
                      ) : (
                        <span className={`text-xs px-2 py-1 rounded-full ${st.color}`}>{st.label}</span>
                      )}
                    </td>
                    <td className="py-3">
                      <div className="flex gap-2 flex-wrap items-center">
                        <button onClick={() => openPdf(item.id, tab === 'quotes' ? 'quote' : 'invoice')}
                          className="text-xs bg-neya-cream hover:bg-neya-cream-dark px-2 py-1 rounded text-neya-orange">
                          PDF
                        </button>
                        {tab === 'quotes' && (
                          item.invoice_id ? (
                            <Link href={`/invoices/${item.invoice_id}`} className="text-xs text-neya-success hover:underline">
                              → Facture #{item.invoice_number}
                            </Link>
                          ) : (
                            <button
                              onClick={() => setConvertForm({
                                id: item.id,
                                title: item.title,
                                subtotal: item.subtotal,
                                total: item.total,
                                quote_number: item.quote_number,
                                deposit_percent: 100,
                                subtitle: '',
                              })}
                              className="text-xs btn-primary py-1 px-2">
                              → Facture
                            </button>
                          )
                        )}
                        {tab === 'invoices' && item.status !== 'paid' && (
                          <button onClick={() => setPaymentForm({ id: item.id, amount: (item.total - (item.amount_paid || 0)).toFixed(2) })}
                            className="text-xs text-neya-success hover:underline">
                            Paiement
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Modal conversion devis → facture */}
        {convertForm && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
            <form onSubmit={confirmConvert} className="bg-white rounded-xl p-6 w-full max-w-md shadow-xl">
              <h3 className="font-heading text-lg mb-1">Convertir en facture</h3>
              <p className="text-sm text-neya-muted mb-4">
                Devis {convertForm.quote_number} — {convertForm.title}
              </p>

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
                          subtitle: opt.pct < 100 ? `${opt.pct}% Deposit · ${convertForm.title || 'Order'}` : '',
                        })}
                        className={`flex-1 py-2 rounded-lg text-sm border ${
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

                <div className="bg-neya-cream rounded-lg p-3 text-sm">
                  <p className="text-neya-muted">Montant facture estimé (TTC)</p>
                  <p className="font-heading text-xl text-neya-orange">
                    {formatMoney(calcTaxes((convertForm.subtotal || 0) * (convertForm.deposit_percent / 100)).total)}
                  </p>
                  <p className="text-xs text-neya-muted mt-1">
                    {convertForm.deposit_percent}% du devis (sous-total {formatMoney(convertForm.subtotal)})
                  </p>
                </div>
              </div>

              <div className="flex gap-2">
                <button type="submit" className="btn-primary flex-1">Créer la facture</button>
                <button type="button" onClick={() => setConvertForm(null)} className="btn-secondary">Annuler</button>
              </div>
            </form>
          </div>
        )}

        {paymentForm && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
            <form onSubmit={addPayment} className="bg-white rounded-xl p-6 w-96">
              <h3 className="font-heading text-lg mb-4">Enregistrer paiement</h3>
              <input type="number" step="0.01" className="input mb-4" value={paymentForm.amount}
                onChange={e => setPaymentForm({ ...paymentForm, amount: e.target.value })} />
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

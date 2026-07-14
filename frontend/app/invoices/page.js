'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import AppShell from '../../components/AppShell';
import AuthGuard from '../../components/AuthGuard';
import InvoicePaymentModal from '../../components/InvoicePaymentModal';
import EasyTable from '../../components/EasyTable';
import {
  api, formatMoney, formatDate, INVOICE_STATUS, QUOTE_STATUS,
  downloadPdf, calcLineSubtotal, calcTaxes,
} from '../../lib/api';
import DocRowMenu from '../../components/DocRowMenu';
import SendDocumentModal from '../../components/SendDocumentModal';

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
  const [sendDoc, setSendDoc] = useState(null); // { type, id }
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

  async function submitPayment(payload) {
    await api('/payments', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    setPaymentForm(null);
    showToast('Paiement enregistré');
    load();
  }

  async function openPdf(id, type) {
    const path = type === 'quote' ? `/invoices/quotes/${id}/pdf` : `/invoices/${id}/pdf`;
    await downloadPdf(path, `${type}-${id}.pdf`);
  }

  async function deleteDoc(item) {
    const isQuote = tab === 'quotes';
    const num = item.invoice_number || item.quote_number;
    const label = isQuote ? `devis ${num}` : `facture ${num}`;
    if (!window.confirm(`Supprimer définitivement ${label} ?`)) return;
    try {
      if (isQuote) {
        try {
          await api(`/invoices/quotes/${item.id}`, { method: 'DELETE' });
        } catch (err) {
          if (String(err.message || '').includes('liée à la facture')) {
            if (!window.confirm(`${err.message}\n\nForcer la suppression du devis (la facture restera) ?`)) return;
            await api(`/invoices/quotes/${item.id}?force=1`, { method: 'DELETE' });
          } else {
            throw err;
          }
        }
      } else {
        await api(`/invoices/${item.id}`, { method: 'DELETE' });
      }
      showToast(`${isQuote ? 'Devis' : 'Facture'} ${num} supprimé(e)`);
      load();
    } catch (err) {
      showToast(err.message || 'Suppression impossible');
    }
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
              <label className="label">Lignes (tableau)</label>
              <EasyTable
                rows={form.lines}
                onChange={lines => setForm({ ...form, lines })}
              />
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
                {tab === 'invoices' && (
                  <>
                    <th className="pb-3 pr-4">Déjà payé</th>
                    <th className="pb-3 pr-4">Reste</th>
                  </>
                )}
                <th className="pb-3 pr-4">Statut</th>
                <th className="pb-3 pr-2">Actions</th>
                <th className="pb-3 w-10" />
              </tr>
            </thead>
            <tbody>
              {list.length === 0 && (
                <tr><td colSpan={tab === 'invoices' ? 9 : 7} className="py-8 text-center text-neya-muted">
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
                const paid = Number(item.amount_paid) || 0;
                const balance = Math.max(0, Math.round(((Number(item.total) || 0) - paid) * 100) / 100);
                const menuItems = [
                  {
                    id: 'open',
                    label: 'Ouvrir',
                    onClick: () => { window.location.href = detailHref; },
                  },
                  {
                    id: 'send',
                    label: 'Envoyer par courriel…',
                    onClick: () => setSendDoc({
                      type: tab === 'quotes' ? 'quote' : 'invoice',
                      id: item.id,
                    }),
                  },
                  {
                    id: 'pdf',
                    label: 'Télécharger le PDF',
                    onClick: () => openPdf(item.id, tab === 'quotes' ? 'quote' : 'invoice'),
                  },
                  {
                    id: 'delete',
                    label: 'Supprimer',
                    danger: true,
                    onClick: () => deleteDoc(item),
                  },
                ];
                return (
                  <tr
                    key={item.id}
                    className="border-b border-neya-border hover:bg-neya-surface cursor-pointer"
                    onClick={(e) => {
                      if (e.target.closest('button, select, a')) return;
                      window.location.href = detailHref;
                    }}
                  >
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
                    {tab === 'invoices' && (
                      <>
                        <td className="py-3 pr-4 text-neya-success">{formatMoney(paid)}</td>
                        <td className={`py-3 pr-4 font-medium ${balance > 0 ? 'text-neya-error' : 'text-neya-success'}`}>
                          {formatMoney(balance)}
                        </td>
                      </>
                    )}
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
                    <td className="py-3 pr-2">
                      <div className="flex gap-2 flex-wrap items-center">
                        <button
                          type="button"
                          onClick={() => setSendDoc({
                            type: tab === 'quotes' ? 'quote' : 'invoice',
                            id: item.id,
                          })}
                          className="text-xs btn-primary py-1 px-2"
                        >
                          Envoyer
                        </button>
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
                        {tab === 'invoices' && balance > 0 && (
                          <button
                            type="button"
                            onClick={() => setPaymentForm(item)}
                            className="text-xs text-neya-success hover:underline"
                          >
                            Paiement
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="py-3 pl-1 text-right align-middle">
                      <DocRowMenu items={menuItems} />
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
          <InvoicePaymentModal
            invoice={paymentForm}
            onClose={() => setPaymentForm(null)}
            onSubmit={submitPayment}
          />
        )}

        {sendDoc && (
          <SendDocumentModal
            type={sendDoc.type}
            docId={sendDoc.id}
            onClose={() => setSendDoc(null)}
            onSent={() => {
              showToast('Courriel envoyé');
              load();
            }}
          />
        )}
      </AppShell>
    </AuthGuard>
  );
}

'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import AppShell from '../../../../components/AppShell';
import AuthGuard from '../../../../components/AuthGuard';
import EasyTable from '../../../../components/EasyTable';
import {
  api, formatMoney, formatDate, QUOTE_STATUS, downloadPdf, calcTaxes, calcLineSubtotal,
} from '../../../../lib/api';
import { useRegisterChatContext } from '../../../../lib/chat-context';

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

export default function QuoteDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const [quote, setQuote] = useState(null);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [sending, setSending] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [convertForm, setConvertForm] = useState(null);
  const [converting, setConverting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editLines, setEditLines] = useState([]);
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

  function startEdit() {
    setEditLines(normalizeLines(quote.lines));
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
      await api(`/invoices/quotes/${id}`, {
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

  async function updateStatus(status) {
    await api(`/invoices/quotes/${id}`, { method: 'PUT', body: JSON.stringify({ status }) });
    load();
    showToast('Statut mis à jour');
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

  async function handleSend() {
    setSending(true);
    try {
      const result = await api(`/invoices/quotes/${id}/send`, { method: 'POST' });
      showToast(result.message || 'Devis envoyé par courriel');
      load();
    } catch (err) {
      showToast(err.message);
    } finally {
      setSending(false);
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

  const lines = parseLines(quote.lines);
  const st = QUOTE_STATUS[quote.status] || { label: quote.status, color: 'bg-gray-100 text-gray-700' };
  const previewSub = editing ? calcLineSubtotal(editLines) : (Number(quote.subtotal) || 0);
  const taxes = calcTaxes(previewSub);

  return (
    <AuthGuard>
      <AppShell title={`Devis ${quote.quote_number}`}>
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
              <p className="text-xs text-neya-muted uppercase tracking-wider">Devis {quote.quote_number}</p>
              <h1 className="font-heading text-2xl text-neya-ink mt-1">{quote.title || '—'}</h1>
              {quote.reference && <p className="text-sm text-neya-muted mt-1">{quote.reference}</p>}
              {quote.client_id && (
                <Link href={`/clients/${quote.client_id}`} className="text-sm text-neya-orange hover:underline mt-2 inline-block">
                  {quote.client_name}
                </Link>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={quote.status}
                onChange={e => updateStatus(e.target.value)}
                className={`text-xs px-3 py-1.5 rounded-full border-0 ${st.color}`}
              >
                <option value="draft">Brouillon</option>
                <option value="sent">Envoyé</option>
                <option value="accepted">Accepté</option>
                <option value="rejected">Refusé</option>
              </select>
              <span className="text-xs text-neya-muted">{formatDate(quote.created_at)}</span>
            </div>
          </div>

          {quote.notes && (
            <p className="text-sm text-neya-muted mt-4 pt-4 border-t border-neya-border whitespace-pre-wrap">
              {quote.notes}
            </p>
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
                {formatMoney(editing ? taxes.total : quote.total)}
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
          {quote.invoice_id ? (
            <Link href={`/invoices/${quote.invoice_id}`} className="btn-secondary">
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
              className="btn-secondary"
            >
              Convertir en facture
            </button>
          )}
        </div>

        {convertForm && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
            <form onSubmit={confirmConvert} className="bg-white rounded-xl p-6 w-full max-w-md shadow-xl">
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
                  <p className="text-neya-muted">Montant estimé (TTC)</p>
                  <p className="font-heading text-xl text-neya-orange">
                    {formatMoney(calcTaxes((convertForm.subtotal || 0) * (convertForm.deposit_percent / 100)).total)}
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
      </AppShell>
    </AuthGuard>
  );
}

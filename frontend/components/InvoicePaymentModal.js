'use client';

import { useMemo, useState } from 'react';
import { formatMoney } from '../lib/api';

export const PAYMENT_METHODS = [
  { id: 'interac', label: 'Interac' },
  { id: 'transfer', label: 'Virement' },
  { id: 'cash', label: 'Espèces' },
  { id: 'check', label: 'Chèque' },
  { id: 'card', label: 'Carte' },
  { id: 'other', label: 'Autre' },
];

export function paymentMethodLabel(method) {
  return PAYMENT_METHODS.find(m => m.id === method)?.label || method || '—';
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function todayInput() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Modal d'enregistrement de paiement avec raccourcis (solde, 50 %, 30 %).
 * props: invoice { id, invoice_number, total, amount_paid }, onClose, onSaved(api)
 */
export default function InvoicePaymentModal({ invoice, onClose, onSubmit }) {
  const total = round2(invoice?.total);
  const paid = round2(invoice?.amount_paid);
  const balance = round2(Math.max(0, total - paid));

  const [amount, setAmount] = useState(balance > 0 ? String(balance) : '');
  const [method, setMethod] = useState('interac');
  const [date, setDate] = useState(todayInput());
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const quickOptions = useMemo(() => {
    const opts = [];
    if (balance > 0) {
      opts.push({ id: 'full', label: 'Solde dû', amount: balance, hint: formatMoney(balance) });
    }
    const halfTotal = round2(total * 0.5);
    const thirdTotal = round2(total * 0.3);
    if (halfTotal > 0 && halfTotal <= balance) {
      opts.push({ id: '50total', label: '50 % du total', amount: halfTotal, hint: formatMoney(halfTotal) });
    }
    if (thirdTotal > 0 && thirdTotal <= balance) {
      opts.push({ id: '30total', label: '30 % du total', amount: thirdTotal, hint: formatMoney(thirdTotal) });
    }
    const halfBal = round2(balance * 0.5);
    if (balance > 0 && halfBal > 0 && halfBal < balance) {
      opts.push({ id: '50bal', label: '50 % du reste', amount: halfBal, hint: formatMoney(halfBal) });
    }
    return opts;
  }, [balance, total]);

  const amountNum = round2(amount);
  const remainingAfter = round2(Math.max(0, balance - amountNum));

  async function handleSubmit(e) {
    e.preventDefault();
    setErr('');
    if (!(amountNum > 0)) {
      setErr('Indiquez un montant valide');
      return;
    }
    if (amountNum > balance + 0.009) {
      setErr(`Le montant dépasse le solde dû (${formatMoney(balance)})`);
      return;
    }
    setBusy(true);
    try {
      await onSubmit({
        invoice_id: invoice.id,
        amount: amountNum,
        method,
        notes: notes.trim() || null,
        date: date || todayInput(),
      });
    } catch (error) {
      setErr(error.message || 'Erreur');
      setBusy(false);
      return;
    }
    setBusy(false);
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <form onSubmit={handleSubmit} className="bg-white rounded-xl p-6 w-full max-w-md shadow-xl space-y-4">
        <div>
          <h3 className="font-heading text-lg text-neya-ink">Enregistrer un paiement</h3>
          <p className="text-sm text-neya-muted mt-0.5">
            Facture {invoice?.invoice_number || `#${invoice?.id}`}
          </p>
        </div>

        <div className="grid grid-cols-3 gap-2 text-center text-sm bg-neya-cream/60 rounded-lg p-3 border border-neya-border">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-neya-muted">Total</p>
            <p className="font-medium">{formatMoney(total)}</p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-neya-muted">Déjà payé</p>
            <p className="font-medium text-neya-success">{formatMoney(paid)}</p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-neya-muted">Reste</p>
            <p className="font-medium text-neya-error">{formatMoney(balance)}</p>
          </div>
        </div>

        {quickOptions.length > 0 && (
          <div>
            <p className="label mb-2">Options rapides</p>
            <div className="flex flex-wrap gap-2">
              {quickOptions.map(opt => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setAmount(String(opt.amount))}
                  className={`text-xs px-3 py-2 rounded-lg border transition-colors ${
                    amountNum === opt.amount
                      ? 'bg-neya-orange text-white border-neya-orange'
                      : 'bg-white border-neya-border hover:border-neya-orange/50'
                  }`}
                >
                  <span className="font-medium block">{opt.label}</span>
                  <span className="opacity-80">{opt.hint}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div>
          <label className="label">Montant ($)</label>
          <input
            type="number"
            step="0.01"
            min="0.01"
            max={balance || undefined}
            className="input"
            value={amount}
            onChange={e => setAmount(e.target.value)}
            required
          />
          {amountNum > 0 && amountNum <= balance && (
            <p className="text-xs text-neya-muted mt-1">
              Après paiement → reste {formatMoney(remainingAfter)}
              {remainingAfter === 0 ? ' (soldée)' : ''}
            </p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Méthode</label>
            <select className="input" value={method} onChange={e => setMethod(e.target.value)}>
              {PAYMENT_METHODS.map(m => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Date</label>
            <input type="date" className="input" value={date} onChange={e => setDate(e.target.value)} />
          </div>
        </div>

        <div>
          <label className="label">Note (optionnel)</label>
          <input
            className="input"
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="ex. Interac reçu, chèque #123"
          />
        </div>

        {err && <p className="text-sm text-neya-error">{err}</p>}

        <div className="flex gap-2 pt-1">
          <button type="submit" disabled={busy || balance <= 0} className="btn-primary flex-1">
            {busy ? 'Enregistrement…' : 'Confirmer'}
          </button>
          <button type="button" onClick={onClose} className="btn-secondary" disabled={busy}>
            Annuler
          </button>
        </div>
      </form>
    </div>
  );
}

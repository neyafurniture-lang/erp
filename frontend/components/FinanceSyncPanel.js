'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Mail, Receipt, Store, RefreshCw } from 'lucide-react';
import { api, formatMoney } from '../lib/api';

export default function FinanceSyncPanel({ year: yearProp, onDone }) {
  const [year, setYear] = useState(yearProp || new Date().getFullYear());
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [supplierResult, setSupplierResult] = useState(null);
  const [issuedResult, setIssuedResult] = useState(null);
  const [webResult, setWebResult] = useState(null);

  async function runSupplier() {
    setBusy('supplier');
    setErr('');
    setSupplierResult(null);
    try {
      const r = await api('/finance-sync/import-supplier-invoices', {
        method: 'POST',
        body: JSON.stringify({ year, max: 100, auto_expense: true }),
      });
      setSupplierResult(r);
      onDone?.();
    } catch (e) {
      setErr(e.message || 'Import fournisseurs impossible');
    } finally {
      setBusy('');
    }
  }

  async function runIssued() {
    setBusy('issued');
    setErr('');
    setIssuedResult(null);
    try {
      const r = await api('/finance-sync/sync-issued-invoices', {
        method: 'POST',
        body: JSON.stringify({ year }),
      });
      setIssuedResult(r);
      onDone?.();
    } catch (e) {
      setErr(e.message || 'Sync factures émises impossible');
    } finally {
      setBusy('');
    }
  }

  async function runWeb() {
    setBusy('web');
    setErr('');
    setWebResult(null);
    try {
      const r = await api('/finance-sync/sync-web-orders-marketplace', {
        method: 'POST',
        body: JSON.stringify({ year, book: true }),
      });
      setWebResult(r);
      onDone?.();
    } catch (e) {
      setErr(e.message || 'Import commandes web impossible');
    } finally {
      setBusy('');
    }
  }

  return (
    <section className="rounded-2xl border border-neya-border bg-white p-4 sm:p-5 mb-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <h2 className="font-display text-lg font-semibold text-neya-ink">Import compta {year}</h2>
          <p className="text-sm text-neya-muted mt-0.5">
            Factures reçues → Dépenses · Factures émises → Gains · Commandes site → Marketplace
          </p>
        </div>
        <label className="text-xs text-neya-muted flex items-center gap-2">
          Année
          <input
            type="number"
            className="input w-24 min-h-[36px] py-1"
            value={year}
            onChange={e => setYear(Number(e.target.value) || new Date().getFullYear())}
            min={2020}
            max={2100}
          />
        </label>
      </div>

      {err && (
        <div className="mb-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{err}</div>
      )}

      <div className="grid sm:grid-cols-3 gap-3">
        <div className="rounded-xl border border-neya-border bg-neya-surface/50 p-3 flex flex-col gap-3">
          <div className="flex items-start gap-2">
            <Mail className="h-4 w-4 text-neya-orange mt-0.5 shrink-0" aria-hidden />
            <div>
              <p className="text-sm font-semibold text-neya-ink">Factures reçues (Gmail)</p>
              <p className="text-xs text-neya-muted mt-0.5">
                Scan {year} → crée les dépenses quand le montant est détecté.
              </p>
            </div>
          </div>
          <button
            type="button"
            className="btn-primary text-sm mt-auto"
            disabled={!!busy}
            onClick={runSupplier}
          >
            {busy === 'supplier' ? 'Import…' : 'Importer → Dépenses'}
          </button>
          {supplierResult && (
            <p className="text-xs text-neya-muted">
              Scannés {supplierResult.scanned} · nouvelles {supplierResult.ingested} ·{' '}
              <strong className="text-neya-ink">{supplierResult.expenses_created} dépenses</strong>
              {supplierResult.without_amount ? ` · ${supplierResult.without_amount} sans montant (à compléter dans Courriel)` : ''}
            </p>
          )}
        </div>

        <div className="rounded-xl border border-neya-border bg-neya-surface/50 p-3 flex flex-col gap-3">
          <div className="flex items-start gap-2">
            <Receipt className="h-4 w-4 text-neya-orange mt-0.5 shrink-0" aria-hidden />
            <div>
              <p className="text-sm font-semibold text-neya-ink">Factures émises</p>
              <p className="text-xs text-neya-muted mt-0.5">
                Pousse les brouillons déjà payés et calcule les gains {year}.
              </p>
            </div>
          </div>
          <button
            type="button"
            className="btn-primary text-sm mt-auto"
            disabled={!!busy}
            onClick={runIssued}
          >
            {busy === 'issued' ? 'Sync…' : 'Sync → Gains'}
          </button>
          {issuedResult && (
            <p className="text-xs text-neya-muted">
              {issuedResult.issued_count} factures · facturé{' '}
              <strong className="text-neya-ink">{formatMoney(issuedResult.revenue_invoiced)}</strong>
              {' · '}encaissé{' '}
              <strong className="text-neya-ink">{formatMoney(issuedResult.revenue_collected)}</strong>
              {issuedResult.drafts_promoted ? ` · ${issuedResult.drafts_promoted} brouillon(s) promu(s)` : ''}
            </p>
          )}
        </div>

        <div className="rounded-xl border border-neya-border bg-neya-surface/50 p-3 flex flex-col gap-3">
          <div className="flex items-start gap-2">
            <Store className="h-4 w-4 text-neya-orange mt-0.5 shrink-0" aria-hidden />
            <div>
              <p className="text-sm font-semibold text-neya-ink">Commandes site</p>
              <p className="text-xs text-neya-muted mt-0.5">
                web_orders → ventes Marketplace + factures payées.
              </p>
            </div>
          </div>
          <button
            type="button"
            className="btn-secondary text-sm mt-auto inline-flex items-center justify-center gap-1.5"
            disabled={!!busy}
            onClick={runWeb}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${busy === 'web' ? 'animate-spin' : ''}`} aria-hidden />
            {busy === 'web' ? 'Import…' : 'Site → Marketplace'}
          </button>
          {webResult && (
            <p className="text-xs text-neya-muted">
              {webResult.orders_found} commandes · {webResult.sales_created} ventes · {webResult.booked} en compta
            </p>
          )}
        </div>
      </div>

      <p className="text-[11px] text-neya-muted mt-3">
        Gmail requis pour les factures reçues ·{' '}
        <Link href="/expenses" className="text-neya-orange hover:underline">Dépenses</Link>
        {' · '}
        <Link href="/marketplace" className="text-neya-orange hover:underline">Ventes marketplace</Link>
        {' · '}
        <Link href="/invoices" className="text-neya-orange hover:underline">Devis & factures</Link>
      </p>
    </section>
  );
}

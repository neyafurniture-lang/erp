'use client';

import Link from 'next/link';
import { ArrowUpRight, Banknote, Clock, FileText } from 'lucide-react';
import { formatMoney } from '../lib/api';

function timeLabel(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

export default function DashboardFollowPanel({ invoices = [], quotes = [], shifts = [] }) {
  const moneyRows = [
    ...invoices.slice(0, 5).map(i => ({
      key: `inv-${i.id}`,
      href: i.href || `/invoices/${i.id}`,
      title: i.label || i.client_name || i.invoice_number,
      meta: i.remaining != null ? formatMoney(i.remaining) : formatMoney(i.total),
      kind: 'Facture',
    })),
    ...quotes.slice(0, 5).map(q => ({
      key: `q-${q.id}`,
      href: q.href || `/invoices/quotes/${q.id}`,
      title: q.label || `${q.client_name || 'Client'} — ${q.quote_number}`,
      meta: q.status === 'draft' ? 'Brouillon' : 'Envoyé',
      kind: 'Devis',
    })),
  ].slice(0, 8);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
      <section className="cf-panel">
        <div className="cf-panel-head">
          <div>
            <h2 className="cf-panel-title inline-flex items-center gap-2">
              <Clock className="h-4 w-4 text-neya-orange" strokeWidth={2} />
              Quarts aujourd’hui
            </h2>
            <p className="cf-panel-sub">Qui est à l’atelier</p>
          </div>
          <Link href="/team?tab=planning" className="dash-link inline-flex items-center gap-1">
            Planning <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        </div>
        {!shifts.length ? (
          <p className="dash-empty px-1">
            Aucun quart aujourd’hui.{' '}
            <Link href="/team?tab=planning" className="text-neya-orange hover:underline">Ajouter un quart</Link>
            {' '}— cliquez un employé, puis glissez sur le calendrier.
          </p>
        ) : (
          <ul className="divide-y divide-neya-border/70">
            {shifts.map(s => (
              <li key={s.id}>
                <Link href="/team?tab=planning" className="cf-agenda-row">
                  <span className="cf-agenda-time">{timeLabel(s.start_at)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-neya-ink truncate">{s.employee_name}</span>
                    <span className="cf-agenda-type">{s.project_name || 'Atelier'}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="cf-panel">
        <div className="cf-panel-head">
          <div>
            <h2 className="cf-panel-title inline-flex items-center gap-2">
              <Banknote className="h-4 w-4 text-neya-orange" strokeWidth={2} />
              Factures & devis à suivre
            </h2>
            <p className="cf-panel-sub">Cliquez → la fiche s’ouvre (pas une liste vide)</p>
          </div>
          <Link href="/invoices" className="dash-link inline-flex items-center gap-1">
            Tout <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        </div>
        {!moneyRows.length ? (
          <p className="dash-empty px-1">Rien à relancer — devis et factures sont à jour.</p>
        ) : (
          <ul className="divide-y divide-neya-border/70">
            {moneyRows.map(row => (
              <li key={row.key}>
                <Link href={row.href} className="cf-mail-row">
                  <span className="cf-kpi-icon cf-kpi-icon-neutral shrink-0">
                    <FileText className="h-3.5 w-3.5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-neya-ink truncate">{row.title}</span>
                    <span className="block text-[12px] text-neya-muted mt-0.5">{row.kind}</span>
                  </span>
                  <span className="shrink-0 text-[12px] tabular-nums text-neya-ink">{row.meta}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

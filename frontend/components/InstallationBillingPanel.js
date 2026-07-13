'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api, formatMoney } from '../lib/api';

function emptyRow() {
  return {
    date: '',
    label: '',
    source: '',
    source_subject: '',
    hours: 0,
    fee: 0,
    billed: false,
    note: '',
  };
}

export default function InstallationBillingPanel({ projectId, projectName, clientId, clientName, onReload }) {
  const [data, setData] = useState(null);
  const [dates, setDates] = useState([]);
  const [contactName, setContactName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [invoiceId, setInvoiceId] = useState(null);
  const [invoices, setInvoices] = useState([]);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [dirty, setDirty] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api(`/projects/${projectId}/installation-billing`);
      setData(res);
      setDates(res.billing?.dates?.length ? res.billing.dates : []);
      setContactName(res.billing?.contact_name || '');
      setContactEmail(res.billing?.contact_email || '');
      setInvoiceId(res.billing?.invoice_id || null);
      setInvoices(res.invoices || []);
      setDirty(false);
    } catch (e) {
      setErr(e.message);
    }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  function patchDates(next) {
    setDates(next);
    setDirty(true);
    setOk('');
  }

  function updateRow(index, field, value) {
    const next = dates.map((row, i) => (i === index ? { ...row, [field]: value } : row));
    patchDates(next);
  }

  function addManualDate() {
    patchDates([...dates, emptyRow()]);
  }

  function removeRow(index) {
    if (!confirm('Retirer cette date ?')) return;
    patchDates(dates.filter((_, i) => i !== index));
  }

  async function scanMails() {
    setBusy('scan');
    setErr('');
    setOk('');
    try {
      const res = await api(`/projects/${projectId}/installation-billing/scan`, { method: 'POST' });
      setDates(res.dates || []);
      setDirty(false);
      const n = res.new_dates?.length || 0;
      setOk(n
        ? `${n} nouvelle(s) date(s) trouvée(s) dans ${res.mail_count || 0} courriel(s).`
        : `Analyse terminée — ${res.dates?.length || 0} date(s) (${res.mail_count || 0} courriel(s)).`);
      onReload?.();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy('');
    }
  }

  async function save() {
    setBusy('save');
    setErr('');
    setOk('');
    try {
      const payload = {
        contact_name: contactName,
        contact_email: contactEmail,
        invoice_id: invoiceId,
        dates: dates.filter(d => d.date).map(d => ({
          ...d,
          hours: Number(d.hours) || 0,
          fee: Number(d.fee) || 0,
        })),
      };
      const res = await api(`/projects/${projectId}/installation-billing`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      setDates(res.dates || []);
      setDirty(false);
      setOk('Suivi enregistré.');
      onReload?.();
      load();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy('');
    }
  }

  async function syncInvoice() {
    if (dirty) await save();
    setBusy('invoice');
    setErr('');
    setOk('');
    try {
      const res = await api(`/projects/${projectId}/installation-billing/sync-invoice`, { method: 'POST' });
      setInvoiceId(res.invoice?.id || null);
      setOk(`Facture ${res.invoice?.invoice_number} mise à jour (${res.lines_added} ligne(s) forfaitaire(s)).`);
      load();
      onReload?.();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy('');
    }
  }

  const totalHours = dates.reduce((s, d) => s + (Number(d.hours) || 0), 0);
  const totalFees = dates.reduce((s, d) => s + (Number(d.fee) || 0), 0);
  const scannedAt = data?.billing?.scanned_at;

  if (!data && !err) {
    return <div className="text-sm text-neya-muted py-6">Chargement du suivi installation…</div>;
  }

  return (
    <div className="space-y-4">
      <div className="border border-neya-border bg-neya-surface/40 px-4 py-3">
        <p className="text-sm text-neya-ink">
          Dates repérées dans les courriels du projet — renseignez les <span className="font-medium">heures atelier</span> (interne)
          et le <span className="font-medium">forfait</span> par journée. La facture client utilise des lignes forfaitaires, jamais un tarif horaire.
        </p>
      </div>

      {err && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 px-4 py-3">{err}</div>
      )}
      {ok && (
        <div className="text-sm text-green-800 bg-green-50 border border-green-200 px-4 py-3">{ok}</div>
      )}

      <div className="card grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div>
          <label className="label">Contact client</label>
          <input
            className="input"
            placeholder="Ex. Waita"
            value={contactName}
            onChange={e => { setContactName(e.target.value); setDirty(true); setOk(''); }}
          />
        </div>
        <div>
          <label className="label">Courriel contact</label>
          <input
            type="email"
            className="input"
            placeholder="contact@…"
            value={contactEmail}
            onChange={e => { setContactEmail(e.target.value); setDirty(true); setOk(''); }}
          />
        </div>
        <div>
          <label className="label">Client</label>
          <p className="text-sm py-2.5 text-neya-ink">
            {clientName ? (
              clientId ? (
                <Link href={`/clients/${clientId}`} className="underline-offset-2 hover:underline">{clientName}</Link>
              ) : clientName
            ) : '—'}
          </p>
        </div>
        <div>
          <label className="label">Facture liée</label>
          {invoiceId ? (
            <Link href={`/invoices/${invoiceId}`} className="text-sm text-neya-ink underline-offset-2 hover:underline block py-2.5">
              Ouvrir la facture →
            </Link>
          ) : invoices[0] ? (
            <Link href={`/invoices/${invoices[0].id}`} className="text-sm text-neya-ink underline-offset-2 hover:underline block py-2.5">
              {invoices[0].invoice_number} ({invoices[0].status})
            </Link>
          ) : (
            <p className="text-sm text-neya-muted py-2.5">Aucune — sync ci-dessous</p>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={scanMails}
          disabled={!!busy}
          className="btn-secondary text-sm min-h-[36px]"
        >
          {busy === 'scan' ? 'Analyse…' : 'Analyser les courriels'}
        </button>
        <button
          type="button"
          onClick={save}
          disabled={!!busy || !dirty}
          className="btn-primary text-sm min-h-[36px] disabled:opacity-40"
        >
          {busy === 'save' ? 'Enregistrement…' : 'Enregistrer'}
        </button>
        <button
          type="button"
          onClick={syncInvoice}
          disabled={!!busy || totalFees <= 0}
          className="btn-secondary text-sm min-h-[36px] disabled:opacity-40"
          title={totalFees <= 0 ? 'Renseignez au moins un forfait' : undefined}
        >
          {busy === 'invoice' ? 'Sync…' : 'Mettre à jour la facture'}
        </button>
        <button type="button" onClick={addManualDate} disabled={!!busy} className="btn-ghost text-sm">
          + Date manuelle
        </button>
        {scannedAt && (
          <span className="text-xs text-neya-muted self-center ml-auto">
            Dernière analyse : {new Date(scannedAt).toLocaleString('fr-CA')}
          </span>
        )}
      </div>

      <div className="card !p-0 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-neya-border bg-neya-surface/50 text-left text-xs uppercase tracking-wide text-neya-muted">
              <th className="px-3 py-2 font-semibold min-w-[130px]">Date</th>
              <th className="px-3 py-2 font-semibold min-w-[180px]">Extrait courriel</th>
              <th className="px-3 py-2 font-semibold w-24 text-right">Heures</th>
              <th className="px-3 py-2 font-semibold w-28 text-right">Forfait ($)</th>
              <th className="px-3 py-2 font-semibold min-w-[120px]">Note interne</th>
              <th className="px-3 py-2 font-semibold w-16" />
            </tr>
          </thead>
          <tbody className="divide-y divide-neya-border">
            {dates.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-neya-muted">
                  Aucune date — liez des courriels au projet (onglet Courriel) puis cliquez « Analyser les courriels ».
                </td>
              </tr>
            )}
            {dates.map((row, i) => (
              <tr key={`${row.date}-${i}`} className="hover:bg-neya-surface/30">
                <td className="px-3 py-2 align-top">
                  <input
                    type="date"
                    className="input text-sm py-1.5"
                    value={row.date || ''}
                    onChange={e => updateRow(i, 'date', e.target.value)}
                  />
                  {row.label && row.date && (
                    <p className="text-[11px] text-neya-muted mt-1">{row.label}</p>
                  )}
                </td>
                <td className="px-3 py-2 align-top">
                  <p className="text-xs text-neya-ink leading-snug">{row.source || '—'}</p>
                  {row.source_subject && (
                    <p className="text-[10px] text-neya-muted mt-1 truncate max-w-xs" title={row.source_subject}>
                      {row.source_subject}
                    </p>
                  )}
                </td>
                <td className="px-3 py-2 align-top">
                  <input
                    type="number"
                    min={0}
                    step={0.5}
                    className="input text-sm py-1.5 text-right tabular-nums"
                    value={row.hours || ''}
                    placeholder="0"
                    onChange={e => updateRow(i, 'hours', e.target.value)}
                  />
                  <p className="text-[10px] text-neya-muted mt-0.5 text-right">interne</p>
                </td>
                <td className="px-3 py-2 align-top">
                  <input
                    type="number"
                    min={0}
                    step={1}
                    className="input text-sm py-1.5 text-right tabular-nums"
                    value={row.fee || ''}
                    placeholder="0"
                    onChange={e => updateRow(i, 'fee', e.target.value)}
                  />
                </td>
                <td className="px-3 py-2 align-top">
                  <input
                    className="input text-sm py-1.5"
                    value={row.note || ''}
                    placeholder="Optionnel"
                    onChange={e => updateRow(i, 'note', e.target.value)}
                  />
                </td>
                <td className="px-3 py-2 align-top text-right">
                  <button type="button" onClick={() => removeRow(i)} className="text-xs text-neya-muted hover:text-red-700">
                    Retirer
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
          {dates.length > 0 && (
            <tfoot>
              <tr className="border-t border-neya-border bg-neya-surface/40 font-medium">
                <td className="px-3 py-2" colSpan={2}>Totaux</td>
                <td className="px-3 py-2 text-right tabular-nums">{totalHours} h</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatMoney(totalFees)}</td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <p className="text-xs text-neya-muted">
        Projet : {projectName}. Les heures restent dans l&apos;atelier ; seuls les forfaits alimentent la facture client.
      </p>
    </div>
  );
}

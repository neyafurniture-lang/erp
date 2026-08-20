'use client';

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  Plus, Trash2, ChevronDown, ChevronUp, Upload, Mail, Calendar,
  ArrowUp, ArrowDown, FileText, CheckCircle2, Circle,
} from 'lucide-react';
import AppShell from '../../components/AppShell';
import AuthGuard from '../../components/AuthGuard';
import { api, formatMoney, formatDate, getApiUrl, getToken } from '../../lib/api';

const STATUS_OPTIONS = [
  { value: 'not_started', label: 'Pas commencé', tone: 'bg-stone-100 text-stone-700' },
  { value: 'in_progress', label: 'En cours', tone: 'bg-sky-50 text-sky-800' },
  { value: 'applied', label: 'Candidature envoyée', tone: 'bg-amber-50 text-amber-900' },
  { value: 'accepted', label: 'Accepté — à payer', tone: 'bg-orange-50 text-orange-900' },
  { value: 'confirmed', label: 'Confirmé (payé)', tone: 'bg-emerald-50 text-emerald-900' },
  { value: 'done', label: 'Terminé', tone: 'bg-emerald-100 text-emerald-950' },
  { value: 'cancelled', label: 'Annulé', tone: 'bg-red-50 text-red-800' },
];

const STATUS_LABEL = Object.fromEntries(STATUS_OPTIONS.map(o => [o.value, o.label]));

function dateRange(ev) {
  if (!ev.start_date) return '—';
  const a = formatDate(ev.start_date);
  if (!ev.end_date || ev.end_date === ev.start_date) return a;
  return `${a} → ${formatDate(ev.end_date)}`;
}

function emptyForm() {
  return {
    name: '',
    organizer: '',
    venue: '',
    address: '',
    start_date: '',
    end_date: '',
    event_hours: '10 h – 17 h',
    setup_start: '',
    presence_deadline: '',
    fee_amount: '',
    fee_notes: '',
    fee_paid: false,
    status: 'not_started',
    description: '',
    mail_reply: '',
    notes: '',
    sales_total: '',
    sales_notes: '',
  };
}

function MarketDetail({ ev, onPatch, onDelete }) {
  const logistics = ev.logistics || {};
  const materials = ev.materials?.length ? ev.materials : logistics.materials_checklist || [];
  const steps = Array.isArray(ev.steps) ? ev.steps : [];

  async function toggleStep(idx) {
    const next = steps.map((s, i) => (i === idx ? { ...s, done: !s.done } : s));
    await onPatch(ev.id, { steps: next });
  }

  return (
    <div className="border-t border-neya-border bg-neya-cream/20 px-4 py-4 text-sm space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-neya-muted">Logistique</p>
          <ul className="space-y-1 text-neya-ink-light">
            {ev.setup_start && <li>Montage dès <strong>{ev.setup_start}</strong></li>}
            {ev.presence_deadline && <li>Présence avant <strong>{ev.presence_deadline}</strong></li>}
            {ev.event_hours && <li>Horaires public : {ev.event_hours}</li>}
            {logistics.wifi && <li>Wi-Fi : {logistics.wifi === 'oui' ? 'Oui' : 'Non — terminal cellulaire'}</li>}
            {logistics.parking && <li>Stationnement : {logistics.parking}</li>}
            {logistics.table_size && <li>Table : {logistics.table_size}{logistics.panels ? ` (${logistics.panels})` : ''}</li>}
            {logistics.night_repack && <li className="text-amber-800">Remballage obligatoire le samedi soir</li>}
            {(logistics.notes || []).map((n, i) => <li key={i} className="text-neya-muted">{n}</li>)}
          </ul>
          {logistics.contact_email && (
            <p className="text-xs text-neya-muted pt-1">
              {logistics.contact_email}
              {logistics.contact_phone ? ` · ${logistics.contact_phone}` : ''}
            </p>
          )}
        </div>

        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-neya-muted mb-2">Matériel / préparation</p>
          <ul className="space-y-1">
            {materials.length === 0 && <li className="text-neya-muted">—</li>}
            {materials.map((m, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="text-neya-orange mt-0.5">•</span>
                <span>{m}</span>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-neya-muted mb-2">Étapes</p>
          <ul className="space-y-1.5">
            {steps.map((s, i) => (
              <li key={s.key || i}>
                <button
                  type="button"
                  onClick={() => toggleStep(i)}
                  className="flex items-start gap-2 text-left w-full hover:text-neya-ink"
                >
                  {s.done ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
                  ) : (
                    <Circle className="h-4 w-4 text-neya-muted shrink-0 mt-0.5" />
                  )}
                  <span className={s.done ? 'line-through text-neya-muted' : ''}>{s.label}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {(ev.description || ev.mail_reply || ev.notes) && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-2 border-t border-neya-border/60">
          {ev.description && (
            <div>
              <p className="text-[10px] font-semibold uppercase text-neya-muted">Objet</p>
              <p className="text-xs mt-0.5 whitespace-pre-wrap">{ev.description}</p>
            </div>
          )}
          {ev.mail_reply && (
            <div>
              <p className="text-[10px] font-semibold uppercase text-neya-muted">Réponse mail</p>
              <p className="text-xs mt-0.5 whitespace-pre-wrap">{ev.mail_reply}</p>
            </div>
          )}
          {ev.notes && (
            <div>
              <p className="text-[10px] font-semibold uppercase text-neya-muted">Notes</p>
              <p className="text-xs mt-0.5 whitespace-pre-wrap">{ev.notes}</p>
            </div>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-2 pt-1">
        {ev.contract_url && (
          <a
            href={`${getApiUrl().replace(/\/api\/?$/, '')}${ev.contract_url}`}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-secondary text-xs gap-1"
          >
            <FileText className="h-3.5 w-3.5" /> Contrat PDF
          </a>
        )}
        {ev.gmail_message_id && (
          <Link href={`/mail?message=${encodeURIComponent(ev.gmail_message_id)}`} className="btn-secondary text-xs gap-1">
            <Mail className="h-3.5 w-3.5" /> Courriel lié
          </Link>
        )}
        {ev.task_id && (
          <Link href="/calendar" className="btn-secondary text-xs gap-1">
            <Calendar className="h-3.5 w-3.5" /> Dans le calendrier
          </Link>
        )}
        <button type="button" onClick={() => onDelete(ev.id)} className="btn-secondary text-xs text-red-700 gap-1 ml-auto">
          <Trash2 className="h-3.5 w-3.5" /> Supprimer
        </button>
      </div>
    </div>
  );
}

export default function MarchesPage() {
  const [events, setEvents] = useState([]);
  const [summary, setSummary] = useState(null);
  const [expanded, setExpanded] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm());
  const [editId, setEditId] = useState(null);
  const [statusFilter, setStatusFilter] = useState('all');
  const [err, setErr] = useState('');
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState('');
  const fileRef = useRef(null);

  const load = useCallback(async () => {
    setErr('');
    try {
      const [list, sum] = await Promise.all([
        api('/markets'),
        api('/markets/summary'),
      ]);
      setEvents(Array.isArray(list) ? list : []);
      setSummary(sum);
    } catch (e) {
      setErr(e.message || 'Chargement impossible');
    }
  }, []);

  useEffect(() => {
    load();
    window.addEventListener('neya:assistant-action', load);
    return () => window.removeEventListener('neya:assistant-action', load);
  }, [load]);

  const filtered = useMemo(() => {
    let rows = [...events];
    if (statusFilter !== 'all') rows = rows.filter(e => e.status === statusFilter);
    return rows.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  }, [events, statusFilter]);

  async function patch(id, body) {
    const updated = await api(`/markets/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
    setEvents(prev => prev.map(e => (e.id === id ? updated : e)));
    return updated;
  }

  async function remove(id) {
    if (!window.confirm('Supprimer ce marché ?')) return;
    await api(`/markets/${id}`, { method: 'DELETE' });
    if (expanded === id) setExpanded(null);
    await load();
  }

  async function saveForm(e) {
    e.preventDefault();
    setBusy('save');
    setErr('');
    try {
      const body = {
        ...form,
        fee_amount: form.fee_amount ? Number(form.fee_amount) : null,
        sales_total: form.sales_total ? Number(form.sales_total) : 0,
      };
      if (editId) {
        await patch(editId, body);
      } else {
        await api('/markets', { method: 'POST', body: JSON.stringify(body) });
      }
      setShowForm(false);
      setEditId(null);
      setForm(emptyForm());
      await load();
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setBusy('');
    }
  }

  function startEdit(ev) {
    setEditId(ev.id);
    setForm({
      name: ev.name || '',
      organizer: ev.organizer || '',
      venue: ev.venue || '',
      address: ev.address || '',
      start_date: ev.start_date?.slice?.(0, 10) || ev.start_date || '',
      end_date: ev.end_date?.slice?.(0, 10) || ev.end_date || '',
      event_hours: ev.event_hours || '',
      setup_start: ev.setup_start || '',
      presence_deadline: ev.presence_deadline || '',
      fee_amount: ev.fee_amount ?? '',
      fee_notes: ev.fee_notes || '',
      fee_paid: Boolean(ev.fee_paid),
      status: ev.status || 'not_started',
      description: ev.description || '',
      mail_reply: ev.mail_reply || '',
      notes: ev.notes || '',
      sales_total: ev.sales_total ?? '',
      sales_notes: ev.sales_notes || '',
    });
    setShowForm(true);
  }

  async function moveRow(id, dir) {
    const idx = filtered.findIndex(e => e.id === id);
    const swap = filtered[idx + dir];
    if (!swap) return;
    const ids = filtered.map(e => e.id);
    [ids[idx], ids[idx + dir]] = [ids[idx + dir], ids[idx]];
    await api('/markets/reorder', { method: 'POST', body: JSON.stringify({ ids }) });
    await load();
  }

  async function scanMail() {
    setBusy('mail');
    setInfo('');
    setErr('');
    try {
      const r = await api('/markets/scan-mail', { method: 'POST', body: JSON.stringify({ max: 30 }) });
      setInfo(`${r.hits?.length || 0} courriel(s) marché sur ${r.scanned || 0} scanné(s)`);
      await load();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy('');
    }
  }

  async function importContracts() {
    setBusy('contracts');
    setErr('');
    try {
      const r = await api('/markets/import-seed-contracts', { method: 'POST' });
      setInfo(`${r.imported || 0} contrat(s) PDF importé(s)`);
      await load();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy('');
    }
  }

  async function uploadContract(file) {
    if (!file) return;
    setBusy('upload');
    setErr('');
    const fd = new FormData();
    fd.append('contract', file);
    try {
      const token = getToken();
      const res = await fetch(`${getApiUrl()}/markets/import-contract`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Import impossible');
      setInfo(`Contrat importé — ${data.name}`);
      await load();
      setExpanded(data.id);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy('');
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  return (
    <AuthGuard>
      <AppShell
        title="Marchés & événements"
        subtitle="Contrats, logistique, calendrier et ventes sur place"
        wide
      >
        {summary && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-5">
            {[
              { label: 'Total', value: summary.total },
              { label: 'Confirmés', value: summary.confirmed },
              { label: 'En pipeline', value: summary.pipeline },
              { label: 'Terminés', value: summary.done },
              { label: 'Ventes marchés', value: formatMoney(summary.sales_total || 0) },
            ].map(k => (
              <div key={k.label} className="rounded-xl border border-neya-border bg-white px-3 py-2.5">
                <p className="text-[10px] uppercase tracking-wide text-neya-muted">{k.label}</p>
                <p className="font-display text-xl font-semibold tabular-nums">{k.value}</p>
              </div>
            ))}
          </div>
        )}

        <div className="flex flex-wrap gap-2 mb-4">
          <button type="button" onClick={() => { setShowForm(true); setEditId(null); setForm(emptyForm()); }} className="btn-primary gap-1.5 text-sm">
            <Plus className="h-4 w-4" /> Ajouter un marché
          </button>
          <button type="button" onClick={scanMail} disabled={busy === 'mail'} className="btn-secondary text-sm gap-1.5">
            <Mail className="h-4 w-4" /> Scanner Gmail
          </button>
          <button type="button" onClick={importContracts} disabled={busy === 'contracts'} className="btn-secondary text-sm gap-1.5">
            <FileText className="h-4 w-4" /> Importer contrats Drive
          </button>
          <label className="btn-secondary text-sm gap-1.5 cursor-pointer">
            <Upload className="h-4 w-4" /> PDF contrat
            <input ref={fileRef} type="file" accept=".pdf,application/pdf" className="hidden" onChange={e => uploadContract(e.target.files?.[0])} />
          </label>
          <select className="input text-xs h-9 w-auto ml-auto" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="all">Tous les statuts</option>
            {STATUS_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>

        {info && <div className="mb-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">{info}</div>}
        {err && <div className="mb-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{err}</div>}

        {showForm && (
          <form onSubmit={saveForm} className="card rounded-2xl mb-5 space-y-3">
            <p className="font-medium">{editId ? 'Modifier le marché' : 'Nouveau marché'}</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="label">Nom</label>
                <input className="input" required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
              </div>
              <div>
                <label className="label">Organisateur</label>
                <input className="input" value={form.organizer} onChange={e => setForm({ ...form, organizer: e.target.value })} />
              </div>
              <div>
                <label className="label">Date début</label>
                <input type="date" className="input" value={form.start_date} onChange={e => setForm({ ...form, start_date: e.target.value })} />
              </div>
              <div>
                <label className="label">Date fin</label>
                <input type="date" className="input" value={form.end_date} onChange={e => setForm({ ...form, end_date: e.target.value })} />
              </div>
              <div>
                <label className="label">Frais ($)</label>
                <input type="number" step="0.01" className="input" value={form.fee_amount} onChange={e => setForm({ ...form, fee_amount: e.target.value })} />
              </div>
              <div>
                <label className="label">Statut</label>
                <select className="input" value={form.status} onChange={e => setForm({ ...form, status: e.target.value })}>
                  {STATUS_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </div>
              <div className="md:col-span-2">
                <label className="label">Lieu</label>
                <input className="input" value={form.venue} onChange={e => setForm({ ...form, venue: e.target.value })} placeholder="Auditorium de Verdun…" />
              </div>
              <div>
                <label className="label">Montage dès</label>
                <input className="input" value={form.setup_start} onChange={e => setForm({ ...form, setup_start: e.target.value })} placeholder="8 h 30" />
              </div>
              <div>
                <label className="label">Présence avant</label>
                <input className="input" value={form.presence_deadline} onChange={e => setForm({ ...form, presence_deadline: e.target.value })} placeholder="9 h 30" />
              </div>
              <div className="md:col-span-2">
                <label className="label">Notes / frais détail</label>
                <input className="input" value={form.fee_notes} onChange={e => setForm({ ...form, fee_notes: e.target.value })} />
              </div>
              <div className="md:col-span-2">
                <label className="label">Ventes sur place ($)</label>
                <input type="number" step="0.01" className="input" value={form.sales_total} onChange={e => setForm({ ...form, sales_total: e.target.value })} />
              </div>
              <label className="flex items-center gap-2 md:col-span-2 cursor-pointer">
                <input type="checkbox" checked={form.fee_paid} onChange={e => setForm({ ...form, fee_paid: e.target.checked })} />
                <span className="text-sm">Frais d&apos;inscription payés</span>
              </label>
            </div>
            <div className="flex gap-2">
              <button type="submit" disabled={busy === 'save'} className="btn-primary">{busy === 'save' ? '…' : 'Enregistrer'}</button>
              <button type="button" className="btn-secondary" onClick={() => { setShowForm(false); setEditId(null); }}>Annuler</button>
            </div>
          </form>
        )}

        <div className="cf-table-wrap overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-neya-muted">
                <th className="px-3 py-2 w-8" />
                <th className="px-3 py-2">Événement</th>
                <th className="px-3 py-2">Dates</th>
                <th className="px-3 py-2">Frais</th>
                <th className="px-3 py-2">Statut</th>
                <th className="px-3 py-2">Ventes</th>
                <th className="px-3 py-2 w-24">Ordre</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-neya-muted">Aucun marché — importez la fiche ou ajoutez une ligne.</td></tr>
              )}
              {filtered.map((ev, idx) => {
                const st = STATUS_OPTIONS.find(s => s.value === ev.status) || STATUS_OPTIONS[0];
                const open = expanded === ev.id;
                return (
                  <Fragment key={ev.id}>
                    <tr className="border-t border-neya-border hover:bg-neya-cream/30">
                      <td className="px-2 py-2">
                        <button type="button" onClick={() => setExpanded(open ? null : ev.id)} className="p-1 text-neya-muted hover:text-neya-ink">
                          {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                        </button>
                      </td>
                      <td className="px-3 py-2 min-w-[12rem]">
                        <button type="button" onClick={() => startEdit(ev)} className="text-left font-medium hover:text-neya-orange">
                          {ev.name}
                        </button>
                        {ev.organizer && <p className="text-[11px] text-neya-muted truncate max-w-xs">{ev.organizer}</p>}
                      </td>
                      <td className="px-3 py-2 tabular-nums whitespace-nowrap">{dateRange(ev)}</td>
                      <td className="px-3 py-2">
                        <p className="tabular-nums">{ev.fee_amount != null ? formatMoney(ev.fee_amount) : ev.fee_notes || '—'}</p>
                        {ev.fee_paid && <span className="text-[10px] text-emerald-700">Payé</span>}
                      </td>
                      <td className="px-3 py-2">
                        <select
                          className={`text-[11px] font-medium rounded-full px-2 py-0.5 border-0 ${st.tone}`}
                          value={ev.status}
                          onChange={e => patch(ev.id, { status: e.target.value })}
                        >
                          {STATUS_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                        </select>
                        {ev.task_id && ['accepted', 'confirmed', 'done'].includes(ev.status) && (
                          <p className="text-[10px] text-neya-muted mt-0.5 flex items-center gap-0.5"><Calendar className="h-3 w-3" /> Agenda</p>
                        )}
                      </td>
                      <td className="px-3 py-2 tabular-nums">{formatMoney(ev.sales_total || 0)}</td>
                      <td className="px-3 py-2">
                        <div className="flex gap-0.5">
                          <button type="button" disabled={idx === 0} onClick={() => moveRow(ev.id, -1)} className="p-1 text-neya-muted disabled:opacity-30"><ArrowUp className="h-4 w-4" /></button>
                          <button type="button" disabled={idx === filtered.length - 1} onClick={() => moveRow(ev.id, 1)} className="p-1 text-neya-muted disabled:opacity-30"><ArrowDown className="h-4 w-4" /></button>
                        </div>
                      </td>
                    </tr>
                    {open && (
                      <tr key={`${ev.id}-detail`}>
                        <td colSpan={7} className="p-0">
                          <MarketDetail ev={ev} onPatch={patch} onDelete={remove} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>

        <p className="text-xs text-neya-muted mt-4">
          Les marchés <strong>acceptés</strong> ou <strong>confirmés</strong> sont ajoutés au{' '}
          <Link href="/calendar" className="text-neya-orange hover:underline">calendrier</Link>.
          Les ventes sur place restent distinctes des ventes{' '}
          <Link href="/marketplace" className="text-neya-orange hover:underline">marketplace en ligne</Link>.
        </p>
      </AppShell>
    </AuthGuard>
  );
}

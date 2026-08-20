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
import './marches-grid.css';

const STATUS_OPTIONS = [
  { value: 'not_started', label: 'Pas commencé' },
  { value: 'in_progress', label: 'En cours' },
  { value: 'applied', label: 'Candidature envoyée' },
  { value: 'accepted', label: 'Accepté — à payer' },
  { value: 'confirmed', label: 'Confirmé (payé)' },
  { value: 'done', label: 'Terminé' },
  { value: 'cancelled', label: 'Annulé' },
];

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
    <div className="mb-detail">
      <div className="mb-detail-grid">
        <div>
          <h4>Logistique</h4>
          <ul>
            {ev.setup_start && <li>Montage dès <strong>{ev.setup_start}</strong></li>}
            {ev.presence_deadline && <li>Présence avant <strong>{ev.presence_deadline}</strong></li>}
            {ev.event_hours && <li>Horaires public : {ev.event_hours}</li>}
            {logistics.wifi && (
              <li>Wi-Fi : {logistics.wifi === 'oui' ? 'Oui' : 'Non — terminal cellulaire'}</li>
            )}
            {logistics.parking && <li>Stationnement : {logistics.parking}</li>}
            {logistics.table_size && (
              <li>Table : {logistics.table_size}{logistics.panels ? ` (${logistics.panels})` : ''}</li>
            )}
            {logistics.night_repack && <li>Remballage obligatoire le samedi soir</li>}
            {(logistics.notes || []).map((n, i) => <li key={i}>{n}</li>)}
          </ul>
          {logistics.contact_email && (
            <p className="mb-folio" style={{ marginTop: 8 }}>
              {logistics.contact_email}
              {logistics.contact_phone ? ` · ${logistics.contact_phone}` : ''}
            </p>
          )}
        </div>
        <div>
          <h4>Matériel</h4>
          <ul>
            {materials.length === 0 && <li>—</li>}
            {materials.map((m, i) => <li key={i}>— {m}</li>)}
          </ul>
        </div>
        <div>
          <h4>Étapes</h4>
          <ul>
            {steps.map((s, i) => (
              <li key={s.key || i}>
                <button
                  type="button"
                  className={`mb-step${s.done ? ' done' : ''}`}
                  onClick={() => toggleStep(i)}
                >
                  {s.done
                    ? <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
                    : <Circle className="h-4 w-4 shrink-0 mt-0.5" />}
                  <span>{s.label}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {(ev.description || ev.mail_reply || ev.notes) && (
        <div className="mb-detail-grid" style={{ marginTop: 24 }}>
          {ev.description && (
            <div>
              <h4>Objet</h4>
              <p style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: 14 }}>{ev.description}</p>
            </div>
          )}
          {ev.mail_reply && (
            <div>
              <h4>Réponse mail</h4>
              <p style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: 14 }}>{ev.mail_reply}</p>
            </div>
          )}
          {ev.notes && (
            <div>
              <h4>Notes</h4>
              <p style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: 14 }}>{ev.notes}</p>
            </div>
          )}
        </div>
      )}

      <div className="mb-actions" style={{ marginTop: 24 }}>
        {ev.contract_url && (
          <a
            href={`${getApiUrl().replace(/\/api\/?$/, '')}${ev.contract_url}`}
            target="_blank"
            rel="noopener noreferrer"
            className="mb-btn"
          >
            <FileText className="h-3.5 w-3.5 inline mr-1" /> Contrat PDF
          </a>
        )}
        {ev.gmail_message_id && (
          <Link href={`/mail?message=${encodeURIComponent(ev.gmail_message_id)}`} className="mb-btn">
            <Mail className="h-3.5 w-3.5 inline mr-1" /> Courriel
          </Link>
        )}
        {ev.task_id && (
          <Link href="/calendar" className="mb-btn">
            <Calendar className="h-3.5 w-3.5 inline mr-1" /> Agenda
          </Link>
        )}
        <button type="button" onClick={() => onDelete(ev.id)} className="mb-btn" style={{ marginLeft: 'auto', color: 'var(--accent)', borderColor: 'var(--accent)' }}>
          <Trash2 className="h-3.5 w-3.5 inline mr-1" /> Supprimer
        </button>
      </div>
    </div>
  );
}

function useMbGrid() {
  const [on, setOn] = useState(false);
  const rootRef = useRef(null);
  const guidesRef = useRef(null);

  useEffect(() => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Archivo:wght@400;600;700;800&family=Space+Mono:wght@400;700&display=swap';
    document.head.appendChild(link);
    return () => { link.remove(); };
  }, []);

  useEffect(() => {
    const colsHost = guidesRef.current?.querySelector('.cols');
    if (!colsHost || colsHost.childElementCount) return;
    const n = parseInt(
      getComputedStyle(rootRef.current || document.documentElement).getPropertyValue('--cols') || '12',
      10
    );
    for (let i = 1; i <= n; i++) {
      const c = document.createElement('div');
      c.className = 'col';
      const s = document.createElement('span');
      s.textContent = String(i);
      c.appendChild(s);
      colsHost.appendChild(c);
    }
  }, []);

  useEffect(() => {
    function onKey(e) {
      if ((e.key === 'g' || e.key === 'G') && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const tag = (e.target?.tagName || '').toLowerCase();
        if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
        setOn(v => !v);
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    let t;
    const cvs = document.createElement('canvas');
    const ctx = cvs.getContext('2d');
    function align() {
      rootRef.current?.querySelectorAll('.mb-masthead, .mb-numeral').forEach((el) => {
        el.style.marginLeft = '0px';
        const cs = getComputedStyle(el);
        let ch = (el.textContent || '').trim().charAt(0);
        if (!ch) return;
        if (cs.textTransform === 'uppercase') ch = ch.toUpperCase();
        ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
        ctx.textAlign = 'left';
        const abl = ctx.measureText(ch).actualBoundingBoxLeft;
        if (Number.isFinite(abl)) el.style.marginLeft = `${abl.toFixed(2)}px`;
      });
    }
    const run = () => {
      if (document.fonts?.ready) document.fonts.ready.then(align);
      else align();
    };
    run();
    const onResize = () => { clearTimeout(t); t = setTimeout(align, 120); };
    window.addEventListener('resize', onResize);
    return () => { window.removeEventListener('resize', onResize); clearTimeout(t); };
  }, [on]);

  return { on, setOn, rootRef, guidesRef };
}

export default function MarchesPage() {
  const { on, setOn, rootRef, guidesRef } = useMbGrid();
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
      if (editId) await patch(editId, body);
      else await api('/markets', { method: 'POST', body: JSON.stringify(body) });
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
      <AppShell title="Marchés & événements" subtitle="Grille éditoriale — contrats, logistique, ventes" wide>
        <div ref={rootRef} className={`mb-root${on ? ' grid-on' : ''}`}>
          <section className="mb-spread">
            <div className="mb-wrap">
              <button
                type="button"
                className="mb-toggle"
                aria-pressed={on}
                onClick={() => setOn(v => !v)}
              >
                <span className="dot" />
                <span className="lbl">{on ? 'Masquer grille' : 'Afficher grille'}</span>
              </button>

              <div className="mb-grid">
                <div className="mb-band">
                  <p className="mb-kicker" style={{ gridColumn: '1 / 5' }}>NEYA · Saison 2026</p>
                  <p className="mb-folio" style={{ gridColumn: '10 / 13', textAlign: 'right' }}>
                    Touche G · grille
                  </p>
                </div>

                <div className="mb-band">
                  <h1 className="mb-masthead" style={{ gridColumn: '1 / 9' }}>
                    Marchés
                  </h1>
                  <p className="mb-lede" style={{ gridColumn: '9 / 13' }}>
                    Suivi des marchés artisanaux : dates, frais, contrats, logistique et ventes sur place.
                  </p>
                </div>

                <hr className="mb-rule" />

                {summary && (
                  <div className="mb-band">
                    {[
                      { label: 'Total', value: summary.total },
                      { label: 'Confirmés', value: summary.confirmed },
                      { label: 'Pipeline', value: summary.pipeline },
                      { label: 'Terminés', value: summary.done },
                      { label: 'Ventes', value: formatMoney(summary.sales_total || 0) },
                    ].map((k, i) => (
                      <div key={k.label} style={{ gridColumn: `${i * 2 + 1} / ${i * 2 + 3}` }}>
                        <p className="mb-numeral">{k.value}</p>
                        <p className="mb-numeral-label">{k.label}</p>
                      </div>
                    ))}
                  </div>
                )}

                <hr className="mb-rule" />

                <div className="mb-band">
                  <div className="mb-actions" style={{ gridColumn: '1 / 10' }}>
                    <button type="button" className="mb-btn mb-btn-primary" onClick={() => { setShowForm(true); setEditId(null); setForm(emptyForm()); }}>
                      <Plus className="h-3.5 w-3.5 inline mr-1" /> Ajouter
                    </button>
                    <button type="button" className="mb-btn" onClick={scanMail} disabled={busy === 'mail'}>
                      <Mail className="h-3.5 w-3.5 inline mr-1" /> Gmail
                    </button>
                    <button type="button" className="mb-btn" onClick={importContracts} disabled={busy === 'contracts'}>
                      <FileText className="h-3.5 w-3.5 inline mr-1" /> Contrats
                    </button>
                    <label className="mb-btn" style={{ cursor: 'pointer' }}>
                      <Upload className="h-3.5 w-3.5 inline mr-1" /> PDF
                      <input ref={fileRef} type="file" accept=".pdf,application/pdf" className="hidden" onChange={e => uploadContract(e.target.files?.[0])} />
                    </label>
                  </div>
                  <div style={{ gridColumn: '10 / 13', textAlign: 'right' }}>
                    <select className="mb-select" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
                      <option value="all">Tous</option>
                      {STATUS_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                    </select>
                  </div>
                </div>

                {info && <div className="mb-msg ok">{info}</div>}
                {err && <div className="mb-msg err">{err}</div>}

                {showForm && (
                  <form onSubmit={saveForm} className="mb-form">
                    <div className="mb-form-span">
                      <p className="mb-kicker">{editId ? 'Modifier' : 'Nouveau marché'}</p>
                    </div>
                    <div>
                      <label>Nom</label>
                      <input className="mb-input" required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
                    </div>
                    <div>
                      <label>Organisateur</label>
                      <input className="mb-input" value={form.organizer} onChange={e => setForm({ ...form, organizer: e.target.value })} />
                    </div>
                    <div>
                      <label>Date début</label>
                      <input type="date" className="mb-input" value={form.start_date} onChange={e => setForm({ ...form, start_date: e.target.value })} />
                    </div>
                    <div>
                      <label>Date fin</label>
                      <input type="date" className="mb-input" value={form.end_date} onChange={e => setForm({ ...form, end_date: e.target.value })} />
                    </div>
                    <div>
                      <label>Frais ($)</label>
                      <input type="number" step="0.01" className="mb-input" value={form.fee_amount} onChange={e => setForm({ ...form, fee_amount: e.target.value })} />
                    </div>
                    <div>
                      <label>Statut</label>
                      <select className="mb-input" value={form.status} onChange={e => setForm({ ...form, status: e.target.value })}>
                        {STATUS_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                      </select>
                    </div>
                    <div className="mb-form-span">
                      <label>Lieu</label>
                      <input className="mb-input" value={form.venue} onChange={e => setForm({ ...form, venue: e.target.value })} />
                    </div>
                    <div>
                      <label>Montage dès</label>
                      <input className="mb-input" value={form.setup_start} onChange={e => setForm({ ...form, setup_start: e.target.value })} />
                    </div>
                    <div>
                      <label>Présence avant</label>
                      <input className="mb-input" value={form.presence_deadline} onChange={e => setForm({ ...form, presence_deadline: e.target.value })} />
                    </div>
                    <div>
                      <label>Ventes ($)</label>
                      <input type="number" step="0.01" className="mb-input" value={form.sales_total} onChange={e => setForm({ ...form, sales_total: e.target.value })} />
                    </div>
                    <div>
                      <label>Notes frais</label>
                      <input className="mb-input" value={form.fee_notes} onChange={e => setForm({ ...form, fee_notes: e.target.value })} />
                    </div>
                    <label className="mb-form-span" style={{ display: 'flex', alignItems: 'center', gap: 8, textTransform: 'none', letterSpacing: 0, fontFamily: 'inherit', fontSize: 14 }}>
                      <input type="checkbox" checked={form.fee_paid} onChange={e => setForm({ ...form, fee_paid: e.target.checked })} />
                      Frais d&apos;inscription payés
                    </label>
                    <div className="mb-actions mb-form-span">
                      <button type="submit" className="mb-btn mb-btn-primary" disabled={busy === 'save'}>
                        {busy === 'save' ? '…' : 'Enregistrer'}
                      </button>
                      <button type="button" className="mb-btn" onClick={() => { setShowForm(false); setEditId(null); }}>Annuler</button>
                    </div>
                  </form>
                )}

                <div className="mb-table-wrap">
                  <table className="mb-table">
                    <thead>
                      <tr>
                        <th style={{ width: 32 }} />
                        <th>Événement</th>
                        <th>Dates</th>
                        <th>Frais</th>
                        <th>Statut</th>
                        <th>Ventes</th>
                        <th style={{ width: 64 }}>Ordre</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.length === 0 && (
                        <tr>
                          <td colSpan={7} style={{ padding: 40, textAlign: 'center', color: 'var(--ink-soft)' }}>
                            Aucun marché — importez la fiche ou ajoutez une ligne.
                          </td>
                        </tr>
                      )}
                      {filtered.map((ev, idx) => {
                        const open = expanded === ev.id;
                        return (
                          <Fragment key={ev.id}>
                            <tr>
                              <td>
                                <button type="button" className="mb-icon-btn" onClick={() => setExpanded(open ? null : ev.id)}>
                                  {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                                </button>
                              </td>
                              <td>
                                <button type="button" className="mb-name-btn" onClick={() => startEdit(ev)}>
                                  {ev.name}
                                </button>
                                {ev.organizer && (
                                  <p className="mb-folio" style={{ margin: '4px 0 0', maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {ev.organizer}
                                  </p>
                                )}
                              </td>
                              <td style={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{dateRange(ev)}</td>
                              <td>
                                <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                                  {ev.fee_amount != null ? formatMoney(ev.fee_amount) : ev.fee_notes || '—'}
                                </span>
                                {ev.fee_paid && <div className="mb-chip">Payé</div>}
                              </td>
                              <td>
                                <select
                                  className="mb-status"
                                  value={ev.status}
                                  onChange={e => patch(ev.id, { status: e.target.value })}
                                >
                                  {STATUS_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                                </select>
                                {ev.task_id && ['accepted', 'confirmed', 'done'].includes(ev.status) && (
                                  <p className="mb-folio" style={{ margin: '4px 0 0' }}>Agenda</p>
                                )}
                              </td>
                              <td style={{ fontVariantNumeric: 'tabular-nums' }}>{formatMoney(ev.sales_total || 0)}</td>
                              <td>
                                <button type="button" className="mb-icon-btn" disabled={idx === 0} onClick={() => moveRow(ev.id, -1)}>
                                  <ArrowUp className="h-4 w-4" />
                                </button>
                                <button type="button" className="mb-icon-btn" disabled={idx === filtered.length - 1} onClick={() => moveRow(ev.id, 1)}>
                                  <ArrowDown className="h-4 w-4" />
                                </button>
                              </td>
                            </tr>
                            {open && (
                              <tr>
                                <td colSpan={7} style={{ padding: 0 }}>
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

                <div className="mb-band" style={{ marginTop: 24 }}>
                  <p className="mb-folio" style={{ gridColumn: '1 / 13' }}>
                    Marchés acceptés / confirmés →{' '}
                    <Link href="/calendar" className="mb-link">calendrier</Link>
                    {' · '}
                    Distinct de la{' '}
                    <Link href="/marketplace" className="mb-link">marketplace en ligne</Link>
                    {' · '}
                    Grille Müller-Brockmann (12 col · baseline 8 px)
                  </p>
                </div>
              </div>

              <div ref={guidesRef} className="mb-guides" aria-hidden="true">
                <div className="cols" />
                <div className="rows" />
                <div className="mline l" />
                <div className="mline r" />
              </div>
            </div>
          </section>
        </div>
      </AppShell>
    </AuthGuard>
  );
}

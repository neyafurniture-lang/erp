'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Search, Plus, Mail, MapPin, Phone, ChevronRight, Inbox, Sparkles } from 'lucide-react';
import AppShell from '../../components/AppShell';
import AuthGuard from '../../components/AuthGuard';
import { api, formatMoney } from '../../lib/api';

function initials(name) {
  return String(name || '?')
    .split(/\s+/)
    .map(n => n[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

function relativeLast(dateLike) {
  if (!dateLike) return '—';
  const d = new Date(dateLike);
  if (Number.isNaN(d.getTime())) return '—';
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startThat = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diff = Math.round((startToday - startThat) / 86400000);
  if (diff <= 0) return "Aujourd'hui";
  if (diff === 1) return 'Hier';
  if (diff < 7) return `${diff} j`;
  if (diff < 30) return `${Math.floor(diff / 7)} sem`;
  if (diff < 60) return '1 mois';
  return d.toLocaleDateString('fr-CA', { day: 'numeric', month: 'short' });
}

function toneLabel(tone) {
  if (tone === 'fidele') return 'Fidèle';
  if (tone === 'prospect') return 'Prospect';
  if (tone === 'active') return 'Actif';
  return 'Archivé';
}

function toneClass(tone) {
  if (tone === 'fidele') return 'bg-neya-orange-soft text-neya-orange border-neya-orange/25';
  if (tone === 'prospect') return 'bg-amber-50 text-amber-800 border-amber-200';
  if (tone === 'active') return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  return 'bg-neya-surface text-neya-muted border-neya-border';
}

export default function ClientsPage() {
  return (
    <AuthGuard>
      <AppShell title="Clients" subtitle="Répertoire clients de l'atelier" wide>
        <Suspense fallback={<p className="text-neya-muted">Chargement…</p>}>
          <ClientsContent />
        </Suspense>
      </AppShell>
    </AuthGuard>
  );
}

function ClientsContent() {
  const searchParams = useSearchParams();
  const [clients, setClients] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [query, setQuery] = useState('');
  const [form, setForm] = useState({ name: '', contact: '', email: '', phone: '', address: '', city: '', notes: '' });
  const [editId, setEditId] = useState(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importLoading, setImportLoading] = useState(false);
  const [importSaving, setImportSaving] = useState(false);
  const [importError, setImportError] = useState('');
  const [importResult, setImportResult] = useState(null);
  const [candidates, setCandidates] = useState([]);
  const [selected, setSelected] = useState({});
  const [nameEdits, setNameEdits] = useState({});
  const [enriching, setEnriching] = useState(false);
  const [enrichInfo, setEnrichInfo] = useState('');
  const [enrichErr, setEnrichErr] = useState('');

  const load = () => api('/clients').then(setClients);

  useEffect(() => {
    load();
    window.addEventListener('neya:assistant-action', load);
    return () => window.removeEventListener('neya:assistant-action', load);
  }, []);

  useEffect(() => {
    const editParam = searchParams.get('edit');
    if (!editParam || clients.length === 0) return;
    const c = clients.find(x => String(x.id) === editParam);
    if (c) startEdit(c);
  }, [searchParams, clients]);

  async function save(e) {
    e.preventDefault();
    if (editId) {
      await api(`/clients/${editId}`, { method: 'PUT', body: JSON.stringify(form) });
    } else {
      await api('/clients', { method: 'POST', body: JSON.stringify(form) });
    }
    setShowForm(false);
    setEditId(null);
    setForm({ name: '', contact: '', email: '', phone: '', address: '', city: '', notes: '' });
    load();
  }

  function startEdit(c) {
    setForm({
      name: c.name,
      contact: c.contact || '',
      email: c.email || '',
      phone: c.phone || '',
      address: c.address || '',
      city: c.city || '',
      notes: c.notes || '',
    });
    setEditId(c.id);
    setShowForm(true);
  }

  async function openMailImport() {
    setImportOpen(true);
    setImportError('');
    setImportResult(null);
    setImportLoading(true);
    try {
      const data = await api('/clients/from-mail/scan', {
        method: 'POST',
        body: JSON.stringify({ max_messages: 400 }),
      });
      const list = data.candidates || [];
      setCandidates(list);
      const sel = {};
      const names = {};
      list.forEach(c => {
        sel[c.email] = Boolean(c.selected);
        names[c.email] = c.suggested_name || '';
      });
      setSelected(sel);
      setNameEdits(names);
    } catch (err) {
      setImportError(err.message || 'Scan impossible');
      setCandidates([]);
    } finally {
      setImportLoading(false);
    }
  }

  async function enrichFromMail() {
    setEnriching(true);
    setEnrichErr('');
    setEnrichInfo('');
    try {
      const result = await api('/clients/enrich-from-mail', {
        method: 'POST',
        body: JSON.stringify({ limit: 60, use_ai: true }),
      });
      setEnrichInfo(
        `${result.updated || 0} fiche${(result.updated || 0) !== 1 ? 's' : ''} complétée${(result.updated || 0) !== 1 ? 's' : ''} sur ${result.scanned || 0} client(s) incomplets (champs vides seulement).`
      );
      await load();
    } catch (err) {
      setEnrichErr(err.message || 'Enrichissement impossible');
    } finally {
      setEnriching(false);
    }
  }

  function toggleAll(on) {
    const next = {};
    candidates.forEach(c => { next[c.email] = on; });
    setSelected(next);
  }

  async function confirmImport() {
    const clientsPayload = candidates
      .filter(c => selected[c.email])
      .map(c => ({
        email: c.email,
        name: nameEdits[c.email] || c.suggested_name,
      }));
    if (!clientsPayload.length) {
      setImportError('Sélectionnez au moins un contact');
      return;
    }
    setImportSaving(true);
    setImportError('');
    try {
      const result = await api('/clients/from-mail/import', {
        method: 'POST',
        body: JSON.stringify({ clients: clientsPayload }),
      });
      setImportResult(result);
      load();
      if (result.created_count > 0) {
        setCandidates(prev => prev.filter(c => !result.created.some(x => x.email === c.email)));
      }
    } catch (err) {
      setImportError(err.message || 'Import échoué');
    } finally {
      setImportSaving(false);
    }
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return clients;
    return clients.filter(c =>
      [c.name, c.contact, c.email, c.phone, c.city, c.address]
        .filter(Boolean)
        .some(v => String(v).toLowerCase().includes(q))
    );
  }, [clients, query]);

  const activeCount = clients.filter(c => c.tone === 'active' || c.active_projects > 0).length;
  const selectedCount = Object.values(selected).filter(Boolean).length;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-[26px] font-semibold text-neya-ink lg:hidden">Clients</h1>
          <p className="text-sm text-neya-muted">
            {clients.length} compte{clients.length > 1 ? 's' : ''}
            {activeCount ? ` · ${activeCount} actif${activeCount > 1 ? 's' : ''}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={enrichFromMail}
            disabled={enriching}
            className="btn-secondary gap-1.5 shrink-0"
            title="Remplit tél., adresse, mail manquants depuis les courriels liés"
          >
            <Sparkles className="h-4 w-4" />
            {enriching ? 'Complétion…' : 'Compléter depuis les mails'}
          </button>
          <button
            type="button"
            onClick={openMailImport}
            className="btn-secondary gap-1.5 shrink-0"
          >
            <Inbox className="h-4 w-4" /> Depuis le courriel
          </button>
          <button
            type="button"
            onClick={() => {
              setShowForm(true);
              setEditId(null);
              setForm({ name: '', contact: '', email: '', phone: '', address: '', city: '', notes: '' });
            }}
            className="btn-primary gap-1.5 shrink-0"
          >
            <Plus className="h-4 w-4" /> Nouveau client
          </button>
        </div>
      </div>

      {(enrichInfo || enrichErr) && (
        <p className={`text-sm ${enrichErr ? 'text-red-700' : 'text-emerald-700'}`}>
          {enrichErr || enrichInfo}
        </p>
      )}

      {importOpen && (
        <div className="card rounded-2xl space-y-4 border-neya-orange/20">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-display text-lg font-semibold text-neya-ink">Import depuis la boîte mail</h2>
              <p className="text-sm text-neya-muted mt-0.5">
                Contacts externes détectés (hors fournisseurs / newsletters) qui n’ont pas encore de fiche.
              </p>
            </div>
            <button type="button" className="btn-secondary text-sm" onClick={() => setImportOpen(false)}>
              Fermer
            </button>
          </div>

          {importLoading && <p className="text-sm text-neya-muted">Scan de la boîte mail en cours…</p>}
          {importError && <p className="text-sm text-red-600">{importError}</p>}
          {importResult && (
            <p className="text-sm text-emerald-700">
              {importResult.created_count} fiche{importResult.created_count > 1 ? 's' : ''} créée
              {importResult.created_count > 1 ? 's' : ''}
              {importResult.skipped?.length ? ` · ${importResult.skipped.length} ignorée(s)` : ''}
            </p>
          )}

          {!importLoading && candidates.length > 0 && (
            <>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <button type="button" className="text-neya-orange hover:underline" onClick={() => toggleAll(true)}>
                  Tout sélectionner
                </button>
                <span className="text-neya-muted">·</span>
                <button type="button" className="text-neya-muted hover:underline" onClick={() => toggleAll(false)}>
                  Tout désélectionner
                </button>
                <span className="text-neya-muted ml-auto">{selectedCount} sélectionné{selectedCount > 1 ? 's' : ''}</span>
              </div>
              <div className="max-h-[420px] overflow-y-auto rounded-xl border border-neya-border divide-y divide-neya-border">
                {candidates.map(c => (
                  <label key={c.email} className="flex items-start gap-3 p-3 hover:bg-neya-surface/60 cursor-pointer">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={Boolean(selected[c.email])}
                      onChange={e => setSelected(prev => ({ ...prev, [c.email]: e.target.checked }))}
                    />
                    <div className="min-w-0 flex-1 space-y-1">
                      <input
                        className="input h-9 text-sm"
                        value={nameEdits[c.email] || ''}
                        onChange={e => setNameEdits(prev => ({ ...prev, [c.email]: e.target.value }))}
                        onClick={e => e.stopPropagation()}
                      />
                      <p className="text-[12px] text-neya-muted truncate">{c.email}</p>
                      <p className="text-[11px] text-neya-muted">
                        {c.message_count} message{c.message_count > 1 ? 's' : ''}
                        {c.last_subject ? ` · ${c.last_subject}` : ''}
                      </p>
                    </div>
                  </label>
                ))}
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="btn-primary"
                  disabled={importSaving || selectedCount === 0}
                  onClick={confirmImport}
                >
                  {importSaving ? 'Création…' : `Créer ${selectedCount} fiche${selectedCount > 1 ? 's' : ''}`}
                </button>
                <button type="button" className="btn-secondary" onClick={openMailImport} disabled={importLoading}>
                  Rescanner
                </button>
              </div>
            </>
          )}

          {!importLoading && !importError && candidates.length === 0 && (
            <p className="text-sm text-neya-muted py-4 text-center">
              Aucun nouveau contact client trouvé dans la boîte mail.
            </p>
          )}
        </div>
      )}

      <div className="relative max-w-xl">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neya-muted" aria-hidden />
        <input
          type="search"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Rechercher un client, une ville…"
          className="cf-page-search h-11 pl-10 text-[13.5px]"
        />
      </div>

      {showForm && (
        <form onSubmit={save} className="card rounded-2xl grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="label">Nom</label>
            <input className="input" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required />
          </div>
          <div>
            <label className="label">Contact</label>
            <input className="input" value={form.contact} onChange={e => setForm({ ...form, contact: e.target.value })} />
          </div>
          <div>
            <label className="label">Email</label>
            <input type="email" className="input" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
          </div>
          <div>
            <label className="label">Téléphone</label>
            <input className="input" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} />
          </div>
          <div>
            <label className="label">Adresse</label>
            <input className="input" value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} />
          </div>
          <div>
            <label className="label">Ville / Province</label>
            <input className="input" value={form.city} onChange={e => setForm({ ...form, city: e.target.value })} placeholder="Montréal QC" />
          </div>
          <div className="md:col-span-2">
            <label className="label">Notes</label>
            <textarea className="input" rows={2} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} />
          </div>
          <div className="md:col-span-2 flex gap-2">
            <button type="submit" className="btn-primary">{editId ? 'Modifier' : 'Créer'}</button>
            <button type="button" onClick={() => setShowForm(false)} className="btn-secondary">Annuler</button>
          </div>
        </form>
      )}

      {/* Mobile cards — Craft Flow */}
      <ul className="space-y-2 lg:hidden">
        {filtered.map(c => {
          const projects = Number(c.project_count || 0);
          const total = Number(c.total_billed || c.total_invoiced || 0);
          return (
            <li key={c.id}>
              <Link
                href={`/clients/${c.id}`}
                className="flex w-full items-center gap-3 rounded-2xl border border-neya-border bg-white p-3.5 text-left shadow-sm"
              >
                <div className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-neya-ink font-display text-[13px] font-semibold text-white">
                  {initials(c.name)}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-semibold text-neya-ink">{c.name}</p>
                  <p className="truncate text-[11.5px] text-neya-muted mt-0.5">
                    {[c.city || '—', `${projects} projet${projects > 1 ? 's' : ''}`, formatMoney(total)].join(' · ')}
                  </p>
                </div>
                <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${toneClass(c.tone)}`}>
                  {toneLabel(c.tone)}
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-neya-muted" />
              </Link>
            </li>
          );
        })}
        {filtered.length === 0 && (
          <li className="card rounded-2xl text-center py-10 text-sm text-neya-muted">Aucun client</li>
        )}
      </ul>

      {/* Desktop table — Craft Flow */}
      <div className="cf-table-wrap hidden lg:block">
        <table className="w-full text-[13px]">
          <thead>
            <tr>
              <th className="px-5 py-3">Client</th>
              <th className="px-5 py-3">Ville</th>
              <th className="px-5 py-3">Projets</th>
              <th className="px-5 py-3">Total facturé</th>
              <th className="px-5 py-3">Statut</th>
              <th className="px-5 py-3">Dernier contact</th>
              <th className="px-5 py-3 text-right"> </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neya-border">
            {filtered.map(c => {
              const projects = Number(c.project_count || 0);
              const total = Number(c.total_billed || c.total_invoiced || 0);
              return (
                <tr key={c.id}>
                  <td className="px-5 py-3">
                    <Link href={`/clients/${c.id}`} className="flex items-center gap-3 min-w-0">
                      <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-neya-ink font-display text-[12px] font-semibold text-white">
                        {initials(c.name)}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-neya-ink">{c.name}</p>
                        {c.email ? (
                          <p className="flex items-center gap-1.5 truncate text-[11px] text-neya-muted">
                            <Mail className="h-3 w-3" /> {c.email}
                          </p>
                        ) : c.phone ? (
                          <p className="flex items-center gap-1.5 truncate text-[11px] text-neya-muted">
                            <Phone className="h-3 w-3" /> {c.phone}
                          </p>
                        ) : null}
                      </div>
                    </Link>
                  </td>
                  <td className="px-5 py-3 text-neya-ink-light">
                    {c.city ? (
                      <span className="inline-flex items-center gap-1.5">
                        <MapPin className="h-3 w-3 text-neya-muted" /> {c.city}
                      </span>
                    ) : '—'}
                  </td>
                  <td className="px-5 py-3 tabular-nums font-medium text-neya-ink">{projects}</td>
                  <td className="px-5 py-3 tabular-nums font-medium text-neya-ink">{formatMoney(total)}</td>
                  <td className="px-5 py-3">
                    <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${toneClass(c.tone)}`}>
                      {toneLabel(c.tone)}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-neya-muted">
                    {c.open_quotes > 0 && !c.last_activity_at ? 'Devis' : relativeLast(c.last_activity_at)}
                  </td>
                  <td className="px-5 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => startEdit(c)}
                      className="text-xs font-medium text-neya-orange hover:underline"
                    >
                      Modifier
                    </button>
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="px-5 py-10 text-center text-neya-muted">Aucun client</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

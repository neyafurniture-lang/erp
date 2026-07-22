'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import AppShell from '../../../components/AppShell';
import AuthGuard from '../../../components/AuthGuard';
import {
  api, formatMoney, formatDate, projectStatusMeta,
  INVOICE_STATUS, QUOTE_STATUS, downloadPdf,
} from '../../../lib/api';
import { isCustomProject } from '../../../lib/projects';
import { useRegisterChatContext } from '../../../lib/chat-context';

function StatusBadge({ map, status }) {
  const st = map[status] || { label: status, color: 'bg-gray-100 text-gray-700' };
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full ${st.color}`}>{st.label}</span>
  );
}

export default function ClientDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const [client, setClient] = useState(null);
  const [tab, setTab] = useState('projects');
  const [error, setError] = useState('');
  const [creatingQuote, setCreatingQuote] = useState(false);
  const [creatingProject, setCreatingProject] = useState(false);

  useEffect(() => {
    if (!id) return;
    api(`/clients/${id}`)
      .then(setClient)
      .catch(() => setError('Client introuvable'));
  }, [id]);

  useEffect(() => {
    const load = () => api(`/clients/${id}`).then(setClient).catch(() => {});
    window.addEventListener('neya:assistant-action', load);
    return () => window.removeEventListener('neya:assistant-action', load);
  }, [id]);

  useRegisterChatContext(client ? {
    type: 'client',
    id: client.id,
    label: client.name,
    meta: { email: client.email, phone: client.phone },
  } : null);

  async function openPdf(type, docId, filename) {
    const path = type === 'quote'
      ? `/invoices/quotes/${docId}/pdf`
      : `/invoices/${docId}/pdf`;
    await downloadPdf(path, filename);
  }

  async function createQuote() {
    setCreatingQuote(true);
    try {
      const quote = await api('/invoices/quotes', {
        method: 'POST',
        body: JSON.stringify({
          client_id: Number(id),
          title: `Projet — ${client.name}`,
          lines: [{ description: '', qty: 1, price: 0 }],
        }),
      });
      router.push(`/invoices/quotes/${quote.id}`);
    } catch (err) {
      setError(err.message);
      setCreatingQuote(false);
    }
  }

  async function createLinkedProject() {
    setCreatingProject(true);
    setError('');
    try {
      const project = await api('/projects', {
        method: 'POST',
        body: JSON.stringify({
          name: `Projet — ${client.name}`,
          client_id: Number(id),
        }),
      });
      router.push(`/projects/${project.id}`);
    } catch (err) {
      setError(err.message);
      setCreatingProject(false);
    }
  }

  if (error) {
    return (
      <AuthGuard>
        <AppShell title="Client">
          <p className="text-neya-muted mb-4">{error}</p>
          <Link href="/clients" className="btn-secondary">Retour aux clients</Link>
        </AppShell>
      </AuthGuard>
    );
  }

  if (!client) {
    return (
      <AuthGuard>
        <AppShell title="Client">
          <p className="text-neya-muted">Chargement…</p>
        </AppShell>
      </AuthGuard>
    );
  }

  const tabs = [
    { key: 'projects', label: 'Projets', count: client.projects?.length || 0 },
    { key: 'quotes', label: 'Devis', count: client.quotes?.length || 0 },
    { key: 'invoices', label: 'Factures', count: client.invoices?.length || 0 },
  ];

  return (
    <AuthGuard>
      <AppShell title={client.name}>
        <Link href="/clients" className="text-sm text-neya-orange hover:underline mb-4 inline-block">
          ← Retour aux clients
        </Link>

        <div className="card mb-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="font-heading text-2xl text-neya-ink">{client.name}</h1>
              {client.contact && <p className="text-sm text-neya-muted mt-1">{client.contact}</p>}
            </div>
            <Link href={`/clients?edit=${client.id}`} className="btn-secondary text-sm">
              Modifier
            </Link>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-4 pt-4 border-t border-neya-border text-sm">
            {client.email && (
              <div>
                <p className="text-[10px] uppercase tracking-wider text-neya-muted">Email</p>
                <a href={`mailto:${client.email}`} className="text-neya-ink hover:text-neya-orange">{client.email}</a>
              </div>
            )}
            {client.phone && (
              <div>
                <p className="text-[10px] uppercase tracking-wider text-neya-muted">Téléphone</p>
                <p className="text-neya-ink">{client.phone}</p>
              </div>
            )}
            {(client.address || client.city) && (
              <div className="sm:col-span-2">
                <p className="text-[10px] uppercase tracking-wider text-neya-muted">Adresse</p>
                <p className="text-neya-ink">
                  {[client.address, client.city].filter(Boolean).join(', ')}
                </p>
              </div>
            )}
          </div>
          {client.notes && (
            <p className="text-xs text-neya-muted mt-4 pt-4 border-t border-neya-border italic">{client.notes}</p>
          )}
        </div>

        <div className="flex flex-wrap gap-2 mb-6">
          {tabs.map(t => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                tab === t.key
                  ? 'bg-neya-orange text-white'
                  : 'bg-white border border-neya-border text-neya-muted hover:border-neya-orange'
              }`}
            >
              {t.label} ({t.count})
            </button>
          ))}
        </div>

        {tab === 'projects' && (
          <div className="space-y-3">
            <div className="flex justify-end">
              <button
                type="button"
                onClick={createLinkedProject}
                disabled={creatingProject}
                className="btn-primary text-sm"
              >
                {creatingProject ? '…' : '+ Projet lié à ce client'}
              </button>
            </div>
            {client.projects?.length === 0 ? (
              <p className="text-sm text-neya-muted card">Aucun projet pour ce client.</p>
            ) : (
              client.projects.map(p => {
                const st = projectStatusMeta(p.status);
                const custom = isCustomProject(p);
                return (
                  <Link
                    key={p.id}
                    href={`/projects/${p.id}`}
                    className="card block hover:border-neya-orange transition-colors"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="font-heading text-lg text-neya-ink">{p.name}</h3>
                        <p className="text-xs text-neya-muted mt-1">
                          Deadline : {formatDate(p.deadline)}
                          {custom && p.tasks_total > 0 && (
                            <span className="ml-2 text-neya-orange">
                              · Checklist {p.tasks_done}/{p.tasks_total}
                            </span>
                          )}
                        </p>
                      </div>
                      <span className={`text-xs px-2 py-1 rounded-full text-white shrink-0 ${st.color}`}>
                        {st.label}
                      </span>
                    </div>
                  </Link>
                );
              })
            )}
            <Link href="/projects" className="inline-block text-sm text-neya-orange hover:underline mt-2">
              Voir tous les projets →
            </Link>
          </div>
        )}

        {tab === 'quotes' && (
          <div className="card overflow-x-auto">
            <div className="flex justify-end mb-4">
              <button
                type="button"
                onClick={createQuote}
                disabled={creatingQuote}
                className="btn-primary text-sm"
              >
                {creatingQuote ? 'Création…' : '+ Nouveau devis'}
              </button>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neya-border text-left text-neya-muted">
                  <th className="pb-3 pr-4">N°</th>
                  <th className="pb-3 pr-4">Titre / Projet</th>
                  <th className="pb-3 pr-4">Date</th>
                  <th className="pb-3 pr-4">Total</th>
                  <th className="pb-3 pr-4">Statut</th>
                  <th className="pb-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {client.quotes?.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-neya-muted">Aucun devis</td>
                  </tr>
                ) : (
                  client.quotes.map(q => (
                    <tr key={q.id} className="border-b border-neya-border hover:bg-neya-cream/30">
                      <td className="py-3 pr-4 font-medium">
                        <Link href={`/invoices/quotes/${q.id}`} className="text-neya-orange hover:underline">
                          {q.quote_number}
                        </Link>
                      </td>
                      <td className="py-3 pr-4">
                        <Link href={`/invoices/quotes/${q.id}`} className="hover:text-neya-orange">
                          <p>{q.title || q.project_name || '—'}</p>
                        </Link>
                        {q.reference && <p className="text-xs text-neya-muted">{q.reference}</p>}
                      </td>
                      <td className="py-3 pr-4 text-neya-muted">{formatDate(q.created_at)}</td>
                      <td className="py-3 pr-4 font-medium">{formatMoney(q.total)}</td>
                      <td className="py-3 pr-4">
                        <StatusBadge map={QUOTE_STATUS} status={q.status} />
                      </td>
                      <td className="py-3">
                        <div className="flex gap-2 items-center flex-wrap">
                          <button
                            type="button"
                            onClick={() => openPdf('quote', q.id, `devis-${q.quote_number}.pdf`)}
                            className="text-xs bg-neya-cream hover:bg-neya-cream-dark px-2 py-1 rounded text-neya-orange"
                          >
                            PDF
                          </button>
                          {q.invoice_id && (
                            <Link href={`/invoices/${q.invoice_id}`} className="text-xs text-neya-success hover:underline">
                              → Facture #{q.invoice_number}
                            </Link>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
            <Link href="/invoices" className="inline-block text-sm text-neya-orange hover:underline mt-4">
              Gérer les devis →
            </Link>
          </div>
        )}

        {tab === 'invoices' && (
          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neya-border text-left text-neya-muted">
                  <th className="pb-3 pr-4">N°</th>
                  <th className="pb-3 pr-4">Titre / Projet</th>
                  <th className="pb-3 pr-4">Date</th>
                  <th className="pb-3 pr-4">Total</th>
                  <th className="pb-3 pr-4">Payé</th>
                  <th className="pb-3 pr-4">Statut</th>
                  <th className="pb-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {client.invoices?.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-neya-muted">Aucune facture</td>
                  </tr>
                ) : (
                  client.invoices.map(inv => (
                    <tr key={inv.id} className="border-b border-neya-border hover:bg-neya-cream/30">
                      <td className="py-3 pr-4 font-medium">
                        <Link href={`/invoices/${inv.id}`} className="text-neya-orange hover:underline">
                          {inv.invoice_number}
                        </Link>
                      </td>
                      <td className="py-3 pr-4">
                        <Link href={`/invoices/${inv.id}`} className="hover:text-neya-orange">
                          <p>{inv.title || inv.project_name || '—'}</p>
                        </Link>
                        {inv.subtitle && <p className="text-xs text-neya-muted">{inv.subtitle}</p>}
                      </td>
                      <td className="py-3 pr-4 text-neya-muted">{formatDate(inv.created_at)}</td>
                      <td className="py-3 pr-4 font-medium">{formatMoney(inv.total)}</td>
                      <td className="py-3 pr-4 text-neya-muted">{formatMoney(inv.amount_paid || 0)}</td>
                      <td className="py-3 pr-4">
                        <StatusBadge map={INVOICE_STATUS} status={inv.status} />
                      </td>
                      <td className="py-3">
                        <button
                          type="button"
                          onClick={() => openPdf('invoice', inv.id, `facture-${inv.invoice_number}.pdf`)}
                          className="text-xs bg-neya-cream hover:bg-neya-cream-dark px-2 py-1 rounded text-neya-orange"
                        >
                          PDF
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
            <Link href="/invoices" className="inline-block text-sm text-neya-orange hover:underline mt-4">
              Gérer les factures →
            </Link>
          </div>
        )}
      </AppShell>
    </AuthGuard>
  );
}

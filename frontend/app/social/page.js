'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  CalendarClock,
  BarChart3,
  Sparkles,
  Plus,
  Trash2,
  Check,
  Image as ImageIcon,
  Share2,
  Link2,
  Unlink,
  Images,
} from 'lucide-react';
import AppShell from '../../components/AppShell';
import AuthGuard from '../../components/AuthGuard';
import { api, formatDate } from '../../lib/api';

const TABS = [
  { id: 'accounts', label: 'Comptes', Icon: Link2 },
  { id: 'media', label: 'Médias', Icon: Images },
  { id: 'propose', label: 'À publier', Icon: Sparkles },
  { id: 'plan', label: 'Calendrier', Icon: CalendarClock },
  { id: 'analytics', label: 'Analytics', Icon: BarChart3 },
];

const PLATFORM_LABEL = {
  instagram: 'Instagram',
  facebook: 'Facebook',
  pinterest: 'Pinterest',
  tiktok: 'TikTok',
  linkedin: 'LinkedIn',
};

const STATUS_LABEL = {
  draft: 'Brouillon',
  scheduled: 'Planifié',
  published: 'Publié',
  needs_credentials: 'Configurer',
  ready: 'Prêt à connecter',
  connected: 'Connecté',
};

function PlatformChips({ platforms = [] }) {
  return (
    <div className="flex flex-wrap gap-1">
      {platforms.map(p => (
        <span key={p} className="rounded-full bg-neya-surface border border-neya-border px-2 py-0.5 text-[10px] font-medium text-neya-ink-light">
          {PLATFORM_LABEL[p] || p}
        </span>
      ))}
    </div>
  );
}

function ScoreBadge({ analysis }) {
  if (!analysis) return null;
  const score = analysis.score ?? 0;
  const tone = score >= 70 ? 'bg-emerald-100 text-emerald-800' : score >= 45 ? 'bg-amber-100 text-amber-900' : 'bg-red-100 text-red-800';
  return (
    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-md ${tone}`}>
      {score}/100 · {analysis.verdict || '—'}
    </span>
  );
}

export default function SocialPage() {
  const [tab, setTab] = useState('accounts');
  const [posts, setPosts] = useState([]);
  const [proposals, setProposals] = useState([]);
  const [proposeMeta, setProposeMeta] = useState(null);
  const [media, setMedia] = useState([]);
  const [mediaMeta, setMediaMeta] = useState(null);
  const [accountsData, setAccountsData] = useState(null);
  const [analytics, setAnalytics] = useState(null);
  const [platforms, setPlatforms] = useState([]);
  const [loadingPropose, setLoadingPropose] = useState(false);
  const [loadingMedia, setLoadingMedia] = useState(false);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [busyKey, setBusyKey] = useState('');
  const [mediaQuery, setMediaQuery] = useState('');
  const [form, setForm] = useState({
    title: '',
    caption: '',
    platforms: ['instagram', 'facebook'],
    scheduled_at: '',
    status: 'scheduled',
  });

  const loadPosts = useCallback(async () => {
    const list = await api('/social').catch(() => []);
    setPosts(Array.isArray(list) ? list : []);
  }, []);

  const loadAnalytics = useCallback(async () => {
    const a = await api('/social/analytics').catch(() => null);
    setAnalytics(a);
  }, []);

  const loadAccounts = useCallback(async () => {
    const data = await api('/social/accounts').catch(() => null);
    setAccountsData(data);
  }, []);

  const loadMedia = useCallback(async (q = '') => {
    setLoadingMedia(true);
    try {
      const qs = new URLSearchParams({ limit: '24' });
      if (q) qs.set('q', q);
      const data = await api(`/social/media?${qs}`);
      setMedia(data.items || []);
      setMediaMeta(data);
    } catch (e) {
      setMedia([]);
      setMediaMeta({ error: e.message });
    } finally {
      setLoadingMedia(false);
    }
  }, []);

  const loadPropose = useCallback(async () => {
    setLoadingPropose(true);
    setErr('');
    try {
      const data = await api('/social/propose?limit=6');
      setProposals(data.proposals || []);
      setProposeMeta(data);
      if (data.error && !(data.proposals || []).length) setErr(data.error);
    } catch (e) {
      setErr(e.message || 'Propositions indisponibles');
      setProposals([]);
    } finally {
      setLoadingPropose(false);
    }
  }, []);

  useEffect(() => {
    api('/social/platforms').then(setPlatforms).catch(() => setPlatforms([]));
    loadPosts();
    loadAnalytics();
    loadAccounts();
  }, [loadPosts, loadAnalytics, loadAccounts]);

  useEffect(() => {
    if (tab === 'propose') loadPropose();
    if (tab === 'analytics') loadAnalytics();
    if (tab === 'plan') loadPosts();
    if (tab === 'media') loadMedia(mediaQuery);
    if (tab === 'accounts') loadAccounts();
  }, [tab, loadPropose, loadAnalytics, loadPosts, loadMedia, loadAccounts, mediaQuery]);

  const scheduled = useMemo(
    () => posts.filter(p => p.status === 'scheduled' || p.status === 'draft'),
    [posts]
  );
  const published = useMemo(
    () => posts.filter(p => p.status === 'published'),
    [posts]
  );

  function togglePlatform(value) {
    setForm(f => {
      const has = f.platforms.includes(value);
      const next = has ? f.platforms.filter(p => p !== value) : [...f.platforms, value];
      return { ...f, platforms: next.length ? next : [value] };
    });
  }

  async function connectAccount(provider) {
    setBusyKey(`connect-${provider}`);
    setErr('');
    try {
      const data = await api(`/social/accounts/${provider}/authorize`);
      if (data?.url) window.location.href = data.url;
      else throw new Error('URL OAuth manquante — configurez l’App ID dans Paramètres');
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusyKey('');
    }
  }

  async function disconnectAccount(provider) {
    if (!confirm(`Déconnecter ${PLATFORM_LABEL[provider] || provider} ?`)) return;
    setBusyKey(`disc-${provider}`);
    try {
      await api(`/social/accounts/${provider}/disconnect`, { method: 'POST', body: '{}' });
      setMsg(`${PLATFORM_LABEL[provider] || provider} déconnecté.`);
      loadAccounts();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusyKey('');
    }
  }

  async function createManual(e) {
    e.preventDefault();
    setBusyKey('manual');
    setErr('');
    try {
      await api('/social', {
        method: 'POST',
        body: JSON.stringify({
          ...form,
          scheduled_at: form.scheduled_at ? new Date(form.scheduled_at).toISOString() : null,
        }),
      });
      setShowForm(false);
      setForm({
        title: '',
        caption: '',
        platforms: ['instagram', 'facebook'],
        scheduled_at: '',
        status: 'scheduled',
      });
      setMsg('Post planifié.');
      await loadPosts();
      setTab('plan');
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setBusyKey('');
    }
  }

  async function planProposal(proposal) {
    setBusyKey(proposal.key);
    setErr('');
    setMsg('');
    try {
      await api('/social/from-proposal', {
        method: 'POST',
        body: JSON.stringify(proposal),
      });
      setMsg(`Post planifié : ${proposal.title || 'sans titre'}`);
      await loadPosts();
      setTab('plan');
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusyKey('');
    }
  }

  async function planFromMedia(item) {
    setBusyKey(`media-${item.id}`);
    try {
      await api('/social/from-proposal', {
        method: 'POST',
        body: JSON.stringify({
          title: item.name?.replace(/\.[^.]+$/, '') || 'Photo NEYA',
          caption: `Pièce d’atelier NEYA\n\n#NeyaFurniture #FaitMain`,
          platforms: item.analysis?.platforms_ok?.length ? item.analysis.platforms_ok : ['instagram', 'facebook'],
          scheduled_at: new Date(Date.now() + 86400000).toISOString(),
          media: [{
            drive_file_id: item.id,
            name: item.name,
            thumbnailLink: item.thumbnailLink,
            webViewLink: item.webViewLink,
            mimeType: item.mimeType,
            analysis: item.analysis,
          }],
          source: 'media_library',
        }),
      });
      setMsg('Photo ajoutée au calendrier.');
      await loadPosts();
      setTab('plan');
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusyKey('');
    }
  }

  async function markPublished(id) {
    await api(`/social/${id}/publish`, { method: 'PATCH' });
    loadPosts();
    loadAnalytics();
  }

  async function saveMetrics(id, metrics) {
    await api(`/social/${id}/metrics`, {
      method: 'PATCH',
      body: JSON.stringify(metrics),
    });
    loadAnalytics();
    loadPosts();
  }

  async function removePost(id) {
    if (!confirm('Supprimer ce post ?')) return;
    await api(`/social/${id}`, { method: 'DELETE' });
    loadPosts();
    loadAnalytics();
  }

  const accounts = accountsData?.accounts || [];

  return (
    <AuthGuard>
      <AppShell
        title="Réseaux sociaux"
        subtitle="Comme Buffer / Later — comptes, médiathèque photo, planning et analytics"
        wide
      >
        <div className="rounded-2xl border border-neya-border bg-white px-4 py-3 mb-5 text-sm text-neya-muted">
          <strong className="text-neya-ink font-medium">Pôle social NEYA</strong>
          {' — '}connectez Instagram, Facebook et Pinterest, analysez vos photos produit (les factures et documents sont exclus),
          puis planifiez. Publication auto Graph API dès que les App ID Meta/Pinterest sont renseignés.
          {' '}
          <Link href="/settings?tab=integrations" className="text-neya-orange hover:underline">Paramètres → Intégrations</Link>
        </div>

        <div className="flex flex-wrap items-center gap-2 mb-5">
          {TABS.map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={`inline-flex items-center gap-1.5 h-9 rounded-lg border px-3 text-[12.5px] font-medium transition-colors ${
                tab === id
                  ? 'border-neya-ink bg-neya-ink text-white'
                  : 'border-neya-border bg-white text-neya-muted hover:text-neya-ink'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => { setTab('plan'); setShowForm(true); }}
            className="btn-primary gap-1.5 text-sm h-9 ml-auto"
          >
            <Plus className="h-4 w-4" /> Composer
          </button>
        </div>

        {err && (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{err}</div>
        )}
        {msg && (
          <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{msg}</div>
        )}

        {tab === 'accounts' && (
          <section className="space-y-4">
            <p className="text-sm text-neya-muted max-w-2xl">
              Connectez vos comptes professionnels pour programmer et (bientôt) publier.
              Même logique que Meta Business Suite / Buffer : un compte = un canal.
            </p>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {accounts.map(acc => (
                <div key={acc.id} className="rounded-2xl border border-neya-border bg-white p-4 flex flex-col gap-3">
                  <div className="flex items-start gap-3">
                    <span
                      className="w-10 h-10 rounded-xl shrink-0 grid place-items-center text-white text-xs font-bold"
                      style={{ background: acc.color || '#333' }}
                    >
                      {(acc.label || '?').slice(0, 2).toUpperCase()}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-neya-ink">{acc.label}</p>
                      <p className="text-xs text-neya-muted mt-0.5">{acc.description}</p>
                      <p className="text-[11px] mt-1.5">
                        <span className={`px-2 py-0.5 rounded-full font-medium ${
                          acc.connected ? 'bg-emerald-100 text-emerald-800'
                            : acc.configured ? 'bg-amber-100 text-amber-900'
                              : 'bg-neya-surface text-neya-muted'
                        }`}>
                          {STATUS_LABEL[acc.status] || acc.status}
                        </span>
                        {acc.account_name && (
                          <span className="ml-2 text-neya-muted">{acc.account_name}</span>
                        )}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2 mt-auto">
                    {acc.connected ? (
                      <button
                        type="button"
                        className="btn-secondary text-xs gap-1"
                        disabled={busyKey === `disc-${acc.id}`}
                        onClick={() => disconnectAccount(acc.id)}
                      >
                        <Unlink className="h-3.5 w-3.5" /> Déconnecter
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn-primary text-xs gap-1"
                        disabled={busyKey === `connect-${acc.id}` || !['instagram', 'facebook', 'pinterest'].includes(acc.id)}
                        onClick={() => connectAccount(acc.id)}
                      >
                        <Link2 className="h-3.5 w-3.5" />
                        {acc.configured ? 'Connecter' : 'Configurer puis connecter'}
                      </button>
                    )}
                  </div>
                  {!acc.configured && ['instagram', 'facebook', 'pinterest'].includes(acc.id) && (
                    <p className="text-[11px] text-neya-muted">
                      Ajoutez App ID / Secret dans{' '}
                      <Link href="/settings?tab=integrations" className="text-neya-orange hover:underline">Intégrations</Link>.
                    </p>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {tab === 'media' && (
          <section className="space-y-4">
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex-1 min-w-[200px]">
                <label className="label">Chercher une photo produit</label>
                <input
                  className="input"
                  placeholder="ex. banc, table, showroom…"
                  value={mediaQuery}
                  onChange={e => setMediaQuery(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') loadMedia(mediaQuery); }}
                />
              </div>
              <button type="button" className="btn-secondary text-sm" onClick={() => loadMedia(mediaQuery)} disabled={loadingMedia}>
                {loadingMedia ? 'Analyse…' : 'Analyser Drive'}
              </button>
            </div>
            {mediaMeta?.hint && (
              <p className="text-xs text-neya-muted rounded-xl bg-neya-surface px-3 py-2">{mediaMeta.hint}</p>
            )}
            {mediaMeta?.error && (
              <p className="text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                {mediaMeta.error} —{' '}
                <Link href="/settings?tab=integrations" className="text-neya-orange hover:underline">connecter Google Drive</Link>
              </p>
            )}
            {!loadingMedia && media.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-neya-border px-6 py-10 text-center text-sm text-neya-muted">
                Aucune photo produit. Placez vos photos finales dans Drive (pas les dossiers Factures / Admin).
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {media.map(item => (
                  <article key={item.id} className="rounded-2xl border border-neya-border bg-white overflow-hidden flex flex-col">
                    <div className="aspect-square bg-neya-surface relative">
                      {item.thumbnailLink ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={item.thumbnailLink} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full grid place-items-center text-neya-muted">
                          <ImageIcon className="h-8 w-8" />
                        </div>
                      )}
                      <div className="absolute top-2 left-2">
                        <ScoreBadge analysis={item.analysis} />
                      </div>
                    </div>
                    <div className="p-3 flex flex-col gap-2 flex-1">
                      <p className="text-xs font-medium text-neya-ink truncate" title={item.name}>{item.name}</p>
                      <PlatformChips platforms={item.analysis?.platforms_ok || []} />
                      <button
                        type="button"
                        className="btn-primary text-xs mt-auto"
                        disabled={busyKey === `media-${item.id}`}
                        onClick={() => planFromMedia(item)}
                      >
                        Planifier
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        )}

        {tab === 'propose' && (
          <section className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-neya-muted max-w-xl">
                Suggestions depuis vos photos produit analysées — factures, reçus et documents exclus automatiquement.
              </p>
              <button type="button" onClick={loadPropose} disabled={loadingPropose} className="btn-secondary text-sm">
                {loadingPropose ? 'Analyse…' : 'Relancer'}
              </button>
            </div>
            {proposeMeta?.hint && (
              <p className="text-xs text-neya-muted bg-neya-surface rounded-xl px-3 py-2">{proposeMeta.hint}</p>
            )}
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {proposals.map(p => (
                <article key={p.key} className="rounded-2xl border border-neya-border bg-white overflow-hidden flex flex-col">
                  {p.media?.[0]?.thumbnailLink ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.media[0].thumbnailLink} alt="" className="h-40 w-full object-cover" />
                  ) : (
                    <div className="h-28 bg-neya-surface grid place-items-center text-neya-muted text-xs">
                      {p.source === 'local_template' ? 'Modèle' : 'Sans aperçu'}
                    </div>
                  )}
                  <div className="p-3 space-y-2 flex-1 flex flex-col">
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-medium text-sm text-neya-ink">{p.title}</p>
                      <ScoreBadge analysis={p.analysis} />
                    </div>
                    <PlatformChips platforms={p.platforms} />
                    <p className="text-xs text-neya-muted whitespace-pre-wrap line-clamp-4">{p.caption}</p>
                    <p className="text-[11px] text-neya-muted">
                      {p.scheduled_at ? formatDate(p.scheduled_at) : '—'}
                    </p>
                    <button
                      type="button"
                      className="btn-primary text-xs mt-auto"
                      disabled={busyKey === p.key}
                      onClick={() => planProposal(p)}
                    >
                      Planifier
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}

        {tab === 'plan' && (
          <section className="space-y-5">
            {showForm && (
              <form onSubmit={createManual} className="rounded-2xl border border-neya-border bg-white p-4 space-y-3">
                <p className="font-medium text-neya-ink">Composer un post</p>
                <div>
                  <label className="label">Titre</label>
                  <input className="input" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} />
                </div>
                <div>
                  <label className="label">Légende</label>
                  <textarea className="input min-h-[100px]" value={form.caption} onChange={e => setForm({ ...form, caption: e.target.value })} required />
                </div>
                <div className="flex flex-wrap gap-2">
                  {(platforms.length ? platforms.map(p => p.value || p) : Object.keys(PLATFORM_LABEL)).map(p => {
                    const value = typeof p === 'string' ? p : p.value;
                    const active = form.platforms.includes(value);
                    return (
                      <button
                        key={value}
                        type="button"
                        onClick={() => togglePlatform(value)}
                        className={`cf-chip ${active ? 'bg-neya-ink text-white border-neya-ink' : ''}`}
                      >
                        {PLATFORM_LABEL[value] || value}
                      </button>
                    );
                  })}
                </div>
                <div className="grid sm:grid-cols-2 gap-3">
                  <div>
                    <label className="label">Programmation</label>
                    <input
                      type="datetime-local"
                      className="input"
                      value={form.scheduled_at}
                      onChange={e => setForm({ ...form, scheduled_at: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="label">Statut</label>
                    <select className="input" value={form.status} onChange={e => setForm({ ...form, status: e.target.value })}>
                      <option value="draft">Brouillon</option>
                      <option value="scheduled">Planifié</option>
                      <option value="published">Publié</option>
                    </select>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button type="submit" className="btn-primary text-sm" disabled={busyKey === 'manual'}>
                    {busyKey === 'manual' ? '…' : 'Enregistrer'}
                  </button>
                  <button type="button" className="btn-secondary text-sm" onClick={() => setShowForm(false)}>Annuler</button>
                </div>
              </form>
            )}

            <div>
              <h3 className="font-display font-semibold text-neya-ink mb-2">À publier ({scheduled.length})</h3>
              {scheduled.length === 0 ? (
                <p className="text-sm text-neya-muted rounded-xl border border-dashed border-neya-border px-4 py-6">
                  Rien en file. Utilisez Médias ou Composer.
                </p>
              ) : (
                <ul className="space-y-2">
                  {scheduled.map(p => (
                    <li key={p.id} className="rounded-xl border border-neya-border bg-white px-4 py-3 flex flex-wrap gap-3 items-start">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-neya-ink">{p.title || 'Sans titre'}</p>
                        <p className="text-xs text-neya-muted mt-0.5 line-clamp-2 whitespace-pre-wrap">{p.caption}</p>
                        <div className="mt-1.5 flex flex-wrap items-center gap-2">
                          <PlatformChips platforms={p.platforms} />
                          <span className="text-[11px] text-neya-muted">
                            {STATUS_LABEL[p.status]} · {p.scheduled_at ? formatDate(p.scheduled_at) : '—'}
                          </span>
                        </div>
                      </div>
                      <div className="flex gap-1.5 shrink-0">
                        <button type="button" className="btn-secondary text-xs gap-1" onClick={() => markPublished(p.id)}>
                          <Check className="h-3.5 w-3.5" /> Publié
                        </button>
                        <button type="button" className="btn-secondary text-xs text-red-600" onClick={() => removePost(p.id)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {published.length > 0 && (
              <div>
                <h3 className="font-display font-semibold text-neya-ink mb-2">Publiés ({published.length})</h3>
                <ul className="space-y-2">
                  {published.slice(0, 12).map(p => (
                    <li key={p.id} className="rounded-xl border border-neya-border bg-white px-4 py-3">
                      <div className="flex flex-wrap justify-between gap-2">
                        <p className="text-sm font-medium">{p.title || 'Sans titre'}</p>
                        <PlatformChips platforms={p.platforms} />
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2 text-xs">
                        <label className="flex items-center gap-1 text-neya-muted">
                          Likes
                          <input
                            type="number"
                            className="input w-20 min-h-[32px] py-1"
                            defaultValue={p.metrics?.likes || ''}
                            onBlur={e => saveMetrics(p.id, { ...p.metrics, likes: Number(e.target.value) || 0 })}
                          />
                        </label>
                        <label className="flex items-center gap-1 text-neya-muted">
                          Reach
                          <input
                            type="number"
                            className="input w-20 min-h-[32px] py-1"
                            defaultValue={p.metrics?.reach || ''}
                            onBlur={e => saveMetrics(p.id, { ...p.metrics, reach: Number(e.target.value) || 0 })}
                          />
                        </label>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        )}

        {tab === 'analytics' && (
          <section className="space-y-4">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {[
                { label: 'Posts', value: analytics?.totals?.posts ?? posts.length },
                { label: 'Publiés', value: analytics?.totals?.published ?? published.length },
                { label: 'Likes', value: analytics?.totals?.likes ?? 0 },
                { label: 'Reach', value: analytics?.totals?.reach ?? 0 },
              ].map(c => (
                <div key={c.label} className="rounded-2xl border border-neya-border bg-white px-4 py-3">
                  <p className="text-[11px] uppercase tracking-wider text-neya-muted font-semibold">{c.label}</p>
                  <p className="font-display text-2xl font-semibold tabular-nums mt-1">{c.value}</p>
                </div>
              ))}
            </div>
            {analytics?.note && (
              <p className="text-xs text-neya-muted">{analytics.note}</p>
            )}
            <div className="rounded-2xl border border-neya-border bg-white overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-neya-surface text-left text-xs text-neya-muted">
                  <tr>
                    <th className="px-4 py-2 font-medium">Plateforme</th>
                    <th className="px-4 py-2 font-medium">Posts</th>
                    <th className="px-4 py-2 font-medium">Likes</th>
                    <th className="px-4 py-2 font-medium">Reach</th>
                  </tr>
                </thead>
                <tbody>
                  {(analytics?.by_platform || []).map(row => (
                    <tr key={row.platform} className="border-t border-neya-border">
                      <td className="px-4 py-2">{PLATFORM_LABEL[row.platform] || row.platform}</td>
                      <td className="px-4 py-2 tabular-nums">{row.posts}</td>
                      <td className="px-4 py-2 tabular-nums">{row.likes}</td>
                      <td className="px-4 py-2 tabular-nums">{row.reach}</td>
                    </tr>
                  ))}
                  {!(analytics?.by_platform || []).length && (
                    <tr>
                      <td colSpan={4} className="px-4 py-6 text-neya-muted text-center">Pas encore de données</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </AppShell>
    </AuthGuard>
  );
}

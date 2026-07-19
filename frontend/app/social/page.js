'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CalendarClock,
  BarChart3,
  Sparkles,
  Plus,
  Trash2,
  Check,
  Image as ImageIcon,
  Share2,
} from 'lucide-react';
import AppShell from '../../components/AppShell';
import AuthGuard from '../../components/AuthGuard';
import { api, formatDate } from '../../lib/api';

const TABS = [
  { id: 'propose', label: 'Propositions Drive', Icon: Sparkles },
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

export default function SocialPage() {
  const [tab, setTab] = useState('propose');
  const [posts, setPosts] = useState([]);
  const [proposals, setProposals] = useState([]);
  const [proposeMeta, setProposeMeta] = useState(null);
  const [analytics, setAnalytics] = useState(null);
  const [platforms, setPlatforms] = useState([]);
  const [loadingPropose, setLoadingPropose] = useState(false);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [busyKey, setBusyKey] = useState('');
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

  const loadPropose = useCallback(async () => {
    setLoadingPropose(true);
    setErr('');
    try {
      const data = await api('/social/propose?limit=6');
      setProposals(data.proposals || []);
      setProposeMeta(data);
      if (data.error) setErr(data.error);
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
  }, [loadPosts, loadAnalytics]);

  useEffect(() => {
    if (tab === 'propose') loadPropose();
    if (tab === 'analytics') loadAnalytics();
    if (tab === 'plan') loadPosts();
  }, [tab, loadPropose, loadAnalytics, loadPosts]);

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

  async function planAll() {
    setBusyKey('all');
    try {
      for (const p of proposals) {
        await api('/social/from-proposal', { method: 'POST', body: JSON.stringify(p) });
      }
      setMsg(`${proposals.length} posts planifiés en un clic.`);
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

  return (
    <AuthGuard>
      <AppShell
        title="Réseaux sociaux"
        subtitle="Pôle contenu — planifier Instagram / Facebook / Pinterest, légendes et calendrier"
        wide
      >
        <div className="rounded-2xl border border-neya-border bg-white px-4 py-3 mb-5 text-sm text-neya-muted">
          <strong className="text-neya-ink font-medium">Pôle réseaux sociaux</strong>
          {' — '}propositions (Drive ou semaine type), calendrier de posts, analytics locales.
          La publication Meta/Pinterest OAuth arrive ensuite ; en attendant, planifiez ici et marquez « Publié ».
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
            onClick={async () => {
              setBusyKey('seed');
              setErr('');
              try {
                const r = await api('/social/seed-week', { method: 'POST', body: '{}' });
                setMsg(`${r.created} posts planifiés (semaine type).`);
                await loadPosts();
                setTab('plan');
              } catch (e) {
                setErr(e.message);
              } finally {
                setBusyKey('');
              }
            }}
            disabled={busyKey === 'seed'}
            className="btn-secondary text-sm h-9 ml-auto"
          >
            {busyKey === 'seed' ? '…' : 'Générer semaine type'}
          </button>
          <button
            type="button"
            onClick={() => { setTab('plan'); setShowForm(true); }}
            className="btn-primary gap-1.5 text-sm h-9"
          >
            <Plus className="h-4 w-4" /> Nouveau post
          </button>
        </div>

        {err && (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{err}</div>
        )}
        {msg && (
          <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{msg}</div>
        )}

        {tab === 'propose' && (
          <section className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-neya-muted max-w-xl">
                L’ERP parcourt le Drive, sélectionne les plus belles photos produit et propose des légendes
                multi-réseaux. Un clic = post planifié.
              </p>
              <div className="flex gap-2">
                <button type="button" onClick={loadPropose} disabled={loadingPropose} className="btn-secondary text-sm">
                  {loadingPropose ? 'Recherche…' : 'Relancer la recherche'}
                </button>
                {proposals.length > 0 && (
                  <button
                    type="button"
                    onClick={planAll}
                    disabled={busyKey === 'all'}
                    className="btn-primary text-sm gap-1.5"
                  >
                    <Sparkles className="h-4 w-4" />
                    Tout planifier ({proposals.length})
                  </button>
                )}
              </div>
            </div>

            {proposeMeta?.hint && !proposals.length && (
              <div className="rounded-2xl border border-dashed border-neya-border bg-neya-surface/40 px-5 py-8 text-center">
                <ImageIcon className="h-8 w-8 mx-auto text-neya-muted mb-2" />
                <p className="text-sm font-medium text-neya-ink">Aucune photo proposée</p>
                <p className="text-xs text-neya-muted mt-1">{proposeMeta.hint}</p>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {proposals.map(p => {
                const thumb = p.media?.[0]?.thumbnailLink;
                return (
                  <article key={p.key} className="rounded-2xl border border-neya-border bg-white shadow-sm overflow-hidden flex flex-col">
                    <div className="aspect-[4/3] bg-neya-surface relative">
                      {thumb ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={thumb} alt={p.title || ''} className="absolute inset-0 h-full w-full object-cover" />
                      ) : (
                        <div className="absolute inset-0 grid place-items-center text-neya-muted text-xs">Pas d’aperçu</div>
                      )}
                    </div>
                    <div className="p-4 flex flex-col gap-2 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="font-display text-[15px] font-semibold text-neya-ink leading-snug">{p.title}</h3>
                        <PlatformChips platforms={p.platforms} />
                      </div>
                      <p className="text-[12.5px] text-neya-ink-light whitespace-pre-wrap line-clamp-4 flex-1">{p.caption}</p>
                      <p className="text-[11px] text-neya-muted tabular-nums">
                        Créneau suggéré : {p.scheduled_at ? new Date(p.scheduled_at).toLocaleString('fr-CA') : '—'}
                      </p>
                      <button
                        type="button"
                        disabled={busyKey === p.key}
                        onClick={() => planProposal(p)}
                        className="btn-primary w-full text-sm gap-1.5 mt-1"
                      >
                        <Check className="h-4 w-4" />
                        {busyKey === p.key ? 'Planification…' : 'Planifier en 1 clic'}
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        )}

        {tab === 'plan' && (
          <section className="space-y-4">
            {showForm && (
              <form onSubmit={createManual} className="card rounded-2xl grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="md:col-span-2">
                  <label className="label">Titre</label>
                  <input className="input" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="Ex. Table chêne — détail plateau" />
                </div>
                <div className="md:col-span-2">
                  <label className="label">Légende (cross-platform)</label>
                  <textarea
                    className="input min-h-[120px]"
                    value={form.caption}
                    onChange={e => setForm({ ...form, caption: e.target.value })}
                    required
                  />
                </div>
                <div>
                  <label className="label">Planifié pour</label>
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
                <div className="md:col-span-2">
                  <label className="label">Plateformes</label>
                  <div className="flex flex-wrap gap-2 mt-1">
                    {(platforms.length ? platforms : Object.keys(PLATFORM_LABEL).map(value => ({ value, label: PLATFORM_LABEL[value] }))).map(p => {
                      const active = form.platforms.includes(p.value);
                      return (
                        <button
                          key={p.value}
                          type="button"
                          onClick={() => togglePlatform(p.value)}
                          className={`rounded-full border px-3 py-1 text-xs font-medium ${
                            active ? 'border-neya-orange bg-neya-orange/10 text-neya-ink' : 'border-neya-border text-neya-muted'
                          }`}
                        >
                          {p.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="md:col-span-2 flex gap-2">
                  <button type="submit" disabled={busyKey === 'manual'} className="btn-primary">Enregistrer</button>
                  <button type="button" className="btn-secondary" onClick={() => setShowForm(false)}>Annuler</button>
                </div>
              </form>
            )}

            <div>
              <h3 className="font-display text-[15px] font-semibold text-neya-ink mb-3 inline-flex items-center gap-1.5">
                <Share2 className="h-4 w-4 text-neya-orange" /> À publier
              </h3>
              <div className="space-y-2">
                {scheduled.map(p => (
                  <div key={p.id} className="rounded-xl border border-neya-border bg-white px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-neya-orange">
                          {STATUS_LABEL[p.status] || p.status}
                        </span>
                        <PlatformChips platforms={p.platforms} />
                      </div>
                      <p className="font-medium text-neya-ink truncate">{p.title || 'Sans titre'}</p>
                      <p className="text-xs text-neya-muted line-clamp-2 mt-0.5 whitespace-pre-wrap">{p.caption}</p>
                      <p className="text-[11px] text-neya-muted mt-1 tabular-nums">
                        {p.scheduled_at ? new Date(p.scheduled_at).toLocaleString('fr-CA') : 'Pas de créneau'}
                        {p.source === 'drive_auto' ? ' · Drive auto' : ''}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2 shrink-0">
                      <button type="button" className="btn-secondary text-xs" onClick={() => markPublished(p.id)}>
                        Marquer publié
                      </button>
                      <button type="button" className="btn-secondary text-xs text-red-600 border-red-200" onClick={() => removePost(p.id)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
                {scheduled.length === 0 && (
                  <p className="text-sm text-neya-muted rounded-xl border border-dashed border-neya-border px-4 py-8 text-center">
                    Aucun post planifié — allez dans « Propositions Drive » ou créez-en un.
                  </p>
                )}
              </div>
            </div>

            {published.length > 0 && (
              <div>
                <h3 className="font-display text-[15px] font-semibold text-neya-ink mb-3">Publiés récemment</h3>
                <div className="space-y-2">
                  {published.slice(0, 10).map(p => (
                    <div key={p.id} className="rounded-xl border border-neya-border bg-neya-surface/30 px-4 py-3">
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <PlatformChips platforms={p.platforms} />
                        <span className="text-[11px] text-neya-muted tabular-nums">
                          {p.published_at ? formatDate(p.published_at) : ''}
                        </span>
                      </div>
                      <p className="text-sm font-medium">{p.title || 'Sans titre'}</p>
                      <MetricsInline post={p} onSave={saveMetrics} />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>
        )}

        {tab === 'analytics' && (
          <section className="space-y-5">
            <p className="text-sm text-neya-muted">
              {analytics?.note || 'Vue d’ensemble des posts et métriques.'}
              {!analytics?.meta_connected && (
                <span className="block mt-1 text-neya-orange">
                  Connexion Meta / Pinterest OAuth prévue ensuite — pour l’instant saisissez likes / reach sur les posts publiés.
                </span>
              )}
            </p>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {[
                { label: 'Posts', value: analytics?.totals?.posts ?? 0 },
                { label: 'Publiés', value: analytics?.totals?.published ?? 0 },
                { label: 'Likes', value: analytics?.totals?.likes ?? 0 },
                { label: 'Reach', value: analytics?.totals?.reach ?? 0 },
              ].map(c => (
                <div key={c.label} className="rounded-2xl border border-neya-border bg-white px-4 py-3 shadow-sm">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-neya-muted">{c.label}</p>
                  <p className="mt-1 font-display text-xl font-semibold tabular-nums">{c.value}</p>
                </div>
              ))}
            </div>

            <div className="cf-table-wrap overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className="px-4 py-3">Plateforme</th>
                    <th className="px-4 py-3 text-right">Posts</th>
                    <th className="px-4 py-3 text-right">Likes</th>
                    <th className="px-4 py-3 text-right">Reach</th>
                    <th className="px-4 py-3 text-right">Commentaires</th>
                  </tr>
                </thead>
                <tbody>
                  {(analytics?.by_platform || []).map(row => (
                    <tr key={row.platform}>
                      <td className="px-4 py-3 font-medium">{PLATFORM_LABEL[row.platform] || row.platform}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{row.posts}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{row.likes}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{row.reach}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{row.comments}</td>
                    </tr>
                  ))}
                  {!(analytics?.by_platform || []).length && (
                    <tr>
                      <td colSpan={5} className="px-4 py-10 text-center text-neya-muted">
                        Pas encore de données — planifiez ou publiez des posts.
                      </td>
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

function MetricsInline({ post, onSave }) {
  const [likes, setLikes] = useState(String(post.metrics?.likes ?? ''));
  const [reach, setReach] = useState(String(post.metrics?.reach ?? ''));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setLikes(String(post.metrics?.likes ?? ''));
    setReach(String(post.metrics?.reach ?? ''));
  }, [post.id, post.metrics]);

  async function save() {
    setSaving(true);
    try {
      await onSave(post.id, {
        likes: Number(likes) || 0,
        reach: Number(reach) || 0,
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-2 flex flex-wrap items-end gap-2">
      <div>
        <label className="text-[10px] uppercase tracking-wider text-neya-muted">Likes</label>
        <input type="number" className="input h-8 text-xs w-24" value={likes} onChange={e => setLikes(e.target.value)} />
      </div>
      <div>
        <label className="text-[10px] uppercase tracking-wider text-neya-muted">Reach</label>
        <input type="number" className="input h-8 text-xs w-24" value={reach} onChange={e => setReach(e.target.value)} />
      </div>
      <button type="button" onClick={save} disabled={saving} className="btn-secondary text-xs h-8">
        {saving ? '…' : 'Sauver metrics'}
      </button>
    </div>
  );
}

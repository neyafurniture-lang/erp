'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import AppShell from '../../components/AppShell';
import AuthGuard from '../../components/AuthGuard';
import SkillsManager, { ACTION_TYPES } from '../../components/SkillsManager';
import UsersManager from '../../components/UsersManager';
import CursorAgentPanel from '../../components/CursorAgentPanel';
import DeployVpsPanel from '../../components/DeployVpsPanel';
import { api, getApiRoot, setApiRoot, getApiUrl, logout, getSavedLogin, saveLoginCredentials } from '../../lib/api';
import { connectGoogle, disconnectGoogle, getGoogleStatus } from '../../lib/google';
import { useAuth } from '../../lib/auth-context';
import { isAdmin } from '../../lib/permissions';

const TABS = [
  { id: 'general', label: 'Général', icon: '⚙' },
  { id: 'web', label: 'Site web', icon: '🌐' },
  { id: 'email', label: 'Courriel', icon: '✉' },
  { id: 'integrations', label: 'Intégrations', icon: '🔗' },
  { id: 'security', label: 'Sécurité', icon: '🔒' },
  { id: 'users', label: 'Utilisateurs', icon: '👤', adminOnly: true },
  { id: 'assistant', label: 'Assistant IA', icon: '🤖' },
  { id: 'cursor', label: 'Agent Cursor', icon: '◈', adminOnly: true },
  { id: 'deploy', label: 'Déploiement VPS', icon: '🚀', adminOnly: true },
  { id: 'skills', label: 'Skills chat', icon: '💬' },
  { id: 'api', label: 'API', icon: '🔗' },
];

function SettingsContent() {
  const { user } = useAuth();
  const searchParams = useSearchParams();
  const initialTab = searchParams.get('tab') || 'general';
  const [tab, setTab] = useState(initialTab);
  const [settings, setSettings] = useState(null);
  const [apiRoutes, setApiRoutes] = useState([]);
  const [apiRoot, setApiRootState] = useState('');
  const [health, setHealth] = useState(null);
  const [form, setForm] = useState({
    ai_provider: 'anthropic',
    anthropic_api_key: '',
    anthropic_model: 'claude-sonnet-5',
    openai_api_key: '',
    openai_model: 'gpt-4o-mini',
    assistant_ai_enabled: true,
    company_name: '',
    company_email: '',
    company_phone: '',
    wordpress_url: '',
    woocommerce_key: '',
    woocommerce_secret: '',
    smtp_host: '',
    smtp_port: 587,
    smtp_user: '',
    smtp_pass: '',
    smtp_from: '',
    google_client_id: '',
    google_client_secret: '',
    google_redirect_uri: '',
  });
  const [passwordForm, setPasswordForm] = useState({ current_password: '', new_password: '', confirm: '' });
  const [securityInfo, setSecurityInfo] = useState(null);
  const [webTest, setWebTest] = useState(null);
  const [webSyncing, setWebSyncing] = useState(false);
  const [webTesting, setWebTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [googleStatus, setGoogleStatus] = useState(null);
  const [googleBusy, setGoogleBusy] = useState(false);

  useEffect(() => {
    const t = searchParams.get('tab');
    if (t && TABS.some(x => x.id === t)) setTab(t);
    const gErr = searchParams.get('google_error');
    const gOk = searchParams.get('google_connected');
    if (gErr) setErr(decodeURIComponent(gErr));
    if (gOk) setMsg(`Google connecté${searchParams.get('email') ? ` — ${decodeURIComponent(searchParams.get('email'))}` : ''}`);
  }, [searchParams]);

  useEffect(() => {
    if (tab === 'security') {
      api('/auth/security').then(setSecurityInfo).catch(() => {});
    }
    if (tab === 'integrations') {
      getGoogleStatus().then(setGoogleStatus).catch(() => setGoogleStatus({ google: { configured: false, connected: false } }));
    }
  }, [tab]);

  useEffect(() => {
    setApiRootState(getApiRoot());
    loadSettings();
    api('/settings/api-routes').then(setApiRoutes).catch(() => {});
  }, []);

  async function loadSettings() {
    try {
      const s = await api('/settings');
      setSettings(s);
      setForm(f => ({
        ...f,
        ai_provider: s.ai_provider || 'anthropic',
        anthropic_model: s.anthropic_model || 'claude-sonnet-5',
        openai_model: s.openai_model,
        assistant_ai_enabled: s.assistant_ai_enabled,
        company_name: s.company_name || '',
        company_email: s.company_email || '',
        company_phone: s.company_phone || '',
        wordpress_url: s.wordpress_url || '',
        smtp_host: s.smtp_host || '',
        smtp_port: s.smtp_port || 587,
        smtp_user: s.smtp_user || '',
        smtp_from: s.smtp_from || '',
        google_client_id: s.google_client_id || '',
        google_redirect_uri: s.google_redirect_uri || '',
        anthropic_api_key: '',
        openai_api_key: '',
        woocommerce_key: '',
        woocommerce_secret: '',
        smtp_pass: '',
        google_client_secret: '',
      }));
    } catch (e) {
      setErr(e.message);
    }
  }

  async function saveSettings(extra = {}) {
    setSaving(true);
    setErr('');
    setMsg('');
    try {
      const payload = { ...form, ...extra };
      if (!payload.anthropic_api_key) delete payload.anthropic_api_key;
      if (!payload.openai_api_key) delete payload.openai_api_key;
      if (!payload.woocommerce_key) delete payload.woocommerce_key;
      if (!payload.woocommerce_secret) delete payload.woocommerce_secret;
      if (!payload.smtp_pass) delete payload.smtp_pass;
      if (!payload.google_client_secret) delete payload.google_client_secret;
      const s = await api('/settings', { method: 'PUT', body: JSON.stringify(payload) });
      setSettings(s);
      setForm(f => ({
        ...f,
        anthropic_api_key: '',
        openai_api_key: '',
        woocommerce_key: '',
        woocommerce_secret: '',
        smtp_pass: '',
        google_client_secret: '',
      }));
      setMsg('Paramètres enregistrés');
      if (tab === 'integrations') {
        getGoogleStatus().then(setGoogleStatus).catch(() => {});
      }
    } catch (e) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function testWordPress() {
    setWebTesting(true);
    setWebTest(null);
    setErr('');
    try {
      const result = await api('/wordpress/test');
      setWebTest({ ok: true, data: result });
    } catch (e) {
      setWebTest({ ok: false, error: e.message });
    } finally {
      setWebTesting(false);
    }
  }

  async function syncWordPress(mode = 'products') {
    setWebSyncing(true);
    setErr('');
    setMsg('');
    try {
      const path = mode === 'all' ? '/wordpress/sync-all'
        : mode === 'orders' ? '/wordpress/sync-orders'
          : mode === 'photos' ? '/wordpress/sync-photos'
            : '/wordpress/sync';
      const result = await api(path, { method: 'POST' });
      if (mode === 'all') {
        setMsg(`Sync complète — ${result.products?.matched ?? 0} produits, ${result.orders?.imported ?? 0} commandes importées`);
      } else if (mode === 'orders') {
        setMsg(`${result.imported ?? 0} commande(s) importée(s)`);
      } else if (mode === 'photos') {
        setMsg(`${result.photos_downloaded ?? 0} photo(s) récupérée(s) pour ${result.matched ?? 0} fiche(s)`);
      } else {
        setMsg(`Sync terminée — ${result.matched ?? 0} fiche(s), ${result.photos_downloaded ?? 0} photo(s)`);
      }
    } catch (e) {
      setErr(e.message);
    } finally {
      setWebSyncing(false);
    }
  }

  async function changePassword(e) {
    e.preventDefault();
    setErr('');
    setMsg('');
    if (passwordForm.new_password !== passwordForm.confirm) {
      setErr('Les mots de passe ne correspondent pas');
      return;
    }
    setSaving(true);
    try {
      await api('/auth/password', {
        method: 'PUT',
        body: JSON.stringify({
          current_password: passwordForm.current_password,
          new_password: passwordForm.new_password,
        }),
      });
      setPasswordForm({ current_password: '', new_password: '', confirm: '' });
      setMsg('Mot de passe modifié');
      const saved = getSavedLogin();
      if (saved.remember && user?.email) {
        saveLoginCredentials(user.email, passwordForm.new_password, true);
      }
    } catch (e) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function testConnection() {
    setHealth(null);
    try {
      const root = apiRoot.replace(/\/$/, '');
      const res = await fetch(`${root}/health`);
      const data = await res.json();
      setHealth({ ok: res.ok, data });
    } catch (e) {
      setHealth({ ok: false, error: e.message });
    }
  }

  function saveApiRoot() {
    setApiRoot(apiRoot);
    setMsg('URL API enregistrée — rechargez si nécessaire');
    testConnection();
  }

  async function handleConnectGoogle() {
    setGoogleBusy(true);
    try {
      await connectGoogle();
    } catch (e) {
      setErr(e.message);
      setGoogleBusy(false);
    }
  }

  async function handleDisconnectGoogle() {
    if (!confirm('Déconnecter le compte Google (Drive + Gmail) ?')) return;
    setGoogleBusy(true);
    setErr('');
    try {
      await disconnectGoogle();
      setMsg('Google déconnecté');
      setGoogleStatus(s => ({ ...s, google: { ...s?.google, connected: false, email: null } }));
    } catch (e) {
      setErr(e.message);
    } finally {
      setGoogleBusy(false);
    }
  }

  return (
    <div className="max-w-4xl">
      <div className="flex flex-wrap gap-2 mb-8 border-b border-neya-border pb-4">
        {TABS.filter(t => !t.adminOnly || isAdmin(user)).map(t => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${
              tab === t.id ? 'bg-neya-orange text-white' : 'bg-neya-cream text-neya-muted hover:text-neya-ink'
            }`}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {msg && <p className="mb-4 text-sm text-green-700 bg-green-50 px-4 py-2 rounded-lg">{msg}</p>}
      {err && <p className="mb-4 text-sm text-neya-error bg-red-50 px-4 py-2 rounded-lg">{err}</p>}

      {tab === 'general' && (
        <div className="space-y-6">
          <section className="card">
            <h2 className="font-heading text-lg mb-4">Entreprise</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="label">Nom</label>
                <input className="input" value={form.company_name} onChange={e => setForm({ ...form, company_name: e.target.value })} />
              </div>
              <div>
                <label className="label">Courriel</label>
                <input className="input" type="email" value={form.company_email} onChange={e => setForm({ ...form, company_email: e.target.value })} />
              </div>
              <div>
                <label className="label">Téléphone</label>
                <input className="input" value={form.company_phone} onChange={e => setForm({ ...form, company_phone: e.target.value })} />
              </div>
            </div>
            <button type="button" onClick={() => saveSettings()} disabled={saving} className="btn-primary mt-4">
              {saving ? 'Enregistrement…' : 'Enregistrer'}
            </button>
          </section>
        </div>
      )}

      {tab === 'web' && (
        <div className="space-y-6">
          <section className="card">
            <h2 className="font-heading text-lg mb-2">Site web WooCommerce</h2>
            <p className="text-sm text-neya-muted mb-4">
              Connexion à neyafurniture.ca — produits, photos et commandes vers l&apos;ERP.
              <Link href="/web" className="text-neya-orange hover:underline ml-1">Ouvrir le hub site web →</Link>
            </p>
            <div className="flex items-center gap-2 mb-4">
              <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${
                settings?.woocommerce_configured ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'
              }`}>
                {settings?.woocommerce_configured
                  ? `Clés configurées ${settings.woocommerce_key_preview}`
                  : 'Clés WooCommerce non configurées'}
              </span>
            </div>
            <div className="grid gap-4">
              <div>
                <label className="label">URL WordPress</label>
                <input
                  className="input font-mono text-sm"
                  placeholder="https://neyafurniture.ca"
                  value={form.wordpress_url}
                  onChange={e => setForm({ ...form, wordpress_url: e.target.value })}
                />
              </div>
              <div>
                <label className="label">Clé consommateur WooCommerce</label>
                <input
                  className="input font-mono text-sm"
                  type="password"
                  placeholder={settings?.woocommerce_configured ? 'Laisser vide pour conserver' : 'ck_…'}
                  value={form.woocommerce_key}
                  onChange={e => setForm({ ...form, woocommerce_key: e.target.value })}
                />
              </div>
              <div>
                <label className="label">Secret consommateur WooCommerce</label>
                <input
                  className="input font-mono text-sm"
                  type="password"
                  placeholder={settings?.woocommerce_configured ? 'Laisser vide pour conserver' : 'cs_…'}
                  value={form.woocommerce_secret}
                  onChange={e => setForm({ ...form, woocommerce_secret: e.target.value })}
                />
              </div>
            </div>
            <div className="flex flex-wrap gap-2 mt-4">
              <button type="button" onClick={() => saveSettings()} disabled={saving} className="btn-primary">
                {saving ? 'Enregistrement…' : 'Enregistrer'}
              </button>
              <button type="button" onClick={testWordPress} disabled={webTesting} className="btn-secondary">
                {webTesting ? 'Test…' : 'Tester connexion'}
              </button>
              <button type="button" onClick={() => syncWordPress('photos')} disabled={webSyncing} className="btn-primary">
                {webSyncing ? 'Téléchargement…' : 'Récupérer les photos'}
              </button>
              <button type="button" onClick={() => syncWordPress('all')} disabled={webSyncing} className="btn-secondary">
                {webSyncing ? 'Synchronisation…' : 'Tout synchroniser'}
              </button>
              <button type="button" onClick={() => syncWordPress('products')} disabled={webSyncing} className="btn-secondary">
                {webSyncing ? 'Sync…' : 'Produits & photos'}
              </button>
              <button type="button" onClick={() => syncWordPress('orders')} disabled={webSyncing} className="btn-secondary">
                {webSyncing ? 'Import…' : 'Commandes → projets'}
              </button>
            </div>
            {webTest && (
              <div className={`mt-4 text-sm px-4 py-3 rounded-lg ${webTest.ok ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'}`}>
                {webTest.ok
                  ? `✓ Connexion OK — ${webTest.data?.sample ?? webTest.data?.base ?? 'Site accessible'}`
                  : `✗ ${webTest.error}`}
              </div>
            )}
          </section>
        </div>
      )}

      {tab === 'email' && (
        <div className="space-y-6">
          <section className="card">
            <h2 className="font-heading text-lg mb-2">Courriel (SMTP)</h2>
            <p className="text-sm text-neya-muted mb-4">
              Configuration pour l&apos;envoi des devis et factures par courriel.
            </p>
            <div className="flex items-center gap-2 mb-4">
              <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${
                settings?.smtp_configured ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'
              }`}>
                {settings?.smtp_configured ? 'SMTP configuré' : 'SMTP non configuré'}
              </span>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="label">Serveur SMTP</label>
                <input className="input" placeholder="smtp.gmail.com" value={form.smtp_host}
                  onChange={e => setForm({ ...form, smtp_host: e.target.value })} />
              </div>
              <div>
                <label className="label">Port</label>
                <input type="number" className="input" value={form.smtp_port}
                  onChange={e => setForm({ ...form, smtp_port: Number(e.target.value) })} />
              </div>
              <div>
                <label className="label">Utilisateur</label>
                <input className="input" value={form.smtp_user}
                  onChange={e => setForm({ ...form, smtp_user: e.target.value })} />
              </div>
              <div>
                <label className="label">Mot de passe</label>
                <input type="password" className="input" placeholder="Laisser vide pour conserver"
                  value={form.smtp_pass} onChange={e => setForm({ ...form, smtp_pass: e.target.value })} />
              </div>
              <div className="sm:col-span-2">
                <label className="label">Adresse expéditeur</label>
                <input type="email" className="input" placeholder="facturation@neyafurniture.ca"
                  value={form.smtp_from} onChange={e => setForm({ ...form, smtp_from: e.target.value })} />
              </div>
            </div>
            <button type="button" onClick={() => saveSettings()} disabled={saving} className="btn-primary mt-4">
              {saving ? 'Enregistrement…' : 'Enregistrer'}
            </button>
          </section>
        </div>
      )}

      {tab === 'integrations' && (
        <div className="space-y-6">
          <section className="card">
            <h2 className="font-heading text-lg mb-2">Gmail (priorité)</h2>
            <p className="text-sm text-neya-muted mb-4">
              Lisez, répondez et liez les courriels aux projets depuis l&apos;ERP.
              <Link href="/mail" className="text-neya-orange hover:underline ml-1">Ouvrir la boîte Gmail →</Link>
            </p>

            {!googleStatus ? (
              <p className="text-sm text-neya-muted">Chargement…</p>
            ) : (
              <>
                {(googleStatus.google?.oauth_ip_blocked || /\/\/\d+\.\d+\.\d+\.\d+/.test(googleStatus.google?.redirect_uri || '')) && (
                  <div className="mb-4 text-sm bg-amber-50 border border-amber-200 text-amber-950 px-4 py-3 rounded-xl">
                    <p className="font-medium mb-2">Google refuse les adresses IP (51.222.31.75)</p>
                    <p className="text-xs mb-2">Il faut un vrai nom de domaine (.ca, .com…) pour OAuth Gmail.</p>
                    <ol className="list-decimal list-inside space-y-1 text-xs">
                      <li>Chez votre registrar (où est <strong>neyafurniture.ca</strong>), créez un enregistrement <strong>A</strong> :</li>
                    </ol>
                    <p className="font-mono text-xs mt-2 bg-white/80 px-2 py-1 rounded">qg → 51.222.31.75</p>
                    <p className="text-xs mt-2">Attendez 5–30 min, puis dites-moi quand c&apos;est fait pour activer HTTPS automatiquement.</p>
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-2 mb-4">
                  <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${
                    googleStatus.google?.connected ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'
                  }`}>
                    {googleStatus.google?.connected
                      ? `Gmail connecté — ${googleStatus.google.email || 'compte Google'}`
                      : googleStatus.google?.configured ? 'OAuth prêt — compte non connecté' : 'Étape 1 : configurer OAuth ci-dessous'}
                  </span>
                  {settings?.google_client_secret_preview && (
                    <span className="text-xs text-neya-muted">Secret {settings.google_client_secret_preview}</span>
                  )}
                </div>

                <div className="grid gap-4 sm:grid-cols-2 mb-4">
                  <div className="sm:col-span-2">
                    <label className="label">Client ID Google</label>
                    <input
                      className="input font-mono text-sm"
                      placeholder="xxxx.apps.googleusercontent.com"
                      value={form.google_client_id}
                      onChange={e => setForm({ ...form, google_client_id: e.target.value })}
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="label">Client Secret Google</label>
                    <input
                      className="input font-mono text-sm"
                      type="password"
                      placeholder={settings?.google_client_secret_preview || 'Collez le secret OAuth'}
                      value={form.google_client_secret}
                      onChange={e => setForm({ ...form, google_client_secret: e.target.value })}
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="label">URI de redirection (à copier dans Google Cloud)</label>
                    <input
                      className="input font-mono text-xs bg-neya-cream"
                      value={
                        form.google_redirect_uri
                        || googleStatus.google?.suggested_redirect_uri
                        || googleStatus.google?.redirect_uri
                        || 'https://qg.neyafurniture.ca/api/integrations/google/callback'
                      }
                      onChange={e => setForm({ ...form, google_redirect_uri: e.target.value })}
                    />
                    <p className="text-[11px] text-neya-muted mt-1">
                      Copiez cette URL dans Google Cloud → Identifiants → URI de redirection autorisés.
                      {!googleStatus.google?.oauth_ip_blocked && ' Doit commencer par https:// et un nom de domaine.'}
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 mb-4">
                  <button type="button" onClick={() => saveSettings()} disabled={saving} className="btn-secondary">
                    {saving ? '…' : 'Enregistrer OAuth'}
                  </button>
                  {googleStatus.google?.configured && !googleStatus.google?.connected && !googleStatus.google?.oauth_ip_blocked && (
                    <button type="button" onClick={handleConnectGoogle} disabled={googleBusy} className="btn-primary">
                      {googleBusy ? 'Redirection…' : 'Étape 2 — Connecter Gmail'}
                    </button>
                  )}
                  {googleStatus.google?.connected && (
                    <button type="button" onClick={handleDisconnectGoogle} disabled={googleBusy} className="btn-secondary">
                      Déconnecter Gmail
                    </button>
                  )}
                  <Link href="/mail" className="btn-secondary">Ouvrir Gmail</Link>
                </div>

                <div className="text-sm text-neya-muted bg-neya-surface p-4 rounded-lg">
                  <p className="font-medium text-neya-ink mb-2">Configuration Google Cloud Console (une fois)</p>
                  <ol className="list-decimal list-inside space-y-1.5 text-xs">
                    <li>Créez l&apos;enregistrement DNS <strong>qg.neyafurniture.ca → 51.222.31.75</strong> (VPS, pas Hostinger)</li>
                    <li><a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener noreferrer" className="text-neya-orange hover:underline">Google Cloud → Identifiants</a> → OAuth 2.0 (Application Web)</li>
                    <li>URI de redirection : utilisez le champ ci-dessus (<strong>https://qg.neyafurniture.ca/...</strong>)</li>
                    <li>Activez <strong>Gmail API</strong> et <strong>Google Drive API</strong></li>
                    <li>Écran de consentement : ajoutez votre Gmail comme utilisateur test</li>
                    <li>Collez Client ID + Secret → Enregistrer → Connecter Gmail (après activation du domaine)</li>
                  </ol>
                </div>
              </>
            )}
          </section>
        </div>
      )}

      {tab === 'security' && (
        <div className="space-y-6">
          <section className="card bg-neya-cream/40">
            <h2 className="font-heading text-lg mb-3">État de la sécurité</h2>
            {securityInfo ? (
              <ul className="text-sm space-y-2 text-neya-ink">
                <li>✓ Session JWT — {securityInfo.session_days} jours</li>
                <li>✓ Fichiers uploadés protégés (authentification requise)</li>
                <li>✓ Limite de tentatives de connexion active</li>
                <li>✓ Mot de passe minimum 10 caractères (lettres + chiffres)</li>
                <li>Connecté en tant que : <strong>{securityInfo.user?.email}</strong></li>
              </ul>
            ) : (
              <p className="text-sm text-neya-muted">Chargement…</p>
            )}
            <button type="button" onClick={logout} className="btn-secondary mt-4">
              Se déconnecter
            </button>
          </section>

          <section className="card">
            <h2 className="font-heading text-lg mb-4">Changer le mot de passe</h2>
            <form onSubmit={changePassword} className="grid gap-4 max-w-md">
              <div>
                <label className="label">Mot de passe actuel</label>
                <input type="password" className="input" required autoComplete="current-password"
                  value={passwordForm.current_password}
                  onChange={e => setPasswordForm({ ...passwordForm, current_password: e.target.value })} />
              </div>
              <div>
                <label className="label">Nouveau mot de passe</label>
                <input type="password" className="input" required minLength={10} autoComplete="new-password"
                  value={passwordForm.new_password}
                  onChange={e => setPasswordForm({ ...passwordForm, new_password: e.target.value })} />
                <p className="text-xs text-neya-muted mt-1">Min. 10 caractères, lettres et chiffres</p>
              </div>
              <div>
                <label className="label">Confirmer le mot de passe</label>
                <input type="password" className="input" required minLength={10} autoComplete="new-password"
                  value={passwordForm.confirm}
                  onChange={e => setPasswordForm({ ...passwordForm, confirm: e.target.value })} />
              </div>
              <button type="submit" disabled={saving} className="btn-primary w-fit">
                {saving ? 'Modification…' : 'Modifier le mot de passe'}
              </button>
            </form>
          </section>
        </div>
      )}

      {tab === 'users' && isAdmin(user) && <UsersManager />}

      {tab === 'assistant' && (
        <div className="space-y-6">
          <section className="card">
            <h2 className="font-heading text-lg mb-2">Assistant IA — Claude / OpenAI</h2>
            <p className="text-sm text-neya-muted mb-4">
              Clé API pour commandes en langage naturel. Sans clé, le chat utilise les skills par mots-clés.
            </p>
            <div className="flex flex-wrap items-center gap-2 mb-4">
              <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${
                settings?.ai_configured ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'
              }`}>
                {settings?.ai_configured ? 'IA configurée' : 'Aucune clé API'}
              </span>
              {settings?.anthropic_configured && (
                <span className="text-xs px-2.5 py-1 rounded-full bg-violet-100 text-violet-800">
                  Claude {settings.anthropic_api_key_preview}
                </span>
              )}
              {settings?.openai_configured && (
                <span className="text-xs px-2.5 py-1 rounded-full bg-blue-100 text-blue-800">
                  OpenAI {settings.openai_api_key_preview}
                </span>
              )}
            </div>
            <div className="grid gap-4">
              <div>
                <label className="label">Fournisseur prioritaire</label>
                <select className="input" value={form.ai_provider} onChange={e => setForm({ ...form, ai_provider: e.target.value })}>
                  <option value="anthropic">Claude (Anthropic) — recommandé</option>
                  <option value="openai">OpenAI (GPT)</option>
                </select>
              </div>
              <div>
                <label className="label">Clé API Claude (Anthropic)</label>
                <input
                  className="input font-mono text-sm"
                  type="password"
                  placeholder={settings?.anthropic_configured ? 'Laisser vide pour conserver la clé actuelle' : 'sk-ant-…'}
                  value={form.anthropic_api_key}
                  onChange={e => setForm({ ...form, anthropic_api_key: e.target.value })}
                />
                <p className="text-xs text-neya-muted mt-1">
                  Obtenez une clé sur{' '}
                  <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer" className="text-neya-orange underline">
                    console.anthropic.com
                  </a>
                </p>
              </div>
              <div>
                <label className="label">Modèle Claude</label>
                <select className="input" value={form.anthropic_model} onChange={e => setForm({ ...form, anthropic_model: e.target.value })}>
                  <option value="claude-sonnet-5">Claude Sonnet 5 (recommandé)</option>
                  <option value="claude-sonnet-4-6">Claude Sonnet 4.6</option>
                  <option value="claude-haiku-4-5">Claude Haiku 4.5 (économique)</option>
                  <option value="claude-opus-4-8">Claude Opus 4.8 (puissant)</option>
                </select>
              </div>
              <hr className="border-neya-border" />
              <div>
                <label className="label">Clé API OpenAI (optionnel)</label>
                <input
                  className="input font-mono text-sm"
                  type="password"
                  placeholder={settings?.openai_configured ? 'Laisser vide pour conserver la clé actuelle' : 'sk-…'}
                  value={form.openai_api_key}
                  onChange={e => setForm({ ...form, openai_api_key: e.target.value })}
                />
              </div>
              <div>
                <label className="label">Modèle OpenAI</label>
                <select className="input" value={form.openai_model} onChange={e => setForm({ ...form, openai_model: e.target.value })}>
                  <option value="gpt-4o-mini">gpt-4o-mini</option>
                  <option value="gpt-4o">gpt-4o</option>
                  <option value="gpt-4.1-mini">gpt-4.1-mini</option>
                </select>
              </div>
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.assistant_ai_enabled}
                  onChange={e => setForm({ ...form, assistant_ai_enabled: e.target.checked })}
                  className="w-4 h-4 accent-neya-orange"
                />
                <span className="text-sm">Activer l&apos;IA pour le chat (si clé présente)</span>
              </label>
            </div>
            <button type="button" onClick={() => saveSettings()} disabled={saving} className="btn-primary mt-4">
              {saving ? 'Enregistrement…' : 'Enregistrer'}
            </button>
          </section>
        </div>
      )}

      {tab === 'cursor' && isAdmin(user) && <CursorAgentPanel />}

      {tab === 'deploy' && isAdmin(user) && <DeployVpsPanel />}

      {tab === 'skills' && <SkillsManager />}

      {tab === 'api' && (
        <div className="space-y-6">
          <section className="card">
            <h2 className="font-heading text-lg mb-4">Connexion API</h2>
            <div className="grid gap-4">
              <div>
                <label className="label">URL du serveur backend</label>
                <input
                  className="input font-mono text-sm"
                  placeholder="http://localhost:4000"
                  value={apiRoot}
                  onChange={e => setApiRootState(e.target.value)}
                />
                <p className="text-xs text-neya-muted mt-1">URL actuelle des requêtes : {getApiUrl()}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={saveApiRoot} className="btn-primary">Enregistrer URL</button>
                <button type="button" onClick={testConnection} className="btn-secondary">Tester connexion</button>
              </div>
              {health && (
                <div className={`text-sm px-4 py-3 rounded-lg ${health.ok ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'}`}>
                  {health.ok
                    ? `✓ API en ligne — ${health.data?.service || 'OK'}`
                    : `✗ Échec — ${health.error || 'Serveur inaccessible'}`}
                </div>
              )}
            </div>
          </section>

          <section className="card">
            <h2 className="font-heading text-lg mb-4">Routes API principales</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-neya-muted border-b border-neya-border">
                    <th className="pb-2 pr-4">Méthode</th>
                    <th className="pb-2 pr-4">Route</th>
                    <th className="pb-2">Description</th>
                  </tr>
                </thead>
                <tbody>
                  {apiRoutes.map((r, i) => (
                    <tr key={i} className="border-b border-neya-border/50">
                      <td className="py-2 pr-4">
                        <span className="text-xs font-mono px-1.5 py-0.5 rounded bg-neya-cream">{r.method}</span>
                      </td>
                      <td className="py-2 pr-4 font-mono text-xs text-neya-orange">{r.path}</td>
                      <td className="py-2 text-neya-muted">{r.desc}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="card bg-neya-cream/40">
            <h2 className="font-heading text-lg mb-2">Types d&apos;actions skills</h2>
            <p className="text-sm text-neya-muted mb-3">Actions disponibles pour les skills du chat :</p>
            <div className="flex flex-wrap gap-2">
              {ACTION_TYPES.map(t => (
                <span key={t} className="text-xs px-2 py-1 rounded-full bg-white border border-neya-border font-mono">{t}</span>
              ))}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

export default function SettingsPage() {
  return (
    <AuthGuard>
      <AppShell title="Paramètres">
        <Suspense fallback={<p className="text-neya-muted">Chargement…</p>}>
          <SettingsContent />
        </Suspense>
      </AppShell>
    </AuthGuard>
  );
}

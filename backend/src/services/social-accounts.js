/**
 * Comptes sociaux (Meta / Instagram / Facebook / Pinterest).
 * Stockage via integration_tokens — même pattern que Google OAuth.
 * La publication Graph API se branche quand les App ID/Secret sont configurés.
 */
import pool from '../db/pool.js';
import { getSetting } from './settings.js';

export const SOCIAL_PROVIDERS = [
  {
    id: 'instagram',
    label: 'Instagram',
    family: 'meta',
    description: 'Compte professionnel lié à une Page Facebook',
    color: '#E1306C',
  },
  {
    id: 'facebook',
    label: 'Facebook Page',
    family: 'meta',
    description: 'Page entreprise pour publications et stories',
    color: '#1877F2',
  },
  {
    id: 'pinterest',
    label: 'Pinterest',
    family: 'pinterest',
    description: 'Business account + tableaux pins produit',
    color: '#E60023',
  },
  {
    id: 'tiktok',
    label: 'TikTok',
    family: 'tiktok',
    description: 'Compte Business (bientôt)',
    color: '#010101',
  },
  {
    id: 'linkedin',
    label: 'LinkedIn',
    family: 'linkedin',
    description: 'Page entreprise (bientôt)',
    color: '#0A66C2',
  },
];

async function getProviderConfig(family) {
  if (family === 'meta') {
    const appId = await getSetting('meta_app_id') || process.env.META_APP_ID || '';
    const secret = await getSetting('meta_app_secret') || process.env.META_APP_SECRET || '';
    const redirect = await getSetting('meta_redirect_uri')
      || process.env.META_REDIRECT_URI
      || '';
    return {
      configured: Boolean(String(appId).trim() && String(secret).trim()),
      appId: String(appId || ''),
      secret: String(secret || ''),
      redirectUri: String(redirect || ''),
    };
  }
  if (family === 'pinterest') {
    const appId = await getSetting('pinterest_app_id') || process.env.PINTEREST_APP_ID || '';
    const secret = await getSetting('pinterest_app_secret') || process.env.PINTEREST_APP_SECRET || '';
    const redirect = await getSetting('pinterest_redirect_uri') || process.env.PINTEREST_REDIRECT_URI || '';
    return {
      configured: Boolean(String(appId).trim() && String(secret).trim()),
      appId: String(appId || ''),
      secret: String(secret || ''),
      redirectUri: String(redirect || ''),
    };
  }
  return { configured: false, appId: '', secret: '', redirectUri: '' };
}

export async function listSocialAccounts() {
  const { rows } = await pool.query(
    `SELECT provider, account_email, expires_at, scopes, meta, updated_at,
            (access_token IS NOT NULL AND access_token <> '') AS has_token
     FROM integration_tokens
     WHERE provider = ANY($1)
     ORDER BY provider`,
    [SOCIAL_PROVIDERS.map(p => p.id)]
  ).catch(() => ({ rows: [] }));

  const byProvider = Object.fromEntries(rows.map(r => [r.provider, r]));
  const metaCfg = await getProviderConfig('meta');
  const pinCfg = await getProviderConfig('pinterest');

  return SOCIAL_PROVIDERS.map(p => {
    const row = byProvider[p.id];
    const cfg = p.family === 'meta' ? metaCfg : p.family === 'pinterest' ? pinCfg : { configured: false };
    const connected = Boolean(row?.has_token);
    return {
      ...p,
      connected,
      account_email: row?.account_email || null,
      account_name: row?.meta?.account_name || row?.account_email || null,
      expires_at: row?.expires_at || null,
      scopes: row?.scopes || [],
      pages: row?.meta?.pages || [],
      boards: row?.meta?.boards || [],
      configured: cfg.configured,
      oauth_ready: cfg.configured,
      status: connected ? 'connected' : (cfg.configured ? 'ready' : 'needs_credentials'),
    };
  });
}

/** URL d’autorisation Meta (Instagram + Facebook Pages). */
export async function buildMetaAuthUrl(provider = 'instagram', userId = null) {
  const cfg = await getProviderConfig('meta');
  if (!cfg.configured) {
    throw new Error('Configurez Meta App ID + Secret dans Paramètres → Intégrations.');
  }
  const frontend = (process.env.FRONTEND_URL || 'http://localhost:3000').split(',')[0];
  const redirect = cfg.redirectUri || `${frontend.replace(/\/$/, '')}/api/integrations/meta/callback`;
  const scopes = [
    'pages_show_list',
    'pages_read_engagement',
    'pages_manage_posts',
    'instagram_basic',
    'instagram_content_publish',
    'business_management',
  ].join(',');
  const state = Buffer.from(JSON.stringify({
    provider,
    userId,
    t: Date.now(),
  })).toString('base64url');

  const url = new URL('https://www.facebook.com/v21.0/dialog/oauth');
  url.searchParams.set('client_id', cfg.appId);
  url.searchParams.set('redirect_uri', redirect);
  url.searchParams.set('state', state);
  url.searchParams.set('scope', scopes);
  url.searchParams.set('response_type', 'code');
  return { url: url.toString(), redirect_uri: redirect, state };
}

export async function buildPinterestAuthUrl(userId = null) {
  const cfg = await getProviderConfig('pinterest');
  if (!cfg.configured) {
    throw new Error('Configurez Pinterest App ID + Secret dans Paramètres → Intégrations.');
  }
  const frontend = (process.env.FRONTEND_URL || 'http://localhost:3000').split(',')[0];
  const redirect = cfg.redirectUri || `${frontend.replace(/\/$/, '')}/api/integrations/pinterest/callback`;
  const state = Buffer.from(JSON.stringify({ provider: 'pinterest', userId, t: Date.now() })).toString('base64url');
  const url = new URL('https://www.pinterest.com/oauth/');
  url.searchParams.set('client_id', cfg.appId);
  url.searchParams.set('redirect_uri', redirect);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'boards:read,pins:read,pins:write,user_accounts:read');
  url.searchParams.set('state', state);
  return { url: url.toString(), redirect_uri: redirect, state };
}

export async function exchangeMetaCode(code, redirectUri) {
  const cfg = await getProviderConfig('meta');
  const tokenUrl = new URL('https://graph.facebook.com/v21.0/oauth/access_token');
  tokenUrl.searchParams.set('client_id', cfg.appId);
  tokenUrl.searchParams.set('client_secret', cfg.secret);
  tokenUrl.searchParams.set('redirect_uri', redirectUri || cfg.redirectUri);
  tokenUrl.searchParams.set('code', code);
  const res = await fetch(tokenUrl);
  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(data.error?.message || `Meta OAuth ${res.status}`);
  }
  return data;
}

export async function saveSocialTokens(provider, {
  accessToken,
  refreshToken = null,
  expiresIn = null,
  accountEmail = null,
  accountName = null,
  scopes = [],
  meta = {},
}) {
  const expiresAt = expiresIn
    ? new Date(Date.now() + Number(expiresIn) * 1000)
    : null;
  const email = accountEmail || `${provider}@connected`;
  await pool.query(
    `INSERT INTO integration_tokens (provider, account_email, access_token, refresh_token, expires_at, scopes, meta, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
     ON CONFLICT (provider, account_email) DO UPDATE SET
       access_token = EXCLUDED.access_token,
       refresh_token = COALESCE(EXCLUDED.refresh_token, integration_tokens.refresh_token),
       expires_at = EXCLUDED.expires_at,
       scopes = EXCLUDED.scopes,
       meta = EXCLUDED.meta,
       updated_at = NOW()`,
    [
      provider,
      email,
      accessToken,
      refreshToken,
      expiresAt,
      scopes,
      JSON.stringify({ ...meta, account_name: accountName, connected_at: new Date().toISOString() }),
    ]
  );
  return email;
}

export async function disconnectSocial(provider) {
  await pool.query('DELETE FROM integration_tokens WHERE provider = $1', [provider]);
  return { ok: true };
}

export async function getSocialStatusSummary() {
  const accounts = await listSocialAccounts();
  const connected = accounts.filter(a => a.connected).length;
  const metaCfg = await getProviderConfig('meta');
  const pinCfg = await getProviderConfig('pinterest');
  return {
    accounts,
    connected_count: connected,
    meta_configured: metaCfg.configured,
    pinterest_configured: pinCfg.configured,
    publish_ready: connected > 0,
  };
}

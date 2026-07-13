import jwt from 'jsonwebtoken';
import pool from '../db/pool.js';
import { getJwtSecret } from '../config.js';
import { getSetting } from './settings.js';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';

export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/userinfo.email',
];

function defaultRedirectUri() {
  const custom = process.env.ERP_PUBLIC_URL || process.env.ERP_DOMAIN;
  if (custom) {
    const host = String(custom).replace(/^https?:\/\//, '').split('/')[0];
    if (host && !/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
      const base = custom.includes('://') ? custom.replace(/\/$/, '') : `https://${custom}`;
      return `${base}/api/integrations/google/callback`;
    }
  }
  const frontend = (process.env.FRONTEND_URL || 'http://localhost:3000').split(',')[0].replace(/\/$/, '');
  const host = frontend.replace(/^https?:\/\//, '').split('/')[0];
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    return `https://erp.neyafurniture.ca/api/integrations/google/callback`;
  }
  return `${frontend}/api/integrations/google/callback`;
}

export function isGoogleOAuthIpBlocked(redirectUri) {
  return /https?:\/\/\d{1,3}(\.\d{1,3}){3}/.test(String(redirectUri || ''));
}

export async function getGoogleConfig() {
  const clientId = String((await getSetting('google_client_id')) || process.env.GOOGLE_CLIENT_ID || '').trim();
  const clientSecret = String((await getSetting('google_client_secret')) || process.env.GOOGLE_CLIENT_SECRET || '').trim();
  const redirectUri = String(
    (await getSetting('google_redirect_uri')) || process.env.GOOGLE_REDIRECT_URI || defaultRedirectUri()
  ).trim();
  const oauthIpBlocked = isGoogleOAuthIpBlocked(redirectUri);
  return {
    clientId,
    clientSecret,
    redirectUri,
    configured: Boolean(clientId && clientSecret),
    oauthIpBlocked,
    suggestedRedirectUri: 'https://erp.neyafurniture.ca/api/integrations/google/callback',
  };
}

export async function buildAuthUrl(userId) {
  const { clientId, redirectUri, configured, oauthIpBlocked } = await getGoogleConfig();
  if (!configured) {
    throw new Error('OAuth Google non configuré — ajoutez Client ID et Secret dans Paramètres → Intégrations');
  }
  if (oauthIpBlocked) {
    throw new Error(
      'Google OAuth refuse les adresses IP. Configurez qg.neyafurniture.ca (DNS → VPS) puis utilisez l’URI de redirection suggérée.'
    );
  }

  const state = jwt.sign({ uid: userId, t: Date.now() }, getJwtSecret(), { expiresIn: '15m' });
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: GOOGLE_SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    state,
  });
  return `${AUTH_URL}?${params}`;
}

export async function exchangeCode(code) {
  const { clientId, clientSecret, redirectUri } = await getGoogleConfig();
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description || data.error || 'Échec OAuth Google');
  return data;
}

export async function refreshAccessToken(refreshToken) {
  const { clientId, clientSecret } = await getGoogleConfig();
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description || 'Refresh token expiré — reconnectez Google');
  return data;
}

async function fetchGoogleEmail(accessToken) {
  const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.email;
}

export async function saveGoogleTokens(tokenData) {
  const email = await fetchGoogleEmail(tokenData.access_token);
  const expiresAt = new Date(Date.now() + (tokenData.expires_in || 3600) * 1000);
  await pool.query(
    `INSERT INTO integration_tokens (provider, account_email, access_token, refresh_token, expires_at, scopes, meta, updated_at)
     VALUES ('google', $1, $2, $3, $4, $5, $6, NOW())
     ON CONFLICT (provider, account_email) DO UPDATE SET
       access_token = $2, refresh_token = COALESCE($3, integration_tokens.refresh_token),
       expires_at = $4, scopes = $5, meta = $6, updated_at = NOW()`,
    [
      email || 'google@connected',
      tokenData.access_token,
      tokenData.refresh_token || null,
      expiresAt,
      GOOGLE_SCOPES,
      JSON.stringify({ connected_at: new Date().toISOString() }),
    ]
  );
  return email;
}

export async function getGoogleTokenRow() {
  const { rows } = await pool.query(
    "SELECT * FROM integration_tokens WHERE provider = 'google' ORDER BY updated_at DESC LIMIT 1"
  );
  return rows[0] || null;
}

export async function getValidAccessToken() {
  const row = await getGoogleTokenRow();
  if (!row) throw new Error('Gmail non connecté — Paramètres → Intégrations → Connecter Google');

  const expiresAt = row.expires_at ? new Date(row.expires_at).getTime() : 0;
  if (Date.now() < expiresAt - 60_000) return row.access_token;

  if (!row.refresh_token) throw new Error('Session Google expirée — reconnectez votre compte Gmail');
  const refreshed = await refreshAccessToken(row.refresh_token);
  const expires = new Date(Date.now() + (refreshed.expires_in || 3600) * 1000);
  await pool.query(
    'UPDATE integration_tokens SET access_token = $1, expires_at = $2, updated_at = NOW() WHERE id = $3',
    [refreshed.access_token, expires, row.id]
  );
  return refreshed.access_token;
}

export async function disconnectGoogle() {
  await pool.query("DELETE FROM integration_tokens WHERE provider = 'google'");
}

export function verifyOAuthState(state) {
  return jwt.verify(state, getJwtSecret());
}

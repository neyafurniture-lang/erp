/**
 * Client HTTP vers l’API NEYA ERP (auth Bearer + endpoints assistant).
 *
 * Env :
 *   NEYA_ERP_URL     — ex. https://erp.neyafurniture.ca  (défaut)
 *   NEYA_ERP_TOKEN   — JWT Bearer (prioritaire)
 *   NEYA_ERP_EMAIL   — login si pas de token
 *   NEYA_ERP_PASSWORD
 */

const DEFAULT_URL = 'https://erp.neyafurniture.ca';

function baseUrl() {
  const raw = (process.env.NEYA_ERP_URL || DEFAULT_URL).trim().replace(/\/$/, '');
  return raw;
}

function apiRoot() {
  const base = baseUrl();
  return base.endsWith('/api') ? base : `${base}/api`;
}

let cachedToken = null;

export async function getToken() {
  if (process.env.NEYA_ERP_TOKEN) {
    return String(process.env.NEYA_ERP_TOKEN).trim();
  }
  if (cachedToken) return cachedToken;

  const email = (process.env.NEYA_ERP_EMAIL || '').trim();
  const password = process.env.NEYA_ERP_PASSWORD || '';
  if (!email || !password) {
    throw new Error(
      'Auth MCP : définis NEYA_ERP_TOKEN, ou NEYA_ERP_EMAIL + NEYA_ERP_PASSWORD'
    );
  }

  const res = await fetch(`${apiRoot()}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Login ERP échoué (${res.status})`);
  }
  const token = data.token || data.access_token;
  if (!token) throw new Error('Login ERP : pas de token dans la réponse');
  cachedToken = token;
  return token;
}

export async function erpFetch(path, { method = 'GET', body, headers = {} } = {}) {
  const token = await getToken();
  const url = path.startsWith('http') ? path : `${apiRoot()}${path.startsWith('/') ? path : `/${path}`}`;
  const res = await fetch(url, {
    method,
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
      ...(body != null ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: body != null ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    const err = new Error(data.error || data.message || `ERP ${res.status} ${path}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export function erpBaseUrl() {
  return baseUrl();
}

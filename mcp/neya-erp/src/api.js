const API_URL = (process.env.NEYA_API_URL || 'http://localhost:4001/api').replace(/\/$/, '');

let cachedToken = process.env.NEYA_TOKEN || null;

export async function login() {
  if (cachedToken) return cachedToken;
  const email = process.env.NEYA_EMAIL;
  const password = process.env.NEYA_PASSWORD;
  if (!email || !password) {
    throw new Error('NEYA_TOKEN ou NEYA_EMAIL + NEYA_PASSWORD requis');
  }
  const res = await fetch(`${API_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Login échoué (${res.status})`);
  cachedToken = data.token;
  return cachedToken;
}

export async function neyaFetch(path, options = {}) {
  const token = await login();
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
  });
  const isJson = res.headers.get('content-type')?.includes('application/json');
  const data = isJson ? await res.json().catch(() => ({})) : await res.text();
  if (res.status === 401) {
    cachedToken = null;
    throw new Error('Session expirée — vérifiez NEYA_TOKEN ou identifiants');
  }
  if (!res.ok) {
    throw new Error(typeof data === 'object' ? data.error || JSON.stringify(data) : String(data));
  }
  return data;
}

export function getApiUrl() {
  return API_URL;
}

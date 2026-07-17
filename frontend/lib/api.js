const API_URL_DEFAULT = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4001/api';
const API_ROOT_KEY = 'neya_api_url';
const FETCH_TIMEOUT_MS = 45000;

export function getApiRoot() {
  return getApiUrl().replace(/\/api\/?$/, '');
}

/**
 * Sur iPhone / VPS : toujours same-origin (/api via Caddy).
 * Évite les appels cross-origin qui restent bloqués sur Safari mobile.
 */
export function getApiUrl() {
  if (typeof window === 'undefined') {
    return String(API_URL_DEFAULT).replace(/\/$/, '');
  }

  const custom = localStorage.getItem(API_ROOT_KEY);
  if (custom) {
    try {
      const root = custom.replace(/\/$/, '');
      const absolute = root.includes('://') ? root : `${window.location.protocol}//${root}`;
      const host = new URL(absolute).hostname;
      if (host === window.location.hostname) {
        return `${root.replace(/\/api\/?$/, '')}/api`;
      }
      // Ancienne URL (localhost, autre IP) → on ignore
      localStorage.removeItem(API_ROOT_KEY);
    } catch {
      localStorage.removeItem(API_ROOT_KEY);
    }
  }

  // Dev Next.js local (port 3000) → backend séparé
  if (
    /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname) &&
    (window.location.port === '3000' || window.location.port === '3001')
  ) {
    return String(API_URL_DEFAULT).replace(/\/$/, '');
  }

  // Prod / VPS / IP : reverse proxy same-origin
  return `${window.location.origin}/api`;
}

export function setApiRoot(root) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(API_ROOT_KEY, root.replace(/\/$/, ''));
}

export function getToken() {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('neya_token');
}

const LOGIN_EMAIL_KEY = 'neya_login_email';
const LOGIN_PASSWORD_KEY = 'neya_login_password';
const LOGIN_REMEMBER_KEY = 'neya_remember_login';

function encodeStored(value) {
  try {
    return btoa(unescape(encodeURIComponent(value)));
  } catch {
    return '';
  }
}

function decodeStored(value) {
  try {
    return decodeURIComponent(escape(atob(value)));
  } catch {
    return '';
  }
}

export function getSavedLogin() {
  if (typeof window === 'undefined') return { email: '', password: '', remember: false };
  const remember = localStorage.getItem(LOGIN_REMEMBER_KEY) === '1';
  if (!remember) return { email: '', password: '', remember: false };
  return {
    email: localStorage.getItem(LOGIN_EMAIL_KEY) || '',
    password: decodeStored(localStorage.getItem(LOGIN_PASSWORD_KEY) || ''),
    remember: true,
  };
}

export function saveLoginCredentials(email, password, remember) {
  if (typeof window === 'undefined') return;
  if (remember) {
    localStorage.setItem(LOGIN_REMEMBER_KEY, '1');
    localStorage.setItem(LOGIN_EMAIL_KEY, email);
    localStorage.setItem(LOGIN_PASSWORD_KEY, encodeStored(password));
  } else {
    clearSavedLoginCredentials();
  }
}

export function clearSavedLoginCredentials() {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(LOGIN_REMEMBER_KEY);
  localStorage.removeItem(LOGIN_EMAIL_KEY);
  localStorage.removeItem(LOGIN_PASSWORD_KEY);
}

export function logout() {
  if (typeof window === 'undefined') return;
  localStorage.removeItem('neya_token');
  localStorage.removeItem('neya_user');
  window.location.href = '/login';
}

/** URL authentifiée pour fichiers /uploads (balises img, liens) */
export function resolveUploadUrl(pathOrUrl) {
  if (!pathOrUrl) return null;
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  const base = getApiRoot();
  const path = pathOrUrl.startsWith('/') ? pathOrUrl : `/${pathOrUrl}`;
  const token = getToken();
  if (!token) return `${base}${path}`;
  const sep = path.includes('?') ? '&' : '?';
  return `${base}${path}${sep}access_token=${encodeURIComponent(token)}`;
}

export async function api(path, options = {}) {
  const token = getToken();
  const isFormData = options.body instanceof FormData;
  const headers = {
    ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...options.headers,
  };

  let res;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    res = await fetch(`${getApiUrl()}${path}`, {
      ...options,
      headers,
      signal: options.signal || controller.signal,
    });
  } catch (err) {
    if (err?.name === 'AbortError') {
      throw new Error(`Délai dépassé — API inaccessible (${getApiUrl()})`);
    }
    throw new Error(
      `Connexion API impossible (${getApiUrl()}). Vérifiez le réseau ou l'URL API.`
    );
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 401 && typeof window !== 'undefined') {
    const errBody = await res.clone().json().catch(() => ({}));
    const msg = String(errBody.error || '');
    // Ne déconnecter que les vrais échecs JWT — pas un PIN admin / autre 401 métier
    const isAuthFailure = /token|jwt|authentif|session expir/i.test(msg)
      || msg === 'Token requis'
      || msg === 'Non authentifié'
      || !msg;
    if (isAuthFailure) {
      localStorage.removeItem('neya_token');
      window.location.href = '/login';
      throw new Error('Non authentifié');
    }
    throw new Error(msg || 'Non autorisé');
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Erreur ${res.status}`);
  }

  if (res.headers.get('content-type')?.includes('application/pdf')) {
    return res.blob();
  }

  return res.json();
}

export function formatMoney(n) {
  return new Intl.NumberFormat('fr-CA', { style: 'currency', currency: 'CAD' }).format(n || 0);
}

export function formatDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('fr-CA');
}

export const TASK_TYPES = [
  { value: 'debitage', label: 'Débitage' },
  { value: 'usinage', label: 'Usinage' },
  { value: 'assemblage', label: 'Assemblage' },
  { value: 'finition', label: 'Finition' },
  { value: 'admin', label: 'Admin' },
];

export const ADMIN_TASK_CATEGORIES = [
  { value: 'marche', label: 'Marchés & événements', icon: '🏪', color: 'bg-purple-100 text-purple-800' },
  { value: 'facturation', label: 'Factures & devis', icon: '📄', color: 'bg-blue-100 text-blue-800' },
  { value: 'site_web', label: 'Site web', icon: '🌐', color: 'bg-cyan-100 text-cyan-800' },
  { value: 'marketing', label: 'Pub & SEO', icon: '📣', color: 'bg-pink-100 text-pink-800' },
  { value: 'gestion', label: 'Gestion générale', icon: '📋', color: 'bg-amber-100 text-amber-800' },
];

export const ADMIN_TASK_STATUS = [
  { value: 'todo', label: 'À faire', cls: 'bg-neya-cream text-neya-muted' },
  { value: 'doing', label: 'En cours', cls: 'bg-neya-warning/20 text-neya-warning' },
  { value: 'done', label: 'Fait', cls: 'bg-green-100 text-green-800' },
];

export function adminCategoryMeta(value) {
  return ADMIN_TASK_CATEGORIES.find(c => c.value === value) || ADMIN_TASK_CATEGORIES[4];
}

export const EXPENSE_CATEGORIES = [
  'materiaux', 'outils', 'transport', 'atelier', 'admin',
];

export const PURCHASE_NEED_CATEGORIES = [
  { value: 'consommable', label: 'Consommables' },
  { value: 'quincaillerie', label: 'Quincaillerie' },
  { value: 'finition', label: 'Finitions' },
  { value: 'materiaux', label: 'Matières premières' },
  { value: 'outil', label: 'Outils' },
  { value: 'emballage', label: 'Emballages' },
  { value: 'autre', label: 'Autre' },
];

export const PURCHASE_NEED_STATUS = {
  needed: { label: 'À acheter', cls: 'bg-amber-100 text-amber-900' },
  ordered: { label: 'Commandé', cls: 'bg-blue-100 text-blue-800' },
  received: { label: 'Reçu', cls: 'bg-green-100 text-green-800' },
};

export const PROJECT_STATUS = [
  { value: 'active', label: 'Actif', color: 'bg-neya-success' },
  { value: 'paused', label: 'Pause', color: 'bg-neya-warning' },
  { value: 'done', label: 'Terminé', color: 'bg-neya-muted' },
];

export async function downloadPdf(path, filename) {
  const token = getToken();
  const res = await fetch(`${getApiUrl()}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Erreur téléchargement PDF (${res.status})`);
  }
  const blob = await res.blob();
  if (!blob.size || blob.type === 'application/json') {
    throw new Error('Le serveur n\'a pas renvoyé un PDF valide');
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.target = '_blank';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

/** Charge un PDF et renvoie une URL blob pour prévisualisation (iframe). */
export async function fetchPdfObjectUrl(path) {
  const token = getToken();
  const res = await fetch(`${getApiUrl()}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Erreur PDF (${res.status})`);
  }
  const blob = await res.blob();
  if (!blob.size || (blob.type && blob.type.includes('json'))) {
    throw new Error('Le serveur n\'a pas renvoyé un PDF valide');
  }
  return URL.createObjectURL(blob);
}

export const UPLOADS_URL = getApiRoot();

export const QUOTE_STATUS = {
  draft: { label: 'Brouillon', color: 'bg-gray-200 text-gray-700' },
  sent: { label: 'Envoyé', color: 'bg-blue-100 text-blue-700' },
  accepted: { label: 'Accepté', color: 'bg-neya-success/20 text-neya-success' },
  rejected: { label: 'Refusé', color: 'bg-neya-error/20 text-neya-error' },
};

export function calcLineSubtotal(lines) {
  return (lines || []).reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.price) || 0), 0);
}

export function calcTaxes(subtotal) {
  const gst = subtotal * 0.05;
  const qst = subtotal * 0.09975;
  return { subtotal, gst, qst, total: subtotal + gst + qst };
}

export const INVOICE_STATUS = {
  draft: { label: 'Brouillon', color: 'bg-gray-200 text-gray-700' },
  sent: { label: 'Envoyée', color: 'bg-blue-100 text-blue-700' },
  partially_paid: { label: 'Partiel', color: 'bg-neya-warning/20 text-neya-warning' },
  paid: { label: 'Payée', color: 'bg-neya-success/20 text-neya-success' },
  overdue: { label: 'En retard', color: 'bg-neya-error/20 text-neya-error' },
};

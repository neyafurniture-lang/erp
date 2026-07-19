import pool from '../db/pool.js';
import { clearCompanyCache } from './company-config.js';

/** Modèles Anthropic retirés → remplacement API actuel (juin 2026+). */
const RETIRED_ANTHROPIC_MODELS = {
  'claude-sonnet-4-20250514': 'claude-sonnet-4-6',
  'claude-opus-4-20250514': 'claude-opus-4-8',
  'claude-3-7-sonnet-20250219': 'claude-sonnet-4-6',
  'claude-3-5-haiku-20241022': 'claude-haiku-4-5-20251001',
};

const DEFAULTS = {
  ai_provider: 'anthropic',
  anthropic_api_key: '',
  anthropic_model: 'claude-sonnet-5',
  openai_api_key: '',
  openai_model: 'gpt-4o-mini',
  assistant_ai_enabled: true,
  company_name: 'Neya Furniture',
  company_email: 'neyafurniture@gmail.com',
  company_phone: '+1 514 910-4874',
  wordpress_url: 'https://neyafurniture.ca',
  woocommerce_key: '',
  woocommerce_secret: '',
  wordpress_last_sync: null,
  smtp_host: '',
  smtp_port: 587,
  smtp_user: '',
  smtp_pass: '',
  smtp_from: '',
  calendar_include_custom: true,
  cursor_api_key: '',
  cursor_runtime: 'local',
  cursor_repo_url: '',
  cursor_cwd: '/opt/neya-erp',
  cursor_model: 'composer-2.5',
  google_client_id: '',
  google_client_secret: '',
  google_redirect_uri: '',
  meta_app_id: '',
  meta_app_secret: '',
  meta_redirect_uri: '',
  pinterest_app_id: '',
  pinterest_app_secret: '',
  pinterest_redirect_uri: '',
  project_admin_pin: '3125',
};

function maskSecret(value) {
  if (!value || typeof value !== 'string') return '';
  if (value.length <= 8) return '••••••••';
  return `••••${value.slice(-4)}`;
}

const SECRET_KEYS = [
  'anthropic_api_key', 'openai_api_key', 'woocommerce_key', 'woocommerce_secret',
  'smtp_pass', 'cursor_api_key', 'google_client_secret', 'project_admin_pin',
  'meta_app_secret', 'pinterest_app_secret',
];

export async function getSetting(key) {
  const { rows } = await pool.query('SELECT value FROM app_settings WHERE key = $1', [key]);
  if (!rows[0] || rows[0].value === null) return DEFAULTS[key] ?? null;
  return rows[0].value;
}

export async function setSetting(key, value) {
  await pool.query(
    `INSERT INTO app_settings (key, value, updated_at) VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
    [key, JSON.stringify(value)]
  );
}

export async function getAllSettings() {
  const { rows } = await pool.query('SELECT key, value FROM app_settings');
  const map = { ...DEFAULTS };
  for (const row of rows) map[row.key] = row.value;
  return map;
}

export async function getPublicSettings() {
  const all = await getAllSettings();
  const openaiKey = all.openai_api_key || process.env.OPENAI_API_KEY || '';
  const anthropicKey = all.anthropic_api_key || process.env.ANTHROPIC_API_KEY || '';
  const wooKey = all.woocommerce_key || process.env.WOOCOMMERCE_KEY || '';
  const wooSecret = all.woocommerce_secret || process.env.WOOCOMMERCE_SECRET || '';
  return {
    ai_provider: all.ai_provider || 'anthropic',
    anthropic_model: resolveAnthropicModel(all.anthropic_model),
    anthropic_configured: Boolean(anthropicKey),
    anthropic_api_key_preview: anthropicKey ? maskSecret(anthropicKey) : '',
    openai_model: all.openai_model,
    assistant_ai_enabled: all.assistant_ai_enabled,
    ai_configured: Boolean(anthropicKey || openaiKey),
    openai_configured: Boolean(openaiKey),
    openai_api_key_preview: openaiKey ? maskSecret(openaiKey) : '',
    company_name: all.company_name,
    company_email: all.company_email,
    company_phone: all.company_phone,
    wordpress_url: all.wordpress_url,
    woocommerce_configured: Boolean(wooKey && wooSecret),
    woocommerce_key_preview: wooKey ? maskSecret(wooKey) : '',
    wordpress_last_sync: all.wordpress_last_sync,
    smtp_configured: Boolean(all.smtp_host && all.smtp_user),
    smtp_host: all.smtp_host,
    smtp_port: all.smtp_port,
    smtp_user: all.smtp_user,
    smtp_from: all.smtp_from,
    calendar_include_custom: all.calendar_include_custom,
    cursor_runtime: all.cursor_runtime || 'local',
    cursor_repo_url: all.cursor_repo_url || '',
    cursor_cwd: all.cursor_cwd || '/opt/neya-erp',
    cursor_model: all.cursor_model || 'composer-2.5',
    cursor_configured: Boolean(all.cursor_api_key || process.env.CURSOR_API_KEY),
    cursor_api_key_preview: (all.cursor_api_key || process.env.CURSOR_API_KEY)
      ? maskSecret(String(all.cursor_api_key || process.env.CURSOR_API_KEY))
      : '',
    google_client_id: all.google_client_id || process.env.GOOGLE_CLIENT_ID || '',
    google_client_secret_preview: (all.google_client_secret || process.env.GOOGLE_CLIENT_SECRET)
      ? maskSecret(String(all.google_client_secret || process.env.GOOGLE_CLIENT_SECRET))
      : '',
    project_admin_pin_configured: Boolean(all.project_admin_pin || process.env.PROJECT_ADMIN_PIN || '3125'),
    google_redirect_uri: all.google_redirect_uri || process.env.GOOGLE_REDIRECT_URI || '',
    google_configured: Boolean(
      (all.google_client_id || process.env.GOOGLE_CLIENT_ID)
      && (all.google_client_secret || process.env.GOOGLE_CLIENT_SECRET)
    ),
    meta_app_id: all.meta_app_id || process.env.META_APP_ID || '',
    meta_app_secret_preview: (all.meta_app_secret || process.env.META_APP_SECRET)
      ? maskSecret(String(all.meta_app_secret || process.env.META_APP_SECRET))
      : '',
    meta_redirect_uri: all.meta_redirect_uri || process.env.META_REDIRECT_URI || '',
    meta_configured: Boolean(
      (all.meta_app_id || process.env.META_APP_ID)
      && (all.meta_app_secret || process.env.META_APP_SECRET)
    ),
    pinterest_app_id: all.pinterest_app_id || process.env.PINTEREST_APP_ID || '',
    pinterest_app_secret_preview: (all.pinterest_app_secret || process.env.PINTEREST_APP_SECRET)
      ? maskSecret(String(all.pinterest_app_secret || process.env.PINTEREST_APP_SECRET))
      : '',
    pinterest_redirect_uri: all.pinterest_redirect_uri || process.env.PINTEREST_REDIRECT_URI || '',
    pinterest_configured: Boolean(
      (all.pinterest_app_id || process.env.PINTEREST_APP_ID)
      && (all.pinterest_app_secret || process.env.PINTEREST_APP_SECRET)
    ),
  };
}

export async function updateSettings(patch) {
  const allowed = Object.keys(DEFAULTS);
  for (const key of allowed) {
    if (patch[key] === undefined) continue;
    if (SECRET_KEYS.includes(key) && (patch[key] === '' || String(patch[key]).startsWith('••••'))) continue;
    await setSetting(key, patch[key]);
  }
  clearCompanyCache();
  return getPublicSettings();
}

export async function getOpenAIKey() {
  const fromDb = await getSetting('openai_api_key');
  if (fromDb && String(fromDb).trim()) return String(fromDb).trim();
  return process.env.OPENAI_API_KEY || null;
}

export async function getAnthropicKey() {
  const fromDb = await getSetting('anthropic_api_key');
  if (fromDb && String(fromDb).trim()) return String(fromDb).trim();
  return process.env.ANTHROPIC_API_KEY || null;
}

/** Normalise un ID modèle Claude (aliases / modèles retirés → ID API valide). */
export function resolveAnthropicModel(raw) {
  const model = String(raw || '').trim() || DEFAULTS.anthropic_model;
  if (RETIRED_ANTHROPIC_MODELS[model]) return RETIRED_ANTHROPIC_MODELS[model];
  return model;
}

/** Modèle Claude à utiliser pour les appels API (+ migration soft si ID retiré en DB). */
export async function getAnthropicModel() {
  const raw = await getSetting('anthropic_model');
  const resolved = resolveAnthropicModel(raw);
  const stored = raw == null ? '' : String(raw).trim();
  if (stored && RETIRED_ANTHROPIC_MODELS[stored] && resolved !== stored) {
    setSetting('anthropic_model', resolved).catch(() => {});
  }
  return resolved;
}

export async function isAssistantAiEnabled() {
  return (await getSetting('assistant_ai_enabled')) !== false;
}

export async function seedDefaultSettings() {
  for (const [key, value] of Object.entries(DEFAULTS)) {
    await pool.query(
      `INSERT INTO app_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING`,
      [key, JSON.stringify(value)]
    );
  }
}

export const API_ROUTES = [
  { method: 'POST', path: '/api/auth/login', desc: 'Connexion' },
  { method: 'PUT', path: '/api/auth/password', desc: 'Changer mot de passe' },
  { method: 'GET', path: '/api/production', desc: 'File de production atelier' },
  { method: 'POST', path: '/api/production', desc: 'Nouvelle production (banc ou sur mesure)' },
  { method: 'POST', path: '/api/production/:id/advance', desc: 'Avancer étape production' },
  { method: 'GET', path: '/api/clients', desc: 'Liste clients' },
  { method: 'GET', path: '/api/invoices/quotes/:id', desc: 'Détail devis' },
  { method: 'POST', path: '/api/invoices/quotes/:id/send', desc: 'Envoyer devis par courriel' },
  { method: 'GET', path: '/api/invoices/:id', desc: 'Détail facture' },
  { method: 'POST', path: '/api/invoices/:id/send', desc: 'Envoyer facture par courriel' },
  { method: 'GET', path: '/api/wordpress/status', desc: 'Statut connexion site web' },
  { method: 'POST', path: '/api/wordpress/sync', desc: 'Sync produits WooCommerce' },
  { method: 'POST', path: '/api/wordpress/sync-photos', desc: 'Télécharger photos produits' },
  { method: 'POST', path: '/api/wordpress/sync-all', desc: 'Sync complète site web' },
  { method: 'GET', path: '/api/wordpress/orders', desc: 'Commandes web synchronisées' },
  { method: 'GET', path: '/api/wordpress/test', desc: 'Tester connexion site web' },
  { method: 'POST', path: '/api/assistant/chat', desc: 'Chat assistant' },
  { method: 'GET', path: '/api/settings', desc: 'Paramètres ERP' },
  { method: 'PUT', path: '/api/settings', desc: 'Mettre à jour paramètres' },
];

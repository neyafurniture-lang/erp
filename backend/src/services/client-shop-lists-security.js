import crypto from 'crypto';

export const SHOP_URGENCIES = ['low', 'normal', 'high', 'critical'];
export const SHOP_ITEM_STATUSES = ['todo', 'ordered', 'done'];

const TOKEN_BYTES = 32;

export function generatePublicToken() {
  return crypto.randomBytes(TOKEN_BYTES).toString('base64url');
}

/** Autorise uniquement http(s) absolus — bloque javascript:, data:, etc. */
export function sanitizeShopUrl(raw) {
  if (raw == null || raw === '') return null;
  const s = String(raw).trim();
  if (!s) return null;
  let u;
  try {
    u = new URL(s);
  } catch {
    throw new Error('Lien d’achat invalide (URL http/https requise)');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new Error('Lien d’achat : seul http(s) est autorisé');
  }
  if (u.username || u.password) {
    throw new Error('Lien d’achat : identifiants dans l’URL interdits');
  }
  return u.toString();
}

export function normalizeUrgency(v) {
  const s = String(v || 'normal').toLowerCase();
  return SHOP_URGENCIES.includes(s) ? s : 'normal';
}

export function normalizeItemStatus(v) {
  const s = String(v || 'todo').toLowerCase();
  return SHOP_ITEM_STATUSES.includes(s) ? s : 'todo';
}

/** Payload public minimal — jamais d’IDs clients / mails / notes internes. */
export function toPublicShopPayload(list, items) {
  return {
    title: list.title,
    subtitle: list.subtitle || null,
    client_name: list.show_client_name ? (list.client_name || null) : null,
    updated_at: list.updated_at,
    items: (items || []).map(it => ({
      id: it.id,
      title: it.title,
      price: it.price != null ? Number(it.price) : null,
      currency: it.currency || 'CAD',
      url: it.url || null,
      urgency: it.urgency || 'normal',
      notes: it.notes_public || null,
      status: it.status || 'todo',
    })),
  };
}

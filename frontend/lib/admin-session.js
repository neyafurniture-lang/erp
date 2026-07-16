/** Code pour ouvrir une session admin (notes / suivi). */
export const ADMIN_SESSION_PIN = '31250';

const STORAGE_KEY = 'neya_admin_session';
/** Durée de session : 4 h (ferme l’onglet = sessionStorage perdu). */
const TTL_MS = 4 * 60 * 60 * 1000;

export function isAdminSessionOpen() {
  if (typeof window === 'undefined') return false;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const data = JSON.parse(raw);
    if (!data?.ok || !data?.at) return false;
    if (Date.now() - Number(data.at) > TTL_MS) {
      sessionStorage.removeItem(STORAGE_KEY);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function openAdminSession() {
  if (typeof window === 'undefined') return;
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ ok: true, at: Date.now() }));
}

export function closeAdminSession() {
  if (typeof window === 'undefined') return;
  sessionStorage.removeItem(STORAGE_KEY);
}

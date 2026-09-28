/** Session Finance (P&L) — jeton serveur après POST /analytics/unlock. */
const STORAGE_KEY = 'neya_finance_session';
/** Durée de session : 4 h (alignée TTL backend). */
const TTL_MS = 4 * 60 * 60 * 1000;

export function getFinanceToken() {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data?.ok || !data?.at || !data?.token) return null;
    if (Date.now() - Number(data.at) > TTL_MS) {
      sessionStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return String(data.token);
  } catch {
    return null;
  }
}

export function isFinanceSessionOpen() {
  return Boolean(getFinanceToken());
}

export function openFinanceSession(financeToken) {
  if (typeof window === 'undefined') return;
  if (!financeToken) return;
  sessionStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ ok: true, at: Date.now(), token: String(financeToken) })
  );
}

export function closeFinanceSession() {
  if (typeof window === 'undefined') return;
  sessionStorage.removeItem(STORAGE_KEY);
}

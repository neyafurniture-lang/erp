import { api } from './api';

const THREAD_PREFIXES = ['/gmail/threads', '/email-threads'];

function isNotFoundError(err) {
  return /404|introuvable|not found/i.test(String(err?.message || ''));
}

/** Appels API fils de conversation — essaie /gmail/threads puis /email-threads */
export async function threadApi(path, options = {}) {
  let lastErr;
  for (const prefix of THREAD_PREFIXES) {
    try {
      return await api(`${prefix}${path}`, options);
    } catch (err) {
      lastErr = err;
      if (!isNotFoundError(err)) throw err;
    }
  }
  throw lastErr || new Error('Service de fils courriel indisponible');
}

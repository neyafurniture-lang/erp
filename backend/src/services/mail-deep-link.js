/** Lien profond vers un message Gmail dans l’ERP. */
export function mailMessageHref(messageId) {
  if (!messageId) return '/mail';
  return `/mail?message=${encodeURIComponent(String(messageId))}`;
}

/**
 * Extrait l’id Gmail depuis source_key (`mail_payable_xxx` / `mail_receivable_xxx`)
 * ou depuis un link_href déjà profond.
 */
export function resolveMailTaskHref({ source_key, link_href } = {}) {
  const fromKey = String(source_key || '').match(/^mail_(?:payable|receivable)_(.+)$/);
  if (fromKey?.[1]) return mailMessageHref(fromKey[1]);
  if (link_href && link_href !== '/mail') return link_href;
  return link_href || null;
}

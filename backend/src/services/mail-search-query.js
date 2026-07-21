/** Construit une requête Gmail à partir du message utilisateur (sans dépendances I/O). */
export function buildGmailSearchQuery(message, params = {}) {
  if (params.message_id) return null;
  if (params.query) return String(params.query).trim();

  const msg = String(message || '');
  const lower = msg.toLowerCase();
  const terms = [];

  const fromMatch = msg.match(
    /(?:mail|courriel|envoi|message)\s+(?:de\s+|d['']|du\s+)?([A-Za-zÀ-ÿ][\wÀ-ÿ' -]{2,40}?)(?:\s*$|\s+(?:avec|pour|—|-))/i
  ) || msg.match(/du mail de\s+([A-Za-zÀ-ÿ][\wÀ-ÿ' -]{2,40})/i);
  if (fromMatch) terms.push(fromMatch[1].trim());

  if (/olive/i.test(msg) && !terms.some(t => /olive/i.test(t))) terms.push('olive');
  if (/facturation/i.test(lower)) terms.push('facturation');
  if (/facture|invoice|re[cç]u/i.test(lower)) terms.push('facture OR invoice OR facturation');

  if (terms.length) return terms.join(' ');
  if (/celle du mail|dans les mail|dans la bo[iî]te/i.test(lower)) return 'facture OR invoice newer_than:7d';
  return 'facture OR invoice newer_than:14d';
}

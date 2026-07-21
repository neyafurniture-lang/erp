/**
 * Classification pure factures mail → À payer / À recevoir (sans DB / Gmail).
 */

const SUPPLIER_PATTERNS = [
  { id: 'home_depot', label: 'Home Depot', patterns: ['homedepot', 'home depot', 'home-depot'] },
  { id: 'rona', label: 'Rona', patterns: ['rona'] },
  { id: 'canac', label: 'Canac', patterns: ['canac'] },
  { id: 'reno_depot', label: 'Reno Depot', patterns: ['renodepot', 'reno-depot', 'reno depot'] },
  { id: 'amazon', label: 'Amazon', patterns: ['amazon'] },
  { id: 'walmart', label: 'Walmart', patterns: ['walmart'] },
];

const INVOICE_HINTS = [
  'facture', 'invoice', 'facturation', 'receipt', 'reçu', 'recu',
  'à payer', 'a payer', 'montant dû', 'payment due', 'votre facture',
  'order confirmation', 'confirmation de commande', 'your order', 'votre commande',
];

/** Contreparties connues hors DB (ex. Phoenix). */
export const KNOWN_ALIASES = [
  { name: 'Phoenix', patterns: ['phoenix', 'pheonix'] },
  { name: 'Olive', patterns: ['olive'] },
];

export function norm(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s@.]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseEmailAddress(raw) {
  if (!raw) return null;
  const m = String(raw).match(/<([^>]+)>/);
  const email = (m ? m[1] : raw).trim().toLowerCase();
  return email.includes('@') ? email : null;
}

export function parseDisplayName(raw) {
  if (!raw) return null;
  const m = String(raw).match(/^"?([^"<]+)"?\s*</);
  const name = (m ? m[1] : String(raw).split('@')[0] || '').trim();
  if (name.length < 2) return null;
  if (name.includes('@')) return name.split('@')[0];
  return name;
}

export function personSlug(name) {
  return norm(name).replace(/\s+/g, '_').slice(0, 48) || 'inconnu';
}

function detectSupplierLabel(from, subject, snippet) {
  const hay = norm(`${from} ${subject} ${snippet}`);
  for (const s of SUPPLIER_PATTERNS) {
    if (s.patterns.some(p => hay.includes(norm(p)))) return s.label;
  }
  return null;
}

export function looksLikeInvoiceMail({ subject, snippet, from, attachments = [] } = {}) {
  const hay = norm(`${subject} ${snippet} ${from}`);
  if (INVOICE_HINTS.some(h => hay.includes(norm(h)))) return true;
  const attNames = (attachments || []).map(a => norm(a.filename || a.name || '')).join(' ');
  if (/\b(facture|invoice|receipt|recu)\b/.test(attNames)) return true;
  return false;
}

/**
 * Direction : SENT → à recevoir (on a facturé) ; sinon → à payer (on a reçu une facture).
 */
export function classifyInvoiceKind({ labelIds = [], from = '', to = '', ownEmails = new Set() } = {}) {
  const labels = labelIds.map(String);
  if (labels.includes('SENT')) return 'a_recevoir';

  const fromEmail = parseEmailAddress(from);
  if (fromEmail && ownEmails.has(fromEmail)) return 'a_recevoir';

  const toEmail = parseEmailAddress(to);
  if (toEmail && ownEmails.has(toEmail) && fromEmail && !ownEmails.has(fromEmail)) {
    return 'a_payer';
  }

  return 'a_payer';
}

export function buildInvoiceTaskTitle(kind, personName) {
  const who = String(personName || 'inconnu').trim() || 'inconnu';
  if (kind === 'a_recevoir') return `À recevoir — facture ${who}`;
  return `À payer — facture ${who}`;
}

/**
 * @param {{ haystack: string, people: Array<{ name: string, email?: string|null, type?: string }> }}
 */
export function matchCounterparty({ haystack, people = [] } = {}) {
  const hay = norm(haystack);
  const emailMatch = String(haystack || '').match(/[\w.+-]+@[\w.-]+\.\w+/gi) || [];
  for (const email of emailMatch.map(e => e.toLowerCase())) {
    const hit = people.find(p => p.email && String(p.email).toLowerCase() === email);
    if (hit) return hit.name;
  }

  const ranked = [...people]
    .filter(p => p.name && norm(p.name).length >= 3)
    .sort((a, b) => norm(b.name).length - norm(a.name).length);

  for (const p of ranked) {
    const n = norm(p.name);
    if (n.length >= 3 && hay.includes(n)) return p.name;
    const first = n.split(' ')[0];
    if (first.length >= 4 && hay.includes(first)) return p.name;
  }

  for (const alias of KNOWN_ALIASES) {
    if (alias.patterns.some(p => hay.includes(norm(p)))) return alias.name;
  }

  return null;
}

export function guessPersonFromMessage(msg, kind, people) {
  const peerRaw = kind === 'a_recevoir' ? (msg.to || msg.from) : (msg.from || msg.to);
  const display = parseDisplayName(peerRaw);
  const matched = matchCounterparty({
    haystack: `${peerRaw} ${msg.subject} ${msg.snippet}`,
    people,
  });
  if (matched) return matched;

  const supplier = detectSupplierLabel(msg.from, msg.subject, msg.snippet);
  if (supplier) return supplier;

  if (display && !/@/.test(display) && display.length >= 2) {
    const cleaned = display.replace(/\s+/g, ' ').trim();
    if (!/neya/i.test(cleaned)) return cleaned;
  }
  return 'inconnu';
}

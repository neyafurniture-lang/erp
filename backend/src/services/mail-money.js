/**
 * Montants et nature d’un courriel fournisseur (facture / ticket / reçu).
 * Sans DB ni Gmail — réutilisable par ingest, scan et tests.
 */

export function attachmentNamesText(attachments = []) {
  if (!attachments) return '';
  if (typeof attachments === 'string') return attachments;
  if (!Array.isArray(attachments)) return String(attachments);
  return attachments
    .map((a) => (typeof a === 'string' ? a : (a?.filename || a?.name || '')))
    .filter(Boolean)
    .join(' ');
}

export function mailHaystack({ subject = '', snippet = '', body = '', attachments } = {}) {
  return `${subject} ${snippet} ${body} ${attachmentNamesText(attachments)}`;
}

/** Notre propre devis / facture client — pas une dépense. */
export function isOurQuoteOrClientInvoice(subject = '', snippet = '') {
  const t = `${subject} ${snippet}`;
  return /\b(?:q-\d{4}|f-\d{4}|devis\s*n[°o]|votre devis|quote\s*#)\b/i.test(t)
    || /\bneya\s+(?:furniture\s+)?(?:invoice|facture|devis)\b/i.test(t);
}

/**
 * Newsletter / promo sans pièce de caisse.
 * Une vraie facture / ticket passe toujours.
 */
export function isLikelyPromoMail(from = '', subject = '', snippet = '') {
  const doc = /\b(facture|invoice|receipt|ticket|re[cç]u|order confirmation|confirmation de commande|bon de commande)\b/i
    .test(`${subject} ${snippet}`);
  if (doc) return false;
  const hay = `${from} ${subject} ${snippet}`;
  return /unsubscribe|d[ée]sinscri|newsletter|view in browser|%\s*off|promo code|code promo|soldes\b|flash sale/i.test(hay);
}

/**
 * ticket | recu | facture | null
 * Ticket / reçu magasin = déjà débité. Facture = à payer.
 */
export function mailDocKind({ subject = '', snippet = '', body = '', attachments } = {}) {
  const t = mailHaystack({ subject, snippet, body, attachments }).toLowerCase();
  if (/\bticket\b|\bcaisse\b|\bpos\b/.test(t)) return 'ticket';
  if (/\breceipt\b|\bre[cç]u\b|\bpaiement (?:re[cç]u|confirm)|payment (?:received|confirmation)|d[ée]bit[ée]/.test(t)) {
    return 'recu';
  }
  if (/\bfacture\b|\binvoice\b|\bmontant d[ûu]\b|\bpayment due\b|\bbalance due\b|\b[àa] payer\b/.test(t)) {
    return 'facture';
  }
  if (/\border confirmation\b|\bconfirmation de commande\b|\bbon de commande\b|\bpurchase order\b/.test(t)) {
    return 'facture';
  }
  return null;
}

export function paymentStatusFromMail(msg = {}) {
  const kind = mailDocKind(msg);
  const t = mailHaystack(msg).toLowerCase();
  const paidHint = /\b(paid|pay[ée]|r[ée]gl[ée]|d[ée]bit[ée]|visa|mastercard|interac|already paid|d[ée]j[àa] pay)/i.test(t);
  if (kind === 'ticket' || kind === 'recu') return 'paid';
  if (paidHint && kind !== 'facture') return 'paid';
  if (kind === 'facture') return 'unpaid';
  if (paidHint) return 'paid';
  return 'unpaid';
}

/** Libellé UI : Facture à payer / Ticket payé / Reçu. */
export function mailMoneyLabel(msg = {}) {
  const kind = mailDocKind(msg);
  const status = paymentStatusFromMail(msg);
  if (kind === 'ticket') return status === 'paid' ? 'Ticket · payé' : 'Ticket';
  if (kind === 'recu') return 'Reçu · payé';
  if (kind === 'facture' && status === 'unpaid') return 'Facture à payer';
  if (kind === 'facture') return 'Facture · payée';
  if (status === 'paid') return 'Payé';
  return 'À payer';
}

/** Extrait un montant CAD approximatif du texte mail. */
export function extractMoneyAmount(...parts) {
  const blob = parts.filter(Boolean).join('\n');
  if (!blob) return null;
  const patterns = [
    /(?:total|montant|amount|grand\s*total|balance\s*due|sous[- ]?total)[^\d]{0,20}(\d{1,3}(?:[ ,]\d{3})*[.,]\d{2}|\d+[.,]\d{2})/i,
    /\$\s*(\d{1,3}(?:[ ,]\d{3})*[.,]\d{2}|\d+[.,]\d{2})/,
    /(\d{1,3}(?:[ ,]\d{3})*[.,]\d{2}|\d+[.,]\d{2})\s*(?:\$|cad|CAD)/,
  ];
  for (const re of patterns) {
    const m = blob.match(re);
    if (!m?.[1]) continue;
    let raw = String(m[1]).replace(/\s/g, '');
    if (/^\d{1,3}(\.\d{3})+(,\d{2})$/.test(raw)) {
      raw = raw.replace(/\./g, '').replace(',', '.');
    } else if (/,\d{2}$/.test(raw) && !raw.includes('.')) {
      raw = raw.replace(',', '.');
    } else {
      raw = raw.replace(/,/g, '');
    }
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0 && n < 500000) return Math.round(n * 100) / 100;
  }
  return null;
}

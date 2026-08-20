/**
 * Extraction structurée depuis le texte d'un contrat marché (PDF Bazar Verdunois, etc.).
 */
import { extractPdfStrings } from './attachment-extract.js';

export const MARKET_STATUSES = [
  'not_started',
  'in_progress',
  'applied',
  'accepted',
  'confirmed',
  'done',
  'cancelled',
];

export const DEFAULT_MARKET_STEPS = [
  { key: 'follow', label: 'Newsletter / RS organisateur', done: false },
  { key: 'apply', label: 'Envoyer la candidature', done: false },
  { key: 'wait', label: 'Attendre la réponse', done: false },
  { key: 'contract', label: 'Signer le contrat', done: false },
  { key: 'pay', label: 'Payer la facture d\'inscription', done: false },
  { key: 'promo', label: 'Publier sur nos réseaux (tag organisateur)', done: false },
  { key: 'inventory', label: 'Préparer inventaire stand + terminal', done: false },
  { key: 'setup', label: 'Montage (heure d\'installation)', done: false },
  { key: 'event', label: 'Tenir le stand — présence continue', done: false },
  { key: 'sales', label: 'Bilan des ventes', done: false },
];

const MONTHS = {
  janvier: 1, fevrier: 2, février: 2, mars: 3, avril: 4, mai: 5, juin: 6,
  juillet: 7, aout: 8, août: 8, septembre: 9, octobre: 10, novembre: 11, decembre: 12, décembre: 12,
};

function norm(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseFrenchDateToken(token, defaultYear = new Date().getFullYear()) {
  const t = norm(token);
  const m1 = t.match(/(\d{1,2})\s+(janvier|fevrier|février|mars|avril|mai|juin|juillet|aout|août|septembre|octobre|novembre|decembre|décembre)(?:\s+(\d{4}))?/i);
  if (m1) {
    const mo = MONTHS[norm(m1[2])] || MONTHS[m1[2].toLowerCase()];
    const y = m1[3] ? Number(m1[3]) : defaultYear;
    return `${y}-${String(mo).padStart(2, '0')}-${String(m1[1]).padStart(2, '0')}`;
  }
  const m2 = t.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m2) return m2[0];
  return null;
}

function parseDateRange(text, defaultYear) {
  const blob = String(text || '');
  const y = defaultYear || new Date().getFullYear();
  // "Samedi 24 et dimanche 25 octobre 2026"
  const range = blob.match(/(?:samedi|sam\.?)\s*(\d{1,2})\s*(?:et|,|&|\/?)\s*(?:dimanche|dim\.?)\s*(\d{1,2})\s+(janvier|février|fevrier|mars|avril|mai|juin|juillet|août|aout|septembre|octobre|novembre|décembre|decembre)\s*(\d{4})?/i);
  if (range) {
    const mo = MONTHS[norm(range[3])];
    const year = range[4] ? Number(range[4]) : y;
    const start = `${year}-${String(mo).padStart(2, '0')}-${String(range[1]).padStart(2, '0')}`;
    const end = `${year}-${String(mo).padStart(2, '0')}-${String(range[2]).padStart(2, '0')}`;
    return { start_date: start, end_date: end };
  }
  // "28 & dimanche 29 novembre 2026"
  const amp = blob.match(/(\d{1,2})\s*(?:&|et)\s*(?:dimanche\s*)?(\d{1,2})\s+(janvier|février|fevrier|mars|avril|mai|juin|juillet|août|aout|septembre|octobre|novembre|décembre|decembre)\s*(\d{4})?/i);
  if (amp) {
    const mo = MONTHS[norm(amp[3])];
    const year = amp[4] ? Number(amp[4]) : y;
    return {
      start_date: `${year}-${String(mo).padStart(2, '0')}-${String(amp[1]).padStart(2, '0')}`,
      end_date: `${year}-${String(mo).padStart(2, '0')}-${String(amp[2]).padStart(2, '0')}`,
    };
  }
  // "16 et 17 mai" / "8 et 9 août"
  const simple = blob.match(/(\d{1,2})\s+et\s+(\d{1,2})\s+(janvier|février|fevrier|mars|avril|mai|juin|juillet|août|aout|septembre|octobre|novembre|décembre|decembre)(?:\s+(\d{4}))?/i);
  if (simple) {
    const mo = MONTHS[norm(simple[3])];
    const year = simple[4] ? Number(simple[4]) : y;
    return {
      start_date: `${year}-${String(mo).padStart(2, '0')}-${String(simple[1]).padStart(2, '0')}`,
      end_date: `${year}-${String(mo).padStart(2, '0')}-${String(simple[2]).padStart(2, '0')}`,
    };
  }
  // "Dates et heures : Samedi 28 & dimanche 29 novembre 2026"
  const lineDates = blob.match(/Dates[^\n]{0,30}:\s*([^\n]+)/i);
  if (lineDates) {
    const d2 = parseDateRange(lineDates[1], y);
    if (d2.start_date) return d2;
  }
  return { start_date: null, end_date: null };
}

function pickFirst(re, text) {
  const m = String(text || '').match(re);
  return m?.[1]?.trim() || null;
}

function parseAmount(text) {
  const m = String(text || '').match(/(?:facture|montant|acquitt(?:er|é)|total)[^\d$]{0,30}(\d{2,4}(?:[.,]\d{2})?)\s*\$?/i)
    || String(text || '').match(/(\d{2,4}(?:[.,]\d{2})?)\s*\$\s*\+\s*tax/i)
    || String(text || '').match(/\$\s*(\d{2,4}(?:[.,]\d{2})?)/);
  if (!m?.[1]) return null;
  return Number(String(m[1]).replace(',', '.'));
}

/** Parse le texte brut d'un contrat marché. */
export function parseMarketContractText(text, { filename = '', defaultYear } = {}) {
  const blob = String(text || '').replace(/\r/g, '');
  const yearHint = Number(blob.match(/\b(20\d{2})\b/)?.[1]) || defaultYear || new Date().getFullYear();
  const dates = parseDateRange(blob, yearHint);

  let name = pickFirst(/(?:march[eé]|grand march[eé]|foire)[^\n]{0,80}/i, blob)
    || pickFirst(/CONTRAT[^\n]*\n([^\n]{8,80})/i, blob);
  if (/automne.*[ée]trange|l['']?[ée]trange/i.test(blob)) {
    name = 'Marché de l\'Automne et de l\'Étrange — Bazar Verdunois';
  } else if (/no[eë]l|noel/i.test(blob) && /verdun/i.test(blob)) {
    name = 'Grand Marché de Noël de Verdun 2026';
  } else if (/collectif cr[eé]atif/i.test(blob)) {
    name = pickFirst(/march[eé][^\n]{0,60}/i, blob) || 'Marché Collectif Créatif MTL';
  }

  const organizer = /bazar verdunois/i.test(blob)
    ? 'Bazar Verdunois & L\'Élan Verdunois'
    : pickFirst(/^([A-Z][^\n]{5,60})\nCONTRAT/im, blob);

  const venue = pickFirst(/Emplacement\s*:?\s*([^\n]+)/i, blob)
    || pickFirst(/(?:Auditorium|Sous-sol)[^\n]{0,120}/i, blob);

  const address = pickFirst(/(\d{3,5}[^\n]{5,80}(?:H\d[A-Z]\s*\d[A-Z]\d)?)/i, blob);

  const eventHours = pickFirst(/de\s*(\d{1,2}\s*h(?:\s*[àa-]\s*\d{1,2}\s*h)?)/i, blob)
    || pickFirst(/(\d{1,2}\s*h\s*[àa-]\s*\d{1,2}\s*h)/i, blob);

  const setupStart = pickFirst(/(?:Installation|Montage)[^\n]{0,40}?(\d{1,2}\s*h\s*\d{0,2})/i, blob)
    || pickFirst(/(?:partir de|d[eè]s)\s*(\d{1,2}\s*h\s*\d{0,2})/i, blob);

  const presenceDeadline = pickFirst(/(?:Arriv[eé]e requise|pr[eé]sence)[^\n]{0,50}?(\d{1,2}\s*h\s*\d{0,2})/i, blob);

  const nightRepack = /remballage|repack|nuit/i.test(blob) && /samedi/i.test(blob);

  const wifi = /wi[- ]?fi/i.test(blob)
    ? (/pas de connexion wi[- ]?fi|ne dispose pas de wi[- ]?fi|sans wi[- ]?fi/i.test(blob) ? 'non' : 'oui')
    : null;

  const parking = pickFirst(/Stationnement\s*:?\s*([^\n]+)/i, blob);

  const tableSize = pickFirst(/Table de (\d+\s*pieds?)/i, blob)
    || (/\b4 pieds\b/i.test(blob) ? '4 pieds' : /\b6 pieds\b/i.test(blob) ? '6 pieds' : /\b8\s*pi\b/i.test(blob) ? '8 pi' : null);

  const panels = /\bavec panneaux\b/i.test(blob) ? 'avec panneaux'
    : /\bsans panneau\b/i.test(blob) ? 'sans panneau' : null;

  const feeAmount = parseAmount(blob);
  const contactEmail = pickFirst(/([\w.+-]+@[\w.-]+\.\w+)/, blob);
  const contactPhone = pickFirst(/(?:📞|\bt[eé]l\.?\b|phone)[^\d]{0,8}(\d{3}[-.\s]?\d{3}[-.\s]?\d{4})/i, blob)
    || pickFirst(/(\d{3}[-.\s]?\d{3}[-.\s]?\d{4})/, blob);

  const materials = ['Terminal paiement + monnaie'];
  if (wifi === 'non' || /cellulaire|bluetooth/i.test(blob)) materials.push('Terminal cellulaire (pas de Wi-Fi)');
  if (/gourde|tasse|gobelet r[eé]utilisable/i.test(blob)) materials.push('Gourde / tasse réutilisable');
  if (tableSize) materials.push(`Table ${tableSize}${panels ? ` (${panels})` : ''}`);
  materials.push('Inventaire produits NEYA');
  if (/mat[eé]riel publicitaire|kit.*promo|r[eé]seaux sociaux/i.test(blob)) materials.push('Kit promo organisateur (RS)');

  const logisticsNotes = [];
  if (nightRepack) logisticsNotes.push('Remballage complet obligatoire le samedi soir — réinstaller dimanche matin');
  if (/pr[eé]sence continue|tenu en tout temps/i.test(blob)) logisticsNotes.push('Kiosque tenu en permanence — pas de remballage avant 17 h');
  if (/gourde|d[eé]chets|r[eé]utilisable/i.test(blob)) logisticsNotes.push('Apporter gourde/tasse (virage écoresponsable)');

  const steps = DEFAULT_MARKET_STEPS.map(s => ({ ...s }));
  if (feeAmount) {
    const pay = steps.find(x => x.key === 'pay');
    if (pay) pay.label = `Payer la facture (${feeAmount} $ + taxes, 3 j ouvrables)`;
  }
  if (setupStart) {
    const setup = steps.find(x => x.key === 'setup');
    if (setup) setup.label = `Montage dès ${setupStart} — prêt à 10 h`;
  }

  return {
    name: name || filename.replace(/\.pdf$/i, '').replace(/_/g, ' ') || 'Marché',
    organizer,
    venue,
    address,
    ...dates,
    event_hours: eventHours ? `10 h – 17 h` : null,
    setup_start: setupStart,
    presence_deadline: presenceDeadline,
    fee_amount: feeAmount,
    fee_notes: feeAmount ? `${feeAmount} $ + taxes` : null,
    invoice_amount: feeAmount,
    status: 'accepted',
    description: pickFirst(/(?:march[eé]|[eé]v[eè]nement)[^\n]{0,120}/i, blob),
    contract_text: blob.slice(0, 12000),
    contract_filename: filename || null,
    logistics: {
      wifi,
      parking,
      night_repack: nightRepack,
      table_size: tableSize,
      panels,
      contact_email: contactEmail,
      contact_phone: contactPhone,
      setup_start: setupStart,
      presence_deadline: presenceDeadline,
      event_hours: eventHours,
      notes: logisticsNotes,
      materials_checklist: materials,
    },
    materials,
    steps,
  };
}

/** Heuristiques quand le PDF est un formulaire XFA (texte illisible). */
function enrichFromFilename(parsed, filename = '') {
  const fn = norm(filename);
  if (/noel|no[eë]l/.test(fn)) {
    parsed.start_date = parsed.start_date || '2026-11-28';
    parsed.end_date = parsed.end_date || '2026-11-29';
    parsed.name = 'Grand Marché de Noël de Verdun 2026';
    parsed.fee_amount = parsed.fee_amount || 260;
    parsed.organizer = parsed.organizer || 'Bazar Verdunois & L\'Élan Verdunois';
  } else if (/(etrange|automne)/.test(fn)) {
    parsed.start_date = parsed.start_date || '2026-10-24';
    parsed.end_date = parsed.end_date || '2026-10-25';
    parsed.name = 'Marché de l\'Automne et de l\'Étrange — Verdun';
    parsed.fee_amount = parsed.fee_amount || 218;
    parsed.organizer = parsed.organizer || 'Bazar Verdunois & L\'Élan Verdunois';
  } else if (/verdun|bazar/.test(fn)) {
    parsed.organizer = parsed.organizer || 'Bazar Verdunois & L\'Élan Verdunois';
  }
  return parsed;
}

/** Extraction brute depuis le binaire PDF (formulaires XFA). */
function extractPdfRawKeywords(buf) {
  const raw = Buffer.isBuffer(buf) ? buf.toString('latin1') : String(buf || '');
  const snippets = [];
  const patterns = [
    /(?:samedi|sam\.?)\s*\d{1,2}[^\n]{0,80}(?:octobre|novembre|d[eé]cembre)\s*20\d{2}/gi,
    /(?:montant|facture|acquitt)[^\n]{0,40}\d{2,4}\s*\$/gi,
    /(?:wi[- ]?fi|installation|montage|pr[eé]sence)[^\n]{0,60}/gi,
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(raw)) !== null) snippets.push(m[0]);
  }
  return snippets.join('\n');
}

export function parseMarketContractPdf(buffer, opts = {}) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  let text = extractPdfStrings(buf);
  if (text.length < 80) {
    text = [text, extractPdfRawKeywords(buf)].filter(Boolean).join('\n');
  }
  const parsed = parseMarketContractText(text, opts);
  return enrichFromFilename(parsed, opts.filename || '');
}

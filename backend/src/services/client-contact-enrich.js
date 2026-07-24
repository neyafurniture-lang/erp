/**
 * Extraction / enrichissement des coordonnées client depuis les mails liés.
 * Ne remplit que les champs vides (jamais d’écrasement).
 */
import pool from '../db/pool.js';
import { isNoiseEmail } from './clients-from-mail.js';
import { isPromotion } from './mail-sort.js';

const QC_CITIES = [
  'montreal', 'montréal', 'quebec', 'québec', 'laval', 'gatineau', 'longueuil',
  'sherbrooke', 'saguenay', 'levis', 'lévis', 'trois-rivieres', 'trois-rivières',
  'terrebonne', 'saint-jerome', 'saint-jérôme', 'brossard', 'repentigny',
  'drummondville', 'saint-hyacinthe', 'granby', 'shawinigan', 'rimouski',
  'victoriaville', 'chambly', 'saint-jean-sur-richelieu', 'blainville',
  'dollard-des-ormeaux', 'pointe-claire', 'westmount', 'outremont', 'verdun',
  'lasalle', 'lachine', 'anjou', 'rosemont', 'villeray', 'plateau',
];

function blank(v) {
  const s = String(v || '').trim();
  return s ? null : true;
}

function clean(v, max = 200) {
  const s = String(v || '').replace(/\s+/g, ' ').trim();
  return s ? s.slice(0, max) : null;
}

/** Téléphones NA / Québec courants. */
export function extractPhonesFromText(text) {
  const s = String(text || '');
  const found = [];
  const re = /(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}\b/g;
  let m;
  while ((m = re.exec(s))) {
    const raw = m[0].trim();
    const digits = raw.replace(/\D/g, '');
    if (digits.length < 10 || digits.length > 11) continue;
    // Évite dates / montants collés
    if (/^\d{10,}$/.test(raw) && !raw.includes('-') && !raw.includes(' ') && !raw.includes('(')) continue;
    found.push(normalizePhone(raw));
  }
  return [...new Set(found.filter(Boolean))];
}

export function normalizePhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) {
    const local = digits.slice(1);
    return `(${local.slice(0, 3)}) ${local.slice(3, 6)}-${local.slice(6)}`;
  }
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return clean(raw, 40);
}

export function extractEmailsFromText(text) {
  const s = String(text || '');
  const re = /[\w.+-]+@[\w.-]+\.\w{2,}/gi;
  const out = [];
  let m;
  while ((m = re.exec(s))) {
    const email = m[0].toLowerCase();
    if (!isNoiseEmail(email) && !isPromotion(email, '', '')) out.push(email);
  }
  return [...new Set(out)];
}

/** Code postal canadien A1A 1A1. */
export function extractPostalCodes(text) {
  const re = /\b([A-Z]\d[A-Z])\s?(\d[A-Z]\d)\b/gi;
  const out = [];
  let m;
  while ((m = re.exec(String(text || '')))) {
    out.push(`${m[1].toUpperCase()} ${m[2].toUpperCase()}`);
  }
  return [...new Set(out)];
}

/**
 * Tente d’extraire une ligne d’adresse + ville à partir du corps / signature.
 */
export function extractAddressBlock(text) {
  const lines = String(text || '')
    .replace(/\r/g, '')
    .split('\n')
    .map(l => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  const streetFr = /\b\d{1,5}\s+(?:rue|avenue|av\.?|blvd|boul\.?|boulevard|chemin|ch\.?|route|rang|place)\s+[\wÀ-ÿ'. -]{2,60}/i;
  const streetEn = /\b\d{1,5}\s+[\wÀ-ÿ'. -]{2,40}\s+(?:crescent|drive|road|street|way|trail|avenue|blvd)\b/i;
  const postalRe = /\b([A-Z]\d[A-Z])\s?(\d[A-Z]\d)\b/i;

  let address = null;
  let city = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const street = line.match(streetFr) || line.match(streetEn);
    if (street) {
      address = clean(street[0].replace(/[,;]+$/, ''), 240);
      const rest = line.slice(street.index + street[0].length);
      const sameCity = rest.match(/,?\s*([A-Za-zÀ-ÿ' -]{2,40})\s*(?:,?\s*[A-Z]\d[A-Z])?/i);
      if (sameCity?.[1] && looksLikeCity(sameCity[1])) city = clean(sameCity[1], 80);
      const next = lines[i + 1] || '';
      if (!city && next) {
        const pc = next.match(postalRe);
        if (pc) {
          const before = next.slice(0, pc.index).replace(/[,;]+/g, ' ').trim();
          if (before.length >= 2) city = clean(before, 80);
          if (address && !postalRe.test(address)) {
            address = clean(`${address}, ${pc[1].toUpperCase()} ${pc[2].toUpperCase()}`, 240);
          }
        } else if (/^[A-Za-zÀ-ÿ' -]{2,40}$/.test(next) && looksLikeCity(next)) {
          city = clean(next, 80);
        }
      }
      if (!city && next) {
        const cityPc = next.match(/^([A-Za-zÀ-ÿ' -]{2,40}?)\s*,?\s*(?:QC|Québec|Quebec)?\s*([A-Z]\d[A-Z]\s?\d[A-Z]\d)?$/i);
        if (cityPc?.[1] && looksLikeCity(cityPc[1])) city = clean(cityPc[1], 80);
        if (cityPc?.[2] && address && !postalRe.test(address)) {
          const pcParts = String(cityPc[2]).match(postalRe);
          if (pcParts) {
            address = clean(`${address}, ${pcParts[1].toUpperCase()} ${pcParts[2].toUpperCase()}`, 240);
          }
        }
      }
      break;
    }
  }

  if (!address) {
    // Fallback : ligne contenant un code postal
    for (const line of lines) {
      const pc = line.match(postalRe);
      if (!pc) continue;
      const before = line.slice(0, pc.index).replace(/[,;]+$/g, '').trim();
      if (before.length >= 5 && /\d/.test(before)) {
        address = clean(`${before}, ${pc[1].toUpperCase()} ${pc[2].toUpperCase()}`, 240);
        const cityMatch = before.match(/,\s*([A-Za-zÀ-ÿ' -]{2,40})\s*$/);
        if (cityMatch) city = clean(cityMatch[1], 80);
        break;
      }
    }
  }

  if (!city) {
    for (const line of lines) {
      const m = line.match(/^([A-Za-zÀ-ÿ' -]{2,40})\s*,?\s*(?:QC|Québec|Quebec)?/i);
      if (m && looksLikeCity(m[1]) && m[1].length <= 40) {
        city = clean(m[1], 80);
        break;
      }
    }
  }

  return { address, city };
}

function looksLikeCity(name) {
  const n = String(name || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
  if (!n || n.length < 3) return false;
  if (QC_CITIES.some(c => n === c || n.includes(c))) return true;
  return false;
}

/** Nom de contact plausible (prénom + nom), pas une boîte générique. */
export function extractContactName(fromRaw, bodyText = '') {
  const fromName = String(fromRaw || '').match(/^"?([^"<]+)"?\s*</);
  if (fromName) {
    const name = clean(fromName[1], 120);
    if (name && !/@/.test(name) && !/customer|support|noreply|équipe|team|inc\.|ltd|llc/i.test(name)) {
      const parts = name.split(/\s+/);
      if (parts.length >= 2 && parts.length <= 4) return name;
      if (parts.length === 1 && parts[0].length >= 3) return name;
    }
  }

  // Signature : lignes « Cordialement, » / « — » suivies d’un nom
  const lines = String(bodyText || '').split('\n').map(l => l.trim()).filter(Boolean);
  for (let i = 0; i < lines.length; i++) {
    if (/^(cordialement|merci|best regards|regards|sincèrement|--|—)/i.test(lines[i])) {
      const next = lines[i + 1];
      if (next && /^[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ' -]{1,40}$/.test(next) && next.split(/\s+/).length <= 4) {
        return clean(next, 120);
      }
    }
  }
  return null;
}

/**
 * Agrège des indices de contact depuis un blob texte + métadonnées mail.
 */
export function extractContactHints({
  text = '',
  fromEmail = null,
  fromRaw = null,
  participantEmails = [],
  ownEmails = new Set(),
} = {}) {
  const blob = [text, fromRaw, ...(participantEmails || [])].filter(Boolean).join('\n');
  const phones = extractPhonesFromText(blob);
  const emails = extractEmailsFromText(blob);
  const { address, city } = extractAddressBlock(blob);
  const contact = extractContactName(fromRaw, text);

  let email = null;
  const candidates = [
    fromEmail,
    ...emails,
    ...(participantEmails || []).map(e => String(e || '').toLowerCase()),
  ].filter(Boolean);

  for (const e of candidates) {
    const low = String(e).toLowerCase().trim();
    if (!low.includes('@')) continue;
    if (ownEmails.has(low)) continue;
    if (isNoiseEmail(low, { fromRaw: fromRaw || low }) || isPromotion(low, '', '')) continue;
    email = low;
    break;
  }

  return {
    email,
    phone: phones[0] || null,
    address,
    city,
    contact,
  };
}

function parseEmailLoose(message) {
  const m = String(message || '').match(/[\w.+-]+@[\w.-]+\.\w+/);
  return m ? m[0].toLowerCase() : null;
}

function parsePhoneLoose(message) {
  const m = String(message || '').match(/(\+?1?\s?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/);
  return m ? m[0].replace(/\s/g, ' ') : null;
}

/**
 * Résout les champs client pour create_client (params LLM + message + From mail).
 * Ex. From: Olive Richardson <olive_richardson@yahoo.com> — même si le PDF est illisible.
 */
export function buildClientCreateFields(params = {}, message = '') {
  const fromRaw = String(params.from || params.from_raw || params.sender || '').trim();
  const hints = extractContactHints({
    text: message,
    fromRaw: fromRaw || message,
    fromEmail: params.email || null,
  });

  const quoted = String(message || '').match(/[«"]([^»"]+)[»"]/);
  const stop = /^(grâce|grace|avec|depuis|via|pour|dans|sur|à|a|de|du|des|le|la|les|un|une|et|ou|par|aux?)$/i;
  const afterClient = String(message || '').match(
    /(?:nouveau\s+)?(?:client|contact)\s+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ' -]{1,80})/i
  );
  let nameFromMsg = '';
  if (afterClient) {
    const candidate = afterClient[1].trim().split(/\s+/).filter(w => !stop.test(w)).slice(0, 4).join(' ');
    if (candidate && !stop.test(candidate) && /[A-Za-zÀ-ÿ]{2,}/.test(candidate)) {
      nameFromMsg = candidate;
    }
  }

  const name = String(
    params.name
    || params.contact
    || hints.contact
    || (quoted ? quoted[1] : '')
    || nameFromMsg
    || ''
  ).trim().replace(/\s+/g, ' ');

  const emailRaw = String(params.email || hints.email || parseEmailLoose(fromRaw) || parseEmailLoose(message) || '')
    .trim()
    .toLowerCase();
  const email = emailRaw.includes('@') ? emailRaw.slice(0, 200) : null;

  const phone = String(params.phone || hints.phone || parsePhoneLoose(message) || '').trim() || null;
  const address = String(params.address || hints.address || '').trim() || null;
  const city = String(params.city || hints.city || '').trim() || null;
  const contact = String(params.contact || hints.contact || name || '').trim() || null;
  const notes = String(params.notes || '').trim() || null;

  return {
    name: (name || (email ? email.split('@')[0].replace(/[._-]+/g, ' ') : '') || 'Nouveau client')
      .slice(0, 200),
    contact: contact ? contact.slice(0, 200) : null,
    email,
    phone: phone ? phone.slice(0, 40) : null,
    address: address ? address.slice(0, 300) : null,
    city: city ? city.slice(0, 120) : null,
    notes: notes ? notes.slice(0, 2000) : null,
  };
}

async function getOwnEmailSet() {
  const set = new Set();
  try {
    const { getGoogleTokenRow } = await import('./google-oauth.js');
    const row = await getGoogleTokenRow();
    if (row?.account_email) set.add(String(row.account_email).toLowerCase());
  } catch { /* */ }
  try {
    const { getCompanyConfig } = await import('./company-config.js');
    const company = await getCompanyConfig();
    if (company?.email) set.add(String(company.email).toLowerCase());
  } catch { /* */ }
  set.add('neyafurniture@gmail.com');
  set.add('facturation@neyafurniture.ca');
  return set;
}

/**
 * Remplit uniquement les champs vides d’un client.
 */
export async function applyContactHints(clientId, hints = {}) {
  const { rows: before } = await pool.query('SELECT * FROM clients WHERE id = $1', [clientId]);
  if (!before[0]) throw new Error('Client introuvable');
  const c = before[0];

  const next = {
    email: blank(c.email) ? clean(hints.email, 200) : null,
    phone: blank(c.phone) ? clean(hints.phone, 40) : null,
    contact: blank(c.contact) ? clean(hints.contact, 120) : null,
    address: blank(c.address) ? clean(hints.address, 240) : null,
    city: blank(c.city) ? clean(hints.city, 80) : null,
  };

  const filled = Object.fromEntries(Object.entries(next).filter(([, v]) => v));
  if (!Object.keys(filled).length) {
    return { client: c, filled: {}, changed: false };
  }

  const { rows } = await pool.query(
    `UPDATE clients SET
       email = COALESCE(NULLIF(TRIM(email), ''), $1),
       phone = COALESCE(NULLIF(TRIM(phone), ''), $2),
       contact = COALESCE(NULLIF(TRIM(contact), ''), $3),
       address = COALESCE(NULLIF(TRIM(address), ''), $4),
       city = COALESCE(NULLIF(TRIM(city), ''), $5)
     WHERE id = $6
     RETURNING *`,
    [
      next.email,
      next.phone,
      next.contact,
      next.address,
      next.city,
      clientId,
    ]
  );

  return { client: rows[0], filled, changed: true };
}

/**
 * Détecte une adresse / email d’entreprise clairement étrangère au nom client
 * (ex. Atlas Machinery collé sur « Anne »).
 */
export function looksLikeForeignCompanyContact(clientName, { address, email, contact } = {}) {
  const nameTokens = clientIdentityTokens(clientName);
  // Noms courts d’une seule partie : plus strict
  const singleShort = String(clientName || '').trim().split(/\s+/).length === 1
    && String(clientName || '').trim().length < 6;
  const addressNorm = normToken(address);
  const contactNorm = normToken(contact);
  const emailDom = emailDomain(email);
  const emailDomNorm = normToken(emailDom);
  const companyRe = /\b(inc|ltd|llc|corp|machinery|tools|industries|company|cie|corporation)\b/;
  const companyHit = companyRe.test(addressNorm)
    || companyRe.test(contactNorm)
    || companyRe.test(emailDomNorm);
  if (!companyHit) return false;

  // Le prénom seul dans « contact » ne prouve PAS que l’adresse/email sont bons
  const nameInAddressOrDomain = nameTokens.some(
    t => addressNorm.includes(t) || emailDomNorm.includes(t)
  );
  if (nameInAddressOrDomain) return false;

  if (singleShort || nameTokens.length === 0 || nameTokens.every(t => t.length < 6)) {
    return true;
  }
  return !nameTokens.some(t => emailDomNorm.includes(t) || addressNorm.includes(t));
}

/** Efface les champs déjà remplis mais clairement d’une autre entreprise. */
export async function scrubForeignCompanyFields(clientId) {
  const { rows } = await pool.query('SELECT * FROM clients WHERE id = $1', [clientId]);
  const c = rows[0];
  if (!c) return { client: null, cleared: {} };

  if (!looksLikeForeignCompanyContact(c.name, {
    address: c.address,
    email: c.email,
    contact: c.contact,
  })) {
    return { client: c, cleared: {} };
  }

  const cleared = {};
  // On efface adresse / ville / téléphone / email générique info@ — garde le nom
  const sets = [];
  const params = [];
  let i = 1;
  for (const col of ['address', 'city', 'phone']) {
    if (!blank(c[col])) {
      sets.push(`${col} = NULL`);
      cleared[col] = c[col];
    }
  }
  // Email type info@domaine-entreprise sans lien avec le nom
  if (!blank(c.email) && /^info@|contact@|sales@|admin@/i.test(c.email)) {
    sets.push(`email = NULL`);
    cleared.email = c.email;
  }
  if (!blank(c.contact) && looksLikeForeignCompanyContact(c.name, { contact: c.contact, address: c.address, email: c.email })) {
    // contact = "Anne" est ok ; "Atlas Tools" non
    const cn = normToken(c.contact);
    const nn = normToken(c.name);
    if (cn !== nn && !clientIdentityTokens(c.name).some(t => cn.includes(t))) {
      sets.push(`contact = NULL`);
      cleared.contact = c.contact;
    }
  }
  if (!sets.length) return { client: c, cleared: {} };

  params.push(clientId);
  const { rows: updated } = await pool.query(
    `UPDATE clients SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`,
    params
  );
  return { client: updated[0], cleared };
}

function emailDomain(email) {
  const m = String(email || '').toLowerCase().match(/@([\w.-]+\.\w{2,})/);
  return m ? m[1] : null;
}

function normToken(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Tokens significatifs d’un nom client (ignore prénoms trop courts). */
function clientIdentityTokens(clientName) {
  return normToken(clientName)
    .split(/\s+/)
    .filter(t => t.length >= 4);
}

/**
 * Ne garde que les hints plausibles pour CE client (évite Atlas → Anne).
 * Exporte pour tests.
 */
export function filterHintsForClient(client, hints = {}, corpus = {}) {
  const name = String(client?.name || '').trim();
  const clientEmail = String(client?.email || hints.email || '').toLowerCase().trim();
  const clientDom = emailDomain(clientEmail);
  const nameTokens = clientIdentityTokens(name);
  const blob = String(corpus.text || '');
  const blobNorm = normToken(blob);
  const participants = (corpus.participantEmails || []).map(e => String(e).toLowerCase());
  const fromDom = emailDomain(corpus.fromEmail || hints.email);

  const nameInCorpus = nameTokens.length
    ? nameTokens.every(t => blobNorm.includes(t)) || blobNorm.includes(normToken(name))
    : false;

  // Domaine mail « connu » pour ce client : email fiche, ou domaine participant
  // seulement si le nom client apparaît aussi dans le corpus.
  const domainTrusted = Boolean(
    (clientDom && fromDom && clientDom === fromDom)
    || (clientDom && participants.some(e => emailDomain(e) === clientDom))
  );

  const contactNorm = normToken(hints.contact);
  const contactMatchesClient = Boolean(
    contactNorm
    && (
      contactNorm === normToken(name)
      || nameTokens.some(t => contactNorm.includes(t))
      || (nameTokens.length && nameTokens.every(t => contactNorm.includes(t)))
    )
  );

  const addressNorm = normToken(hints.address);
  const foreignCompany = looksLikeForeignCompanyContact(name, {
    address: hints.address,
    email: hints.email,
    contact: hints.contact,
  });

  // Un simple prénom dans « contact » ne suffit pas si le reste sent l’autre entreprise
  const identityOk = (domainTrusted || nameInCorpus || contactMatchesClient) && !foreignCompany;

  const out = {
    email: null,
    phone: null,
    contact: null,
    address: null,
    city: null,
  };

  // Email : OK si domaine déjà celui du client, ou si identité OK + pas un domaine générique seul
  if (hints.email && !foreignCompany) {
    const hintDom = emailDomain(hints.email);
    if (clientDom && hintDom === clientDom) out.email = hints.email;
    else if (!clientDom && (nameInCorpus || (contactMatchesClient && domainTrusted))) out.email = hints.email;
    else if (domainTrusted && hintDom === fromDom && nameInCorpus) out.email = hints.email;
  }

  // Contact : seulement s’il ressemble au client et pas d’entreprise étrangère dominante
  if (hints.contact && contactMatchesClient && !foreignCompany) {
    out.contact = hints.contact;
  } else if (hints.contact && identityOk && contactMatchesClient) {
    out.contact = hints.contact;
  }

  // Adresse / ville / téléphone : exigent une identité fiable et pas une boîte étrangère
  if (identityOk && !foreignCompany) {
    out.address = hints.address || null;
    out.city = hints.city || null;
    out.phone = hints.phone || null;
  } else if (domainTrusted && !foreignCompany && nameInCorpus) {
    out.phone = hints.phone || null;
  }

  // Ville seule type province (Ontario) sans adresse fiable → drop
  if (out.city && !out.address) {
    const cityOnly = normToken(out.city);
    if (['ontario', 'quebec', 'québec', 'canada', 'qc', 'on', 'bc', 'ab'].includes(cityOnly)) {
      out.city = null;
    }
  }

  return out;
}

async function gatherMailCorpus(clientId, client = null) {
  // Préférer les fils liés de façon fiable (email exact / manuel)
  const { rows: threads } = await pool.query(
    `SELECT id, gmail_thread_id, subject, participant_emails, link_source, link_confidence
     FROM email_threads
     WHERE client_id = $1
     ORDER BY
       CASE
         WHEN link_source IN ('client_email', 'client_email_auto', 'manual', 'mail_import') THEN 0
         WHEN COALESCE(link_confidence, 0) >= 0.9 THEN 1
         ELSE 2
       END,
       last_message_at DESC NULLS LAST
     LIMIT 12`,
    [clientId]
  );

  const clientEmail = String(client?.email || '').toLowerCase();
  const clientDom = emailDomain(clientEmail);
  const nameTokens = clientIdentityTokens(client?.name);

  const trusted = [];
  const weak = [];
  for (const t of threads) {
    const src = String(t.link_source || '');
    const conf = Number(t.link_confidence) || 0;
    const parts = (t.participant_emails || []).map(e => String(e).toLowerCase());
    const subject = String(t.subject || '');
    const subjectNorm = normToken(subject);
    const emailHit = clientEmail && parts.includes(clientEmail);
    const domainHit = clientDom && parts.some(e => emailDomain(e) === clientDom);
    const nameHit = nameTokens.length >= 1 && nameTokens.every(tok => subjectNorm.includes(tok));
    const strongLink = ['client_email', 'client_email_auto', 'manual', 'mail_import'].includes(src)
      || conf >= 0.9
      || emailHit
      || (domainHit && nameHit);

    if (strongLink) trusted.push(t);
    else weak.push(t);
  }

  // Si on a des fils fiables, ignorer les faibles (souvent la source Atlas→Anne)
  const useThreads = trusted.length ? trusted : [];

  const parts = [];
  const participants = [];
  let fromEmail = null;
  let fromRaw = null;

  if (useThreads.length) {
    const ids = useThreads.map(t => t.id);
    const { rows: msgs } = await pool.query(
      `SELECT thread_id, from_email, subject, snippet, body_text, is_outbound, sent_at
       FROM email_messages
       WHERE thread_id = ANY($1)
       ORDER BY sent_at DESC NULLS LAST
       LIMIT 40`,
      [ids]
    );

    for (const t of useThreads) {
      for (const pe of t.participant_emails || []) participants.push(String(pe).toLowerCase());
      if (t.subject) parts.push(t.subject);
    }

    for (const m of msgs) {
      if (!m.is_outbound && m.from_email && !fromEmail) {
        fromEmail = String(m.from_email).toLowerCase();
        fromRaw = m.from_email;
      }
      if (m.from_email) participants.push(String(m.from_email).toLowerCase());
      if (m.snippet) parts.push(m.snippet);
      if (m.body_text) parts.push(String(m.body_text).slice(0, 4000));
    }
  }

  // Documents mail classés sur les projets : seulement si on a déjà un corpus fiable
  // ou si le nom du fichier évoque le client
  try {
    const { rows: projects } = await pool.query(
      `SELECT name, meta FROM projects WHERE client_id = $1 ORDER BY created_at DESC LIMIT 15`,
      [clientId]
    );
    for (const p of projects) {
      const meta = typeof p.meta === 'string' ? JSON.parse(p.meta || '{}') : (p.meta || {});
      const files = Array.isArray(meta.mail_files) ? meta.mail_files : [];
      for (const f of files.slice(0, 10)) {
        const fileBlob = [f?.name, f?.ocr_text, f?.extracted_text, f?.text].filter(Boolean).join(' ');
        const fileNorm = normToken(fileBlob);
        const fileOk = useThreads.length > 0
          || (nameTokens.length && nameTokens.some(t => fileNorm.includes(t)));
        if (!fileOk) continue;
        if (f?.name) parts.push(f.name);
        if (f?.ocr_text) parts.push(String(f.ocr_text).slice(0, 3000));
        if (f?.extracted_text) parts.push(String(f.extracted_text).slice(0, 3000));
        if (f?.text) parts.push(String(f.text).slice(0, 3000));
        if (f?.from_email || f?.gmail_from) {
          participants.push(String(f.from_email || f.gmail_from).toLowerCase());
        }
      }
    }
  } catch { /* meta optionnelle */ }

  return {
    text: parts.join('\n\n').slice(0, 24000),
    fromEmail,
    fromRaw,
    participantEmails: [...new Set(participants)],
    threadCount: useThreads.length,
    skippedWeakThreads: weak.length,
  };
}

/**
 * Enrichit une fiche client depuis ses mails / documents liés.
 */
export async function enrichClientFromMail(clientId, { useAi = false } = {}) {
  const id = Number(clientId);
  // Nettoie d’abord les faux remplissages (Atlas → Anne, etc.)
  const scrubbed = await scrubForeignCompanyFields(id);
  const client = scrubbed.client;
  if (!client) throw new Error('Client introuvable');

  const missing = ['email', 'phone', 'address', 'city', 'contact'].filter(k => blank(client[k]));
  if (!missing.length) {
    return {
      client,
      filled: {},
      changed: Boolean(Object.keys(scrubbed.cleared || {}).length),
      cleared: scrubbed.cleared || {},
      missing: [],
      source: Object.keys(scrubbed.cleared || {}).length ? 'scrubbed' : 'complete',
    };
  }

  const corpus = await gatherMailCorpus(id, client);
  if (!corpus.text.trim() && !corpus.participantEmails.length) {
    return {
      client,
      filled: {},
      changed: Boolean(Object.keys(scrubbed.cleared || {}).length),
      cleared: scrubbed.cleared || {},
      missing,
      source: 'no_trusted_mail',
      skippedWeakThreads: corpus.skippedWeakThreads,
    };
  }

  const ownEmails = await getOwnEmailSet();
  let hints = extractContactHints({
    text: corpus.text,
    fromEmail: corpus.fromEmail,
    fromRaw: corpus.fromRaw,
    participantEmails: corpus.participantEmails,
    ownEmails,
  });

  // LLM optionnel si encore des trous et assez de texte
  if (useAi && corpus.text.length > 80) {
    const stillNeed = missing.filter(k => !hints[k]);
    if (stillNeed.length) {
      try {
        const aiHints = await extractContactWithAi(corpus.text, client.name, stillNeed);
        hints = {
          email: hints.email || aiHints.email,
          phone: hints.phone || aiHints.phone,
          contact: hints.contact || aiHints.contact,
          address: hints.address || aiHints.address,
          city: hints.city || aiHints.city,
        };
      } catch { /* IA optionnelle */ }
    }
  }

  hints = filterHintsForClient(client, hints, corpus);

  const result = await applyContactHints(id, hints);
  return {
    ...result,
    cleared: scrubbed.cleared || {},
    changed: result.changed || Boolean(Object.keys(scrubbed.cleared || {}).length),
    missing,
    hints_found: hints,
    threads_scanned: corpus.threadCount,
    skipped_weak_threads: corpus.skippedWeakThreads,
    source: 'mail',
  };
}

async function extractContactWithAi(text, clientName, fields) {
  const { callRawLLM } = await import('./ai-chat.js');
  const { parseLlmJson } = await import('./llm-json.js');
  const systemPrompt = `Tu extrais des coordonnées client pour l’ERP NEYA Furniture.
Réponds UNIQUEMENT en JSON valide :
{"email":null,"phone":null,"contact":null,"address":null,"city":null}
Règles strictes :
- Ne remplis que les champs demandés.
- Les valeurs DOIVENT appartenir au client nommé (pas une autre entreprise citée dans le mail).
- Si l’adresse / téléphone / email semble être ceux d’un autre contact ou fournisseur, renvoie null.
- Ignore les coordonnées de Neya / Mehdi / l’atelier.
- city = ville seulement (pas une province comme Ontario).`;
  const message = `Client : ${clientName}
Champs à chercher : ${fields.join(', ')}

Extraits mails / documents :
${String(text).slice(0, 8000)}`;
  const raw = await callRawLLM({ systemPrompt, message });
  if (!raw) return {};
  const parsed = typeof raw === 'string' ? parseLlmJson(raw) : (raw || {});
  return {
    email: clean(parsed.email, 200),
    phone: parsed.phone ? normalizePhone(parsed.phone) : null,
    contact: clean(parsed.contact, 120),
    address: clean(parsed.address, 240),
    city: clean(parsed.city, 80),
  };
}

/**
 * Enrichit tous les clients incomplets qui ont au moins un fil mail lié.
 */
export async function enrichIncompleteClientsFromMail({
  limit = 40,
  useAi = false,
  onlyWithThreads = true,
} = {}) {
  const { rows } = await pool.query(
    `SELECT c.id, c.name
     FROM clients c
     WHERE (
       NULLIF(TRIM(c.email), '') IS NULL
       OR NULLIF(TRIM(c.phone), '') IS NULL
       OR NULLIF(TRIM(c.address), '') IS NULL
       OR NULLIF(TRIM(c.city), '') IS NULL
       OR NULLIF(TRIM(c.contact), '') IS NULL
     )
     ${onlyWithThreads ? `AND EXISTS (
       SELECT 1 FROM email_threads t WHERE t.client_id = c.id
     )` : ''}
     ORDER BY c.name
     LIMIT $1`,
    [Math.min(Number(limit) || 40, 100)]
  );

  const results = [];
  let updated = 0;
  for (const row of rows) {
    try {
      const r = await enrichClientFromMail(row.id, { useAi });
      if (r.changed) updated += 1;
      results.push({
        id: row.id,
        name: row.name,
        changed: r.changed,
        filled: r.filled,
      });
    } catch (err) {
      results.push({ id: row.id, name: row.name, error: err.message });
    }
  }

  return {
    scanned: rows.length,
    updated,
    results,
  };
}

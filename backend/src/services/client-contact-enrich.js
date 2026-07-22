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

async function gatherMailCorpus(clientId) {
  const { rows: threads } = await pool.query(
    `SELECT id, gmail_thread_id, subject, participant_emails
     FROM email_threads
     WHERE client_id = $1
     ORDER BY last_message_at DESC NULLS LAST
     LIMIT 12`,
    [clientId]
  );

  const parts = [];
  const participants = [];
  let fromEmail = null;
  let fromRaw = null;

  if (threads.length) {
    const ids = threads.map(t => t.id);
    const { rows: msgs } = await pool.query(
      `SELECT thread_id, from_email, subject, snippet, body_text, is_outbound, sent_at
       FROM email_messages
       WHERE thread_id = ANY($1)
       ORDER BY sent_at DESC NULLS LAST
       LIMIT 40`,
      [ids]
    );

    for (const t of threads) {
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

  // Documents mail classés sur les projets du client (meta.mail_files)
  try {
    const { rows: projects } = await pool.query(
      `SELECT meta FROM projects WHERE client_id = $1 ORDER BY created_at DESC LIMIT 15`,
      [clientId]
    );
    for (const p of projects) {
      const meta = typeof p.meta === 'string' ? JSON.parse(p.meta || '{}') : (p.meta || {});
      const files = Array.isArray(meta.mail_files) ? meta.mail_files : [];
      for (const f of files.slice(0, 10)) {
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
    threadCount: threads.length,
  };
}

/**
 * Enrichit une fiche client depuis ses mails / documents liés.
 */
export async function enrichClientFromMail(clientId, { useAi = false } = {}) {
  const id = Number(clientId);
  const { rows } = await pool.query('SELECT * FROM clients WHERE id = $1', [id]);
  if (!rows[0]) throw new Error('Client introuvable');
  const client = rows[0];

  const missing = ['email', 'phone', 'address', 'city', 'contact'].filter(k => blank(client[k]));
  if (!missing.length) {
    return { client, filled: {}, changed: false, missing: [], source: 'complete' };
  }

  const corpus = await gatherMailCorpus(id);
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

  const result = await applyContactHints(id, hints);
  return {
    ...result,
    missing,
    hints_found: hints,
    threads_scanned: corpus.threadCount,
    source: 'mail',
  };
}

async function extractContactWithAi(text, clientName, fields) {
  const { callRawLLM } = await import('./ai-chat.js');
  const { parseLlmJson } = await import('./llm-json.js');
  const systemPrompt = `Tu extrais des coordonnées client pour l’ERP NEYA Furniture.
Réponds UNIQUEMENT en JSON valide :
{"email":null,"phone":null,"contact":null,"address":null,"city":null}
Ne remplis que les champs demandés. Ignore les coordonnées de Neya / Mehdi / l’atelier.`;
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

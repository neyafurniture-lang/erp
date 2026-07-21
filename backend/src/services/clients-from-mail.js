import pool from '../db/pool.js';
import * as gmail from './google-gmail.js';
import { detectSupplier } from './invoice-email-router.js';

/** Domaines / préfixes automatiques — pas des clients atelier. */
const NOISE_LOCAL = new Set([
  'noreply', 'no-reply', 'donotreply', 'do-not-reply', 'mailer-daemon',
  'notifications', 'notification', 'notify', 'alerts', 'alert',
  'newsletter', 'news', 'promo', 'promotions', 'marketing', 'deals',
  'support', 'help', 'billing', 'invoice', 'facturation', 'receipts',
  'orders', 'order', 'shipping', 'ship', 'track', 'tracking',
  'security', 'account', 'accounts', 'noreply-apps', 'bounce',
]);

const NOISE_DOMAINS = new Set([
  'facebookmail.com', 'facebook.com', 'meta.com', 'instagram.com',
  'linkedin.com', 'twitter.com', 'x.com', 'tiktok.com',
  'github.com', 'gitlab.com', 'bitbucket.org', 'cursor.com',
  'google.com', 'accounts.google.com',
  'amazonses.com', 'sendgrid.net', 'mailchimp.com', 'mandrillapp.com',
  'stripe.com', 'paypal.com', 'square.com',
  'microsoft.com', 'office365.com',
  'apple.com',
]);

const SUPPLIER_DOMAIN_HINTS = [
  'homedepot', 'rona', 'canac', 'renodepot', 'amazon', 'walmart',
  'bestbuy', 'costco', 'ikea', 'lowes', 'canadian tire', 'canadiantire',
];

function parseDisplayName(raw) {
  if (!raw) return null;
  const m = String(raw).match(/^"?([^"<]+)"?\s*</);
  const name = (m ? m[1] : '').trim().replace(/\s+/g, ' ');
  return name.length >= 2 ? name : null;
}

function extractPairs(field) {
  const raw = String(field || '');
  const results = [];
  const re = /(?:"?([^"<]+)"?\s*)?<([\w.+-]+@[\w.-]+\.\w+)>|([\w.+-]+@[\w.-]+\.\w+)/gi;
  let m;
  while ((m = re.exec(raw))) {
    const email = (m[2] || m[3] || '').toLowerCase();
    const name = (m[1] || '').trim().replace(/\s+/g, ' ') || null;
    if (email.includes('@')) results.push({ email, name: name && name.length >= 2 ? name : null });
  }
  return results;
}

async function getOwnEmails() {
  const set = new Set();
  try {
    const { getGoogleTokenRow } = await import('./google-oauth.js');
    const row = await getGoogleTokenRow();
    if (row?.account_email) set.add(String(row.account_email).toLowerCase());
  } catch { /* optional */ }
  try {
    const { getCompanyConfig } = await import('./company-config.js');
    const company = await getCompanyConfig();
    if (company?.email) set.add(String(company.email).toLowerCase());
  } catch { /* optional */ }
  // Domaine interne NEYA
  for (const e of [...set]) {
    const domain = e.split('@')[1];
    if (domain && /neya/i.test(domain)) set.add(`*@${domain}`);
  }
  return set;
}

function isOwnEmail(email, own) {
  if (!email) return true;
  if (own.has(email)) return true;
  const domain = email.split('@')[1];
  if (domain && own.has(`*@${domain}`)) return true;
  return false;
}

export function isNoiseEmail(email, { fromRaw = '', subject = '' } = {}) {
  if (!email || !email.includes('@')) return true;
  const [local, domain] = email.split('@');
  const localBase = local.split('+')[0].toLowerCase();
  if (NOISE_LOCAL.has(localBase)) return true;
  if (/^(noreply|no-reply|donotreply|mailer-daemon)/i.test(localBase)) return true;
  if (NOISE_DOMAINS.has(domain)) return true;
  if (SUPPLIER_DOMAIN_HINTS.some(h => domain.includes(h.replace(/\s/g, '')))) return true;
  if (detectSupplier(fromRaw || email, subject, '')) return true;
  // Adresses purement techniques
  if (/\d{6,}@/.test(email)) return true;
  return false;
}

function guessNameFromEmail(email, displayName) {
  if (displayName && displayName.length >= 2 && !/@/.test(displayName)) {
    // Éviter "Home Depot Customer Care"
    if (!/customer|support|noreply|équipe|team|inc\.|ltd/i.test(displayName)) {
      return displayName.slice(0, 120);
    }
  }
  const local = email.split('@')[0].split('+')[0];
  const parts = local.replace(/[._-]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return email.split('@')[0];
  return parts
    .map(p => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
    .join(' ')
    .slice(0, 120);
}

/**
 * Agrège les contacts externes depuis Gmail (+ miroir local email_messages).
 */
export async function scanClientCandidatesFromMail({
  maxMessages = 400,
  pageSize = 50,
  days = 0,
} = {}) {
  const own = await getOwnEmails();
  const byEmail = new Map();

  function addContact({ email, name, subject, lastAt, source }) {
    if (!email || isOwnEmail(email, own) || isNoiseEmail(email, { fromRaw: name ? `${name} <${email}>` : email, subject })) {
      return;
    }
    // gmail.com personnel OK ; domaines bruit déjà filtrés
    const existing = byEmail.get(email);
    const display = guessNameFromEmail(email, name);
    if (!existing) {
      byEmail.set(email, {
        email,
        suggested_name: display,
        message_count: 1,
        last_subject: subject || null,
        last_at: lastAt || null,
        sources: new Set([source]),
      });
    } else {
      existing.message_count += 1;
      if (name && (!existing.suggested_name || existing.suggested_name.includes('@'))) {
        existing.suggested_name = display;
      }
      if (lastAt && (!existing.last_at || new Date(lastAt) > new Date(existing.last_at))) {
        existing.last_at = lastAt;
        existing.last_subject = subject || existing.last_subject;
      }
      existing.sources.add(source);
    }
  }

  // 1) Miroir local (rapide)
  try {
    const { rows } = await pool.query(`
      SELECT from_email, subject, sent_at, is_outbound, to_emails
      FROM email_messages
      WHERE from_email IS NOT NULL
      ORDER BY sent_at DESC NULLS LAST
      LIMIT 2000
    `);
    for (const row of rows) {
      if (!row.is_outbound && row.from_email) {
        addContact({
          email: String(row.from_email).toLowerCase(),
          name: null,
          subject: row.subject,
          lastAt: row.sent_at,
          source: 'local',
        });
      }
      if (row.is_outbound && Array.isArray(row.to_emails)) {
        for (const to of row.to_emails) {
          addContact({
            email: String(to).toLowerCase(),
            name: null,
            subject: row.subject,
            lastAt: row.sent_at,
            source: 'local_sent',
          });
        }
      }
    }
  } catch (err) {
    console.warn('[clients-from-mail] local mirror:', err.message);
  }

  // 2) Scan Gmail historique (maxMessages=0 → miroir local seulement)
  let scanned = 0;
  if (maxMessages > 0) {
    let pageToken = null;
    const qParts = ['-category:promotions', '-category:social', '-category:forums'];
    if (days > 0) qParts.push(`newer_than:${Math.max(1, Math.floor(days))}d`);
    const q = qParts.join(' ');

    try {
      while (scanned < maxMessages) {
        const batch = Math.min(pageSize, maxMessages - scanned);
        const { messages, nextPageToken } = await gmail.listMessages({
          label: null,
          max: batch,
          pageToken,
          q,
        });
        if (!messages?.length) break;

        for (const msg of messages) {
          scanned += 1;
          const dateIso = msg.date ? new Date(msg.date).toISOString() : null;
          for (const pair of extractPairs(msg.from)) {
            addContact({
              email: pair.email,
              name: pair.name || parseDisplayName(msg.from),
              subject: msg.subject,
              lastAt: dateIso,
              source: 'gmail',
            });
          }
          for (const pair of [...extractPairs(msg.to), ...extractPairs(msg.cc)]) {
            addContact({
              email: pair.email,
              name: pair.name,
              subject: msg.subject,
              lastAt: dateIso,
              source: 'gmail_to',
            });
          }
        }

        if (!nextPageToken) break;
        pageToken = nextPageToken;
      }
    } catch (err) {
      // Gmail non connecté → on garde le miroir local
      if (!byEmail.size) throw err;
      console.warn('[clients-from-mail] gmail scan:', err.message);
    }
  }

  // Exclure clients déjà connus
  const emails = [...byEmail.keys()];
  const existing = new Set();
  if (emails.length) {
    const { rows } = await pool.query(
      `SELECT LOWER(TRIM(email)) AS email FROM clients
       WHERE email IS NOT NULL AND LOWER(TRIM(email)) = ANY($1)`,
      [emails]
    );
    rows.forEach(r => existing.add(r.email));
  }

  const candidates = [...byEmail.values()]
    .filter(c => !existing.has(c.email))
    .map(c => ({
      email: c.email,
      suggested_name: c.suggested_name,
      message_count: c.message_count,
      last_subject: c.last_subject,
      last_at: c.last_at,
      sources: [...c.sources],
      selected: c.message_count >= 2,
    }))
    .sort((a, b) => b.message_count - a.message_count || String(b.last_at || '').localeCompare(String(a.last_at || '')));

  return {
    scanned_messages: scanned,
    candidates,
    already_clients: existing.size,
  };
}

/**
 * Crée des fiches clients à partir d'une liste { email, name?, notes? }.
 */
export async function importClientsFromCandidates(items = [], { linkThreads = true } = {}) {
  const created = [];
  const skipped = [];
  const errors = [];

  for (const item of items) {
    const email = String(item.email || '').trim().toLowerCase();
    if (!email || !email.includes('@')) {
      errors.push({ email, error: 'Email invalide' });
      continue;
    }
    if (isNoiseEmail(email)) {
      skipped.push({ email, reason: 'adresse filtrée (bruit / fournisseur)' });
      continue;
    }

    try {
      const { rows: existing } = await pool.query(
        `SELECT id, name FROM clients WHERE LOWER(TRIM(email)) = $1 LIMIT 1`,
        [email]
      );
      if (existing[0]) {
        skipped.push({ email, reason: 'déjà client', client_id: existing[0].id });
        continue;
      }

      const name = String(item.name || item.suggested_name || guessNameFromEmail(email, null)).trim().slice(0, 200);
      const notes = item.notes
        || `Importé depuis la boîte mail (${new Date().toISOString().slice(0, 10)})`;

      const { rows } = await pool.query(
        `INSERT INTO clients (name, contact, email, notes)
         VALUES ($1, $2, $3, $4) RETURNING *`,
        [name, item.contact || name, email, notes]
      );
      const client = rows[0];

      try {
        const { tryEnsureClientFolder } = await import('./drive-folders.js');
        const driveFolder = await tryEnsureClientFolder(client.id);
        if (driveFolder?.folder_id) client.drive_folder_id = driveFolder.folder_id;
      } catch { /* Drive optionnel */ }

      if (linkThreads) {
        await pool.query(
          `UPDATE email_threads SET
             client_id = $1,
             link_source = COALESCE(link_source, 'mail_import'),
             link_confidence = GREATEST(COALESCE(link_confidence, 0), 0.9),
             updated_at = NOW()
           WHERE client_id IS NULL
             AND EXISTS (
               SELECT 1 FROM unnest(COALESCE(participant_emails, ARRAY[]::text[])) pe
               WHERE LOWER(TRIM(pe)) = $2
             )`,
          [client.id, email]
        );
      }

      created.push(client);
    } catch (err) {
      errors.push({ email, error: err.message });
    }
  }

  return { created, skipped, errors, created_count: created.length };
}

import pool from '../db/pool.js';
import { detectSupplier, looksLikeSupplierInvoice } from './invoice-email-router.js';

/** Sections affichées dans la boîte mail NEYA (ordre sidebar). */
export const MAIL_SECTIONS = [
  { id: 'inbox', label: 'Boîte de réception', icon: 'inbox' },
  { id: 'a_repondre', label: 'À répondre', icon: 'reply' },
  { id: 'clients', label: 'Clients', icon: 'clients' },
  { id: 'fournisseurs', label: 'Fournisseurs', icon: 'supplier' },
  { id: 'projets', label: 'Projets liés', icon: 'project' },
  { id: 'promotions', label: 'Promotions', icon: 'promo' },
  { id: 'autres', label: 'Non classés', icon: 'other' },
];

/** Labels Gmail créés sous le préfixe NEYA/ */
export const GMAIL_CATEGORY_LABELS = {
  a_repondre: 'NEYA/À répondre',
  clients: 'NEYA/Clients',
  fournisseurs: 'NEYA/Fournisseurs',
  projets: 'NEYA/Projets',
  promotions: 'NEYA/Promotions',
  autres: 'NEYA/Non classés',
};

const NEYA_LABEL_PREFIX = 'NEYA/';

let neyaLabelIdCache = null;
let neyaLabelIdCacheAt = 0;

export async function ensureNeyaGmailLabels() {
  if (neyaLabelIdCache && Date.now() - neyaLabelIdCacheAt < 300_000) return neyaLabelIdCache;

  const { ensureLabel } = await import('./google-gmail.js');
  await ensureLabel('NEYA');

  const ids = {};
  for (const [category, name] of Object.entries(GMAIL_CATEGORY_LABELS)) {
    const label = await ensureLabel(name);
    ids[category] = label.id;
  }

  neyaLabelIdCache = ids;
  neyaLabelIdCacheAt = Date.now();
  return ids;
}

export async function listNeyaGmailLabels() {
  const labels = await (await import('./google-gmail.js')).getCachedLabels();
  return labels.filter(l => l.name === 'NEYA' || l.name?.startsWith(NEYA_LABEL_PREFIX));
}

export async function applyGmailCategoryLabel(gmailThreadId, category) {
  if (!gmailThreadId || !GMAIL_CATEGORY_LABELS[category]) return { applied: false };

  const { modifyThreadLabels } = await import('./google-gmail.js');
  const labelMap = await ensureNeyaGmailLabels();
  const addId = labelMap[category];
  const removeIds = Object.entries(labelMap)
    .filter(([cat]) => cat !== category)
    .map(([, id]) => id);

  await modifyThreadLabels(gmailThreadId, [addId], removeIds);
  return { applied: true, label: GMAIL_CATEGORY_LABELS[category] };
}

export async function applyGmailLabelsForMessages(messages = []) {
  const seen = new Set();
  let applied = 0;
  const errors = [];

  for (const m of messages) {
    if (!m.threadId || !m.mailCategory || seen.has(m.threadId)) continue;
    seen.add(m.threadId);
    try {
      const result = await applyGmailCategoryLabel(m.threadId, m.mailCategory);
      if (result.applied) applied += 1;
    } catch (err) {
      errors.push({ threadId: m.threadId, error: err.message });
    }
  }

  return { applied, errors };
}

// Éviter no-reply / notification@ (trop large → GitHub, banques, etc. en « Promotions »)
const PROMO_RE = /unsubscribe|newsletter|promotions?\b|marketing|mailchimp|info@shop|deals@|offres@|soldes?@/i;
const NOT_PROMO_FROM_RE = /github\.com|gitlab\.com|bitbucket\.org|cursor\.com|google\.com|accounts\.google/i;
const CLIENT_INTENTS = new Set(['devis', 'suivi', 'plainte', 'confirmation']);

let clientEmailCache = null;
let clientEmailCacheAt = 0;
let ownEmailCache = null;
let ownEmailCacheAt = 0;

async function getClientEmailSet() {
  if (clientEmailCache && Date.now() - clientEmailCacheAt < 60_000) return clientEmailCache;
  const { rows } = await pool.query(
    'SELECT LOWER(TRIM(email)) AS email FROM clients WHERE email IS NOT NULL AND TRIM(email) <> \'\''
  );
  clientEmailCache = new Set(rows.map(r => r.email));
  clientEmailCacheAt = Date.now();
  return clientEmailCache;
}

async function getOwnEmailSet() {
  if (ownEmailCache && Date.now() - ownEmailCacheAt < 300_000) return ownEmailCache;
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
  ownEmailCache = set;
  ownEmailCacheAt = Date.now();
  return set;
}

export function extractEmailsFromField(raw = '') {
  const matches = String(raw || '').match(/[\w.+-]+@[\w.-]+\.\w+/gi) || [];
  return matches.map(e => e.toLowerCase());
}

export function parseFromEmail(from = '') {
  const m = String(from).match(/<([^>]+)>/);
  return (m ? m[1] : from).trim().toLowerCase();
}

function collectAddresses({ from = '', to = '', cc = '', participants = [] } = {}, ownEmails = null) {
  const own = ownEmails || new Set();
  const all = [
    ...extractEmailsFromField(from),
    ...extractEmailsFromField(to),
    ...extractEmailsFromField(cc),
    ...(participants || []).map(e => String(e || '').toLowerCase()),
  ];
  return [...new Set(all.filter(e => e && e.includes('@') && !own.has(e)))];
}

function isPromotion(from, subject, snippet) {
  if (NOT_PROMO_FROM_RE.test(String(from || ''))) return false;
  const hay = `${from} ${subject} ${snippet}`;
  return PROMO_RE.test(hay);
}

/**
 * Classe un message dans une section unique (priorité haute → basse).
 * Les mails envoyés sont classés via le destinataire client (To/Cc), pas seulement From.
 */
export function classifyMailMessage({
  from = '',
  to = '',
  cc = '',
  subject = '',
  snippet = '',
  isUnread = false,
  isOutbound = false,
  thread = null,
  clientEmails = null,
  ownEmails = null,
  preferStored = false,
} = {}) {
  // Ne plus coller une mauvaise catégorie pour toujours — recalcul live par défaut.
  if (preferStored && thread?.mail_category) return thread.mail_category;

  const emails = clientEmails || new Set();
  const addresses = collectAddresses(
    { from, to, cc, participants: thread?.participant_emails },
    ownEmails
  );
  const matchedClientEmail = addresses.some(e => emails.has(e));
  const hasClient = Boolean(thread?.client_id) || matchedClientEmail;
  const hasProject = Boolean(thread?.project_id);
  const needsResponse = !isOutbound && (
    thread?.needs_response === true || thread?.latest_needs_response === true
  );
  const clientIntent = thread?.client_intent || thread?.latest_client_intent;
  const isSupplierInvoice = looksLikeSupplierInvoice(from, subject, snippet);

  // Priorité atelier : répondre / clients avant newsletters fournisseurs
  if (needsResponse || (isUnread && hasClient && !isOutbound)) return 'a_repondre';
  if (hasProject) return 'projets';
  if (hasClient || CLIENT_INTENTS.has(clientIntent)) return 'clients';
  if (isSupplierInvoice) return 'fournisseurs';
  if (isPromotion(from, subject, snippet)) return 'promotions';
  // Domaine fournisseur sans facture → promotions plutôt que « Fournisseurs »
  if (detectSupplier(from, subject, snippet) && isPromotion(from, subject, snippet)) return 'promotions';
  if (detectSupplier(from, subject, snippet)) return 'autres';
  return 'autres';
}

export async function findClientByEmails(emails = []) {
  const cleaned = [...new Set(
    (emails || []).map(e => String(e || '').trim().toLowerCase()).filter(e => e.includes('@'))
  )];
  if (!cleaned.length) return null;

  const { rows } = await pool.query(
    `SELECT id, name, LOWER(TRIM(email)) AS email FROM clients
     WHERE email IS NOT NULL AND LOWER(TRIM(email)) = ANY($1)
     LIMIT 1`,
    [cleaned]
  );
  return rows[0] || null;
}

export function computeMailCategoryForThread(threadRow, synthesis = null, { ownEmails = null, clientEmails = null } = {}) {
  const participants = Array.isArray(threadRow.participant_emails) ? threadRow.participant_emails : [];
  // From ≈ premier participant non-interne si possible
  const own = ownEmails || new Set();
  const external = participants.find(e => e && !own.has(String(e).toLowerCase()));
  const fromHint = external || participants[0] || '';
  return classifyMailMessage({
    from: fromHint,
    to: participants.join(', '),
    subject: threadRow.subject || '',
    snippet: '',
    isUnread: false,
    isOutbound: false,
    thread: {
      client_id: threadRow.client_id,
      project_id: threadRow.project_id,
      needs_response: synthesis?.needs_response,
      client_intent: synthesis?.client_intent,
      participant_emails: participants,
    },
    clientEmails,
    ownEmails,
  });
}

/**
 * Si le fil n'a pas de client mais qu'une adresse connue apparaît (From/To/Cc), le lier automatiquement.
 */
export async function autoLinkThreadFromAddresses(threadRow, addresses = []) {
  if (!threadRow?.id || threadRow.client_id) return threadRow;

  const client = await findClientByEmails(addresses);
  if (!client) return threadRow;

  let project_id = threadRow.project_id || null;
  if (!project_id) {
    const { rows } = await pool.query(
      `SELECT id FROM projects
       WHERE client_id = $1 AND status IN ('active', 'paused')
       ORDER BY created_at DESC LIMIT 1`,
      [client.id]
    );
    project_id = rows[0]?.id || null;
  }

  const { rows } = await pool.query(
    `UPDATE email_threads SET
       client_id = $1,
       project_id = COALESCE($2, project_id),
       link_source = 'client_email_auto',
       link_confidence = 0.95,
       updated_at = NOW()
     WHERE id = $3 AND client_id IS NULL
     RETURNING *`,
    [client.id, project_id, threadRow.id]
  );

  return rows[0] ? { ...threadRow, ...rows[0], client_name: client.name } : threadRow;
}

export async function enrichInboxMessages(messages = []) {
  if (!messages.length) {
    return { messages: [], sections: MAIL_SECTIONS.map(s => ({ ...s, count: 0 })) };
  }

  const threadIds = [...new Set(messages.map(m => m.threadId).filter(Boolean))];
  const [clientEmails, ownEmails] = await Promise.all([getClientEmailSet(), getOwnEmailSet()]);

  let threadMap = {};
  if (threadIds.length) {
    const { rows } = await pool.query(
      `SELECT t.*, c.name AS client_name, p.name AS project_name,
              s.needs_response AS latest_needs_response, s.client_intent AS latest_client_intent
       FROM email_threads t
       LEFT JOIN clients c ON c.id = t.client_id
       LEFT JOIN projects p ON p.id = t.project_id
       LEFT JOIN LATERAL (
         SELECT needs_response, client_intent FROM email_thread_syntheses
         WHERE thread_id = t.id ORDER BY created_at DESC LIMIT 1
       ) s ON true
       WHERE t.gmail_thread_id = ANY($1)`,
      [threadIds]
    );
    threadMap = Object.fromEntries(rows.map(r => [r.gmail_thread_id, r]));
  }

  const enriched = [];
  for (const m of messages) {
    let thread = threadMap[m.threadId] || null;
    const fromEmail = parseFromEmail(m.from);
    const isOutbound = Boolean(fromEmail && ownEmails.has(fromEmail));
    const addresses = collectAddresses(
      {
        from: m.from,
        to: m.to,
        cc: m.cc,
        participants: thread?.participant_emails,
      },
      ownEmails
    );

    // Auto-lier au client connu (surtout pour les mails envoyés : destinataire = client)
    if (thread?.id && !thread.client_id && addresses.length) {
      const linked = await autoLinkThreadFromAddresses(thread, addresses);
      if (linked?.client_id) {
        thread = { ...thread, ...linked };
        threadMap[m.threadId] = thread;
      }
    }

    const mailCategory = classifyMailMessage({
      from: m.from,
      to: m.to,
      cc: m.cc,
      subject: m.subject,
      snippet: m.snippet,
      isUnread: m.isUnread || m.unread,
      isOutbound,
      thread,
      clientEmails,
      ownEmails,
    });
    const supplier = detectSupplier(m.from, m.subject, m.snippet);

    enriched.push({
      ...m,
      mailCategory,
      supplierLabel: supplier?.label || null,
      supplierId: supplier?.id || null,
      isOutbound,
      client_id: thread?.client_id || null,
      project_id: thread?.project_id || null,
      client_name: thread?.client_name || null,
      project_name: thread?.project_name || null,
      sortDate: m.date || m.internalDate || null,
    });
  }

  // Tri stable : non-lus d'abord, puis date décroissante
  enriched.sort((a, b) => {
    const ur = Number(Boolean(b.isUnread || b.unread)) - Number(Boolean(a.isUnread || a.unread));
    if (ur) return ur;
    return new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime();
  });

  const counts = {};
  for (const s of MAIL_SECTIONS) {
    if (s.id === 'inbox') counts.inbox = enriched.length;
    else counts[s.id] = enriched.filter(m => m.mailCategory === s.id).length;
  }

  const sections = MAIL_SECTIONS.map(s => ({
    id: s.id,
    label: s.label,
    icon: s.icon,
    count: counts[s.id] ?? 0,
  }));

  return { messages: enriched, sections };
}

export async function sortInbox({ max = 40 } = {}) {
  const { listMessages } = await import('./google-gmail.js');
  const { messages: raw } = await listMessages({ label: 'INBOX', max });
  return enrichInboxMessages(raw || []);
}

export async function classifyAndStoreThread(threadDbId) {
  const { rows } = await pool.query(
    `SELECT t.*, s.needs_response, s.client_intent
     FROM email_threads t
     LEFT JOIN LATERAL (
       SELECT needs_response, client_intent FROM email_thread_syntheses
       WHERE thread_id = t.id ORDER BY created_at DESC LIMIT 1
     ) s ON true
     WHERE t.id = $1`,
    [threadDbId]
  );
  if (!rows[0]) return null;

  let threadRow = rows[0];
  const [clientEmails, ownEmails] = await Promise.all([getClientEmailSet(), getOwnEmailSet()]);
  const addresses = collectAddresses(
    { participants: threadRow.participant_emails },
    ownEmails
  );

  if (!threadRow.client_id && addresses.length) {
    threadRow = await autoLinkThreadFromAddresses(threadRow, addresses);
  }

  const category = computeMailCategoryForThread(
    threadRow,
    { needs_response: rows[0].needs_response, client_intent: rows[0].client_intent },
    { ownEmails, clientEmails }
  );

  await pool.query(
    'UPDATE email_threads SET mail_category = $1, updated_at = NOW() WHERE id = $2',
    [category, threadDbId]
  );

  if (threadRow.gmail_thread_id) {
    try {
      await applyGmailCategoryLabel(threadRow.gmail_thread_id, category);
    } catch (err) {
      console.warn('Gmail label:', err.message);
    }
  }

  return category;
}

export async function sortRecentInbox(max = 25) {
  const { processRecentInbox } = await import('./email-threads.js');
  const result = await processRecentInbox(max);

  for (const thread of result.threads || []) {
    if (thread?.id) await classifyAndStoreThread(thread.id);
  }

  const sorted = await sortInbox({ max });
  const labelResult = await applyGmailLabelsForMessages(sorted.messages || []);

  return {
    ...result,
    sections: sorted.sections,
    messages: sorted.messages,
    gmail_labels: {
      applied: labelResult.applied,
      errors: labelResult.errors,
      labels: GMAIL_CATEGORY_LABELS,
    },
  };
}

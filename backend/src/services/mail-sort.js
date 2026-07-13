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

const PROMO_RE = /unsubscribe|newsletter|promotion|no-?reply|marketing|mailchimp|notification@|info@shop|deals@|offres@/i;
const CLIENT_INTENTS = new Set(['devis', 'suivi', 'plainte', 'confirmation']);

let clientEmailCache = null;
let clientEmailCacheAt = 0;

async function getClientEmailSet() {
  if (clientEmailCache && Date.now() - clientEmailCacheAt < 60_000) return clientEmailCache;
  const { rows } = await pool.query(
    'SELECT LOWER(email) AS email FROM clients WHERE email IS NOT NULL AND email <> \'\''
  );
  clientEmailCache = new Set(rows.map(r => r.email));
  clientEmailCacheAt = Date.now();
  return clientEmailCache;
}

function parseFromEmail(from = '') {
  const m = String(from).match(/<([^>]+)>/);
  return (m ? m[1] : from).trim().toLowerCase();
}

function isPromotion(from, subject, snippet) {
  const hay = `${from} ${subject} ${snippet}`;
  return PROMO_RE.test(hay);
}

/**
 * Classe un message dans une section unique (priorité haute → basse).
 */
export function classifyMailMessage({
  from = '',
  subject = '',
  snippet = '',
  isUnread = false,
  thread = null,
  clientEmails = null,
}) {
  if (thread?.mail_category) return thread.mail_category;

  const fromEmail = parseFromEmail(from);
  const emails = clientEmails || new Set();
  const hasClient = Boolean(thread?.client_id) || (fromEmail && emails.has(fromEmail));
  const hasProject = Boolean(thread?.project_id);
  const needsResponse = thread?.needs_response === true
    || thread?.latest_needs_response === true;
  const clientIntent = thread?.client_intent || thread?.latest_client_intent;
  const supplier = detectSupplier(from, subject, snippet);
  const isSupplier = looksLikeSupplierInvoice(from, subject, snippet) || Boolean(supplier);

  if (isSupplier) return 'fournisseurs';
  if (needsResponse || (isUnread && hasClient)) return 'a_repondre';
  if (hasProject) return 'projets';
  if (hasClient || CLIENT_INTENTS.has(clientIntent)) return 'clients';
  if (isPromotion(from, subject, snippet)) return 'promotions';
  return 'autres';
}

export function computeMailCategoryForThread(threadRow, synthesis = null) {
  return classifyMailMessage({
    from: threadRow.participant_emails?.[0] || '',
    subject: threadRow.subject || '',
    snippet: '',
    isUnread: false,
    thread: {
      client_id: threadRow.client_id,
      project_id: threadRow.project_id,
      needs_response: synthesis?.needs_response,
      client_intent: synthesis?.client_intent,
    },
  });
}

export async function enrichInboxMessages(messages = []) {
  if (!messages.length) {
    return { messages: [], sections: MAIL_SECTIONS.map(s => ({ ...s, count: 0 })) };
  }

  const threadIds = [...new Set(messages.map(m => m.threadId).filter(Boolean))];
  const clientEmails = await getClientEmailSet();

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

  const enriched = messages.map(m => {
    const thread = threadMap[m.threadId] || null;
    const mailCategory = classifyMailMessage({
      from: m.from,
      subject: m.subject,
      snippet: m.snippet,
      isUnread: m.isUnread || m.unread,
      thread,
      clientEmails,
    });
    return {
      ...m,
      mailCategory,
      client_id: thread?.client_id || null,
      project_id: thread?.project_id || null,
      client_name: thread?.client_name || null,
      project_name: thread?.project_name || null,
    };
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

  const category = computeMailCategoryForThread(rows[0], {
    needs_response: rows[0].needs_response,
    client_intent: rows[0].client_intent,
  });

  await pool.query(
    'UPDATE email_threads SET mail_category = $1, updated_at = NOW() WHERE id = $2',
    [category, threadDbId]
  );

  if (rows[0].gmail_thread_id) {
    try {
      await applyGmailCategoryLabel(rows[0].gmail_thread_id, category);
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

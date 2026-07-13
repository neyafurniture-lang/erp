import { getValidAccessToken } from './google-oauth.js';

const BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';

async function gmailFetch(path, options = {}) {
  const token = await getValidAccessToken();
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `Gmail API ${res.status}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

function decodeBase64Url(data) {
  if (!data) return '';
  const b64 = data.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(b64, 'base64').toString('utf8');
}

function getHeader(headers, name) {
  const h = headers?.find(x => x.name.toLowerCase() === name.toLowerCase());
  return h?.value || '';
}

function extractBody(payload) {
  if (!payload) return '';
  if (payload.body?.data) return decodeBase64Url(payload.body.data);
  for (const part of payload.parts || []) {
    if (part.mimeType === 'text/plain' && part.body?.data) return decodeBase64Url(part.body.data);
  }
  for (const part of payload.parts || []) {
    if (part.mimeType === 'text/html' && part.body?.data) return decodeBase64Url(part.body.data);
    const nested = extractBody(part);
    if (nested) return nested;
  }
  return '';
}

export function formatMessage(msg) {
  const headers = msg.payload?.headers || [];
  return {
    id: msg.id,
    threadId: msg.threadId,
    subject: getHeader(headers, 'Subject') || '(sans objet)',
    from: getHeader(headers, 'From'),
    to: getHeader(headers, 'To'),
    cc: getHeader(headers, 'Cc'),
    date: getHeader(headers, 'Date'),
    snippet: msg.snippet,
    labelIds: msg.labelIds || [],
    body: extractBody(msg.payload),
    isUnread: (msg.labelIds || []).includes('UNREAD'),
  };
}

export async function listMessages({ label = 'INBOX', max = 30, pageToken = null, q = '' } = {}) {
  const params = new URLSearchParams({ maxResults: String(max) });
  if (label) params.set('labelIds', label);
  if (pageToken) params.set('pageToken', pageToken);
  if (q) params.set('q', q);

  const list = await gmailFetch(`/messages?${params}`);
  if (!list.messages?.length) return { messages: [], nextPageToken: null };

  const messages = await Promise.all(
    list.messages.slice(0, max).map(m =>
      gmailFetch(`/messages/${m.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Cc&metadataHeaders=Date`)
        .then(formatMessage)
        .catch(() => ({ id: m.id, subject: '(erreur)', from: '', to: '', snippet: '' }))
    )
  );
  return { messages, nextPageToken: list.nextPageToken || null };
}

export async function getMessage(messageId) {
  const msg = await gmailFetch(`/messages/${messageId}?format=full`);
  return formatMessage(msg);
}

export async function getThread(threadId) {
  const data = await gmailFetch(`/threads/${threadId}?format=full`);
  const messages = (data.messages || []).map(formatMessage);
  return { id: data.id, messages };
}

export async function searchMessages(query, max = 30) {
  return listMessages({ q: query, max, label: null });
}

function buildRawEmail({ to, subject, body, inReplyTo, references, threadId }) {
  const lines = [
    `To: ${to}`,
    `Subject: ${subject}`,
    'Content-Type: text/plain; charset=utf-8',
    'MIME-Version: 1.0',
  ];
  if (inReplyTo) lines.push(`In-Reply-To: ${inReplyTo}`);
  if (references) lines.push(`References: ${references}`);
  lines.push('', body);
  const raw = lines.join('\r\n');
  return Buffer.from(raw).toString('base64url');
}

export async function sendEmail({ to, subject, body, threadId, replyToMessageId }) {
  let inReplyTo;
  let references;
  if (replyToMessageId) {
    const orig = await gmailFetch(`/messages/${replyToMessageId}?format=metadata&metadataHeaders=Message-ID&metadataHeaders=References`);
    const headers = orig.payload?.headers || [];
    inReplyTo = getHeader(headers, 'Message-ID');
    references = getHeader(headers, 'References') || inReplyTo;
    threadId = threadId || orig.threadId;
  }

  const raw = buildRawEmail({ to, subject, body, inReplyTo, references, threadId });
  const payload = { raw };
  if (threadId) payload.threadId = threadId;

  const sent = await gmailFetch('/messages/send', { method: 'POST', body: JSON.stringify(payload) });
  return { id: sent.id, threadId: sent.threadId };
}

export async function archiveMessage(messageId) {
  await gmailFetch(`/messages/${messageId}/modify`, {
    method: 'POST',
    body: JSON.stringify({ removeLabelIds: ['INBOX'] }),
  });
  return { ok: true };
}

export async function trashMessage(messageId) {
  await gmailFetch(`/messages/${messageId}/trash`, { method: 'POST' });
  return { ok: true };
}

export async function modifyLabels(messageId, addLabelIds = [], removeLabelIds = []) {
  await gmailFetch(`/messages/${messageId}/modify`, {
    method: 'POST',
    body: JSON.stringify({ addLabelIds, removeLabelIds }),
  });
  return { ok: true };
}

export async function listLabels() {
  const data = await gmailFetch('/labels');
  return data.labels || [];
}

let labelCache = null;
let labelCacheAt = 0;

export async function getCachedLabels(force = false) {
  if (!force && labelCache && Date.now() - labelCacheAt < 300_000) return labelCache;
  labelCache = await listLabels();
  labelCacheAt = Date.now();
  return labelCache;
}

export function invalidateLabelCache() {
  labelCache = null;
  labelCacheAt = 0;
}

export async function createLabel(name) {
  const created = await gmailFetch('/labels', {
    method: 'POST',
    body: JSON.stringify({
      name,
      labelListVisibility: 'labelShow',
      messageListVisibility: 'show',
    }),
  });
  invalidateLabelCache();
  return created;
}

export async function ensureLabel(name) {
  const labels = await getCachedLabels();
  const found = labels.find(l => l.name === name);
  if (found) return found;
  return createLabel(name);
}

export async function modifyThreadLabels(threadId, addLabelIds = [], removeLabelIds = []) {
  if (!threadId) return { ok: false };
  const add = [...new Set(addLabelIds.filter(Boolean))];
  const remove = [...new Set(removeLabelIds.filter(Boolean))];
  if (!add.length && !remove.length) return { ok: true };
  await gmailFetch(`/threads/${threadId}/modify`, {
    method: 'POST',
    body: JSON.stringify({ addLabelIds: add, removeLabelIds: remove }),
  });
  return { ok: true };
}

/** Résumé court pour l'IA */
export async function summarizeForAi(messageId) {
  const msg = await getMessage(messageId);
  return {
    id: msg.id,
    subject: msg.subject,
    from: msg.from,
    date: msg.date,
    snippet: msg.snippet,
    bodyPreview: msg.body?.slice(0, 2000),
  };
}

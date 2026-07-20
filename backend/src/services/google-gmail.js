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

function htmlToReadableText(html) {
  return String(html || '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

/** Extrait text/plain + text/html (multipart nested inclus). */
function extractBodies(payload) {
  let text = '';
  let html = '';

  function walk(part) {
    if (!part) return;
    const data = part.body?.data ? decodeBase64Url(part.body.data) : '';
    if (part.mimeType === 'text/plain' && data && !text) text = data;
    if (part.mimeType === 'text/html' && data && !html) html = data;
    for (const child of part.parts || []) walk(child);
  }

  if (!payload) return { text: '', html: '' };

  if (payload.mimeType === 'text/plain' && payload.body?.data) {
    text = decodeBase64Url(payload.body.data);
  } else if (payload.mimeType === 'text/html' && payload.body?.data) {
    html = decodeBase64Url(payload.body.data);
  } else if (payload.body?.data && !payload.parts?.length) {
    const raw = decodeBase64Url(payload.body.data);
    if (payload.mimeType === 'text/html' || /<\/?[a-z][\s\S]*>/i.test(raw)) html = raw;
    else text = raw;
  } else {
    walk(payload);
  }

  if (!text && html) text = htmlToReadableText(html);
  return { text, html };
}

/** Collecte les parts text/html|plain dont le corps est en pièce jointe Gmail. */
function collectBodyAttachmentRefs(payload, acc = []) {
  if (!payload) return acc;
  if (
    (payload.mimeType === 'text/html' || payload.mimeType === 'text/plain')
    && payload.body?.attachmentId
    && !payload.body?.data
  ) {
    acc.push({ mimeType: payload.mimeType, attachmentId: payload.body.attachmentId });
  }
  for (const part of payload.parts || []) collectBodyAttachmentRefs(part, acc);
  return acc;
}

/** Fichiers joints (PDF, images, etc.) — pas le corps MIME text. */
export function extractFileAttachments(payload, acc = []) {
  if (!payload) return acc;
  const filename = String(payload.filename || '').trim();
  const attachmentId = payload.body?.attachmentId;
  if (filename && attachmentId) {
    acc.push({
      id: attachmentId,
      filename,
      mimeType: payload.mimeType || 'application/octet-stream',
      size: Number(payload.body?.size) || 0,
    });
  }
  for (const part of payload.parts || []) extractFileAttachments(part, acc);
  return acc;
}

function findAttachmentPart(payload, attachmentId) {
  if (!payload) return null;
  if (payload.body?.attachmentId === attachmentId) return payload;
  for (const part of payload.parts || []) {
    const found = findAttachmentPart(part, attachmentId);
    if (found) return found;
  }
  return null;
}

function decodeAttachmentData(data) {
  if (!data) return Buffer.alloc(0);
  const b64 = String(data).replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(b64, 'base64');
}

async function hydrateBodyAttachments(messageId, payload) {
  const refs = collectBodyAttachmentRefs(payload);
  if (!refs.length) return payload;

  await Promise.all(refs.map(async (ref) => {
    try {
      const att = await gmailFetch(`/messages/${messageId}/attachments/${ref.attachmentId}`);
      if (!att?.data) return;
      // Injecte les données sur la part correspondante
      function inject(part) {
        if (!part) return false;
        if (part.body?.attachmentId === ref.attachmentId) {
          part.body.data = att.data;
          return true;
        }
        for (const child of part.parts || []) {
          if (inject(child)) return true;
        }
        return false;
      }
      inject(payload);
    } catch (err) {
      console.warn('Gmail body attachment:', err.message);
    }
  }));
  return payload;
}

export function formatMessage(msg) {
  const headers = msg.payload?.headers || [];
  const { text, html } = extractBodies(msg.payload);
  const attachments = extractFileAttachments(msg.payload);
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
    body: text,
    bodyHtml: html || null,
    isUnread: (msg.labelIds || []).includes('UNREAD'),
    attachments,
    hasAttachments: attachments.length > 0,
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
  if (msg?.payload) {
    await hydrateBodyAttachments(messageId, msg.payload);
  }
  return formatMessage(msg);
}

/** Télécharge une pièce jointe fichier (par attachmentId Gmail). */
export async function getAttachment(messageId, attachmentId) {
  const msg = await gmailFetch(`/messages/${messageId}?format=full`);
  const part = findAttachmentPart(msg?.payload, attachmentId);
  if (!part) throw new Error('Pièce jointe introuvable');
  const att = await gmailFetch(`/messages/${messageId}/attachments/${encodeURIComponent(attachmentId)}`);
  if (!att?.data) throw new Error('Contenu pièce jointe vide');
  const buffer = decodeAttachmentData(att.data);
  return {
    buffer,
    filename: String(part.filename || 'piece-jointe').trim() || 'piece-jointe',
    mimeType: part.mimeType || 'application/octet-stream',
    size: buffer.length,
    messageId,
    attachmentId,
  };
}

export async function getThread(threadId) {
  const data = await gmailFetch(`/threads/${threadId}?format=full`);
  const messages = await Promise.all((data.messages || []).map(async (msg) => {
    if (msg?.payload && msg.id) await hydrateBodyAttachments(msg.id, msg.payload);
    return formatMessage(msg);
  }));
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

/** Remet un message archivé dans la boîte de réception (Annuler). */
export async function unarchiveMessage(messageId) {
  await gmailFetch(`/messages/${messageId}/modify`, {
    method: 'POST',
    body: JSON.stringify({ addLabelIds: ['INBOX'] }),
  });
  return { ok: true };
}

export async function trashMessage(messageId) {
  await gmailFetch(`/messages/${messageId}/trash`, { method: 'POST' });
  return { ok: true };
}

export async function untrashMessage(messageId) {
  await gmailFetch(`/messages/${messageId}/untrash`, { method: 'POST' });
  return { ok: true };
}

export async function modifyLabels(messageId, addLabelIds = [], removeLabelIds = []) {
  await gmailFetch(`/messages/${messageId}/modify`, {
    method: 'POST',
    body: JSON.stringify({ addLabelIds, removeLabelIds }),
  });
  return { ok: true };
}

/** Marque un message (ou fil entier) comme lu. */
export async function markMessageRead(messageId, { threadId } = {}) {
  if (threadId) {
    return modifyThreadLabels(threadId, [], ['UNREAD']);
  }
  return modifyLabels(messageId, [], ['UNREAD']);
}

/** Marque un message (ou fil entier) comme non lu. */
export async function markMessageUnread(messageId, { threadId } = {}) {
  if (threadId) {
    return modifyThreadLabels(threadId, ['UNREAD'], []);
  }
  return modifyLabels(messageId, ['UNREAD'], []);
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

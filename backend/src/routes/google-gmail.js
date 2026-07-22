import { Router } from 'express';
import pool from '../db/pool.js';
import * as gmail from '../services/google-gmail.js';
import { logAgentAction } from '../services/assistant-memory.js';
import { enrichInboxMessages, sortInbox, sortRecentInbox, MAIL_SECTIONS, ensureNeyaGmailLabels, listNeyaGmailLabels, GMAIL_CATEGORY_LABELS, setThreadMailCategory } from '../services/mail-sort.js';
import emailThreadsRoutes from './email-threads.js';

const router = Router();

// Fils de conversation / synthèse IA — sous /gmail/threads (même auth Gmail)
router.use('/threads', emailThreadsRoutes);

router.get('/messages', async (req, res) => {
  try {
    const data = await gmail.listMessages({
      label: req.query.label || 'INBOX',
      max: Number(req.query.max) || 30,
      pageToken: req.query.pageToken,
      q: req.query.q,
    });
    if (req.query.sorted === '1' || req.query.sorted === 'true') {
      const sorted = await enrichInboxMessages(data.messages || []);
      return res.json({ ...data, messages: sorted.messages, sections: sorted.sections });
    }
    res.json(data);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/inbox-sorted', async (req, res) => {
  try {
    res.json(await sortInbox({ max: Number(req.query.max) || 40 }));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/sections', (_req, res) => {
  res.json(MAIL_SECTIONS);
});

router.post('/sort-inbox', async (req, res) => {
  try {
    const max = Number(req.body?.max) || 40;
    const includeTri = req.body?.includeTri !== false;
    const scanInvoices = req.body?.scanInvoices !== false;
    res.json(await sortRecentInbox(max, { includeTri, scanInvoices }));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/threads/:id/category', async (req, res) => {
  try {
    const category = req.body?.category || req.body?.mail_category;
    const row = await setThreadMailCategory(Number(req.params.id), category);
    res.json({
      ok: true,
      id: row.id,
      mail_category: row.mail_category,
      mail_category_manual: row.mail_category_manual,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/labels/tree', async (req, res) => {
  try {
    const prefixes = String(req.query.prefixes || 'NEYA/,Tri/')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
    const exact = String(req.query.exact || 'NEYA,Tri,Fournitures')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
    const withCounts = req.query.counts !== '0' && req.query.counts !== 'false';
    res.json(await gmail.listLabelTree({ prefixes, exact, withCounts }));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/search', async (req, res) => {
  try {
    if (!req.query.q) return res.status(400).json({ error: 'Paramètre q requis' });
    res.json(await gmail.searchMessages(req.query.q));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/labels', async (_req, res) => {
  try {
    res.json(await gmail.listLabels());
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/labels/neya', async (_req, res) => {
  try {
    const ids = await ensureNeyaGmailLabels();
    const labels = await listNeyaGmailLabels();
    res.json({ labels, category_map: GMAIL_CATEGORY_LABELS, ids });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/labels/neya/setup', async (_req, res) => {
  try {
    const ids = await ensureNeyaGmailLabels();
    const labels = await listNeyaGmailLabels();
    res.json({ ok: true, labels, ids });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/messages/:id', async (req, res) => {
  try {
    res.json(await gmail.getMessage(req.params.id));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

function attachmentRequestParams(req) {
  const attachmentId =
    req.query.attachmentId
    || req.query.attachment_id
    || req.params.attachmentId
    || '';
  const filename = req.query.filename || req.query.name || req.body?.filename || '';
  return { attachmentId, filename };
}

async function streamAttachment(req, res) {
  const { attachmentId, filename } = attachmentRequestParams(req);
  if (!attachmentId && !filename) {
    return res.status(400).json({ error: 'attachmentId ou filename requis' });
  }
  const att = await gmail.getAttachment(req.params.id, attachmentId, { filename });
  const inline = req.query.inline === '1' || req.query.inline === 'true';
  const safeName = String(att.filename || 'piece-jointe').replace(/[\\"\r\n]/g, '_');
  const asciiName = safeName.replace(/[^\x20-\x7E]/g, '_') || 'piece-jointe';
  res.setHeader('Content-Type', att.mimeType || 'application/octet-stream');
  res.setHeader(
    'Content-Disposition',
    `${inline ? 'inline' : 'attachment'}; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(safeName)}`
  );
  res.setHeader('Cache-Control', 'private, max-age=120');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(att.buffer);
}

/** Ouvrir / télécharger une pièce jointe (proxy Gmail, auth ERP). */
router.get('/messages/:id/attachments', async (req, res) => {
  try {
    await streamAttachment(req, res);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** Compatibilité : ID de PJ dans le chemin (peut être tronqué par certains proxies). */
router.get('/messages/:id/attachments/:attachmentId', async (req, res) => {
  try {
    await streamAttachment(req, res);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** Classer une PJ dans un projet (local + Drive si dispo). */
router.post('/messages/:id/attachments/:attachmentId/file-to-project', async (req, res) => {
  try {
    const projectId = req.body?.project_id || req.body?.projectId;
    if (!projectId) return res.status(400).json({ error: 'project_id requis' });
    const { attachmentId, filename } = attachmentRequestParams(req);
    const { fileAttachmentToProject } = await import('../services/mail-attachments.js');
    const result = await fileAttachmentToProject({
      messageId: req.params.id,
      attachmentId,
      filename,
      projectId,
      uploadDrive: req.body?.upload_drive !== false,
    });
    await logAgentAction({
      agent: 'mail',
      action: 'file_attachment_to_project',
      resource: String(projectId),
      details: { message_id: req.params.id, filename: result.file?.name },
    });
    res.status(201).json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** Classer toutes les PJ du message vers un projet. */
router.post('/messages/:id/file-attachments-to-project', async (req, res) => {
  try {
    const projectId = req.body?.project_id || req.body?.projectId;
    if (!projectId) return res.status(400).json({ error: 'project_id requis' });
    const { fileMessageAttachmentsToProject } = await import('../services/mail-attachments.js');
    const result = await fileMessageAttachmentsToProject({
      messageId: req.params.id,
      projectId,
      uploadDrive: req.body?.upload_drive !== false,
    });
    res.status(201).json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/messages/:id/summary', async (req, res) => {
  try {
    res.json(await gmail.summarizeForAi(req.params.id));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/send', async (req, res) => {
  try {
    const { to, subject, body, threadId, replyToMessageId, confirm } = req.body;
    if (!to || !subject || !body) return res.status(400).json({ error: 'to, subject, body requis' });
    if (confirm !== true) return res.status(400).json({ error: 'Confirmation requise (confirm: true)' });

    const sent = await gmail.sendEmail({ to, subject, body, threadId, replyToMessageId });
    await logAgentAction({ agent: 'commercial', action: 'gmail_send', resource: sent.id, details: { to, subject }, requiresConfirm: true });
    res.status(201).json(sent);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/messages/:id/reply', async (req, res) => {
  try {
    const { body, confirm } = req.body;
    if (!body) return res.status(400).json({ error: 'body requis' });
    if (confirm !== true) return res.status(400).json({ error: 'Confirmation requise' });

    const orig = await gmail.getMessage(req.params.id);
    const to = orig.from.match(/<([^>]+)>/)?.[1] || orig.from;
    const subject = orig.subject.startsWith('Re:') ? orig.subject : `Re: ${orig.subject}`;
    const sent = await gmail.sendEmail({
      to,
      subject,
      body,
      threadId: orig.threadId,
      replyToMessageId: req.params.id,
    });
    await logAgentAction({ agent: 'commercial', action: 'gmail_reply', resource: req.params.id, requiresConfirm: true });
    res.status(201).json(sent);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/messages/:id/archive', async (req, res) => {
  try {
    await gmail.archiveMessage(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/messages/:id/unarchive', async (req, res) => {
  try {
    await gmail.unarchiveMessage(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/messages/:id', async (req, res) => {
  try {
    if (req.query.confirm !== '1') return res.status(400).json({ error: 'Confirmation requise (?confirm=1)' });
    await gmail.trashMessage(req.params.id);
    await logAgentAction({ agent: 'commercial', action: 'gmail_trash', resource: req.params.id, requiresConfirm: true });
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/messages/:id/untrash', async (req, res) => {
  try {
    await gmail.untrashMessage(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/messages/:id/labels', async (req, res) => {
  try {
    const { add = [], remove = [] } = req.body;
    await gmail.modifyLabels(req.params.id, add, remove);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/messages/:id/read', async (req, res) => {
  try {
    const threadId = req.body?.threadId || req.body?.thread_id || null;
    await gmail.markMessageRead(req.params.id, { threadId });
    res.json({ ok: true, isUnread: false });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/messages/:id/unread', async (req, res) => {
  try {
    const threadId = req.body?.threadId || req.body?.thread_id || null;
    await gmail.markMessageUnread(req.params.id, { threadId });
    res.json({ ok: true, isUnread: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/link-project', async (req, res) => {
  try {
    const { message_id, project_id } = req.body;
    const msg = await gmail.getMessage(message_id);
    const { rows } = await pool.query(
      `INSERT INTO project_emails (project_id, gmail_message_id, thread_id, subject, from_email, snippet)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (gmail_message_id) DO UPDATE SET project_id = $1 RETURNING *`,
      [project_id, msg.id, msg.threadId, msg.subject, msg.from, msg.snippet]
    );
    const { syncGmailThread } = await import('../services/email-threads.js');
    const thread = await syncGmailThread(msg.threadId, {
      project_id: Number(project_id),
      link_source: 'manual',
      link_confidence: 1,
    });
    res.status(201).json({ ...rows[0], thread });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

export default router;

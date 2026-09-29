/**
 * Classement des pièces jointes Gmail vers un projet (stockage local + Drive).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pool from '../db/pool.js';
import { getAttachment, getMessage } from './google-gmail.js';
import { tryEnsureProjectFolder } from './drive-folders.js';
import { uploadFile } from './google-drive.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS_ROOT = path.join(__dirname, '../../uploads');

function parseMeta(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return { ...raw };
  try { return JSON.parse(raw); } catch { return {}; }
}

function safeFileName(name) {
  return String(name || 'piece-jointe')
    .replace(/[/\\?%*:|"<>]/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 120) || 'piece-jointe';
}

function formatSize(n) {
  const size = Number(n) || 0;
  if (size < 1024) return `${size} o`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} Ko`;
  return `${(size / (1024 * 1024)).toFixed(1)} Mo`;
}

function sameFiledEntry(existing, candidate) {
  if (existing.gmail_message_id && candidate.gmail_message_id
    && String(existing.gmail_message_id) === String(candidate.gmail_message_id)) {
    if (existing.gmail_attachment_id && candidate.gmail_attachment_id
      && String(existing.gmail_attachment_id) === String(candidate.gmail_attachment_id)) {
      return true;
    }
    if (existing.name && candidate.name
      && String(existing.name).toLowerCase() === String(candidate.name).toLowerCase()) {
      return true;
    }
  }
  return false;
}

async function linkMessageToProject(projectId, msg) {
  await pool.query(
    `INSERT INTO project_emails (project_id, gmail_message_id, thread_id, subject, from_email, snippet)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (gmail_message_id) DO UPDATE SET project_id = $1`,
    [projectId, msg.id, msg.threadId, msg.subject, msg.from, msg.snippet]
  );
  if (msg.threadId) {
    try {
      const { syncGmailThread } = await import('./email-threads.js');
      await syncGmailThread(msg.threadId, {
        project_id: Number(projectId),
        link_source: 'mail_attachment',
        link_confidence: 1,
      });
    } catch { /* optional */ }
  }
}

/**
 * Enregistre une PJ Gmail sur un projet :
 * - copie locale /uploads/projects/:id/mail/
 * - meta.mail_files sur le projet
 * - upload Drive dossier projet si possible
 */
export async function fileAttachmentToProject({
  messageId,
  attachmentId,
  filename,
  projectId,
  uploadDrive = true,
  message = null,
}) {
  const pid = Number(projectId);
  if (!pid) throw new Error('project_id requis');
  if (!messageId || (!attachmentId && !filename)) {
    throw new Error('message_id et attachment_id (ou filename) requis');
  }

  const { rows: projRows } = await pool.query(
    'SELECT id, name, meta FROM projects WHERE id = $1',
    [pid]
  );
  if (!projRows[0]) throw new Error('Projet introuvable');

  const msg = message || await getMessage(messageId);
  if (msg?.noise) {
    /* ignore */
  }

  const att = await getAttachment(messageId, attachmentId, {
    filename,
    // Réutilise le payload déjà hydraté si getMessage l’a fourni via cache interne — sinon re-fetch
  });
  const resolvedAttachmentId = att.attachmentId || attachmentId;

  const meta = parseMeta(projRows[0].meta);
  const mail_files = Array.isArray(meta.mail_files) ? [...meta.mail_files] : [];
  const dup = mail_files.find(f => sameFiledEntry(f, {
    gmail_message_id: messageId,
    gmail_attachment_id: resolvedAttachmentId,
    name: att.filename,
  }));
  if (dup) {
    await linkMessageToProject(pid, msg);
    return {
      ok: true,
      skipped: true,
      project: { id: pid, name: projRows[0].name },
      file: dup,
      drive: dup.drive_file_id ? { id: dup.drive_file_id, webViewLink: dup.drive_web_view } : null,
    };
  }

  const dir = path.join(UPLOADS_ROOT, 'projects', String(pid), 'mail');
  fs.mkdirSync(dir, { recursive: true });
  const storedName = `${Date.now()}-${safeFileName(att.filename)}`;
  fs.writeFileSync(path.join(dir, storedName), att.buffer);
  const localUrl = `/uploads/projects/${pid}/mail/${storedName}`;

  const entry = {
    id: `mail-${Date.now()}`,
    name: att.filename,
    url: localUrl,
    mimeType: att.mimeType,
    size: att.size,
    size_label: formatSize(att.size),
    gmail_message_id: messageId,
    gmail_attachment_id: resolvedAttachmentId,
    source_subject: msg.subject,
    filed_at: new Date().toISOString(),
  };

  let driveFile = null;
  if (uploadDrive !== false) {
    try {
      const folder = await tryEnsureProjectFolder(pid);
      if (folder?.folder_id) {
        driveFile = await uploadFile(att.filename, att.buffer, att.mimeType, folder.folder_id);
        entry.drive_file_id = driveFile.id;
        entry.drive_web_view = driveFile.webViewLink || null;
      }
    } catch (err) {
      entry.drive_error = err.message;
    }
  }

  mail_files.push(entry);
  const nextMeta = {
    ...meta,
    mail_files,
    mail_files_updated_at: new Date().toISOString(),
  };
  await pool.query('UPDATE projects SET meta = $1::jsonb WHERE id = $2', [
    JSON.stringify(nextMeta),
    pid,
  ]);

  await linkMessageToProject(pid, msg);

  return {
    ok: true,
    project: { id: pid, name: projRows[0].name },
    file: entry,
    drive: driveFile,
  };
}

/** Classe toutes les PJ du message vers un projet (ignore signatures CID). */
export async function fileMessageAttachmentsToProject({
  messageId,
  projectId,
  uploadDrive = true,
}) {
  const msg = await getMessage(messageId);
  const attachments = (msg.attachments || []).filter(a => !a.noise);
  if (!attachments.length) {
    return { ok: true, project_id: Number(projectId), filed: [], skipped: 'Aucune pièce jointe', count: 0, errors: [] };
  }
  const filed = [];
  const errors = [];
  let projectInfo = null;
  for (const a of attachments) {
    try {
      const result = await fileAttachmentToProject({
        messageId,
        attachmentId: a.id,
        filename: a.filename,
        projectId,
        uploadDrive,
        message: msg,
      });
      if (result.project) projectInfo = result.project;
      if (!result.skipped) filed.push(result.file);
      else filed.push({ ...result.file, skipped: true });
    } catch (err) {
      errors.push({ filename: a.filename, error: err.message });
    }
  }
  return {
    ok: errors.length === 0,
    project_id: Number(projectId),
    project: projectInfo,
    filed,
    errors,
    count: filed.filter(f => !f.skipped).length,
  };
}

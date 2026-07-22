/**
 * Fichiers SketchUp (.skp) liés à un projet.
 * Viewer live via iframe InnerScene + URL signée CORS.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import jwt from 'jsonwebtoken';
import pool from '../db/pool.js';
import { getJwtSecret } from '../config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS_ROOT = path.join(__dirname, '../../uploads');

export const SKP_MIME = 'application/vnd.sketchup.skp';
export const INNERSCENE_VIEWER = 'https://www.innerscene.com/tools/skp-viewer';
const EMBED_TOKEN_TTL = '2h';
const EMBED_PURPOSE = 'skp_embed';

export function isSketchupFilename(name = '') {
  return /\.skp$/i.test(String(name || ''));
}

export function isSketchupMime(mime = '') {
  const m = String(mime || '').toLowerCase();
  return m.includes('sketchup') || m === SKP_MIME || m === 'application/sketchup';
}

export function isSketchupFile({ name, filename, mimeType, url } = {}) {
  return isSketchupFilename(name || filename || url) || isSketchupMime(mimeType);
}

function parseMeta(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return { ...raw };
  try { return JSON.parse(raw); } catch { return {}; }
}

function safeBaseName(name) {
  return String(name || 'modele')
    .replace(/\.skp$/i, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .slice(0, 100) || 'modele';
}

function formatSize(n) {
  const size = Number(n) || 0;
  if (size < 1024) return `${size} o`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} Ko`;
  return `${(size / (1024 * 1024)).toFixed(1)} Mo`;
}

export function listSketchupFiles(meta) {
  const m = parseMeta(meta);
  return Array.isArray(m.sketchup_files) ? m.sketchup_files : [];
}

export function resolveSketchupDiskPath(fileUrl) {
  const rel = String(fileUrl || '').replace(/^\/uploads\//, '');
  if (!rel || rel.includes('..')) return null;
  const disk = path.join(UPLOADS_ROOT, rel);
  if (!disk.startsWith(UPLOADS_ROOT + path.sep)) return null;
  return disk;
}

/** Base API publique absolue (pour iframe InnerScene). */
export function publicApiBaseFromRequest(req) {
  const env = String(process.env.ERP_PUBLIC_URL || process.env.FRONTEND_URL || '').replace(/\/$/, '');
  if (env) {
    if (/\/api$/i.test(env)) return env;
    return `${env}/api`;
  }
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'https').split(',')[0].trim();
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  if (!host) return null;
  return `${proto}://${host}/api`;
}

/**
 * URL signée courte durée + URL iframe InnerScene.
 * Le fichier doit être joignable en HTTPS public (pas localhost).
 */
export async function createSketchupEmbed(projectId, fileId, req) {
  const pid = Number(projectId);
  const { rows } = await pool.query('SELECT meta FROM projects WHERE id = $1', [pid]);
  if (!rows[0]) throw new Error('Projet introuvable');
  const files = listSketchupFiles(rows[0].meta);
  const file = files.find(f => String(f.id) === String(fileId));
  if (!file?.url) throw new Error('Fichier SketchUp introuvable');

  const disk = resolveSketchupDiskPath(file.url);
  if (!disk || !fs.existsSync(disk)) throw new Error('Fichier absent sur le disque');

  const apiBase = publicApiBaseFromRequest(req);
  if (!apiBase) throw new Error('URL publique ERP introuvable');

  const token = jwt.sign(
    {
      purpose: EMBED_PURPOSE,
      projectId: pid,
      fileId: String(file.id),
      rel: String(file.url).replace(/^\/uploads\//, ''),
      name: file.name || 'modele.skp',
    },
    getJwtSecret(),
    { expiresIn: EMBED_TOKEN_TTL }
  );

  const fileUrl = `${apiBase}/public/sketchup/${encodeURIComponent(token)}`;
  const viewerUrl = `${INNERSCENE_VIEWER}?embedded=1&url=${encodeURIComponent(fileUrl)}`;

  return {
    file,
    file_url: fileUrl,
    viewer_url: viewerUrl,
    expires_in: 7200,
    note: /localhost|127\.0\.0\.1/i.test(fileUrl)
      ? 'InnerScene ne peut pas charger un fichier en localhost — déployez l’ERP en HTTPS public.'
      : null,
  };
}

export function verifySketchupEmbedToken(token) {
  const payload = jwt.verify(String(token || ''), getJwtSecret());
  if (payload?.purpose !== EMBED_PURPOSE || !payload.rel) {
    throw new Error('Jeton SketchUp invalide');
  }
  return payload;
}

export async function storeSketchupFile(projectId, buffer, originalName = 'modele.skp') {
  const pid = Number(projectId);
  if (!pid) throw new Error('project_id invalide');
  if (!buffer?.length) throw new Error('Fichier SketchUp vide');

  const { rows } = await pool.query('SELECT id, meta FROM projects WHERE id = $1', [pid]);
  if (!rows[0]) throw new Error('Projet introuvable');

  const dir = path.join(UPLOADS_ROOT, 'projects', String(pid), 'sketchup');
  fs.mkdirSync(dir, { recursive: true });

  const base = safeBaseName(originalName);
  const filename = `${Date.now()}-${base}.skp`;
  const fullPath = path.join(dir, filename);
  fs.writeFileSync(fullPath, buffer);

  const entry = {
    id: `skp-${Date.now()}`,
    name: /\.skp$/i.test(originalName) ? String(originalName).trim() : `${base}.skp`,
    url: `/uploads/projects/${pid}/sketchup/${filename}`,
    mimeType: SKP_MIME,
    size: buffer.length,
    size_label: formatSize(buffer.length),
    kind: 'skp',
    uploaded_at: new Date().toISOString(),
  };

  const meta = parseMeta(rows[0].meta);
  const sketchup_files = [...listSketchupFiles(meta), entry];
  const nextMeta = {
    ...meta,
    sketchup_files,
    sketchup_updated_at: new Date().toISOString(),
  };

  await pool.query('UPDATE projects SET meta = $1::jsonb WHERE id = $2', [
    JSON.stringify(nextMeta),
    pid,
  ]);

  return { file: entry, sketchup_files };
}

export async function removeSketchupFile(projectId, fileId) {
  const pid = Number(projectId);
  const { rows } = await pool.query('SELECT id, meta FROM projects WHERE id = $1', [pid]);
  if (!rows[0]) throw new Error('Projet introuvable');

  const meta = parseMeta(rows[0].meta);
  const prev = listSketchupFiles(meta);
  const target = prev.find(f => String(f.id) === String(fileId) || String(f.url) === String(fileId));
  const next = prev.filter(f => f !== target);

  if (target?.url?.startsWith('/uploads/')) {
    const disk = resolveSketchupDiskPath(target.url);
    try { if (disk && fs.existsSync(disk)) fs.unlinkSync(disk); } catch { /* ignore */ }
  }

  const nextMeta = {
    ...meta,
    sketchup_files: next,
    sketchup_updated_at: new Date().toISOString(),
  };
  await pool.query('UPDATE projects SET meta = $1::jsonb WHERE id = $2', [
    JSON.stringify(nextMeta),
    pid,
  ]);
  return { ok: true, sketchup_files: next };
}

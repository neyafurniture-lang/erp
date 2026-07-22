/**
 * Fichiers SketchUp (.skp) liés à un projet.
 * Pas de preview navigateur : téléchargement pour ouverture dans SketchUp.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pool from '../db/pool.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS_ROOT = path.join(__dirname, '../../uploads');

export const SKP_MIME = 'application/vnd.sketchup.skp';

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

/**
 * Enregistre un .skp sur le projet (disque + meta.sketchup_files).
 */
export async function storeSketchupFile(projectId, buffer, originalName = 'modele.skp') {
  const pid = Number(projectId);
  if (!pid) throw new Error('project_id invalide');
  if (!buffer?.length) throw new Error('Fichier SketchUp vide');
  if (!isSketchupFilename(originalName) && !String(originalName || '').toLowerCase().includes('sketchup')) {
    // Accepte aussi si l’extension manque mais on force .skp
  }

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
    const disk = path.join(UPLOADS_ROOT, target.url.replace(/^\/uploads\//, ''));
    try { if (fs.existsSync(disk)) fs.unlinkSync(disk); } catch { /* ignore */ }
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

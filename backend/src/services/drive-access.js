import pool from '../db/pool.js';
import { isAdmin } from '../config/permissions.js';
import * as drive from './google-drive.js';

export function parseDriveAccess(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  try { return JSON.parse(raw); } catch { return []; }
}

function normalizeEntry(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const out = {
    folder_id: entry.folder_id || null,
    project_id: entry.project_id ? Number(entry.project_id) : null,
    client_id: entry.client_id ? Number(entry.client_id) : null,
    label: entry.label?.trim() || null,
  };
  if (!out.folder_id && !out.project_id && !out.client_id) return null;
  return out;
}

export function sanitizeDriveAccess(list) {
  if (!Array.isArray(list)) return [];
  return list.map(normalizeEntry).filter(Boolean);
}

export async function getRequestUser(req) {
  const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [req.user.id]);
  if (!rows[0]) throw new Error('Utilisateur introuvable');
  if (rows[0].active === false) throw new Error('Compte désactivé');
  return rows[0];
}

export async function resolveDriveRoots(user) {
  if (isAdmin(user)) return { restricted: false, roots: [] };

  const access = sanitizeDriveAccess(parseDriveAccess(user?.drive_access));
  if (!access.length) return { restricted: false, roots: [] };

  const roots = [];
  const seen = new Set();

  for (const entry of access) {
    if (entry.folder_id) {
      const key = `f:${entry.folder_id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      roots.push({
        folder_id: entry.folder_id,
        label: entry.label || 'Dossier Drive',
        project_id: entry.project_id,
        client_id: entry.client_id,
      });
      continue;
    }

    if (entry.project_id) {
      const { rows } = await pool.query(
        `SELECT p.id, p.name, p.drive_folder_id, c.name AS client_name
         FROM projects p LEFT JOIN clients c ON c.id = p.client_id WHERE p.id = $1`,
        [entry.project_id]
      );
      const p = rows[0];
      if (!p?.drive_folder_id) continue;
      const key = `f:${p.drive_folder_id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      roots.push({
        folder_id: p.drive_folder_id,
        label: entry.label || p.name,
        project_id: p.id,
        client_id: null,
      });
      continue;
    }

    if (entry.client_id) {
      const { rows } = await pool.query(
        'SELECT id, name, drive_folder_id FROM clients WHERE id = $1',
        [entry.client_id]
      );
      const c = rows[0];
      if (!c?.drive_folder_id) continue;
      const key = `f:${c.drive_folder_id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      roots.push({
        folder_id: c.drive_folder_id,
        label: entry.label || c.name,
        project_id: null,
        client_id: c.id,
      });
    }
  }

  return { restricted: true, roots };
}

async function isUnderAllowedRoot(folderId, allowedIds) {
  if (!folderId || allowedIds.includes(folderId)) return true;
  let current = folderId;
  const visited = new Set();

  while (current && !visited.has(current)) {
    visited.add(current);
    if (allowedIds.includes(current)) return true;
    const file = await drive.getFile(current);
    const parent = file.parents?.[0];
    if (!parent || parent === current) break;
    current = parent;
  }
  return false;
}

export async function assertCanAccessFolder(user, folderId) {
  const { restricted, roots } = await resolveDriveRoots(user);
  if (!restricted) return;
  const allowedIds = roots.map(r => r.folder_id).filter(Boolean);
  if (!allowedIds.length) throw new Error('Aucun dossier Drive autorisé pour votre compte');
  const ok = await isUnderAllowedRoot(folderId, allowedIds);
  if (!ok) throw new Error('Accès refusé à ce dossier Drive');
}

export async function assertCanAccessFile(user, fileId) {
  const { restricted, roots } = await resolveDriveRoots(user);
  if (!restricted) return;
  const allowedIds = roots.map(r => r.folder_id).filter(Boolean);
  if (!allowedIds.length) throw new Error('Aucun dossier Drive autorisé pour votre compte');

  const file = await drive.getFile(fileId);
  if (await isUnderAllowedRoot(fileId, allowedIds)) return;
  const parentId = file.parents?.[0];
  if (parentId && await isUnderAllowedRoot(parentId, allowedIds)) return;
  throw new Error('Accès refusé à ce fichier Drive');
}

export async function filterSearchResults(user, files) {
  const { restricted, roots } = await resolveDriveRoots(user);
  if (!restricted) return files;
  const allowedIds = roots.map(r => r.folder_id).filter(Boolean);
  const out = [];
  for (const f of files) {
    const parentId = f.parents?.[0];
    if (parentId && await isUnderAllowedRoot(parentId, allowedIds)) {
      out.push(f);
      continue;
    }
    if (f.isFolder && await isUnderAllowedRoot(f.id, allowedIds)) out.push(f);
  }
  return out;
}

export async function listDriveOptions() {
  const { rows: projects } = await pool.query(`
    SELECT p.id, p.name, p.drive_folder_id, c.name AS client_name
    FROM projects p
    LEFT JOIN clients c ON c.id = p.client_id
    WHERE p.status != 'cancelled'
    ORDER BY p.name
    LIMIT 200
  `);
  const { rows: clients } = await pool.query(`
    SELECT id, name, drive_folder_id FROM clients ORDER BY name LIMIT 200
  `);
  return { projects, clients };
}

/**
 * Structure Drive ERP :
 *   NEYA ERP /
 *     Clients /
 *       {Client} /
 *         {Projet} /     ← pièces jointes
 *     _Sans client /
 *       {Projet} /
 */
import pool from '../db/pool.js';
import { getSetting, setSetting } from './settings.js';
import {
  getOrCreateChildFolder,
  getFile,
} from './google-drive.js';

const SETTING_ADMIN_ROOT = 'drive_admin_root_folder_id';
const ADMIN_ROOT_NAME = 'NEYA ERP';
const CLIENTS_FOLDER_NAME = 'Clients';
const ORPHAN_FOLDER_NAME = '_Sans client';

function normalizeSettingId(value) {
  if (value == null) return null;
  if (typeof value === 'string') {
    const t = value.trim().replace(/^"|"$/g, '');
    return t || null;
  }
  return String(value);
}

export async function getAdminRootFolderId() {
  return normalizeSettingId(await getSetting(SETTING_ADMIN_ROOT));
}

export async function ensureAdminRoot() {
  let id = await getAdminRootFolderId();
  if (id) {
    try {
      await getFile(id);
      return id;
    } catch {
      id = null;
    }
  }
  const folder = await getOrCreateChildFolder('root', ADMIN_ROOT_NAME);
  await setSetting(SETTING_ADMIN_ROOT, folder.id);
  return folder.id;
}

export async function ensureClientsParentFolder() {
  const adminId = await ensureAdminRoot();
  const folder = await getOrCreateChildFolder(adminId, CLIENTS_FOLDER_NAME);
  return folder.id;
}

export async function ensureOrphanParentFolder() {
  const adminId = await ensureAdminRoot();
  const folder = await getOrCreateChildFolder(adminId, ORPHAN_FOLDER_NAME);
  return folder.id;
}

export async function ensureClientFolder(clientId) {
  const id = Number(clientId);
  if (!id) throw new Error('client_id invalide');
  const { rows } = await pool.query('SELECT id, name, drive_folder_id FROM clients WHERE id = $1', [id]);
  if (!rows[0]) throw new Error('Client introuvable');

  let folderId = rows[0].drive_folder_id;
  if (folderId) {
    try {
      await getFile(folderId);
      return {
        client_id: id,
        folder_id: folderId,
        name: rows[0].name,
        webViewLink: `https://drive.google.com/drive/folders/${folderId}`,
        created: false,
      };
    } catch {
      folderId = null;
    }
  }

  const parentId = await ensureClientsParentFolder();
  const folder = await getOrCreateChildFolder(parentId, rows[0].name || `Client ${id}`);
  await pool.query('UPDATE clients SET drive_folder_id = $1 WHERE id = $2', [folder.id, id]);
  return {
    client_id: id,
    folder_id: folder.id,
    name: rows[0].name,
    webViewLink: folder.webViewLink || `https://drive.google.com/drive/folders/${folder.id}`,
    created: true,
  };
}

export async function ensureProjectFolder(projectId) {
  const id = Number(projectId);
  if (!id) throw new Error('project_id invalide');
  const { rows } = await pool.query(
    `SELECT p.id, p.name, p.drive_folder_id, p.client_id, c.name AS client_name, c.drive_folder_id AS client_drive_folder_id
     FROM projects p
     LEFT JOIN clients c ON c.id = p.client_id
     WHERE p.id = $1`,
    [id]
  );
  if (!rows[0]) throw new Error('Projet introuvable');
  const project = rows[0];

  let folderId = project.drive_folder_id;
  if (folderId) {
    try {
      await getFile(folderId);
      return {
        project_id: id,
        folder_id: folderId,
        name: project.name,
        client_id: project.client_id,
        webViewLink: `https://drive.google.com/drive/folders/${folderId}`,
        created: false,
      };
    } catch {
      folderId = null;
    }
  }

  let parentId;
  if (project.client_id) {
    const clientFolder = await ensureClientFolder(project.client_id);
    parentId = clientFolder.folder_id;
  } else {
    parentId = await ensureOrphanParentFolder();
  }

  const folder = await getOrCreateChildFolder(parentId, project.name || `Projet ${id}`);
  await pool.query('UPDATE projects SET drive_folder_id = $1 WHERE id = $2', [folder.id, id]);
  return {
    project_id: id,
    folder_id: folder.id,
    name: project.name,
    client_id: project.client_id,
    webViewLink: folder.webViewLink || `https://drive.google.com/drive/folders/${folder.id}`,
    created: true,
  };
}

/** Ne fait pas échouer la création projet/client si Google n’est pas connecté. */
export async function tryEnsureProjectFolder(projectId) {
  try {
    return await ensureProjectFolder(projectId);
  } catch (err) {
    console.warn('[drive-folders] ensureProjectFolder:', err.message);
    return null;
  }
}

export async function tryEnsureClientFolder(clientId) {
  try {
    return await ensureClientFolder(clientId);
  } catch (err) {
    console.warn('[drive-folders] ensureClientFolder:', err.message);
    return null;
  }
}

/** Arborescence ERP pour l’UI Admin Drive. */
export async function getAdminDriveTree() {
  const adminRootId = await getAdminRootFolderId();
  const { rows: clients } = await pool.query(
    `SELECT id, name, drive_folder_id, email, city
     FROM clients
     ORDER BY name ASC
     LIMIT 500`
  );
  const { rows: projects } = await pool.query(
    `SELECT id, name, client_id, drive_folder_id, status
     FROM projects
     WHERE status IS DISTINCT FROM 'cancelled'
     ORDER BY name ASC
     LIMIT 1000`
  );

  const byClient = new Map();
  for (const c of clients) {
    byClient.set(c.id, {
      id: c.id,
      name: c.name,
      drive_folder_id: c.drive_folder_id,
      email: c.email,
      city: c.city,
      projects: [],
    });
  }

  const orphans = [];
  for (const p of projects) {
    const item = {
      id: p.id,
      name: p.name,
      drive_folder_id: p.drive_folder_id,
      status: p.status,
      client_id: p.client_id,
    };
    if (p.client_id && byClient.has(p.client_id)) {
      byClient.get(p.client_id).projects.push(item);
    } else {
      orphans.push(item);
    }
  }

  return {
    admin_root_folder_id: adminRootId,
    admin_root_name: ADMIN_ROOT_NAME,
    clients_folder_name: CLIENTS_FOLDER_NAME,
    clients: [...byClient.values()],
    orphan_projects: orphans,
  };
}

/** Crée les dossiers manquants pour tous les clients + projets actifs. */
export async function syncAllDriveFolders({ maxClients = 200, maxProjects = 400 } = {}) {
  const adminRoot = await ensureAdminRoot();
  await ensureClientsParentFolder();
  await ensureOrphanParentFolder();

  const { rows: clients } = await pool.query(
    'SELECT id FROM clients ORDER BY name ASC LIMIT $1',
    [maxClients]
  );
  const { rows: projects } = await pool.query(
    `SELECT id FROM projects
     WHERE status IS DISTINCT FROM 'cancelled' AND status IS DISTINCT FROM 'done'
     ORDER BY created_at DESC LIMIT $1`,
    [maxProjects]
  );

  const result = {
    admin_root_folder_id: adminRoot,
    clients: { ok: 0, created: 0, errors: [] },
    projects: { ok: 0, created: 0, errors: [] },
  };

  for (const c of clients) {
    try {
      const r = await ensureClientFolder(c.id);
      result.clients.ok += 1;
      if (r.created) result.clients.created += 1;
    } catch (err) {
      result.clients.errors.push({ id: c.id, error: err.message });
    }
  }

  for (const p of projects) {
    try {
      const r = await ensureProjectFolder(p.id);
      result.projects.ok += 1;
      if (r.created) result.projects.created += 1;
    } catch (err) {
      result.projects.errors.push({ id: p.id, error: err.message });
    }
  }

  return result;
}

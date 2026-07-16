import { Router } from 'express';
import multer from 'multer';
import pool from '../db/pool.js';
import * as drive from '../services/google-drive.js';
import {
  assertCanAccessFile,
  assertCanAccessFolder,
  filterSearchResults,
  getRequestUser,
  resolveDriveRoots,
} from '../services/drive-access.js';
import { isAdmin } from '../config/permissions.js';
import { logAgentAction } from '../services/assistant-memory.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });
const router = Router();

function accessDenied(res, err) {
  const msg = err.message || 'Accès refusé';
  if (msg.includes('Accès refusé') || msg.includes('autorisé')) {
    return res.status(403).json({ error: msg });
  }
  return res.status(400).json({ error: msg });
}

router.get('/access', async (req, res) => {
  try {
    const user = await getRequestUser(req);
    res.json(await resolveDriveRoots(user));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/files', async (req, res) => {
  try {
    const user = await getRequestUser(req);
    const folderId = req.query.folderId || 'root';
    await assertCanAccessFolder(user, folderId);
    const data = await drive.listFiles(folderId, req.query.pageToken);
    res.json(data);
  } catch (err) {
    accessDenied(res, err);
  }
});

router.get('/search', async (req, res) => {
  try {
    if (!req.query.q) return res.status(400).json({ error: 'Paramètre q requis' });
    const user = await getRequestUser(req);
    const data = await drive.searchFiles(req.query.q, req.query.pageToken);
    data.files = await filterSearchResults(user, data.files);
    res.json(data);
  } catch (err) {
    accessDenied(res, err);
  }
});

router.get('/tree', async (req, res) => {
  try {
    const user = await getRequestUser(req);
    const folderId = req.query.folderId || 'root';
    await assertCanAccessFolder(user, folderId);
    const depth = Math.min(Number(req.query.depth) || 2, 4);
    res.json({ tree: await drive.getFolderTree(folderId, depth) });
  } catch (err) {
    accessDenied(res, err);
  }
});

router.get('/files/:id', async (req, res) => {
  try {
    const user = await getRequestUser(req);
    await assertCanAccessFile(user, req.params.id);
    res.json(await drive.getFile(req.params.id));
  } catch (err) {
    accessDenied(res, err);
  }
});

router.get('/files/:id/download', async (req, res) => {
  try {
    const user = await getRequestUser(req);
    await assertCanAccessFile(user, req.params.id);
    const { buffer, filename, mimeType } = await drive.downloadFile(req.params.id);
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
    res.setHeader('Content-Type', mimeType);
    res.send(buffer);
  } catch (err) {
    accessDenied(res, err);
  }
});

router.get('/files/:id/preview', async (req, res) => {
  try {
    const user = await getRequestUser(req);
    await assertCanAccessFile(user, req.params.id);
    const { buffer, filename, mimeType } = await drive.downloadFile(req.params.id);
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(filename)}"`);
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.send(buffer);
  } catch (err) {
    accessDenied(res, err);
  }
});

router.post('/folders', async (req, res) => {
  try {
    const user = await getRequestUser(req);
    const { name, parentId = 'root' } = req.body;
    if (!name) return res.status(400).json({ error: 'Nom requis' });
    await assertCanAccessFolder(user, parentId);
    const folder = await drive.createFolder(name, parentId);
    await logAgentAction({ agent: 'general', action: 'drive_create_folder', resource: folder.id, details: { name } });
    res.status(201).json(folder);
  } catch (err) {
    accessDenied(res, err);
  }
});

router.post('/files', async (req, res) => {
  try {
    const user = await getRequestUser(req);
    const { name, parentId = 'root', mimeType = 'application/vnd.google-apps.document' } = req.body;
    await assertCanAccessFolder(user, parentId);
    const file = await drive.createGoogleDoc(name || 'Nouveau document', parentId, mimeType);
    res.status(201).json(file);
  } catch (err) {
    accessDenied(res, err);
  }
});

router.post('/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Fichier requis' });
    const user = await getRequestUser(req);
    const parentId = req.body.parentId || 'root';
    await assertCanAccessFolder(user, parentId);
    const file = await drive.uploadFile(req.file.originalname, req.file.buffer, req.file.mimetype, parentId);
    res.status(201).json(file);
  } catch (err) {
    accessDenied(res, err);
  }
});

router.patch('/files/:id', async (req, res) => {
  try {
    const user = await getRequestUser(req);
    await assertCanAccessFile(user, req.params.id);
    const { name, moveToParentId, currentParentId } = req.body;
    if (moveToParentId) await assertCanAccessFolder(user, moveToParentId);
    let result;
    if (name) result = await drive.renameFile(req.params.id, name);
    if (moveToParentId) result = await drive.moveFile(req.params.id, moveToParentId, currentParentId);
    await logAgentAction({ agent: 'general', action: 'drive_update', resource: req.params.id, details: req.body, requiresConfirm: false });
    res.json(result || { ok: true });
  } catch (err) {
    accessDenied(res, err);
  }
});

router.delete('/files/:id', async (req, res) => {
  try {
    if (req.query.confirm !== '1') {
      return res.status(400).json({ error: 'Confirmation requise — ajoutez ?confirm=1' });
    }
    const user = await getRequestUser(req);
    await assertCanAccessFile(user, req.params.id);
    await drive.deleteFile(req.params.id);
    await logAgentAction({ agent: 'general', action: 'drive_delete', resource: req.params.id, requiresConfirm: true });
    res.json({ ok: true });
  } catch (err) {
    accessDenied(res, err);
  }
});

router.get('/projects/:projectId', async (req, res) => {
  try {
    const user = await getRequestUser(req);
    const { rows } = await pool.query('SELECT drive_folder_id, name FROM projects WHERE id = $1', [req.params.projectId]);
    if (!rows[0]) return res.status(404).json({ error: 'Projet introuvable' });
    if (!rows[0].drive_folder_id) return res.json({ folder: null, files: [] });
    await assertCanAccessFolder(user, rows[0].drive_folder_id);
    const data = await drive.listFiles(rows[0].drive_folder_id);
    res.json({ folder: { id: rows[0].drive_folder_id, name: rows[0].name }, files: data.files });
  } catch (err) {
    accessDenied(res, err);
  }
});

/** Arborescence Admin ERP : Clients → Projets (dossiers Drive). */
router.get('/admin/tree', async (req, res) => {
  try {
    const user = await getRequestUser(req);
    if (!isAdmin(user)) {
      return res.status(403).json({ error: 'Réservé aux administrateurs' });
    }
    const { getAdminDriveTree } = await import('../services/drive-folders.js');
    res.json(await getAdminDriveTree());
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** Crée NEYA ERP / Clients / dossiers manquants. */
router.post('/admin/sync', async (req, res) => {
  try {
    const user = await getRequestUser(req);
    if (!isAdmin(user)) {
      return res.status(403).json({ error: 'Réservé aux administrateurs' });
    }
    const { syncAllDriveFolders } = await import('../services/drive-folders.js');
    res.json(await syncAllDriveFolders());
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

export default router;

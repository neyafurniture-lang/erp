import { getValidAccessToken } from './google-oauth.js';

const BASE = 'https://www.googleapis.com/drive/v3';

async function driveFetch(path, options = {}) {
  const token = await getValidAccessToken();
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.body && !(options.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `Drive API ${res.status}`);
  }
  if (res.status === 204) return null;
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) return res.json();
  return res;
}

const FIELDS = 'files(id,name,mimeType,modifiedTime,size,webViewLink,webContentLink,iconLink,thumbnailLink,parents),nextPageToken';

export function formatFile(f) {
  // Google sert souvent =s220 ; on demande une preview plus nette pour la grille.
  let thumbnailLink = f.thumbnailLink || null;
  if (thumbnailLink) {
    thumbnailLink = thumbnailLink.replace(/=s\d+/, '=s800');
  }
  const meta = f.imageMediaMetadata || {};
  return {
    id: f.id,
    name: f.name,
    mimeType: f.mimeType,
    isFolder: f.mimeType === 'application/vnd.google-apps.folder',
    size: f.size ? Number(f.size) : null,
    modifiedTime: f.modifiedTime,
    webViewLink: f.webViewLink,
    webContentLink: f.webContentLink,
    iconLink: f.iconLink,
    thumbnailLink,
    parents: f.parents || [],
    imageWidth: meta.width ? Number(meta.width) : null,
    imageHeight: meta.height ? Number(meta.height) : null,
  };
}

export async function listFiles(folderId = 'root', pageToken = null) {
  const q = `'${folderId}' in parents and trashed=false`;
  const params = new URLSearchParams({
    q,
    fields: FIELDS,
    pageSize: '100',
    orderBy: 'folder,name',
  });
  if (pageToken) params.set('pageToken', pageToken);
  const data = await driveFetch(`/files?${params}`);
  return {
    files: (data.files || []).map(formatFile),
    nextPageToken: data.nextPageToken || null,
    folderId,
  };
}

export async function searchFiles(query, pageToken = null) {
  const q = `fullText contains '${query.replace(/'/g, "\\'")}' and trashed=false`;
  const params = new URLSearchParams({ q, fields: FIELDS, pageSize: '50' });
  if (pageToken) params.set('pageToken', pageToken);
  const data = await driveFetch(`/files?${params}`);
  return { files: (data.files || []).map(formatFile), nextPageToken: data.nextPageToken || null };
}

/** Photos récentes du Drive (pour propositions de posts / médiathèque). */
export async function listRecentImages({
  pageSize = 24,
  pageToken = null,
  query = null,
  nameOnly = false,
} = {}) {
  const parts = [`mimeType contains 'image/'`, 'trashed=false'];
  if (query) {
    const safe = String(query).replace(/'/g, "\\'");
    // nameOnly : évite fullText/OCR qui remonte les scans de factures
    if (nameOnly) parts.push(`name contains '${safe}'`);
    else parts.push(`(name contains '${safe}' or fullText contains '${safe}')`);
  }
  const params = new URLSearchParams({
    q: parts.join(' and '),
    fields: 'files(id,name,mimeType,modifiedTime,size,webViewLink,webContentLink,iconLink,thumbnailLink,parents,imageMediaMetadata(width,height)),nextPageToken',
    pageSize: String(Math.min(Number(pageSize) || 24, 50)),
    orderBy: 'modifiedTime desc',
  });
  if (pageToken) params.set('pageToken', pageToken);
  const data = await driveFetch(`/files?${params}`);
  return {
    files: (data.files || []).map(formatFile),
    nextPageToken: data.nextPageToken || null,
  };
}

export async function getFile(fileId) {
  const data = await driveFetch(`/files/${fileId}?fields=id,name,mimeType,size,webViewLink,webContentLink,parents,modifiedTime`);
  return formatFile(data);
}

export async function createFolder(name, parentId = 'root') {
  const data = await driveFetch('/files?fields=id,name,mimeType,webViewLink,parents', {
    method: 'POST',
    body: JSON.stringify({
      name,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentId],
    }),
  });
  return formatFile(data);
}

/** Trouve un sous-dossier par nom exact (non corbeille). */
export async function findChildFolderByName(parentId, name) {
  const escaped = String(name || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const q = `'${parentId}' in parents and name='${escaped}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const params = new URLSearchParams({
    q,
    fields: 'files(id,name,mimeType,webViewLink,parents)',
    pageSize: '5',
  });
  const data = await driveFetch(`/files?${params}`);
  const hit = (data.files || [])[0];
  return hit ? formatFile(hit) : null;
}

/** Crée le dossier s’il n’existe pas déjà sous le parent. */
export async function getOrCreateChildFolder(parentId, name) {
  const existing = await findChildFolderByName(parentId, name);
  if (existing) return existing;
  return createFolder(name, parentId);
}

export async function createGoogleDoc(name, parentId = 'root', mimeType = 'application/vnd.google-apps.document') {
  const data = await driveFetch('/files?fields=id,name,mimeType,webViewLink', {
    method: 'POST',
    body: JSON.stringify({ name, mimeType, parents: [parentId] }),
  });
  return formatFile(data);
}

export async function renameFile(fileId, name) {
  const data = await driveFetch(`/files/${fileId}?fields=id,name`, {
    method: 'PATCH',
    body: JSON.stringify({ name }),
  });
  return data;
}

export async function moveFile(fileId, newParentId, oldParentId) {
  const params = new URLSearchParams({ addParents: newParentId });
  if (oldParentId) params.set('removeParents', oldParentId);
  const data = await driveFetch(`/files/${fileId}?${params}&fields=id,name,parents`, { method: 'PATCH' });
  return formatFile(data);
}

export async function deleteFile(fileId) {
  await driveFetch(`/files/${fileId}`, { method: 'DELETE' });
  return { ok: true };
}

export async function uploadFile(name, buffer, mimeType, parentId = 'root') {
  const token = await getValidAccessToken();
  const metadata = { name, parents: [parentId] };

  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  form.append('file', new Blob([buffer], { type: mimeType }));

  const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,webViewLink,size', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || 'Échec upload Drive');
  return formatFile(data);
}

export async function downloadFile(fileId) {
  const meta = await getFile(fileId);
  const token = await getValidAccessToken();
  let url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
  if (meta.mimeType?.startsWith('application/vnd.google-apps.')) {
    const exportMap = {
      'application/vnd.google-apps.document': 'application/pdf',
      'application/vnd.google-apps.spreadsheet': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.google-apps.presentation': 'application/pdf',
    };
    const exportMime = exportMap[meta.mimeType] || 'application/pdf';
    url = `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=${encodeURIComponent(exportMime)}`;
  }
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error('Téléchargement impossible');
  const buffer = Buffer.from(await res.arrayBuffer());
  return { buffer, filename: meta.name, mimeType: res.headers.get('content-type') || 'application/octet-stream' };
}

/** Arborescence pour l'IA (profondeur limitée) */
export async function getFolderTree(folderId = 'root', depth = 2) {
  if (depth <= 0) return [];
  const { files } = await listFiles(folderId);
  const tree = [];
  for (const f of files) {
    const node = { id: f.id, name: f.name, isFolder: f.isFolder };
    if (f.isFolder && depth > 1) {
      node.children = await getFolderTree(f.id, depth - 1);
    }
    tree.push(node);
  }
  return tree;
}

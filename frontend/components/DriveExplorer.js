'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { api, getApiUrl, getToken } from '../lib/api';
import { useAuth } from '../lib/auth-context';
import { isAdmin } from '../lib/permissions';
import { connectGoogle, getGoogleStatus } from '../lib/google';
import DriveFilePreview, { canPreview } from './DriveFilePreview';

const MIME = {
  folder: { label: 'Dossier', bg: 'bg-neya-surface', text: 'text-neya-ink' },
  image: { label: 'Image', bg: 'bg-neya-surface', text: 'text-neya-muted' },
  pdf: { label: 'PDF', bg: 'bg-neya-surface', text: 'text-neya-muted' },
  sheet: { label: 'Tableur', bg: 'bg-neya-surface', text: 'text-neya-muted' },
  doc: { label: 'Document', bg: 'bg-neya-surface', text: 'text-neya-muted' },
  slide: { label: 'Présentation', bg: 'bg-neya-surface', text: 'text-neya-muted' },
  video: { label: 'Vidéo', bg: 'bg-neya-surface', text: 'text-neya-muted' },
  archive: { label: 'Archive', bg: 'bg-neya-surface', text: 'text-neya-muted' },
  file: { label: 'Fichier', bg: 'bg-neya-surface', text: 'text-neya-muted' },
};

function fileKind(mimeType, isFolder) {
  if (isFolder || mimeType === 'application/vnd.google-apps.folder') return 'folder';
  if (!mimeType) return 'file';
  if (mimeType.includes('image')) return 'image';
  if (mimeType.includes('pdf')) return 'pdf';
  if (mimeType.includes('spreadsheet') || mimeType.includes('excel')) return 'sheet';
  if (mimeType.includes('document') || mimeType.includes('word')) return 'doc';
  if (mimeType.includes('presentation') || mimeType.includes('powerpoint')) return 'slide';
  if (mimeType.includes('video')) return 'video';
  if (mimeType.includes('zip') || mimeType.includes('archive')) return 'archive';
  return 'file';
}

function formatSize(bytes) {
  if (!bytes) return '—';
  const units = ['o', 'Ko', 'Mo', 'Go'];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i += 1;
  }
  return `${n.toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}

function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString('fr-CA', {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

function IconFolder({ className = 'w-6 h-6' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" />
    </svg>
  );
}

function IconFile({ className = 'w-6 h-6' }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  );
}

function IconSearch() {
  return (
    <svg className="w-4 h-4 text-neya-muted shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M11 18a7 7 0 100-14 7 7 0 000 14z" />
    </svg>
  );
}

function IconUpload() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M12 4v12m0 0l-4-4m4 4l4-4" />
    </svg>
  );
}

function IconGrid() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
    </svg>
  );
}

function IconList() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  );
}

function IconRefresh({ spin }) {
  return (
    <svg className={`w-4 h-4 ${spin ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h5M20 20v-5h-5M4 9a9 9 0 0115.36-6.36M20 15a9 9 0 01-15.36 6.36" />
    </svg>
  );
}

function FileTypeIcon({ mimeType, isFolder, large }) {
  const kind = fileKind(mimeType, isFolder);
  const meta = MIME[kind];
  const size = large ? 'w-7 h-7' : 'w-5 h-5';
  return (
    <span className={`drive-file-icon ${meta.bg} ${meta.text} ${large ? '' : '!w-9 !h-9 !mb-0'}`}>
      {kind === 'folder' ? <IconFolder className={size} /> : <IconFile className={size} />}
    </span>
  );
}

function EmptyDrive({ title, children }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
      <p className="text-sm font-medium text-neya-ink mb-1">{title}</p>
      <p className="text-sm text-neya-muted max-w-sm">{children}</p>
    </div>
  );
}

export default function DriveExplorer({ projectId = null, initialFolderId = 'root' }) {
  const { user } = useAuth();
  const adminUser = isAdmin(user);
  const [connected, setConnected] = useState(null);
  const [driveCtx, setDriveCtx] = useState(null);
  const [rootsMode, setRootsMode] = useState(false);
  /** 'files' = explorateur Drive | 'admin' = Clients / Projets ERP */
  const [spaceMode, setSpaceMode] = useState('files');
  const [adminTree, setAdminTree] = useState(null);
  const [adminBusy, setAdminBusy] = useState(false);
  const [expandedClientId, setExpandedClientId] = useState(null);
  const [projectRootId, setProjectRootId] = useState(null);
  const [folderId, setFolderId] = useState(initialFolderId);
  const [breadcrumbs, setBreadcrumbs] = useState([{ id: 'root', name: 'Mon Drive' }]);
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [searching, setSearching] = useState(false);
  const [err, setErr] = useState('');
  const [newFolder, setNewFolder] = useState('');
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [view, setView] = useState('grid');
  const [selected, setSelected] = useState(null);
  const [previewFile, setPreviewFile] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);
  const ensuredProject = useRef(false);

  const loadDriveAccess = async () => {
    try {
      const ctx = await api('/drive/access');
      setDriveCtx(ctx);
      if (!projectId && ctx.restricted) {
        if (!ctx.roots.length) {
          setErr('Aucun dossier Drive autorisé pour votre compte.');
          return;
        }
        if (ctx.roots.length === 1) {
          const root = ctx.roots[0];
          setFolderId(root.folder_id);
          setBreadcrumbs([{ id: root.folder_id, name: root.label }]);
          setRootsMode(false);
        } else {
          setRootsMode(true);
        }
      }
    } catch (e) {
      setErr(e.message);
    }
  };

  const loadStatus = () => getGoogleStatus().then(s => setConnected(s.google?.connected)).catch(() => setConnected(false));

  const loadFiles = async (fid = folderId, q = '') => {
    setLoading(true);
    setErr('');
    setSearching(!!q);
    try {
      let data;
      if (q) {
        data = await api(`/drive/search?q=${encodeURIComponent(q)}`);
      } else if (projectId) {
        if (projectRootId && fid && fid !== projectRootId) {
          data = await api(`/drive/files?folderId=${encodeURIComponent(fid)}`);
        } else {
          data = await api(`/drive/projects/${projectId}`);
          if (data.folder?.id) {
            setProjectRootId(data.folder.id);
            if (!fid || fid === 'root' || fid === projectRootId) {
              setFolderId(data.folder.id);
              setBreadcrumbs([{ id: data.folder.id, name: data.folder.name || 'Dossier projet' }]);
            }
          }
        }
      } else {
        data = await api(`/drive/files?folderId=${encodeURIComponent(fid || 'root')}`);
      }
      setFiles(data.files || []);
      setSelected(null);
      setPreviewFile(null);
    } catch (e) {
      setErr(e.message);
      setFiles([]);
    } finally {
      setLoading(false);
    }
  };

  async function loadAdminTree() {
    if (!adminUser) return;
    setAdminBusy(true);
    setErr('');
    try {
      const tree = await api('/drive/admin/tree');
      setAdminTree(tree);
    } catch (e) {
      setErr(e.message);
    } finally {
      setAdminBusy(false);
    }
  }

  async function syncAdminFolders() {
    setAdminBusy(true);
    setErr('');
    try {
      const result = await api('/drive/admin/sync', { method: 'POST' });
      await loadAdminTree();
      setErr('');
      alert(
        `Structure Drive synchronisée.\n`
        + `Clients : ${result.clients?.created || 0} créés / ${result.clients?.ok || 0}\n`
        + `Projets : ${result.projects?.created || 0} créés / ${result.projects?.ok || 0}`
      );
      if (result.admin_root_folder_id) {
        setFolderId(result.admin_root_folder_id);
        setBreadcrumbs([
          { id: result.admin_root_folder_id, name: 'NEYA ERP' },
        ]);
        setSpaceMode('files');
        setRootsMode(false);
        await loadFiles(result.admin_root_folder_id, '');
      }
    } catch (e) {
      setErr(e.message);
    } finally {
      setAdminBusy(false);
    }
  }

  async function openErpFolder({ folderId: fid, label, ensurePath }) {
    setSpaceMode('files');
    setRootsMode(false);
    setSearch('');
    setSearching(false);
    setErr('');
    try {
      let id = fid;
      if (!id && ensurePath) {
        const r = await api(ensurePath, { method: 'POST' });
        id = r.folder_id;
      }
      if (!id) throw new Error('Dossier Drive introuvable — lancez « Synchroniser Clients ».');
      setFolderId(id);
      setBreadcrumbs([{ id, name: label || 'Dossier' }]);
      await loadFiles(id, '');
    } catch (e) {
      setErr(e.message);
    }
  }

  useEffect(() => { loadStatus(); }, []);
  useEffect(() => {
    if (connected) loadDriveAccess();
  }, [connected]);
  useEffect(() => {
    if (connected && adminUser && !projectId) loadAdminTree();
  }, [connected, adminUser, projectId]);
  useEffect(() => {
    if (connected && !rootsMode && driveCtx !== null && spaceMode === 'files') {
      loadFiles(folderId, search);
    }
  }, [connected, folderId, projectId, rootsMode, driveCtx, spaceMode]);

  // Projet : créer le dossier Drive automatiquement à l’ouverture de l’onglet
  useEffect(() => {
    if (!connected || !projectId || ensuredProject.current) return undefined;
    ensuredProject.current = true;
    (async () => {
      try {
        const r = await api(`/integrations/projects/${projectId}/drive-folder`, { method: 'POST' });
        if (r.folder_id) {
          setProjectRootId(r.folder_id);
          setFolderId(r.folder_id);
          setBreadcrumbs([{ id: r.folder_id, name: r.name || 'Dossier projet' }]);
        }
      } catch (e) {
        setErr(e.message);
      }
    })();
    return undefined;
  }, [connected, projectId]);

  function selectItem(f) {
    setSelected(f);
    if (!f.isFolder && canPreview(f)) {
      setPreviewFile(f);
    } else {
      setPreviewFile(null);
    }
  }

  function openItem(f) {
    if (f.isFolder) {
      setBreadcrumbs(b => [...b, { id: f.id, name: f.name }]);
      setFolderId(f.id);
      setSearch('');
      setSearching(false);
      setSelected(null);
      setPreviewFile(null);
      return;
    }
    if (canPreview(f)) {
      selectItem(f);
      return;
    }
    if (f.webViewLink) window.open(f.webViewLink, '_blank');
  }

  function closePreview() {
    setPreviewFile(null);
  }

  function pickRoot(root) {
    setFolderId(root.folder_id);
    setBreadcrumbs([{ id: root.folder_id, name: root.label }]);
    setRootsMode(false);
    setSearch('');
    setSearching(false);
  }

  function goCrumb(i) {
    if (driveCtx?.restricted && driveCtx.roots.length > 1 && i === 0) {
      setRootsMode(true);
      setSearch('');
      setSearching(false);
      setSelected(null);
      setPreviewFile(null);
      return;
    }
    const c = breadcrumbs[i];
    setBreadcrumbs(breadcrumbs.slice(0, i + 1));
    setFolderId(c.id);
    setSearch('');
    setSearching(false);
    setSelected(null);
    setPreviewFile(null);
  }

  async function createFolder(e) {
    e.preventDefault();
    if (!newFolder.trim()) return;
    await api('/drive/folders', { method: 'POST', body: JSON.stringify({ name: newFolder, parentId: folderId }) });
    setNewFolder('');
    setShowNewFolder(false);
    loadFiles(folderId, search);
  }

  async function uploadBlob(file) {
    if (!file) return;
    setUploading(true);
    setErr('');
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('parentId', folderId);
      await api('/drive/upload', { method: 'POST', body: form });
      await loadFiles(folderId, search);
    } catch (e) {
      setErr(e.message);
    } finally {
      setUploading(false);
    }
  }

  async function uploadFile(e) {
    const file = e.target.files?.[0];
    await uploadBlob(file);
    e.target.value = '';
  }

  async function downloadFile(f) {
    const res = await fetch(`${getApiUrl()}/drive/files/${f.id}/download`, {
      headers: { Authorization: `Bearer ${getToken()}` },
    });
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = f.name;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function deleteFile(f) {
    if (!confirm(`Supprimer « ${f.name} » sur Drive ?`)) return;
    await api(`/drive/files/${f.id}?confirm=1`, { method: 'DELETE' });
    setSelected(null);
    setPreviewFile(null);
    loadFiles(folderId, search);
  }

  async function renameFile(f) {
    const name = prompt('Nouveau nom', f.name);
    if (!name || name === f.name) return;
    await api(`/drive/files/${f.id}`, { method: 'PATCH', body: JSON.stringify({ name }) });
    loadFiles(folderId, search);
  }

  async function ensureProjectFolder() {
    const r = await api(`/integrations/projects/${projectId}/drive-folder`, { method: 'POST' });
    setProjectRootId(r.folder_id);
    setFolderId(r.folder_id);
    setBreadcrumbs([{ id: r.folder_id, name: r.name || 'Dossier projet' }]);
    loadFiles(r.folder_id);
  }

  function onDragOver(e) {
    e.preventDefault();
    setDragOver(true);
  }

  function onDragLeave(e) {
    if (!e.currentTarget.contains(e.relatedTarget)) setDragOver(false);
  }

  async function onDrop(e) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) await uploadBlob(file);
  }

  if (connected === null) {
    return (
      <div className="drive-shell items-center justify-center">
        <div className="flex flex-col items-center gap-3 py-16">
          <div className="w-6 h-6 border-2 border-neya-border border-t-neya-ink rounded-full animate-spin" />
          <p className="text-sm text-neya-muted">Connexion à Google Drive…</p>
        </div>
      </div>
    );
  }

  if (!connected) {
    return (
      <div className="drive-shell">
        <EmptyDrive title="Google Drive non connecté">
          <p className="mb-4">Connectez votre compte Google pour parcourir et gérer vos fichiers.</p>
          <div className="flex flex-wrap justify-center gap-2">
            <Link href="/settings?tab=integrations" className="btn-primary text-sm min-h-[40px]">Paramètres</Link>
            <button type="button" onClick={connectGoogle} className="btn-secondary text-sm min-h-[40px]">Connecter Google</button>
          </div>
        </EmptyDrive>
      </div>
    );
  }

  if (driveCtx?.restricted && !driveCtx.roots.length) {
    return (
      <div className="drive-shell">
        <EmptyDrive title="Accès restreint">
          Aucun dossier Drive autorisé pour votre compte. Contactez un administrateur.
        </EmptyDrive>
      </div>
    );
  }

  const showRootsGrid = rootsMode && driveCtx?.roots?.length > 1 && !searching;
  const showPreview = previewFile && canPreview(previewFile);
  const listCompact = showPreview;

  return (
    <div className="drive-shell">
      {!projectId && adminUser && (
        <div className="flex items-center gap-1 px-3 py-1.5 border-b border-neya-border bg-neya-surface/40">
          <button
            type="button"
            onClick={() => { setSpaceMode('files'); setRootsMode(false); }}
            className={`text-xs px-3 py-1.5 rounded-sm min-h-[32px] ${spaceMode === 'files' ? 'bg-white border border-neya-border font-semibold text-neya-ink' : 'text-neya-muted hover:text-neya-ink'}`}
          >
            Mon Drive
          </button>
          <button
            type="button"
            onClick={() => { setSpaceMode('admin'); loadAdminTree(); }}
            className={`text-xs px-3 py-1.5 rounded-sm min-h-[32px] ${spaceMode === 'admin' ? 'bg-white border border-neya-border font-semibold text-neya-ink' : 'text-neya-muted hover:text-neya-ink'}`}
          >
            Admin — Clients
          </button>
          <button
            type="button"
            onClick={syncAdminFolders}
            disabled={adminBusy}
            className="ml-auto text-xs btn-secondary min-h-[32px] py-1 px-2.5"
            title="Crée NEYA ERP / Clients / dossiers projets manquants"
          >
            {adminBusy ? 'Sync…' : 'Synchroniser Clients'}
          </button>
        </div>
      )}

      <div className="drive-toolbar">
        <nav className="drive-breadcrumb" aria-label="Fil d'Ariane">
          {!projectId && spaceMode === 'admin' && (
            <span className="text-sm font-medium text-neya-ink px-2">NEYA ERP · Clients</span>
          )}
          {!projectId && spaceMode === 'files' && breadcrumbs.map((c, i) => (
            <span key={c.id} className="flex items-center shrink-0">
              {i > 0 && <span className="text-neya-muted/50 mx-0.5">/</span>}
              <button
                type="button"
                onClick={() => goCrumb(i)}
                className={`drive-crumb ${i === breadcrumbs.length - 1 && !searching ? 'drive-crumb-active' : ''}`}
              >
                {driveCtx?.restricted && driveCtx.roots.length > 1 && i === 0 ? 'Mes dossiers' : c.name}
              </button>
            </span>
          ))}
          {searching && (
            <span className="drive-crumb drive-crumb-active">Résultats : « {search} »</span>
          )}
          {projectId && (
            <span className="text-sm font-medium text-neya-ink px-2">
              {breadcrumbs[breadcrumbs.length - 1]?.name || 'Dossier projet'}
            </span>
          )}
        </nav>

        <div className="mail-search max-w-xs sm:max-w-sm">
          <IconSearch />
          <input
            placeholder="Rechercher…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') loadFiles(folderId, search);
              if (e.key === 'Escape') { setSearch(''); loadFiles(folderId, ''); }
            }}
          />
        </div>

        <button type="button" onClick={() => loadFiles(folderId, search)} className="drive-icon-btn" title="Actualiser">
          <IconRefresh spin={loading} />
        </button>

        <div className="hidden sm:flex items-center rounded-lg border border-neya-border bg-white p-0.5">
          <button type="button" onClick={() => setView('grid')} className={`drive-icon-btn w-8 h-8 ${view === 'grid' ? 'bg-neya-surface text-neya-ink' : ''}`} title="Grille">
            <IconGrid />
          </button>
          <button type="button" onClick={() => setView('list')} className={`drive-icon-btn w-8 h-8 ${view === 'list' ? 'bg-neya-surface text-neya-ink' : ''}`} title="Liste">
            <IconList />
          </button>
        </div>

        <button type="button" onClick={() => setShowNewFolder(v => !v)} className="btn-secondary text-xs min-h-[36px] py-1.5 hidden sm:inline-flex">
          + Dossier
        </button>
        <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading} className="btn-primary text-xs min-h-[36px] py-1.5 gap-1.5">
          <IconUpload />
          {uploading ? 'Envoi…' : 'Importer'}
        </button>
        <input ref={fileRef} type="file" className="hidden" onChange={uploadFile} />

        {projectId && (
          <button type="button" onClick={ensureProjectFolder} className="btn-secondary text-xs min-h-[36px] py-1.5">
            Ouvrir dossier projet
          </button>
        )}
      </div>

      {showNewFolder && (
        <form onSubmit={createFolder} className="flex gap-2 px-4 py-2.5 border-b border-neya-border bg-neya-surface/30">
          <input
            className="input flex-1 text-sm min-h-[40px]"
            placeholder="Nom du nouveau dossier…"
            value={newFolder}
            onChange={e => setNewFolder(e.target.value)}
            autoFocus
          />
          <button type="submit" className="btn-primary text-sm min-h-[40px]">Créer</button>
          <button type="button" onClick={() => { setShowNewFolder(false); setNewFolder(''); }} className="btn-secondary text-sm min-h-[40px]">Annuler</button>
        </form>
      )}

      {err && (
        <div className="px-4 py-2 text-sm text-red-700 bg-red-50 border-b border-red-100">{err}</div>
      )}

      <div className="drive-layout min-h-[480px]">
        {spaceMode === 'admin' && !projectId && adminUser && (
          <aside className="drive-sidebar !flex w-56 lg:w-64">
            <p className="px-4 pb-1 text-[10px] font-semibold uppercase tracking-widest text-neya-muted">Clients ERP</p>
            <p className="px-4 pb-2 text-[10px] text-neya-muted leading-snug">
              Structure : NEYA ERP → Clients → Projet
            </p>
            <div className="overflow-y-auto flex-1 pb-3">
              {(adminTree?.clients || []).map(client => {
                const open = expandedClientId === client.id;
                return (
                  <div key={client.id} className="mb-0.5">
                    <button
                      type="button"
                      onClick={() => setExpandedClientId(open ? null : client.id)}
                      className="drive-nav-item w-full"
                    >
                      <IconFolder className="w-4 h-4 shrink-0" />
                      <span className="truncate flex-1 text-left">{client.name}</span>
                      <span className="text-[10px] text-neya-muted">{client.projects?.length || 0}</span>
                    </button>
                    {open && (
                      <div className="ml-3 border-l border-neya-border/70 pl-1">
                        <button
                          type="button"
                          className="drive-nav-item text-xs"
                          onClick={() => openErpFolder({
                            folderId: client.drive_folder_id,
                            label: client.name,
                            ensurePath: `/integrations/clients/${client.id}/drive-folder`,
                          })}
                        >
                          Ouvrir dossier client
                        </button>
                        {(client.projects || []).map(p => (
                          <button
                            key={p.id}
                            type="button"
                            className="drive-nav-item text-xs"
                            onClick={() => openErpFolder({
                              folderId: p.drive_folder_id,
                              label: p.name,
                              ensurePath: `/integrations/projects/${p.id}/drive-folder`,
                            })}
                          >
                            <span className="truncate">{p.name}</span>
                          </button>
                        ))}
                        {!client.projects?.length && (
                          <p className="px-2.5 py-1 text-[10px] text-neya-muted">Aucun projet</p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
              {(adminTree?.orphan_projects || []).length > 0 && (
                <div className="mt-3 pt-2 border-t border-neya-border/70">
                  <p className="px-4 pb-1 text-[10px] font-semibold uppercase tracking-widest text-neya-muted">Sans client</p>
                  {adminTree.orphan_projects.map(p => (
                    <button
                      key={p.id}
                      type="button"
                      className="drive-nav-item text-xs"
                      onClick={() => openErpFolder({
                        folderId: p.drive_folder_id,
                        label: p.name,
                        ensurePath: `/integrations/projects/${p.id}/drive-folder`,
                      })}
                    >
                      <span className="truncate">{p.name}</span>
                    </button>
                  ))}
                </div>
              )}
              {!adminTree?.clients?.length && !adminBusy && (
                <p className="px-4 py-3 text-xs text-neya-muted">
                  Aucun client. Créez des clients puis cliquez « Synchroniser Clients ».
                </p>
              )}
            </div>
          </aside>
        )}

        {driveCtx?.roots?.length > 1 && !projectId && spaceMode === 'files' && (
          <aside className="drive-sidebar">
            <p className="px-4 pb-2 text-[10px] font-semibold uppercase tracking-widest text-neya-muted">Accès rapide</p>
            <button
              type="button"
              onClick={() => { setRootsMode(true); setSelected(null); }}
              className={`drive-nav-item ${rootsMode ? 'drive-nav-active' : ''}`}
            >
              <IconFolder className="w-4 h-4 shrink-0" />
              Mes dossiers
            </button>
            {driveCtx.roots.map(root => (
              <button
                key={root.folder_id}
                type="button"
                onClick={() => pickRoot(root)}
                className={`drive-nav-item ${folderId === root.folder_id && !rootsMode ? 'drive-nav-active' : ''}`}
              >
                <IconFolder className="w-4 h-4 shrink-0" />
                <span className="truncate">{root.label}</span>
              </button>
            ))}
          </aside>
        )}

        <div className="drive-main">
          {spaceMode === 'admin' && !projectId ? (
            <div className="flex-1 px-5 py-8">
              <h2 className="font-heading text-lg mb-1">Espace Admin Drive</h2>
              <p className="text-sm text-neya-muted max-w-lg mb-4">
                Structure automatique : <strong className="text-neya-ink font-medium">NEYA ERP → Clients → Client → Projet</strong>.
                Choisissez un client à gauche, ou synchronisez pour créer tous les dossiers manquants.
                Les nouveaux projets ouvrent déjà leur dossier pour les pièces jointes.
              </p>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={syncAdminFolders} disabled={adminBusy} className="btn-primary text-sm min-h-[40px]">
                  {adminBusy ? 'Synchronisation…' : 'Créer / maj tous les dossiers'}
                </button>
                {adminTree?.admin_root_folder_id && (
                  <button
                    type="button"
                    className="btn-secondary text-sm min-h-[40px]"
                    onClick={() => openErpFolder({
                      folderId: adminTree.admin_root_folder_id,
                      label: 'NEYA ERP',
                    })}
                  >
                    Ouvrir NEYA ERP sur Drive
                  </button>
                )}
              </div>
              <ul className="mt-6 text-sm text-neya-muted space-y-1.5 max-w-md">
                <li>· {adminTree?.clients?.length ?? 0} client(s) ERP</li>
                <li>· {adminTree?.orphan_projects?.length ?? 0} projet(s) sans client</li>
                <li>· Cliquez un projet dans la liste pour y déposer des fichiers</li>
              </ul>
            </div>
          ) : (
          <div className={`flex flex-1 min-h-0 ${showPreview ? 'xl:flex-row flex-col' : ''}`}>
            <div className={`${listCompact ? 'drive-list-compact' : 'flex-1 flex flex-col min-w-0'} flex flex-col min-w-0`}>
              <div
                className={`drive-dropzone ${dragOver ? 'drive-dropzone-active' : ''} ${listCompact ? '!p-2' : ''}`}
                onDragOver={onDragOver}
                onDragLeave={onDragLeave}
                onDrop={onDrop}
              >
            {dragOver && (
              <div className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none">
                <p className="text-sm text-neya-muted bg-white px-3 py-1.5 border border-neya-border">
                  Déposez le fichier ici
                </p>
              </div>
            )}

            {showRootsGrid ? (
              <div>
                <p className="text-sm text-neya-muted mb-4 px-1">Choisissez un dossier auquel vous avez accès</p>
                <div className="drive-grid">
                  {driveCtx.roots.map(root => (
                    <button
                      key={root.folder_id}
                      type="button"
                      onClick={() => pickRoot(root)}
                      className="drive-card"
                    >
                      <span className="drive-card-media">
                        <span className="drive-file-icon bg-neya-surface text-neya-muted border border-neya-border">
                          <IconFolder className="w-8 h-8" />
                        </span>
                      </span>
                      <span className="drive-card-meta">
                        <span className="text-xs font-medium text-neya-ink line-clamp-2">{root.label}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ) : loading ? (
              <div className="drive-grid">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="drive-card animate-pulse">
                    <div className="drive-card-media bg-neya-border/30" />
                    <div className="drive-card-meta gap-1.5">
                      <div className="h-3 w-4/5 bg-neya-surface rounded" />
                      <div className="h-2 w-1/3 bg-neya-surface/80 rounded" />
                    </div>
                  </div>
                ))}
              </div>
            ) : files.length === 0 ? (
              <EmptyDrive title={searching ? 'Aucun résultat' : 'Dossier vide'}>
                {searching
                  ? 'Essayez un autre terme de recherche.'
                  : 'Glissez-déposez un fichier ou cliquez sur Importer pour commencer.'}
              </EmptyDrive>
            ) : view === 'grid' && !listCompact ? (
              <div className="drive-grid">
                {files.map(f => {
                  const kind = fileKind(f.mimeType, f.isFolder);
                  const meta = MIME[kind];
                  const isSelected = selected?.id === f.id;
                  const thumb = !f.isFolder && f.thumbnailLink;
                  return (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => selectItem(f)}
                      onDoubleClick={() => openItem(f)}
                      className={`drive-card ${isSelected ? 'drive-card-selected' : ''}`}
                    >
                      <span className="drive-card-media">
                        {thumb ? (
                          <img src={f.thumbnailLink} alt="" className="drive-thumb" loading="lazy" />
                        ) : (
                          <span className={`drive-file-icon ${meta.bg} ${meta.text}`}>
                            {kind === 'folder' ? <IconFolder className="w-8 h-8" /> : <IconFile className="w-8 h-8" />}
                          </span>
                        )}
                      </span>
                      <span className="drive-card-meta">
                        <span className="text-xs font-medium text-neya-ink line-clamp-2 leading-snug">{f.name}</span>
                        <span className="text-[10px] text-neya-muted mt-0.5">{formatDate(f.modifiedTime)}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="drive-list">
                <div className="hidden sm:grid grid-cols-[1fr_100px_80px] gap-2 px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-neya-muted">
                  <span>Nom</span>
                  <span>Modifié</span>
                  <span className="text-right">Taille</span>
                </div>
                {files.map(f => {
                  const isSelected = selected?.id === f.id;
                  return (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => selectItem(f)}
                      onDoubleClick={() => openItem(f)}
                      className={`drive-row w-full text-left ${isSelected ? 'drive-row-selected' : ''}`}
                    >
                      <FileTypeIcon mimeType={f.mimeType} isFolder={f.isFolder} />
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm font-medium truncate">{f.name}</span>
                        <span className="block sm:hidden text-[11px] text-neya-muted">{formatDate(f.modifiedTime)}</span>
                      </span>
                      <span className="hidden sm:block text-xs text-neya-muted w-[100px] shrink-0">{formatDate(f.modifiedTime)}</span>
                      <span className="hidden sm:block text-xs text-neya-muted w-[80px] shrink-0 text-right">
                        {f.isFolder ? '—' : formatSize(f.size)}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
              </div>
            </div>

            {showPreview && (
              <div className="hidden xl:flex flex-1 min-w-0 min-h-0">
                <DriveFilePreview file={previewFile} onClose={closePreview} />
              </div>
            )}
          </div>
          )}
        </div>

        {showPreview && (
          <div className="xl:hidden fixed inset-0 z-50 flex flex-col justify-end sm:justify-center p-0 sm:p-4">
            <button type="button" aria-label="Fermer" className="absolute inset-0 bg-black/50" onClick={closePreview} />
            <div className="relative bg-white w-full sm:max-w-4xl sm:mx-auto rounded sm:rounded border border-neya-border overflow-hidden flex flex-col max-h-[92vh]">
              <DriveFilePreview file={previewFile} onClose={closePreview} />
            </div>
          </div>
        )}

        {selected && (
          <aside className="drive-detail">
            <div className="p-4 border-b border-neya-border">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-neya-muted mb-3">Détails</p>
              <div className="flex justify-center mb-3">
                <FileTypeIcon mimeType={selected.mimeType} isFolder={selected.isFolder} large />
              </div>
              <p className="text-sm font-semibold text-neya-ink break-words text-center leading-snug">{selected.name}</p>
              <p className="text-xs text-neya-muted text-center mt-1">
                {MIME[fileKind(selected.mimeType, selected.isFolder)].label}
              </p>
            </div>
            <dl className="p-4 space-y-3 text-sm flex-1">
              <div>
                <dt className="text-[10px] font-semibold uppercase tracking-wider text-neya-muted">Modifié</dt>
                <dd className="mt-0.5">{formatDate(selected.modifiedTime)}</dd>
              </div>
              {!selected.isFolder && (
                <div>
                  <dt className="text-[10px] font-semibold uppercase tracking-wider text-neya-muted">Taille</dt>
                  <dd className="mt-0.5">{formatSize(selected.size)}</dd>
                </div>
              )}
            </dl>
            <div className="p-4 border-t border-neya-border space-y-2">
              {selected.isFolder ? (
                <button type="button" onClick={() => openItem(selected)} className="btn-primary w-full text-sm min-h-[40px]">
                  Ouvrir le dossier
                </button>
              ) : (
                <>
                  {canPreview(selected) && (
                    <button type="button" onClick={() => setPreviewFile(selected)} className="btn-primary w-full text-sm min-h-[40px]">
                      Aperçu
                    </button>
                  )}
                  {selected.webViewLink && (
                    <a href={selected.webViewLink} target="_blank" rel="noopener noreferrer" className="btn-secondary w-full text-sm min-h-[40px] inline-flex">
                      Ouvrir dans Drive
                    </a>
                  )}
                  <button type="button" onClick={() => downloadFile(selected)} className="btn-secondary w-full text-sm min-h-[40px]">
                    Télécharger
                  </button>
                </>
              )}
              <button type="button" onClick={() => renameFile(selected)} className="btn-secondary w-full text-sm min-h-[40px]">
                Renommer
              </button>
              <button type="button" onClick={() => deleteFile(selected)} className="btn-ghost w-full text-sm text-red-600 hover:bg-red-50">
                Supprimer
              </button>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}

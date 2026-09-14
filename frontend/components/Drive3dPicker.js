'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { isCad3dFile, isModel3dFile } from '../lib/drive-preview';

function is3dFile(file) {
  return isModel3dFile(file) || isCad3dFile(file);
}

function kindLabel(file) {
  if (isModel3dFile(file)) return 'GLB / GLTF — viewer';
  if (isCad3dFile(file)) return 'CAD — export GLB recommandé';
  return '';
}

/**
 * Navigateur Drive restreint : dossiers + fichiers 3D uniquement.
 * Clic sur un fichier 3D → onPick(file).
 */
export default function Drive3dPicker({ open, onClose, onPick, title = 'Sélectionner le modèle 3D' }) {
  const [folderId, setFolderId] = useState('root');
  const [crumbs, setCrumbs] = useState([{ id: 'root', name: 'Mon Drive' }]);
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [q, setQ] = useState('');
  const [searching, setSearching] = useState(false);

  const loadFolder = useCallback(async (fid) => {
    setLoading(true);
    setErr('');
    setSearching(false);
    try {
      const data = await api(`/drive/files?folderId=${encodeURIComponent(fid || 'root')}`);
      const all = data.files || [];
      setFiles(all.filter((f) => f.isFolder || is3dFile(f)));
    } catch (e) {
      setErr(e.message);
      setFiles([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    setFolderId('root');
    setCrumbs([{ id: 'root', name: 'Mon Drive' }]);
    setQ('');
    loadFolder('root');
    return undefined;
  }, [open, loadFolder]);

  async function openFolder(folder) {
    setFolderId(folder.id);
    setCrumbs((prev) => [...prev, { id: folder.id, name: folder.name || 'Dossier' }]);
    setQ('');
    await loadFolder(folder.id);
  }

  async function goCrumb(index) {
    const next = crumbs.slice(0, index + 1);
    const target = next[next.length - 1];
    setCrumbs(next);
    setFolderId(target.id);
    setQ('');
    await loadFolder(target.id);
  }

  async function search3d(query = q) {
    const term = String(query || '').trim();
    if (!term) {
      await loadFolder(folderId);
      return;
    }
    setLoading(true);
    setSearching(true);
    setErr('');
    try {
      const data = await api(`/drive/search?q=${encodeURIComponent(term)}`);
      setFiles((data.files || []).filter((f) => !f.isFolder && is3dFile(f)));
    } catch (e) {
      setErr(e.message);
      setFiles([]);
    } finally {
      setLoading(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="w-full sm:max-w-xl max-h-[90vh] flex flex-col rounded-t-2xl sm:rounded-2xl bg-white border border-neya-border shadow-lg overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-neya-border shrink-0">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-neya-ink truncate">{title}</p>
            <p className="text-[11px] text-neya-muted">Dossiers + fichiers 3D seulement (GLB, GLTF, SKP…)</p>
          </div>
          <button type="button" className="btn-ghost text-sm min-h-[36px]" onClick={onClose}>
            Fermer
          </button>
        </div>

        <div className="px-4 py-2 border-b border-neya-border space-y-2 shrink-0">
          <nav className="flex flex-wrap gap-1 text-[11px]">
            {crumbs.map((c, i) => (
              <button
                key={`${c.id}-${i}`}
                type="button"
                className="text-neya-orange hover:underline disabled:text-neya-ink disabled:no-underline"
                disabled={i === crumbs.length - 1 && !searching}
                onClick={() => goCrumb(i)}
              >
                {c.name}{i < crumbs.length - 1 ? ' /' : ''}
              </button>
            ))}
            {searching && <span className="text-neya-muted"> · résultats recherche</span>}
          </nav>
          <div className="flex gap-2">
            <input
              className="input flex-1 text-sm"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Chercher un fichier 3D…"
              onKeyDown={(e) => {
                if (e.key === 'Enter') search3d(q);
              }}
            />
            <button type="button" className="btn-secondary text-sm min-h-[40px]" disabled={loading} onClick={() => search3d(q)}>
              Chercher
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-auto min-h-[240px]">
          {loading && (
            <p className="p-6 text-sm text-neya-muted text-center">Chargement…</p>
          )}
          {!loading && err && (
            <p className="p-4 text-sm text-red-700">{err}</p>
          )}
          {!loading && !err && files.length === 0 && (
            <p className="p-6 text-sm text-neya-muted text-center">
              Aucun fichier 3D ici. Naviguez dans Production / Clients, ou cherchez « zotique », « assemblage ».
            </p>
          )}
          {!loading && !err && files.length > 0 && (
            <ul className="divide-y divide-neya-border">
              {files.map((f) => (
                <li key={f.id}>
                  {f.isFolder ? (
                    <button
                      type="button"
                      className="w-full text-left px-4 py-3 hover:bg-neya-surface/60 flex items-center gap-3"
                      onClick={() => openFolder(f)}
                    >
                      <span className="text-[10px] uppercase tracking-wide text-neya-muted shrink-0 w-14">Dossier</span>
                      <span className="text-sm font-medium text-neya-ink truncate">{f.name}</span>
                    </button>
                  ) : (
                    <div className="px-4 py-3 flex flex-wrap items-center gap-2 hover:bg-neya-surface/40">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-neya-ink truncate">{f.name}</p>
                        <p className="text-[11px] text-neya-muted">{kindLabel(f)}</p>
                      </div>
                      <button
                        type="button"
                        className="btn-primary text-xs min-h-[32px]"
                        onClick={() => onPick(f)}
                      >
                        Sélectionner
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

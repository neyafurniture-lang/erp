'use client';

import { useRef, useState } from 'react';
import { api, getApiUrl, getToken, resolveUploadUrl } from '../lib/api';
import { parseProjectMeta } from '../lib/project-products';
import UploadFilePreview from './UploadFilePreview';

async function downloadSketchup(projectId, file) {
  const token = getToken();
  const res = await fetch(
    `${getApiUrl()}/projects/${projectId}/sketchup/${encodeURIComponent(file.id)}/download`,
    { headers: token ? { Authorization: `Bearer ${token}` } : {} }
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Erreur ${res.status}`);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name || 'modele.skp';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export default function ProjectPlansPanel({ project, onReload }) {
  const inputRef = useRef(null);
  const skpRef = useRef(null);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [preview, setPreview] = useState(null);
  const [skpViewer, setSkpViewer] = useState(null);

  const meta = parseProjectMeta(project.meta);
  const plans = Array.isArray(meta.plans) ? meta.plans : [];
  const sketchupFiles = Array.isArray(meta.sketchup_files) ? meta.sketchup_files : [];

  async function importPdf(file) {
    if (!file) return;
    setBusy('import');
    setErr('');
    setOk('');
    try {
      const fd = new FormData();
      fd.append('pdf', file);
      const res = await api(`/projects/${project.id}/plans/import`, { method: 'POST', body: fd });
      setOk(`${res.plans?.length || 0} plan(s) importé(s).`);
      onReload?.();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy('');
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  async function uploadSkp(file) {
    if (!file) return;
    setBusy('skp');
    setErr('');
    setOk('');
    try {
      const fd = new FormData();
      fd.append('skp', file);
      const res = await api(`/projects/${project.id}/sketchup`, { method: 'POST', body: fd });
      setOk(`SketchUp « ${res.file?.name || file.name} » ajouté.`);
      onReload?.();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy('');
      if (skpRef.current) skpRef.current.value = '';
    }
  }

  async function viewSkp(file) {
    setErr('');
    setBusy(`view-${file.id}`);
    try {
      const embed = await api(`/projects/${project.id}/sketchup/${encodeURIComponent(file.id)}/embed`);
      setSkpViewer({
        name: file.name,
        viewerUrl: embed.viewer_url,
        note: embed.note,
        file,
      });
      if (embed.note) setOk(embed.note);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy('');
    }
  }

  async function openSkpDownload(file) {
    setErr('');
    try {
      await downloadSketchup(project.id, file);
      setOk(`Téléchargement de « ${file.name} » — ouvrez avec SketchUp desktop si besoin.`);
    } catch (e) {
      setErr(e.message);
    }
  }

  async function removeSkp(file) {
    if (!confirm(`Retirer « ${file.name} » du projet ?`)) return;
    setBusy(`del-${file.id}`);
    setErr('');
    try {
      await api(`/projects/${project.id}/sketchup/${encodeURIComponent(file.id)}`, { method: 'DELETE' });
      setOk('Fichier SketchUp retiré.');
      onReload?.();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy('');
    }
  }

  return (
    <div className="space-y-8">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-neya-ink">Plans 2D</p>
            <p className="text-xs text-neya-muted mt-0.5">
              Feuilles extraites du PDF — une page par plan, accessible dans le projet.
            </p>
          </div>
          <div className="flex gap-2">
            <input
              ref={inputRef}
              type="file"
              accept="application/pdf,.pdf"
              className="hidden"
              onChange={e => importPdf(e.target.files?.[0])}
            />
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={!!busy}
              className="btn-primary text-sm min-h-[36px] disabled:opacity-40"
            >
              {busy === 'import' ? 'Import…' : 'Importer un PDF'}
            </button>
          </div>
        </div>

        {err && (
          <div className="text-sm text-red-700 bg-red-50 border border-red-200 px-4 py-3">{err}</div>
        )}
        {ok && (
          <div className="text-sm text-green-800 bg-green-50 border border-green-200 px-4 py-3">{ok}</div>
        )}

        {plans.length === 0 ? (
          <div className="card-flat py-8 text-center text-sm text-neya-muted">
            Aucun plan 2D — importez un PDF de plans (ex. shop drawings) pour le découper en pages.
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {plans.map(plan => (
              <button
                key={plan.id || plan.url}
                type="button"
                onClick={() => setPreview(plan)}
                className="card-flat p-0 overflow-hidden text-left hover:ring-2 hover:ring-neya-orange/40 transition-shadow"
              >
                <div className="aspect-[4/3] bg-neya-surface border-b border-neya-border">
                  <UploadFilePreview
                    url={plan.url}
                    title={plan.name}
                    compact
                    className="w-full h-full pointer-events-none"
                  />
                </div>
                <div className="px-3 py-2">
                  <p className="text-sm font-medium text-neya-ink truncate">{plan.name}</p>
                  <p className="text-xs text-neya-muted">Page {plan.page}</p>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-4 border-t border-neya-border pt-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-neya-ink">Fichiers SketchUp (.skp)</p>
            <p className="text-xs text-neya-muted mt-0.5">
              Visualisation + mesure dans le navigateur (viewer InnerScene) — ou téléchargement SketchUp desktop.
            </p>
          </div>
          <div>
            <input
              ref={skpRef}
              type="file"
              accept=".skp,application/vnd.sketchup.skp,application/octet-stream"
              className="hidden"
              onChange={e => uploadSkp(e.target.files?.[0])}
            />
            <button
              type="button"
              onClick={() => skpRef.current?.click()}
              disabled={!!busy}
              className="btn-secondary text-sm min-h-[36px] disabled:opacity-40"
            >
              {busy === 'skp' ? 'Upload…' : 'Ajouter un .skp'}
            </button>
          </div>
        </div>

        {sketchupFiles.length === 0 ? (
          <div className="card-flat py-6 text-center text-sm text-neya-muted">
            Aucun fichier SketchUp — ajoutez un .skp reçu du client ou de l’atelier.
          </div>
        ) : (
          <ul className="space-y-2">
            {sketchupFiles.map(file => (
              <li
                key={file.id || file.url}
                className="flex flex-wrap items-center gap-3 rounded-lg border border-neya-border bg-white px-3 py-2.5"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-neya-surface text-xs font-bold text-neya-ink">
                  SKP
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-neya-ink">{file.name}</p>
                  <p className="text-xs text-neya-muted">
                    {file.size_label || ''}
                    {file.uploaded_at ? ` · ${new Date(file.uploaded_at).toLocaleDateString('fr-CA')}` : ''}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => viewSkp(file)}
                    disabled={busy === `view-${file.id}`}
                    className="btn-primary text-xs min-h-[32px] disabled:opacity-40"
                  >
                    {busy === `view-${file.id}` ? '…' : 'Voir / mesurer'}
                  </button>
                  <button
                    type="button"
                    onClick={() => openSkpDownload(file)}
                    className="btn-secondary text-xs min-h-[32px]"
                  >
                    Télécharger
                  </button>
                  <button
                    type="button"
                    onClick={() => removeSkp(file)}
                    disabled={busy === `del-${file.id}`}
                    className="btn-secondary text-xs min-h-[32px] disabled:opacity-40"
                  >
                    Retirer
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {preview && (
        <div
          className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
          onClick={() => setPreview(null)}
        >
          <div
            className="bg-white w-full max-w-5xl max-h-[90vh] rounded-xl overflow-hidden shadow-xl flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-neya-border gap-3">
              <p className="text-sm font-semibold text-neya-ink truncate min-w-0">{preview.name}</p>
              <div className="flex items-center gap-2 shrink-0">
                <a
                  href={resolveUploadUrl(preview.url) || '#'}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-neya-orange hover:underline"
                >
                  Nouvel onglet
                </a>
                <button type="button" onClick={() => setPreview(null)} className="text-sm text-neya-muted hover:text-neya-ink">
                  Fermer
                </button>
              </div>
            </div>
            <div className="w-full flex-1 min-h-[70vh] bg-neya-surface">
              <UploadFilePreview
                url={preview.url}
                title={preview.name}
                pdfHash="toolbar=1&navpanes=0"
                className="w-full h-full min-h-[70vh]"
              />
            </div>
          </div>
        </div>
      )}

      {skpViewer && (
        <div
          className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-2 sm:p-4"
          onClick={() => setSkpViewer(null)}
        >
          <div
            className="bg-white w-full max-w-6xl h-[92vh] rounded-xl overflow-hidden shadow-xl flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-neya-border shrink-0">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-neya-ink truncate">{skpViewer.name}</p>
                <p className="text-[11px] text-neya-muted">
                  Viewer InnerScene — orbit / zoom / règle de mesure
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="btn-secondary text-xs min-h-[32px]"
                  onClick={() => openSkpDownload(skpViewer.file)}
                >
                  Télécharger .skp
                </button>
                <a
                  href={skpViewer.viewerUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-secondary text-xs min-h-[32px] inline-flex items-center"
                >
                  Nouvel onglet
                </a>
                <button
                  type="button"
                  onClick={() => setSkpViewer(null)}
                  className="text-sm text-neya-muted hover:text-neya-ink px-2"
                >
                  Fermer
                </button>
              </div>
            </div>
            {skpViewer.note && (
              <p className="px-4 py-2 text-xs text-amber-800 bg-amber-50 border-b border-amber-100">
                {skpViewer.note}
              </p>
            )}
            <iframe
              title={`SketchUp — ${skpViewer.name}`}
              src={skpViewer.viewerUrl}
              className="w-full flex-1 min-h-0 border-0"
              allow="fullscreen"
              allowFullScreen
            />
          </div>
        </div>
      )}
    </div>
  );
}

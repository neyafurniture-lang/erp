'use client';

import { useEffect, useState } from 'react';
import { getApiUrl, getToken } from '../lib/api';

const GOOGLE_APP_TYPES = new Set([
  'application/vnd.google-apps.document',
  'application/vnd.google-apps.spreadsheet',
  'application/vnd.google-apps.presentation',
  'application/vnd.google-apps.drawing',
]);

export function getPreviewMode(file) {
  if (!file || file.isFolder) return null;
  const mime = file.mimeType || '';
  if (GOOGLE_APP_TYPES.has(mime)) return 'google';
  if (mime.startsWith('image/')) return 'image';
  if (mime === 'application/pdf') return 'pdf';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('text/') || mime === 'application/json' || mime === 'application/xml') return 'text';
  return null;
}

export function canPreview(file) {
  return !!getPreviewMode(file);
}

function previewUrl(fileId) {
  return `${getApiUrl()}/drive/files/${fileId}/preview`;
}

export default function DriveFilePreview({ file, onClose }) {
  const [blobUrl, setBlobUrl] = useState(null);
  const [textContent, setTextContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const mode = getPreviewMode(file);

  useEffect(() => {
    if (!file?.id || !mode) return undefined;
    let revoked = false;
    let objectUrl = null;

    async function load() {
      setLoading(true);
      setErr('');
      setTextContent('');
      setBlobUrl(null);

      if (mode === 'google') {
        setLoading(false);
        return;
      }

      try {
        const res = await fetch(previewUrl(file.id), {
          headers: { Authorization: `Bearer ${getToken()}` },
        });
        if (!res.ok) throw new Error('Impossible de charger l’aperçu');

        if (mode === 'text') {
          const text = await res.text();
          if (!revoked) {
            setTextContent(text.length > 120000 ? `${text.slice(0, 120000)}\n\n… (fichier tronqué)` : text);
          }
        } else {
          const blob = await res.blob();
          objectUrl = URL.createObjectURL(blob);
          if (!revoked) setBlobUrl(objectUrl);
        }
      } catch (e) {
        if (!revoked) setErr(e.message);
      } finally {
        if (!revoked) setLoading(false);
      }
    }

    load();
    return () => {
      revoked = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [file?.id, mode]);

  if (!file || !mode) return null;

  return (
    <div className="drive-preview">
      <div className="drive-preview-header">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-neya-ink truncate">{file.name}</p>
          <p className="text-[11px] text-neya-muted">Aperçu</p>
        </div>
        {onClose && (
          <button type="button" onClick={onClose} className="drive-icon-btn shrink-0" aria-label="Fermer l’aperçu">
            ✕
          </button>
        )}
      </div>

      <div className="drive-preview-body">
        {loading && (
          <div className="flex flex-col items-center justify-center h-full gap-3">
            <div className="w-6 h-6 border-2 border-neya-border border-t-neya-ink rounded-full animate-spin" />
            <p className="text-sm text-neya-muted">Chargement de l’aperçu…</p>
          </div>
        )}

        {!loading && err && (
          <div className="flex flex-col items-center justify-center h-full px-6 text-center">
            <p className="text-sm text-red-700 mb-3">{err}</p>
            {file.webViewLink && (
              <a href={file.webViewLink} target="_blank" rel="noopener noreferrer" className="btn-secondary text-sm min-h-[40px]">
                Ouvrir dans Google Drive
              </a>
            )}
          </div>
        )}

        {!loading && !err && mode === 'google' && (
          <iframe
            title={file.name}
            src={`https://drive.google.com/file/d/${file.id}/preview`}
            className="w-full h-full border-0 bg-white"
            allow="autoplay"
          />
        )}

        {!loading && !err && mode === 'image' && blobUrl && (
          <div className="flex items-center justify-center h-full p-4 bg-neya-surface/30">
            <img src={blobUrl} alt={file.name} className="max-w-full max-h-full object-contain rounded-lg shadow-sm" />
          </div>
        )}

        {!loading && !err && mode === 'pdf' && blobUrl && (
          <iframe title={file.name} src={blobUrl} className="w-full h-full border-0 bg-white" />
        )}

        {!loading && !err && mode === 'video' && blobUrl && (
          <div className="flex items-center justify-center h-full p-4 bg-black/90">
            <video src={blobUrl} controls className="max-w-full max-h-full rounded-lg" playsInline>
              Votre navigateur ne supporte pas la lecture vidéo.
            </video>
          </div>
        )}

        {!loading && !err && mode === 'audio' && blobUrl && (
          <div className="flex flex-col items-center justify-center h-full p-8 gap-4">
            <p className="text-sm text-neya-muted">Fichier audio</p>
            <audio src={blobUrl} controls className="w-full max-w-md" />
          </div>
        )}

        {!loading && !err && mode === 'text' && (
          <pre className="h-full overflow-auto p-4 text-xs sm:text-sm leading-relaxed text-neya-ink bg-neya-surface/20 whitespace-pre-wrap break-words font-mono">
            {textContent}
          </pre>
        )}
      </div>
    </div>
  );
}

'use client';

import { useEffect, useMemo, useState } from 'react';
import { getApiUrl, getToken } from '../lib/api';
import {
  canPreview,
  driveFilePreviewUrl,
  getPreviewMode,
  googleEmbedUrl,
  isSpreadsheetMime,
  parseCsvPreview,
} from '../lib/drive-preview';

export { canPreview, getPreviewMode, googleEmbedUrl, isSpreadsheetMime, parseCsvPreview };

function previewUrl(fileId) {
  return `${getApiUrl()}/drive/files/${fileId}/preview`;
}

function CsvTable({ text }) {
  const rows = useMemo(() => parseCsvPreview(text), [text]);
  if (!rows.length) {
    return <p className="p-4 text-sm text-neya-muted">CSV vide</p>;
  }
  const colCount = Math.max(...rows.map((r) => r.length), 1);
  const header = rows[0];
  const body = rows.slice(1);

  return (
    <div className="h-full overflow-auto">
      <table className="drive-csv-table">
        <thead>
          <tr>
            {Array.from({ length: colCount }, (_, i) => (
              <th key={i}>{header[i] ?? ''}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((r, ri) => (
            <tr key={ri}>
              {Array.from({ length: colCount }, (_, i) => (
                <td key={i}>{r[i] ?? ''}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length >= 200 && (
        <p className="px-3 py-2 text-[11px] text-neya-muted border-t border-neya-border">
          Aperçu limité aux 200 premières lignes.
        </p>
      )}
    </div>
  );
}

export default function DriveFilePreview({ file, onClose }) {
  const [blobUrl, setBlobUrl] = useState(null);
  const [textContent, setTextContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const mode = getPreviewMode(file);
  const isSheet = isSpreadsheetMime(file?.mimeType, file?.name);

  const embedSrc = useMemo(() => {
    if (!file?.id) return '';
    if (mode === 'google') return googleEmbedUrl(file);
    if (mode === 'office') return driveFilePreviewUrl(file.id);
    return '';
  }, [file, mode]);

  useEffect(() => {
    if (!file?.id || !mode) return undefined;
    let revoked = false;
    let objectUrl = null;

    async function load() {
      setLoading(true);
      setErr('');
      setTextContent('');
      setBlobUrl(null);

      if (mode === 'google' || mode === 'office') {
        setLoading(false);
        return;
      }

      try {
        const res = await fetch(previewUrl(file.id), {
          headers: { Authorization: `Bearer ${getToken()}` },
        });
        if (!res.ok) throw new Error('Impossible de charger l’aperçu');

        if (mode === 'text' || mode === 'csv') {
          const text = await res.text();
          if (!revoked) {
            setTextContent(text.length > 400000 ? `${text.slice(0, 400000)}\n\n… (fichier tronqué)` : text);
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
    <div className={`drive-preview ${isSheet ? 'drive-preview--sheet' : ''}`}>
      <div className="drive-preview-header">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-neya-ink truncate">{file.name}</p>
          <p className="text-[11px] text-neya-muted">
            {isSheet ? 'Aperçu tableur' : 'Aperçu'}
          </p>
        </div>
        {file.webViewLink && (
          <a
            href={file.webViewLink}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-secondary text-xs shrink-0 min-h-[32px] px-2.5"
          >
            Ouvrir
          </a>
        )}
        {onClose && (
          <button type="button" onClick={onClose} className="drive-icon-btn shrink-0" aria-label="Fermer l’aperçu">
            ✕
          </button>
        )}
      </div>

      <div className={`drive-preview-body ${isSheet ? 'drive-preview-body--sheet' : ''}`}>
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

        {!loading && !err && (mode === 'google' || mode === 'office') && (
          <iframe
            title={file.name}
            src={embedSrc}
            className="w-full h-full border-0 bg-white"
            allow="autoplay; fullscreen"
            referrerPolicy="no-referrer-when-downgrade"
          />
        )}

        {!loading && !err && mode === 'csv' && (
          <CsvTable text={textContent} />
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

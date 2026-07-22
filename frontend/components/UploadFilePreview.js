'use client';

import { useEffect, useState } from 'react';
import { fetchUploadObjectUrl, resolveUploadUrl, uploadPreviewMode } from '../lib/api';

/**
 * Aperçu d’un fichier /uploads (PDF, image, vidéo…) via blob URL.
 * Contourne X-Frame-Options: DENY sur /uploads.
 */
export default function UploadFilePreview({
  url,
  title = 'Aperçu',
  className = 'w-full h-full',
  compact = false,
  pdfHash = 'toolbar=0&navpanes=0',
}) {
  const [blobUrl, setBlobUrl] = useState(null);
  const [mode, setMode] = useState(() => uploadPreviewMode(url));
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!url) {
      setLoading(false);
      setErr('Fichier manquant');
      return undefined;
    }

    let revoked = false;
    let objectUrl = null;

    async function load() {
      setLoading(true);
      setErr('');
      setBlobUrl(null);
      try {
        const guessed = uploadPreviewMode(url);
        if (guessed === 'download') {
          // Pas d’aperçu inline — garder le lien direct
          if (!revoked) {
            setMode('download');
            setLoading(false);
          }
          return;
        }
        const result = await fetchUploadObjectUrl(url);
        objectUrl = result.objectUrl;
        const nextMode = uploadPreviewMode(url, result.mime) || guessed;
        if (!revoked) {
          setMode(nextMode);
          setBlobUrl(objectUrl);
        } else {
          URL.revokeObjectURL(objectUrl);
        }
      } catch (e) {
        if (!revoked) setErr(e.message || 'Aperçu impossible');
      } finally {
        if (!revoked) setLoading(false);
      }
    }

    load();
    return () => {
      revoked = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url]);

  if (loading) {
    return (
      <div className={`grid place-items-center bg-neya-surface text-xs text-neya-muted ${className}`}>
        Chargement…
      </div>
    );
  }

  if (err) {
    return (
      <div className={`grid place-items-center bg-neya-surface px-2 text-center text-xs text-neya-muted ${className}`}>
        <span>{compact ? 'Aperçu indisponible' : err}</span>
      </div>
    );
  }

  if (mode === 'image' && blobUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={blobUrl} alt={title} className={`object-contain bg-white ${className}`} />
    );
  }

  if (mode === 'pdf' && blobUrl) {
    const src = pdfHash ? `${blobUrl}#${pdfHash}` : blobUrl;
    return (
      <iframe
        title={title}
        src={src}
        className={`border-0 bg-white ${className}`}
      />
    );
  }

  if (mode === 'video' && blobUrl) {
    return (
      <video src={blobUrl} controls className={`bg-black ${className}`} />
    );
  }

  const href = resolveUploadUrl(url);
  return (
    <div className={`grid place-items-center bg-neya-surface ${className}`}>
      <a
        href={href || '#'}
        target="_blank"
        rel="noopener noreferrer"
        className="text-xs text-neya-orange hover:underline"
        onClick={e => e.stopPropagation()}
      >
        Ouvrir le fichier
      </a>
    </div>
  );
}

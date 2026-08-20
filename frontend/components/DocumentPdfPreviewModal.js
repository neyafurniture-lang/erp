'use client';

import { useEffect, useState } from 'react';
import { fetchPdfObjectUrl, downloadPdf } from '../lib/api';

/**
 * Prévisualisation PDF interne (devis / facture) — sans envoi courriel.
 */
export default function DocumentPdfPreviewModal({
  type = 'invoice',
  docId,
  title,
  filename,
  onClose,
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [pdfUrl, setPdfUrl] = useState(null);
  const [downloading, setDownloading] = useState(false);

  const pdfPath = type === 'quote'
    ? `/invoices/quotes/${docId}/pdf`
    : `/invoices/${docId}/pdf`;
  const kindLabel = type === 'quote' ? 'Devis' : 'Facture';
  const displayTitle = title || `Aperçu ${kindLabel.toLowerCase()}`;
  const downloadName = filename
    || (type === 'quote' ? `devis-${docId}.pdf` : `facture-${docId}.pdf`);

  useEffect(() => {
    let cancelled = false;
    let url = null;
    (async () => {
      setLoading(true);
      setError('');
      try {
        url = await fetchPdfObjectUrl(pdfPath);
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        setPdfUrl(url);
      } catch (err) {
        if (!cancelled) setError(err.message || 'Impossible de charger l’aperçu PDF');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [pdfPath]);

  useEffect(() => () => {
    if (pdfUrl) URL.revokeObjectURL(pdfUrl);
  }, [pdfUrl]);

  async function handleDownload() {
    setDownloading(true);
    try {
      await downloadPdf(pdfPath, downloadName);
    } catch (err) {
      setError(err.message || 'Téléchargement impossible');
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/45 flex items-center justify-center p-2 sm:p-4" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-5xl max-h-[96vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-4 sm:px-5 py-3 border-b border-neya-border flex flex-wrap items-start justify-between gap-3 shrink-0">
          <div>
            <h3 className="font-heading text-lg text-neya-ink">Prévisualisation</h3>
            <p className="text-sm text-neya-muted mt-0.5">{displayTitle}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {pdfUrl && (
              <a
                href={pdfUrl}
                target="_blank"
                rel="noreferrer"
                className="btn-secondary text-sm min-h-[36px]"
              >
                Ouvrir en grand
              </a>
            )}
            <button
              type="button"
              onClick={handleDownload}
              disabled={downloading || loading || !!error}
              className="btn-secondary text-sm min-h-[36px] disabled:opacity-40"
            >
              {downloading ? 'PDF…' : 'Télécharger'}
            </button>
            <button type="button" className="text-neya-muted hover:text-neya-ink text-sm px-2" onClick={onClose}>
              Fermer
            </button>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-hidden bg-neya-surface/40">
          {error && (
            <p className="m-4 text-sm text-neya-error bg-red-50 border border-red-100 rounded-lg px-3 py-2">
              {error}
            </p>
          )}
          {loading && (
            <p className="px-5 py-10 text-sm text-neya-muted">Chargement de l’aperçu PDF…</p>
          )}
          {!loading && !error && pdfUrl && (
            <iframe
              title={displayTitle}
              src={`${pdfUrl}#toolbar=1&navpanes=0`}
              className="w-full h-[min(80vh,720px)] bg-white border-0"
            />
          )}
        </div>
      </div>
    </div>
  );
}

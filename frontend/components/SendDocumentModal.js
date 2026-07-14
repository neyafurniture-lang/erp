'use client';

import { useEffect, useState } from 'react';
import { api, fetchPdfObjectUrl } from '../lib/api';

const STEPS = [
  { id: 'preview', label: '1. Aperçu PDF' },
  { id: 'edit', label: '2. Courriel' },
  { id: 'confirm', label: '3. Confirmation' },
];

/**
 * Envoi PDF : aperçu complet → brouillon courriel → confirmation.
 */
export default function SendDocumentModal({ type, docId, onClose, onSent }) {
  const [step, setStep] = useState('preview');
  const [loading, setLoading] = useState(true);
  const [pdfLoading, setPdfLoading] = useState(true);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState(null);
  const [form, setForm] = useState({ to: '', subject: '', text: '' });
  const [result, setResult] = useState(null);
  const [pdfUrl, setPdfUrl] = useState(null);

  const previewPath = type === 'quote'
    ? `/invoices/quotes/${docId}/send-preview`
    : `/invoices/${docId}/send-preview`;
  const sendPath = type === 'quote'
    ? `/invoices/quotes/${docId}/send`
    : `/invoices/${docId}/send`;
  const pdfPath = type === 'quote'
    ? `/invoices/quotes/${docId}/pdf`
    : `/invoices/${docId}/pdf`;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setPdfLoading(true);
      setError('');
      try {
        const [d, url] = await Promise.all([
          api(previewPath),
          fetchPdfObjectUrl(pdfPath).catch((err) => {
            throw new Error(err.message || 'Impossible de charger l’aperçu PDF');
          }),
        ]);
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        setDraft(d);
        setForm({ to: d.to || '', subject: d.subject || '', text: d.text || '' });
        setPdfUrl(url);
      } catch (err) {
        if (!cancelled) setError(err.message || 'Impossible de préparer l’envoi');
      } finally {
        if (!cancelled) {
          setLoading(false);
          setPdfLoading(false);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [previewPath, pdfPath]);

  useEffect(() => () => {
    if (pdfUrl) URL.revokeObjectURL(pdfUrl);
  }, [pdfUrl]);

  function goEditFromPreview() {
    setError('');
    setStep('edit');
  }

  function goConfirm(e) {
    e?.preventDefault?.();
    setError('');
    if (!String(form.to).trim()) {
      setError('Indiquez l’adresse courriel du destinataire.');
      return;
    }
    if (!String(form.subject).trim()) {
      setError('L’objet du message est requis.');
      return;
    }
    if (!String(form.text).trim()) {
      setError('Le message ne peut pas être vide.');
      return;
    }
    setStep('confirm');
  }

  async function confirmSend() {
    setStep('sending');
    setError('');
    try {
      const res = await api(sendPath, {
        method: 'POST',
        body: JSON.stringify({
          to: form.to.trim(),
          subject: form.subject.trim(),
          text: form.text.trim(),
          confirmed: true,
        }),
      });
      setResult(res);
      setStep('done');
      onSent?.(res);
    } catch (err) {
      setError(err.message || 'Envoi impossible');
      setStep('confirm');
    }
  }

  const kindLabel = draft?.kind_label?.toLowerCase() || (type === 'quote' ? 'devis' : 'facture');

  return (
    <div className="fixed inset-0 z-50 bg-black/45 flex items-center justify-center p-2 sm:p-4" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-6xl max-h-[96vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-4 sm:px-5 py-3 border-b border-neya-border flex flex-wrap items-start justify-between gap-3 shrink-0">
          <div>
            <h3 className="font-heading text-lg text-neya-ink">
              Envoyer {kindLabel}
            </h3>
            <p className="text-sm text-neya-muted mt-0.5">
              {draft?.number ? `${draft.kind_label} ${draft.number}` : 'Aperçu du document, puis courriel.'}
              {draft?.client_name ? ` · ${draft.client_name}` : ''}
            </p>
          </div>
          <button type="button" className="text-neya-muted hover:text-neya-ink text-sm" onClick={onClose}>
            Fermer
          </button>
        </div>

        {/* Étapes */}
        {step !== 'done' && step !== 'sending' && (
          <div className="px-4 sm:px-5 py-2 border-b border-neya-border flex flex-wrap gap-2 sm:gap-4 text-xs sm:text-sm shrink-0">
            {STEPS.map((s) => {
              const active = step === s.id;
              const done = STEPS.findIndex(x => x.id === step) > STEPS.findIndex(x => x.id === s.id);
              return (
                <span
                  key={s.id}
                  className={`font-medium ${active ? 'text-neya-orange' : done ? 'text-neya-ink' : 'text-neya-muted'}`}
                >
                  {s.label}
                </span>
              );
            })}
          </div>
        )}

        <div className="flex-1 min-h-0 overflow-y-auto">
          {error && (
            <p className="mx-4 sm:mx-5 mt-3 text-sm text-neya-error bg-red-50 border border-red-100 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          {(loading || pdfLoading) && (
            <p className="px-5 py-8 text-sm text-neya-muted">Chargement de l’aperçu complet…</p>
          )}

          {!loading && !pdfLoading && draft && (step === 'preview' || step === 'edit' || step === 'confirm') && (
            <div className="grid lg:grid-cols-2 gap-0 lg:min-h-[70vh]">
              {/* Aperçu PDF complet */}
              <div className="border-b lg:border-b-0 lg:border-r border-neya-border bg-neya-surface/40 flex flex-col min-h-[45vh] lg:min-h-0">
                <div className="px-4 py-2 flex items-center justify-between gap-2 border-b border-neya-border bg-white/80">
                  <p className="text-xs font-semibold uppercase tracking-wide text-neya-muted">
                    Aperçu du PDF
                  </p>
                  {pdfUrl && (
                    <a
                      href={pdfUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-neya-orange hover:underline"
                    >
                      Ouvrir en grand
                    </a>
                  )}
                </div>
                <div className="flex-1 min-h-[40vh] lg:min-h-0 p-2">
                  {pdfUrl ? (
                    <iframe
                      title={`Aperçu ${draft.filename}`}
                      src={`${pdfUrl}#toolbar=1&navpanes=0`}
                      className="w-full h-full min-h-[40vh] lg:min-h-[calc(70vh-2.5rem)] rounded border border-neya-border bg-white"
                    />
                  ) : (
                    <p className="text-sm text-neya-muted p-4">Aperçu indisponible.</p>
                  )}
                </div>
                <p className="px-4 py-2 text-[11px] text-neya-muted border-t border-neya-border">
                  Pièce jointe : {draft.filename}
                </p>
              </div>

              {/* Panneau droit selon l’étape */}
              <div className="p-4 sm:p-5 flex flex-col">
                {step === 'preview' && (
                  <div className="space-y-4 my-auto">
                    <p className="text-sm text-neya-ink leading-relaxed">
                      Vérifiez le document complet ci-contre. Si tout est bon, préparez le courriel d’envoi.
                    </p>
                    {draft.warning && (
                      <p className="text-sm text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                        {draft.warning}
                      </p>
                    )}
                    <div className="flex flex-wrap gap-2">
                      <button type="button" className="btn-primary" onClick={goEditFromPreview}>
                        Continuer vers le courriel →
                      </button>
                      <button type="button" className="btn-secondary" onClick={onClose}>
                        Annuler
                      </button>
                    </div>
                  </div>
                )}

                {step === 'edit' && (
                  <form onSubmit={goConfirm} className="space-y-3">
                    {draft.warning && (
                      <p className="text-sm text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                        {draft.warning}
                      </p>
                    )}
                    <div>
                      <label className="label">Destinataire</label>
                      <input
                        className="input"
                        type="email"
                        required
                        value={form.to}
                        onChange={e => setForm(f => ({ ...f, to: e.target.value }))}
                        placeholder="client@exemple.com"
                      />
                    </div>
                    <div>
                      <label className="label">Objet</label>
                      <input
                        className="input"
                        required
                        value={form.subject}
                        onChange={e => setForm(f => ({ ...f, subject: e.target.value }))}
                      />
                    </div>
                    <div>
                      <label className="label">Message</label>
                      <textarea
                        className="input min-h-[160px] font-sans text-sm"
                        required
                        value={form.text}
                        onChange={e => setForm(f => ({ ...f, text: e.target.value }))}
                      />
                    </div>
                    <div className="flex flex-wrap gap-2 pt-1">
                      <button type="button" className="btn-secondary" onClick={() => setStep('preview')}>
                        ← Aperçu
                      </button>
                      <button type="submit" className="btn-primary">Continuer →</button>
                      <button type="button" className="btn-secondary" onClick={onClose}>Annuler</button>
                    </div>
                  </form>
                )}

                {step === 'confirm' && (
                  <div className="space-y-4">
                    <p className="text-sm text-neya-ink">
                      Dernière vérification : le PDF affiché à gauche sera joint tel quel.
                    </p>
                    <div className="rounded-lg border border-neya-border bg-neya-surface/50 p-3 text-sm space-y-2">
                      <div><span className="text-neya-muted">À :</span> <span className="font-medium">{form.to}</span></div>
                      <div><span className="text-neya-muted">Objet :</span> <span className="font-medium">{form.subject}</span></div>
                      <div><span className="text-neya-muted">Pièce jointe :</span> <span className="font-medium">{draft.filename}</span></div>
                      <pre className="mt-2 whitespace-pre-wrap text-xs text-neya-ink/90 font-sans border-t border-neya-border pt-2 max-h-40 overflow-y-auto">
                        {form.text}
                      </pre>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button type="button" className="btn-secondary" onClick={() => setStep('edit')}>
                        ← Modifier le courriel
                      </button>
                      <button type="button" className="btn-primary" onClick={confirmSend}>
                        Confirmer l’envoi
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {step === 'sending' && (
            <p className="px-5 py-10 text-sm text-neya-muted">Envoi en cours…</p>
          )}

          {step === 'done' && (
            <div className="px-5 py-10 space-y-3">
              <p className="text-sm text-neya-success font-medium">
                {result?.message || 'Message envoyé.'}
              </p>
              <button type="button" className="btn-primary" onClick={onClose}>
                Fermer
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

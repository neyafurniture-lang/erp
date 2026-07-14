'use client';

import CopyTextButton from './CopyTextButton';

const PHASE_LABELS = {
  recording: 'Enregistrement…',
  reviewing: 'Vérifier la transcription',
  planning: 'Création du plan…',
  plan_ready: 'Plan d\'opérations',
  executing: 'Exécution…',
  done: 'Terminé',
};

export default function VoicePlanCard({
  phase,
  transcript,
  interim,
  plan,
  reply,
  contextLabel,
  onTranscriptChange,
  onStopRecording,
  onCancel,
  onBuildPlan,
  onConfirmPlan,
  onOpenChat,
}) {
  if (!phase) return null;

  const livePreview = [transcript, interim].filter(Boolean).join(' ').trim();

  return (
    <div
      className="fixed z-[62] left-3 right-[4.75rem] bottom-[calc(var(--dock-clearance)+0.5rem)] lg:left-auto lg:right-28 lg:bottom-28 lg:max-w-md lg:w-[min(440px,calc(100vw-12rem))] animate-voice-card-in"
      role="status"
      aria-live="polite"
    >
      <div className="voice-response-card rounded p-4 border border-neya-border shadow-sm max-h-[70vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-2 mb-3">
          <div className="flex items-center gap-2 min-w-0">
            <span className={`w-1.5 h-1.5 shrink-0 ${
              phase === 'recording' || phase === 'planning' || phase === 'executing'
                ? 'bg-neya-ink animate-pulse'
                : 'bg-neya-muted'
            }`} />
            <span className="text-[11px] font-medium text-neya-ink truncate">
              {PHASE_LABELS[phase] || 'Assistant'}
            </span>
            {contextLabel && (
              <span className="text-[10px] px-1.5 py-0.5 border border-neya-border bg-neya-surface text-neya-muted truncate max-w-[100px]">
                {contextLabel}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="text-neya-muted hover:text-neya-ink text-lg leading-none shrink-0 w-8 h-8 flex items-center justify-center"
            aria-label="Fermer"
          >
            ×
          </button>
        </div>

        <div className="flex gap-1 mb-3">
          {['recording', 'reviewing', 'planning', 'plan_ready', 'executing'].map((p, i) => {
            const order = ['recording', 'reviewing', 'planning', 'plan_ready', 'executing', 'done'];
            const current = order.indexOf(phase);
            return (
              <div
                key={p}
                className={`h-0.5 flex-1 ${i <= current ? 'bg-neya-ink' : 'bg-neya-border'}`}
              />
            );
          })}
        </div>

        {phase === 'recording' && (
          <div className="space-y-3">
            <p className="text-sm text-neya-muted">
              Parlez librement. Appuyez sur <strong className="text-neya-ink">Stop</strong> pour garder tout le texte.
            </p>
            <div className="min-h-[72px] rounded border border-neya-border bg-neya-surface px-3 py-2 text-sm text-neya-ink">
              {livePreview || <span className="text-neya-muted italic">En écoute…</span>}
              {interim ? <span className="text-neya-muted"> ▌</span> : null}
            </div>
            <button type="button" onClick={onStopRecording} className="btn-primary w-full">
              ⏹ Stop — terminer l&apos;enregistrement
            </button>
          </div>
        )}

        {phase === 'reviewing' && (
          <div className="space-y-3">
            <p className="text-xs text-neya-muted">Corrigez si besoin, puis créez le plan.</p>
            <textarea
              className="input text-sm min-h-[100px] resize-none"
              value={transcript}
              onChange={e => onTranscriptChange(e.target.value)}
              placeholder="Votre demande…"
            />
            <div className="flex gap-2">
              <button type="button" onClick={onCancel} className="btn-secondary flex-1">Annuler</button>
              <button
                type="button"
                onClick={onBuildPlan}
                disabled={!transcript.trim()}
                className="btn-primary flex-1 disabled:opacity-40"
              >
                Créer le plan →
              </button>
            </div>
          </div>
        )}

        {phase === 'planning' && (
          <div className="flex items-center gap-2 text-sm text-neya-muted py-4">
            <span className="voice-dots flex gap-1"><span /><span /><span /></span>
            Construction du plan d&apos;opérations…
          </div>
        )}

        {phase === 'plan_ready' && plan && (
          <div className="space-y-3">
            {plan.transcript && (
              <p className="text-xs text-neya-muted">
                <span className="font-medium text-neya-ink">Demande :</span> {plan.transcript}
              </p>
            )}
            <p className="text-sm font-medium text-neya-ink">{plan.summary}</p>
            <ol className="space-y-2">
              {(plan.steps || []).map(step => (
                <li key={step.id} className="text-sm bg-white border border-neya-border px-3 py-2">
                  <div className="flex items-start gap-2">
                    <span className="text-neya-muted font-medium shrink-0 tabular-nums">{step.id}.</span>
                    <div className="min-w-0">
                      <p className="font-medium text-neya-ink">{step.title}</p>
                      {step.description && <p className="text-xs text-neya-muted mt-0.5">{step.description}</p>}
                      {step.action_type && (
                        <span className="inline-block mt-1 text-[10px] font-mono px-1.5 py-0.5 border border-neya-border bg-neya-surface text-neya-muted">
                          {step.action_type}
                        </span>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ol>
            <div className="flex gap-2 pt-1">
              <button type="button" onClick={onCancel} className="btn-secondary flex-1">Annuler</button>
              <button type="button" onClick={onConfirmPlan} className="btn-primary flex-1">Exécuter ✓</button>
            </div>
          </div>
        )}

        {phase === 'executing' && (
          <div className="flex items-center gap-2 text-sm text-neya-muted py-4">
            <span className="voice-dots flex gap-1"><span /><span /><span /></span>
            Exécution…
          </div>
        )}

        {phase === 'done' && (
          <div className="space-y-3">
            {reply && (
              <div className="relative">
                <div className="absolute top-0 right-0">
                  <CopyTextButton text={reply} />
                </div>
                <p className="text-sm text-neya-ink whitespace-pre-wrap pr-8">{reply}</p>
              </div>
            )}
            <button type="button" onClick={onOpenChat} className="text-xs text-neya-ink font-medium hover:underline">
              Ouvrir l&apos;historique ▴
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

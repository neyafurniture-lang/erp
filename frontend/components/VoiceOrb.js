'use client';

import { useEffect, useRef } from 'react';

const STATE_LABELS = {
  idle: 'Assistant NEYA',
  listening: 'Enregistrement… (Stop pour finir)',
  processing: 'IA en cours — naviguez librement',
  error: 'Erreur micro',
};

/** Picto NEYA via masque CSS — couleurs et proportions fidèles, sans inversion */
function NeyaPicto({ className = '' }) {
  return (
    <span
      aria-hidden
      className={`neya-picto-mask w-7 h-8 shrink-0 ${className}`}
    />
  );
}

function MicIcon({ className }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
      <rect x="9" y="2" width="6" height="11" rx="3" fill="currentColor" />
      <path d="M5 11a7 7 0 0 0 14 0" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M12 18v3M8 21h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function TextIcon({ className }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
      <path d="M4 6h16M4 12h10M4 18h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function ClipIcon({ className }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
      <path d="M8 12.5V5.5a3.5 3.5 0 0 1 7 0v9a5 5 0 0 1-10 0V8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function TextComposer({
  value,
  onChange,
  onSend,
  onClose,
  loading,
  suggestions = [],
  contextLabel,
  files = [],
  onAddFiles,
  onRemoveFile,
  fileInputRef,
  accept,
}) {
  const inputRef = useRef(null);
  const localFileRef = useRef(null);
  const attachRef = fileInputRef || localFileRef;

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  function onKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
    if (e.key === 'Escape') onClose();
  }

  return (
    <div className="voice-composer fixed z-[58] left-4 right-4 bottom-[calc(9rem+env(safe-area-inset-bottom,0px))] lg:left-auto lg:right-28 lg:bottom-28 lg:w-[min(420px,calc(100vw-12rem))] animate-voice-card-in">
      <div className="voice-response-card rounded p-4 border border-neya-border shadow-sm">
        <div className="flex items-start justify-between gap-2 mb-3">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-[11px] font-medium text-neya-ink">Écrire à l&apos;assistant</span>
            {contextLabel && (
              <span className="text-[10px] px-1.5 py-0.5 border border-neya-border bg-neya-surface text-neya-muted truncate max-w-[120px]">
                {contextLabel}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-neya-muted hover:text-neya-ink text-lg leading-none w-8 h-8 flex items-center justify-center"
            aria-label="Fermer"
          >
            ×
          </button>
        </div>

        <textarea
          ref={inputRef}
          value={value}
          onChange={e => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Ex. Demain finition banc olive, mail The NNS…"
          rows={3}
          disabled={loading}
          className="input resize-none text-sm min-h-[80px] mb-3"
        />

        {files.length > 0 && onRemoveFile && (
          <div className="flex flex-wrap gap-2 mb-3">
            {files.map((f, i) => (
              <div key={`${f.name}-${i}`} className="flex items-center gap-2 text-xs bg-neya-cream border border-neya-border rounded-lg px-2 py-1.5">
                <span className="truncate max-w-[120px]">{f.name}</span>
                <button type="button" onClick={() => onRemoveFile(i)} className="text-neya-error">×</button>
              </div>
            ))}
          </div>
        )}

        {suggestions.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-3">
            {suggestions.slice(0, 4).map(s => (
              <button
                key={s}
                type="button"
                onClick={() => onChange(s)}
                className="text-[11px] bg-white border border-neya-border hover:bg-neya-surface px-2.5 py-1 text-neya-muted"
              >
                {s}
              </button>
            ))}
          </div>
        )}

        <div className="flex justify-between items-center gap-2">
          <div>
            {onAddFiles && (
              <>
                <input
                  ref={attachRef}
                  type="file"
                  multiple
                  accept={accept}
                  className="hidden"
                  onChange={e => {
                    if (e.target.files?.length) onAddFiles(e.target.files);
                    e.target.value = '';
                  }}
                />
                <button
                  type="button"
                  onClick={() => attachRef.current?.click()}
                  className="btn-secondary h-10 px-3 text-sm inline-flex items-center gap-1.5"
                  title="Joindre un fichier"
                >
                  <ClipIcon className="w-4 h-4" />
                  Joindre
                </button>
              </>
            )}
          </div>
          <button
            type="button"
            onClick={onSend}
            disabled={loading || (!value.trim() && files.length === 0)}
            className="btn-primary h-10 px-5 disabled:opacity-40"
          >
            Envoyer
          </button>
        </div>
      </div>
    </div>
  );
}

export default function VoiceOrb({
  state = 'idle',
  menuOpen = false,
  onOrbClick,
  onSelectVoice,
  onSelectText,
  onSelectAttach,
  onCloseMenu,
  disabled,
}) {
  const isListening = state === 'listening';
  const isProcessing = state === 'processing';
  const discActive = isListening || isProcessing;

  return (
    <>
      {menuOpen && (
        <button
          type="button"
          aria-label="Fermer le menu"
          className="fixed inset-0 z-[59] bg-transparent"
          onClick={onCloseMenu}
        />
      )}

      <div className="voice-orb-container fixed z-[60] right-4 bottom-[calc(4.75rem+env(safe-area-inset-bottom,0px))] lg:right-8 lg:bottom-8">
        {menuOpen && !isListening && !isProcessing && (
          <div className="absolute bottom-[calc(100%+12px)] right-0 w-[min(240px,calc(100vw-2rem))] animate-voice-card-in">
            <div className="voice-response-card rounded p-2 border border-neya-border shadow-sm overflow-hidden">
              <p className="text-[10px] font-medium text-neya-muted px-3 pt-2 pb-1">Contacter l&apos;assistant</p>
              <button
                type="button"
                onClick={onSelectVoice}
                className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-neya-surface text-left transition-colors"
              >
                <span className="w-9 h-9 rounded border border-neya-border bg-neya-surface text-neya-ink flex items-center justify-center shrink-0">
                  <MicIcon className="w-4 h-4" />
                </span>
                <span>
                  <span className="block text-sm font-medium text-neya-ink">Parler</span>
                  <span className="block text-[11px] text-neya-muted">Enregistrer → plan → exécuter</span>
                </span>
              </button>
              <button
                type="button"
                onClick={onSelectText}
                className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-neya-surface text-left transition-colors"
              >
                <span className="w-9 h-9 rounded border border-neya-border bg-neya-surface text-neya-ink flex items-center justify-center shrink-0">
                  <TextIcon className="w-4 h-4" />
                </span>
                <span>
                  <span className="block text-sm font-medium text-neya-ink">Écrire</span>
                  <span className="block text-[11px] text-neya-muted">Saisir un message</span>
                </span>
              </button>
              {onSelectAttach && (
                <button
                  type="button"
                  onClick={onSelectAttach}
                  className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-neya-surface text-left transition-colors"
                >
                  <span className="w-9 h-9 rounded border border-neya-border bg-neya-surface text-neya-ink flex items-center justify-center shrink-0">
                    <ClipIcon className="w-4 h-4" />
                  </span>
                  <span>
                    <span className="block text-sm font-medium text-neya-ink">Joindre</span>
                    <span className="block text-[11px] text-neya-muted">Photo, PDF, plan…</span>
                  </span>
                </button>
              )}
            </div>
          </div>
        )}

        <div className="voice-orb-core relative flex items-center justify-center w-16 h-16">
          {isProcessing && (
            <span className="voice-orb-busy-pill" aria-live="polite">
              IA en cours…
            </span>
          )}
          <div
            className={`voice-orb-halo voice-orb-halo--outer ${isListening ? 'voice-orb-halo--active' : ''} ${isProcessing ? 'voice-orb-halo--processing' : ''} ${menuOpen ? 'voice-orb-halo--active' : ''}`}
            aria-hidden
          />
          <div
            className={`voice-orb-halo voice-orb-halo--inner ${isListening ? 'voice-orb-halo--active' : ''} ${isProcessing ? 'voice-orb-halo--processing' : ''} ${menuOpen ? 'voice-orb-halo--active' : ''}`}
            aria-hidden
          />
          <div
            className={`voice-orb-glow ${isListening || menuOpen || isProcessing ? 'voice-orb-glow--active' : ''}`}
            aria-hidden
          />

          <button
            type="button"
            onClick={onOrbClick}
            disabled={disabled && !isProcessing}
            aria-label={STATE_LABELS[state] || STATE_LABELS.idle}
            aria-expanded={menuOpen}
            aria-pressed={isListening}
            className="voice-orb-hit relative z-10 flex items-center justify-center w-full h-full bg-transparent border-0 p-0 cursor-pointer transition-transform active:scale-95 hover:scale-[1.03] disabled:opacity-50 disabled:cursor-not-allowed outline-none"
          >
            <span
              className={`voice-orb-disc absolute ${discActive ? 'voice-orb-disc--active' : ''} ${isProcessing ? 'voice-orb-disc--busy' : ''}`}
              aria-hidden
            />

            <span className="relative z-10 flex items-center justify-center">
              {isListening ? (
                <MicIcon className="w-6 h-6 text-white drop-shadow-sm" />
              ) : isProcessing ? (
                <span className="w-3 h-3 rounded-full bg-blue-500 animate-pulse" />
              ) : (
                <NeyaPicto />
              )}
            </span>

            {isListening && (
              <>
                <span className="voice-orb-ring voice-orb-ring--1" aria-hidden />
                <span className="voice-orb-ring voice-orb-ring--2" aria-hidden />
                <span className="voice-orb-ring voice-orb-ring--3" aria-hidden />
              </>
            )}
          </button>

          {(isListening || isProcessing) && (
            <p className="absolute -bottom-5 left-1/2 -translate-x-1/2 whitespace-nowrap text-[10px] font-medium text-neya-orange/80 animate-pulse pointer-events-none">
              {STATE_LABELS[state]}
            </p>
          )}
        </div>
      </div>
    </>
  );
}

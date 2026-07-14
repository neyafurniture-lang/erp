'use client';

import { useState } from 'react';

function CopyIcon({ className = 'w-3.5 h-3.5' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
      <rect x="9" y="9" width="11" height="11" rx="2" stroke="currentColor" strokeWidth="1.75" />
      <path d="M5 15V5a2 2 0 0 1 2-2h10" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  );
}

function CheckIcon({ className = 'w-3.5 h-3.5' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
      <path d="M5 12.5 10 17.5 19 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Bouton copie presse-papiers — pour réponses Lia */
export default function CopyTextButton({ text, className = '' }) {
  const [copied, setCopied] = useState(false);
  const value = typeof text === 'string' ? text.trim() : '';
  if (!value) return null;

  async function handleCopy(e) {
    e?.stopPropagation?.();
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* ignore */
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={`inline-flex items-center justify-center w-7 h-7 rounded-md text-neya-muted hover:text-neya-ink hover:bg-neya-surface transition-colors shrink-0 ${className}`}
      aria-label={copied ? 'Copié' : 'Copier la réponse'}
      title={copied ? 'Copié' : 'Copier'}
    >
      {copied ? <CheckIcon className="w-3.5 h-3.5 text-neya-success" /> : <CopyIcon />}
    </button>
  );
}

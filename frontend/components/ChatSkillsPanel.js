'use client';

import Link from 'next/link';

/** Lien compact vers les paramètres (skills, API, IA). */
export default function ChatSkillsPanel({ open, onClose }) {
  if (!open) return null;

  return (
    <div className="absolute right-0 bottom-full mb-1 w-64 bg-white border border-neya-border rounded-xl shadow-xl z-[60] p-4">
      <div className="flex items-center justify-between mb-3">
        <h4 className="font-heading text-sm">Skills &amp; API</h4>
        <button type="button" onClick={onClose} className="text-neya-muted hover:text-neya-ink text-lg leading-none">×</button>
      </div>
      <p className="text-xs text-neya-muted mb-3">
        Gérez les skills, la clé OpenAI et l&apos;URL API depuis les paramètres.
      </p>
      <Link
        href="/settings?tab=skills"
        onClick={onClose}
        className="btn-primary w-full text-center text-sm block"
      >
        ⚙ Ouvrir paramètres
      </Link>
    </div>
  );
}

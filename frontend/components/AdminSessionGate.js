'use client';

import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import {
  ADMIN_SESSION_PIN,
  closeAdminSession,
  isAdminSessionOpen,
  openAdminSession,
} from '../lib/admin-session';

/**
 * Verrouillage session admin : petit formulaire code, pas d’UI permanente.
 * Une fois ouvert, affiche les enfants + bouton Fermer.
 */
export default function AdminSessionGate({ children }) {
  const [unlocked, setUnlocked] = useState(false);
  const [ready, setReady] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    setUnlocked(isAdminSessionOpen());
    setReady(true);
  }, []);

  useEffect(() => {
    if (ready && !unlocked) {
      const t = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
  }, [ready, unlocked]);

  async function submit(e) {
    e?.preventDefault();
    setError('');
    setBusy(true);
    try {
      const entered = code.trim();
      // Vérif locale d’abord (fiable même si l’API est momentanément down)
      if (entered !== ADMIN_SESSION_PIN) {
        throw new Error('Code incorrect');
      }
      try {
        await api('/admin-tasks/unlock', {
          method: 'POST',
          body: JSON.stringify({ code: entered }),
        });
      } catch (apiErr) {
        // Code local OK : on ouvre quand même (ex. API en rebuild / réseau)
        console.warn('admin unlock API:', apiErr?.message || apiErr);
      }
      openAdminSession();
      setUnlocked(true);
      setCode('');
    } catch (err) {
      setError(err.message || 'Code incorrect');
      setCode('');
      inputRef.current?.focus();
    } finally {
      setBusy(false);
    }
  }

  function lock() {
    closeAdminSession();
    setUnlocked(false);
    setCode('');
    setError('');
  }

  if (!ready) {
    return <p className="text-sm text-neya-muted py-8 text-center">…</p>;
  }

  if (!unlocked) {
    return (
      <div className="max-w-xs mx-auto mt-10 sm:mt-16">
        <div className="border border-neya-border rounded-xl bg-white p-4 shadow-sm">
          <p className="text-sm font-medium text-neya-ink mb-0.5">Session admin</p>
          <p className="text-[11px] text-neya-muted mb-3">
            Entrez le code pour ouvrir les notes admin.
          </p>
          <form onSubmit={submit} className="space-y-2">
            <input
              ref={inputRef}
              type="password"
              inputMode="numeric"
              autoComplete="off"
              maxLength={8}
              className="input text-center tracking-[0.35em] text-base h-10"
              placeholder="•••••"
              value={code}
              onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 8))}
            />
            {error && (
              <p className="text-[11px] text-red-600 text-center">{error}</p>
            )}
            <button
              type="submit"
              disabled={busy || code.length < 4}
              className="btn-primary w-full text-sm h-9 disabled:opacity-40"
            >
              {busy ? '…' : 'Ouvrir'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-end mb-3">
        <button
          type="button"
          onClick={lock}
          className="text-[11px] text-neya-muted hover:text-neya-ink border border-neya-border rounded-lg px-2.5 py-1"
        >
          Fermer la session
        </button>
      </div>
      {children}
    </div>
  );
}

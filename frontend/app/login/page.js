'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Lock, Mail } from 'lucide-react';
import { getApiUrl, getSavedLogin, saveLoginCredentials } from '../../lib/api';
import { setStoredUser } from '../../lib/permissions';
import NeyaMark from '../../components/NeyaMark';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [apiHint, setApiHint] = useState('');

  useEffect(() => {
    setApiHint(getApiUrl());
    const saved = getSavedLogin();
    if (saved.remember) {
      setEmail(saved.email);
      setPassword(saved.password);
      setRemember(true);
    }
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setError('');

    const apiBase = getApiUrl();
    setApiHint(apiBase);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);

    try {
      const res = await fetch(`${apiBase}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          password,
        }),
        signal: controller.signal,
      });

      const raw = await res.text();
      let data = {};
      try {
        data = raw ? JSON.parse(raw) : {};
      } catch {
        throw new Error(
          `Réponse invalide du serveur (${res.status}). Vérifiez la connexion.`
        );
      }

      if (!res.ok) {
        throw new Error(data.error || `Erreur connexion (${res.status})`);
      }
      if (!data.token) {
        throw new Error('Connexion refusée : pas de jeton reçu');
      }

      localStorage.setItem('neya_token', data.token);
      if (data.user) {
        localStorage.setItem('neya_user', JSON.stringify(data.user));
        setStoredUser(data.user);
      }
      saveLoginCredentials(email.trim().toLowerCase(), password, remember);
      window.location.href = '/';
    } catch (err) {
      if (err?.name === 'AbortError') {
        setError(`Délai dépassé — impossible de joindre ${apiBase}`);
      } else {
        setError(err.message || 'Erreur de connexion');
      }
      setLoading(false);
    } finally {
      clearTimeout(timer);
    }
  }

  const nowLabel = new Date().toLocaleString('fr-CA', {
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <div className="grid min-h-screen min-h-[100dvh] lg:grid-cols-[1fr_1.1fr]">
      <div className="flex flex-col justify-between px-6 py-10 sm:px-10 lg:px-16 bg-white">
        <div className="flex items-center">
          <NeyaMark className="h-10 w-auto max-w-[168px]" />
        </div>

        <div className="mx-auto w-full max-w-sm py-10">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-neya-orange">
            Atelier Furniture · Québec
          </p>
          <h1 className="mt-3 font-display text-[32px] font-semibold leading-tight text-neya-ink sm:text-[36px]">
            Bon retour à l&apos;atelier.
          </h1>
          <p className="mt-2 text-[14px] text-neya-muted">
            Reprends la production, tes courriels et tes projets clients — là où tu les as laissés.
          </p>

          <form onSubmit={handleSubmit} className="mt-8 space-y-4">
            {error && (
              <div className="bg-red-50 text-red-700 text-sm px-4 py-3 rounded-xl border border-red-200" role="alert">
                {error}
                {apiHint && (
                  <p className="text-[11px] text-red-500 mt-2 break-all">API : {apiHint}</p>
                )}
              </div>
            )}

            <label className="block">
              <span className="mb-1.5 block text-[12px] font-medium text-neya-ink">Adresse courriel</span>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neya-muted" aria-hidden />
                <input
                  type="email"
                  inputMode="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="mehdi@neyafurniture.ca"
                  className="h-11 w-full rounded-lg border border-neya-border bg-white pl-10 pr-3 text-[14px] outline-none focus:border-neya-orange/50 focus:ring-2 focus:ring-neya-orange/15"
                  autoComplete="username"
                  autoCapitalize="none"
                  autoCorrect="off"
                  required
                />
              </div>
            </label>

            <label className="block">
              <span className="mb-1.5 flex items-center justify-between text-[12px] font-medium text-neya-ink">
                Mot de passe
              </span>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neya-muted" aria-hidden />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="h-11 w-full rounded-lg border border-neya-border bg-white pl-10 pr-3 text-[14px] outline-none focus:border-neya-orange/50 focus:ring-2 focus:ring-neya-orange/15"
                  autoComplete="current-password"
                  required
                />
              </div>
            </label>

            <label className="flex items-center gap-2.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
                className="w-4 h-4 accent-neya-orange rounded"
              />
              <span className="text-sm text-neya-ink">Mémoriser le mot de passe</span>
            </label>

            <button
              type="submit"
              disabled={loading}
              className="mt-2 inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-neya-orange text-[14px] font-semibold text-white shadow-orange transition-colors hover:bg-neya-orange-dark disabled:opacity-60"
            >
              {loading ? 'Connexion…' : (
                <>
                  Ouvrir l&apos;atelier <ArrowRight className="h-4 w-4" />
                </>
              )}
            </button>
          </form>

          <p className="mt-8 text-center text-[12px] text-neya-muted">
            Accès atelier Neya Furniture —{' '}
            <Link href="/manual" className="font-semibold text-neya-orange hover:underline">
              Manuel
            </Link>
          </p>
        </div>

        <p className="text-[11px] text-neya-muted">
          © {new Date().getFullYear()} Neya Furniture — Fabriqué au Québec.
        </p>
      </div>

      <div className="relative hidden overflow-hidden bg-neya-ink text-white lg:block grain">
        <div className="absolute inset-0 bg-gradient-to-br from-neya-ink via-neya-ink to-neya-orange/40" />
        <div className="relative z-10 flex h-full flex-col justify-between p-16">
          <div className="flex items-center justify-between gap-4">
            <NeyaMark className="h-11 w-auto max-w-[190px]" alt="Neya" />
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-neya-orange">
              <span className="h-1.5 w-1.5 rounded-full bg-neya-orange" />
              En atelier · {nowLabel}
            </div>
          </div>

          <blockquote className="max-w-md">
            <p className="font-display text-[34px] font-medium leading-[1.15]">
              « Le bois demande de la patience. NEYA nous donne le reste — les mails, les
              devis, les étapes — pour qu&apos;on garde nos mains sur le métier. »
            </p>
            <footer className="mt-6 flex items-center gap-3">
              <div className="grid h-10 w-10 place-items-center rounded-full bg-neya-orange font-display text-[13px] font-semibold text-white">
                M
              </div>
              <div>
                <p className="text-[13px] font-semibold">Mehdi Benali</p>
                <p className="text-[12px] text-white/70">Fondateur · Neya Furniture</p>
              </div>
            </footer>
          </blockquote>

          <div className="grid grid-cols-3 gap-6 border-t border-white/10 pt-8 text-[12px] text-white/70">
            <div>
              <p className="font-display text-[24px] font-semibold text-white">ERP</p>
              <p>atelier unifié</p>
            </div>
            <div>
              <p className="font-display text-[24px] font-semibold text-white">QC</p>
              <p>fabriqué ici</p>
            </div>
            <div>
              <p className="font-display text-[24px] font-semibold text-white">1</p>
              <p>outil pour tout</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

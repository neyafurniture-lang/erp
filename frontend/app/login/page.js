'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { getApiUrl, getSavedLogin, saveLoginCredentials } from '../../lib/api';
import { setStoredUser } from '../../lib/permissions';

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

      // Redirection hard : plus fiable sur iPhone que router.push
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

  return (
    <div
      className="min-h-screen min-h-[100dvh] flex items-center justify-center bg-neya-cream px-4 py-8"
      style={{ paddingBottom: 'max(2rem, env(safe-area-inset-bottom))' }}
    >
      <div className="w-full max-w-md px-4">
        <div className="text-center mb-8">
          <Image
            src="/brand/logo-orange.png"
            alt="Neya"
            width={140}
            height={56}
            className="mx-auto h-14 w-auto mb-3"
            priority
          />
          <p className="text-[10px] tracking-[0.25em] text-neya-muted uppercase">
            Furnitures & More
          </p>
          <p className="text-neya-muted mt-2 text-sm">ERP Atelier — Connexion</p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="bg-white rounded-2xl p-6 sm:p-8 shadow-xl border border-neya-border"
        >
          {error && (
            <div
              className="bg-red-50 text-red-700 text-sm px-4 py-3 rounded-xl mb-4 border border-red-200"
              role="alert"
            >
              {error}
              {apiHint && (
                <p className="text-[11px] text-red-500 mt-2 break-all">API : {apiHint}</p>
              )}
            </div>
          )}

          <div className="mb-4">
            <label className="label" htmlFor="login-email">
              Email
            </label>
            <input
              id="login-email"
              type="email"
              inputMode="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="input"
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              required
            />
          </div>

          <div className="mb-4">
            <label className="label" htmlFor="login-password">
              Mot de passe
            </label>
            <input
              id="login-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="input"
              autoComplete="current-password"
              required
            />
          </div>

          <label className="flex items-center gap-2.5 mb-6 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              className="w-5 h-5 accent-neya-orange rounded"
            />
            <span className="text-sm text-neya-ink">Mémoriser le mot de passe</span>
          </label>

          <button
            type="submit"
            disabled={loading}
            className="btn-primary w-full py-3.5 text-base disabled:opacity-60"
          >
            {loading ? 'Connexion…' : 'Se connecter'}
          </button>
        </form>
      </div>
    </div>
  );
}

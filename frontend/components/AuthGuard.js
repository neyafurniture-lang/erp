'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { getToken } from '../lib/api';
import { useAuth } from '../lib/auth-context';

export default function AuthGuard({ children }) {
  const router = useRouter();
  const { user, loading } = useAuth();
  const token = typeof window !== 'undefined' ? getToken() : null;

  useEffect(() => {
    if (loading) return;
    if (!getToken() || !user) {
      router.replace('/login');
    }
  }, [loading, user, router]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-neya-cream px-6">
        <div className="text-center">
          <div className="w-10 h-10 mx-auto mb-3 rounded-full border-2 border-neya-orange border-t-transparent animate-spin" />
          <p className="text-neya-muted text-base">Chargement…</p>
        </div>
      </div>
    );
  }

  if (!token || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-neya-cream px-6">
        <div className="text-center space-y-3">
          <p className="text-neya-muted text-base">Redirection vers la connexion…</p>
          <button
            type="button"
            className="btn-primary"
            onClick={() => { window.location.href = '/login'; }}
          >
            Se connecter
          </button>
        </div>
      </div>
    );
  }

  return children;
}

'use client';

import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { api, getToken } from './api';
import { canAccessPath, setStoredUser, getStoredUser } from './permissions';

const AuthContext = createContext({ user: null, loading: true, refresh: async () => {} });

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const pathname = usePathname();

  const refresh = useCallback(async () => {
    const token = getToken();
    if (!token) {
      setUser(null);
      setStoredUser(null);
      setLoading(false);
      return null;
    }
    try {
      const me = await api('/auth/me');
      setUser(me);
      setStoredUser(me);
      return me;
    } catch {
      // Token invalide / API inaccessible → forcer reconnexion
      if (typeof window !== 'undefined') {
        localStorage.removeItem('neya_token');
      }
      setUser(null);
      setStoredUser(null);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const cached = getStoredUser();
    if (cached) setUser(cached);
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (loading || !user) return;
    if (pathname === '/login') return;
    if (!canAccessPath(user, pathname)) {
      const fallback = firstAllowedPath(user);
      router.replace(fallback || '/login');
    }
  }, [loading, user, pathname, router]);

  return (
    <AuthContext.Provider value={{ user, loading, refresh, setUser }}>
      {children}
    </AuthContext.Provider>
  );
}

function firstAllowedPath(user) {
  const order = ['/', '/mes-heures', '/production', '/projects', '/purchases', '/inventory', '/team', '/calendar', '/settings'];
  return order.find(p => canAccessPath(user, p)) || null;
}

export function useAuth() {
  return useContext(AuthContext);
}

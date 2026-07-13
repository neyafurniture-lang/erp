'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/** Bouton arrière souris (X1) → page précédente */
export default function NavigationBackSupport() {
  const router = useRouter();

  useEffect(() => {
    function onAuxClick(e) {
      if (e.button !== 3) return;
      e.preventDefault();
      if (typeof window !== 'undefined' && window.history.length > 1) {
        router.back();
      } else {
        router.push('/');
      }
    }

    window.addEventListener('auxclick', onAuxClick, true);
    return () => window.removeEventListener('auxclick', onAuxClick, true);
  }, [router]);

  return null;
}

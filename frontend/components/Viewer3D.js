'use client';

import { useEffect, useRef } from 'react';

/**
 * Visualiseur 3D navigateur — GLB/GLTF.
 * Sans URL : ne rend rien (pas de placeholder « Aucun modèle 3D » partout).
 */
export default function Viewer3D({ url, title = 'Modèle 3D', compact = false }) {
  const ref = useRef(null);

  useEffect(() => {
    if (!url || !ref.current) return undefined;
    const el = document.createElement('model-viewer');
    el.setAttribute('src', url);
    el.setAttribute('alt', title);
    el.setAttribute('camera-controls', '');
    el.setAttribute('touch-action', 'pan-y');
    el.setAttribute('shadow-intensity', '1');
    el.style.width = '100%';
    el.style.height = '100%';
    el.style.background = '#FAFAFA';
    ref.current.innerHTML = '';
    ref.current.appendChild(el);

    if (!document.querySelector('script[data-model-viewer]')) {
      const s = document.createElement('script');
      s.type = 'module';
      s.src = 'https://ajax.googleapis.com/ajax/libs/model-viewer/3.5.0/model-viewer.min.js';
      s.dataset.modelViewer = '1';
      document.head.appendChild(s);
    }

    return () => {
      if (ref.current) ref.current.innerHTML = '';
    };
  }, [url, title]);

  if (!url) return null;

  return (
    <div className={`border border-neya-border rounded overflow-hidden bg-neya-surface ${compact ? 'h-[min(320px,45vh)]' : 'h-[min(480px,60vh)]'}`}>
      <div ref={ref} className="w-full h-full" />
    </div>
  );
}

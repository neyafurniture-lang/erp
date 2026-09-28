'use client';

import { useState } from 'react';

/** Cache-bust après recadrage / déploiement des assets brand. */
const BRAND_V = '3';

/**
 * Marque NEYA — wordmark officiel (`/brand/logo-orange.png`).
 * Fallback texte si l’asset public est absent (ex. wipe Docker / deploy).
 */
export default function NeyaMark({
  className = 'h-8 w-auto',
  variant = 'logo',
  alt = 'Neya',
}) {
  const [failed, setFailed] = useState(false);
  const src = variant === 'picto'
    ? `/brand/picto-orange.png?v=${BRAND_V}`
    : `/brand/logo-orange.png?v=${BRAND_V}`;

  if (failed) {
    return (
      <span
        className={`inline-flex items-center font-display font-semibold tracking-tight text-neya-orange select-none ${className}`}
        style={{ fontSize: '1.05em', lineHeight: 1 }}
        aria-label={alt}
      >
        neya
      </span>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      className={`object-contain object-left ${className}`}
      draggable={false}
      decoding="async"
      onError={() => setFailed(true)}
    />
  );
}

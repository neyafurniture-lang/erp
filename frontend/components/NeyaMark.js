'use client';

/**
 * Marque NEYA — wordmark officiel (`/brand/logo-orange.png`).
 * Variante `picto` pour les emplacements carrés / orbe.
 */
export default function NeyaMark({
  className = 'h-8 w-auto',
  variant = 'logo',
  alt = 'Neya',
}) {
  if (variant === 'picto') {
    return (
      <img
        src="/brand/picto-orange.png"
        alt={alt}
        className={className}
        draggable={false}
      />
    );
  }

  return (
    <img
      src="/brand/logo-orange.png"
      alt={alt}
      className={className}
      draggable={false}
    />
  );
}

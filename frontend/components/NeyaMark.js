'use client';

/** Cache-bust après recadrage des assets brand (fichiers /public non hashés). */
const BRAND_V = '2';

/**
 * Marque NEYA — wordmark officiel (`/brand/logo-orange.png`, déjà recadré).
 * Variante `picto` pour les emplacements carrés / orbe.
 */
export default function NeyaMark({
  className = 'h-8 w-auto',
  variant = 'logo',
  alt = 'Neya',
}) {
  const src = variant === 'picto'
    ? `/brand/picto-orange.png?v=${BRAND_V}`
    : `/brand/logo-orange.png?v=${BRAND_V}`;
  return (
    <img
      src={src}
      alt={alt}
      className={`object-contain object-left ${className}`}
      draggable={false}
      decoding="async"
    />
  );
}

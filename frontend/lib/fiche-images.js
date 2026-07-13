import { getApiRoot, resolveUploadUrl } from './api';

/** Chemins publics des visuels fiches (miroir frontend) */
export const SKU_FILE = {
  L3: 'L3', L7: 'L7', 'MÕA': 'MOA', 'ÕNDULA': 'ONDULA',
  SERA: 'SERA', HARE: 'HARE', RIVAGE: 'RIVAGE', AZAD: 'AZAD',
};

function appendQuery(url, key, value) {
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}${key}=${encodeURIComponent(value)}`;
}

/** Résout une URL d'image (locale ERP, uploads serveur, ou site web) */
export function resolveImageUrl(src, cacheKey) {
  if (!src) return null;
  if (/^https?:\/\//i.test(src)) {
    if (cacheKey) return appendQuery(src, 'v', cacheKey);
    return src;
  }
  if (src.startsWith('/uploads')) {
    let url = resolveUploadUrl(src);
    if (cacheKey) url = appendQuery(url, 'v', cacheKey);
    return url;
  }
  if (src.startsWith('/') && typeof window !== 'undefined') {
    return src;
  }
  if (!src.startsWith('/') && typeof window !== 'undefined') {
    return `${getApiRoot()}/${src}`;
  }
  return src;
}

export function productImageUrl(meta) {
  const cacheKey = meta?.photos_synced_at;
  if (meta?.image) return resolveImageUrl(meta.image, cacheKey);
  if (meta?.web_image_local) return resolveImageUrl(meta.web_image_local, cacheKey);
  if (meta?.web_image_url) return meta.web_image_url;
  const sku = meta?.sku;
  const file = SKU_FILE[sku];
  return file ? `/fiches/products/${file}.png` : null;
}

export function stepImageUrl(step) {
  return step?.image || null;
}

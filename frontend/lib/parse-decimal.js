/**
 * Parse un nombre saisi à la française (virgule) ou anglaise (point).
 * Accepte les états intermédiaires de saisie ("12,", ".", "-").
 */

export function isPartialDecimal(value) {
  const s = String(value ?? '').trim();
  return s === '' || /^-?\d*[.,]?\d*$/.test(s);
}

/** Convertit en nombre ; retourne `fallback` si invalide / vide. */
export function parseDecimal(value, fallback = 0) {
  if (value === '' || value == null) return fallback;
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
  let s = String(value).trim().replace(/\u00a0/g, '').replace(/\s/g, '').replace(/\$/g, '');
  if (!s || s === '-' || s === ',' || s === '.' || s === '-,' || s === '-.') return fallback;
  // 1.234,56 → 1234.56 ; 1,234.56 → 1234.56
  if (s.includes(',') && s.includes('.')) {
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) {
      s = s.replace(/\./g, '').replace(',', '.');
    } else {
      s = s.replace(/,/g, '');
    }
  } else {
    s = s.replace(',', '.');
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Valeur à conserver dans le state pendant la saisie.
 * Garde la chaîne si décimale incomplète (ex. "12,") pour ne pas effacer le champ.
 */
export function coerceDecimalInput(value) {
  if (value === '' || value == null) return '';
  const s = String(value);
  if (isPartialDecimal(s) && /[.,]$/.test(s.trim())) return s;
  if (isPartialDecimal(s) && /^-?\d*[.,]\d*$/.test(s.trim())) {
    // garder la forme tapée (virgule) tant que l’utilisateur n’a pas blur
    return s;
  }
  if (isPartialDecimal(s) && /^-?\d+$/.test(s.trim())) return s;
  const n = parseDecimal(s, NaN);
  return Number.isFinite(n) ? n : s;
}

/** Normalise pour stockage (nombre) après blur / sauvegarde. */
export function finalizeDecimal(value, fallback = 0) {
  return parseDecimal(value, fallback);
}

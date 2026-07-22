/** Statuts projet autorisés (colonne TEXT libre en DB). */
export const PROJECT_STATUSES = ['active', 'waiting', 'paused', 'done', 'cancelled'];

const ALIASES = {
  actif: 'active',
  active: 'active',
  'en cours': 'active',
  waiting: 'waiting',
  pending: 'waiting',
  on_hold: 'waiting',
  'on-hold': 'waiting',
  en_attente: 'waiting',
  'en attente': 'waiting',
  paused: 'paused',
  pause: 'paused',
  'en pause': 'paused',
  done: 'done',
  termine: 'done',
  terminé: 'done',
  cancelled: 'cancelled',
  canceled: 'cancelled',
  annule: 'cancelled',
  annulé: 'cancelled',
};

/**
 * Normalise une valeur de statut projet.
 * @returns {string|null} statut canonique, ou null si invalide
 */
export function normalizeProjectStatus(value, { fallback = null } = {}) {
  if (value == null || value === '') return fallback;
  const key = String(value).trim().toLowerCase();
  const mapped = ALIASES[key] || (PROJECT_STATUSES.includes(key) ? key : null);
  return mapped || fallback;
}

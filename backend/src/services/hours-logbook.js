/**
 * Carnet d’heures projet (projects.meta.hours_logbook).
 * Protège contre l’effacement accidentel et garde une sauvegarde restaurable.
 */

export function parseProjectMeta(meta) {
  if (typeof meta === 'string') {
    try { return JSON.parse(meta || '{}'); } catch { return {}; }
  }
  return meta && typeof meta === 'object' ? meta : {};
}

export function countHoursRows(log) {
  return Array.isArray(log?.rows) ? log.rows.length : 0;
}

/** Vrai si on tente d’écraser un carnet non vide par un carnet vide. */
export function isClearingHoursLogbook(existingLog, incomingLog) {
  if (!incomingLog || typeof incomingLog !== 'object') return false;
  if (incomingLog.confirm_clear === true) return false;
  const existingCount = countHoursRows(existingLog);
  const incomingCount = countHoursRows(incomingLog);
  return existingCount > 0 && incomingCount === 0;
}

/**
 * Applique un hours_logbook entrant sur meta, avec backup prev.
 * @returns {{ meta: object, blocked?: boolean, existing_count?: number }}
 */
export function applyHoursLogbookToMeta(meta, incoming, { allowClear = false } = {}) {
  const nextMeta = { ...parseProjectMeta(meta) };
  const existing = nextMeta.hours_logbook || null;
  const payload = { ...incoming };
  delete payload.confirm_clear;

  if (!allowClear && isClearingHoursLogbook(existing, incoming)) {
    return {
      meta: nextMeta,
      blocked: true,
      existing_count: countHoursRows(existing),
    };
  }

  if (existing && countHoursRows(existing) > 0) {
    nextMeta.hours_logbook_prev = {
      ...existing,
      saved_at: existing.updated_at || new Date().toISOString(),
    };
  }

  nextMeta.hours_logbook = {
    ...(existing || {}),
    ...payload,
    updated_at: new Date().toISOString(),
  };

  return { meta: nextMeta, blocked: false };
}

/** Restaure hours_logbook depuis hours_logbook_prev. */
export function restoreHoursLogbookFromPrev(meta) {
  const nextMeta = { ...parseProjectMeta(meta) };
  const prev = nextMeta.hours_logbook_prev;
  if (!prev || !Array.isArray(prev.rows) || !prev.rows.length) {
    return { meta: nextMeta, ok: false, error: 'Aucune sauvegarde précédente à restaurer' };
  }
  const current = nextMeta.hours_logbook || null;
  if (current && countHoursRows(current) > 0) {
    nextMeta.hours_logbook_prev = {
      ...current,
      saved_at: current.updated_at || new Date().toISOString(),
    };
  }
  nextMeta.hours_logbook = {
    ...prev,
    source: prev.source || 'restore',
    updated_at: new Date().toISOString(),
    restored_at: new Date().toISOString(),
  };
  return { meta: nextMeta, ok: true };
}

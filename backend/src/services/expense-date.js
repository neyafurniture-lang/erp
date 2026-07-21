/**
 * Normalise une date d'achat / ticket vers YYYY-MM-DD (calendrier local).
 * Gère formats Québec (JJ/MM/AAAA), ISO, et Date pg.
 */

function pad2(n) {
  return String(n).padStart(2, '0');
}

/** Aujourd'hui en YYYY-MM-DD (fuseau local, pas UTC). */
export function todayISODate() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/**
 * @param {unknown} raw
 * @returns {string|null} YYYY-MM-DD ou null
 */
export function normalizePurchaseDate(raw) {
  if (raw == null || raw === '') return null;

  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    // DATE pg → JS Date à minuit UTC : utiliser UTC pour ne pas reculer d'un jour
    return `${raw.getUTCFullYear()}-${pad2(raw.getUTCMonth() + 1)}-${pad2(raw.getUTCDate())}`;
  }

  const s = String(raw).trim();
  if (!s || /^null$/i.test(s)) return null;

  // ISO / datetime : 2026-07-15 ou 2026-07-15T12:00:00.000Z
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const y = Number(iso[1]);
    const m = Number(iso[2]);
    const d = Number(iso[3]);
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  }

  // YYYY/MM/DD ou YYYY.MM.DD
  const ymd = s.match(/^(\d{4})[/.](\d{1,2})[/.](\d{1,2})/);
  if (ymd) {
    const y = Number(ymd[1]);
    const m = Number(ymd[2]);
    const d = Number(ymd[3]);
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) return `${y}-${pad2(m)}-${pad2(d)}`;
  }

  // JJ/MM/AAAA, JJ-MM-AAAA, JJ.MM.AAAA (Québec) — ou MM/DD/YYYY ambigu
  const dmy = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})/);
  if (dmy) {
    let a = Number(dmy[1]);
    let b = Number(dmy[2]);
    const y = Number(dmy[3]);
    let day;
    let month;
    if (a > 12 && b >= 1 && b <= 12) {
      day = a;
      month = b;
    } else if (b > 12 && a >= 1 && a <= 12) {
      // US-like MM/DD when day part > 12
      month = a;
      day = b;
    } else {
      // Ambigu (les deux ≤ 12) → convention Québec JJ/MM/AAAA
      day = a;
      month = b;
    }
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${y}-${pad2(month)}-${pad2(day)}`;
    }
  }

  // Texte type « 15 juillet 2026 » / « July 15, 2026 »
  const monthsFr = {
    janvier: 1, janv: 1, february: 2, fev: 2, mars: 3, avril: 4, avr: 4,
    mai: 5, juin: 6, juillet: 7, juil: 7, aout: 8, août: 8, septembre: 9, sept: 9,
    octobre: 10, oct: 10, novembre: 11, nov: 11, decembre: 12, décembre: 12, dec: 12,
  };
  const monthsEn = {
    january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3, april: 4, apr: 4,
    may: 5, june: 6, jun: 6, july: 7, jul: 7, august: 8, aug: 8,
    september: 9, sep: 9, october: 10, oct: 10, november: 11, nov: 11, december: 12, dec: 12,
  };
  const fr = s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const frMatch = fr.match(/(\d{1,2})\s+([a-z]{3,9})\.?\s+(\d{4})/);
  if (frMatch) {
    const month = monthsFr[frMatch[2]] || monthsEn[frMatch[2]];
    const day = Number(frMatch[1]);
    const y = Number(frMatch[3]);
    if (month && day >= 1 && day <= 31) return `${y}-${pad2(month)}-${pad2(day)}`;
  }
  const enMatch = s.match(/([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})/);
  if (enMatch) {
    const month = monthsEn[enMatch[1].toLowerCase()];
    const day = Number(enMatch[2]);
    const y = Number(enMatch[3]);
    if (month && day >= 1 && day <= 31) return `${y}-${pad2(month)}-${pad2(day)}`;
  }

  return null;
}

/** Cherche une date dans un texte de ticket (fallback si l'IA omet le champ). */
export function extractDateFromText(text) {
  const blob = String(text || '');
  if (!blob.trim()) return null;

  const patterns = [
    /\b(\d{4}-\d{2}-\d{2})\b/,
    /\b(\d{1,2}[/\-.]\d{1,2}[/\-.]\d{4})\b/,
    /\b(\d{4}[/.]\d{1,2}[/.]\d{1,2})\b/,
    /\b(\d{1,2}\s+(?:janvier|février|fevrier|mars|avril|mai|juin|juillet|août|aout|septembre|octobre|novembre|décembre|decembre)\s+\d{4})\b/i,
    /\b((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{4})\b/i,
  ];

  for (const re of patterns) {
    const m = blob.match(re);
    if (m) {
      const normalized = normalizePurchaseDate(m[1]);
      if (normalized) return normalized;
    }
  }
  return null;
}

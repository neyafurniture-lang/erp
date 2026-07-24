/** Classification des messages « planning journée » vs multi-intentions ERP (sans I/O). */

export function stripPlanPrefix(message) {
  return String(message || '')
    .replace(/^(planifie[rz]?|programme[rz]?|prévois|prevoyez|organise[rz]?)\s+(ma\s+)?(journée|journee|planning|étapes?|etapes?)\s+(de\s+|pour\s+)?(demain|lundi|mardi|mercredi|jeudi|vendredi)\s*[:,-]?\s*/i, '')
    .replace(/^(mes\s+)?(étapes?|etapes?)\s+(de\s+|pour\s+)?(demain|lundi|mardi|mercredi|jeudi|vendredi)\s*[:,-]?\s*/i, '')
    .replace(/^(demain|pour\s+demain|lundi|mardi|mercredi|jeudi|vendredi)\s*[:,-]?\s*/i, '')
    .trim();
}

const DAY_NAME_RE = /^(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)$/i;
const WORKSHOP_PLAN_RE = /finition|débitage|debitage|usinage|assemblage|mail|courriel|email|e-mail|ponçage|poncage|vernis|cnc|relance/i;

/** Fragments narratifs / jours seuls — pas des étapes atelier à enchaîner. */
export function isJunkPlanSegment(segment) {
  const s = String(segment || '').trim();
  if (!s || s.length < 3) return true;
  if (DAY_NAME_RE.test(s)) return true;
  if (/^(demain|pour|planifier|programmer|journée|journee|matin|après-midi|apres-midi|également|egalement|aussi|ensuite|puis)$/i.test(s)) {
    return true;
  }
  if (/^(la semaine prochaine|il faut|entendu|à vérifier|a verifier|concernant|avec un nouveau|nom non clair)/i.test(s)) {
    return true;
  }
  if (/créer?\s+(un\s+)?(nouveau\s+)?(devis|client|projet)|nouveau\s+(devis|client|projet)|client\s+nommé/i.test(s)) {
    return true;
  }
  return false;
}

/**
 * Découpe une vraie liste « Demain X, Y puis Z ».
 * Ne coupe PAS sur les points d'une prose dictée (sinon chaque phrase → créneau 30 min).
 */
export function splitPlanItems(text) {
  const raw = String(text || '').trim();
  if (!raw) return [];
  const hasListSeps = /,\s*|;\s*|\s+puis\s+|\s+ensuite\s+|\s+après\s+|\s+apres\s+/i.test(raw);
  const parts = hasListSeps
    ? raw.split(/\s*(?:,|;|\bet\b|\bpuis\b|\baprès\b|\bapres\b|\bensuite\b)\s*/i)
    : raw.split(/\s*(?:;|\bpuis\b|\bensuite\b)\s*/i);

  return parts
    .map(s => s.trim().replace(/^[.\-•]+/, '').replace(/[.]+$/, ''))
    .filter(s => s.length > 2)
    .filter(s => !isJunkPlanSegment(s));
}

/** Plusieurs intentions ERP distinctes (client + devis + calendrier multi-jours, etc.). */
export function isMultiIntentErpMessage(message) {
  const text = String(message || '').trim();
  if (!text) return false;
  const lower = text.toLowerCase();

  const intentFlags = [
    /créer?\s+(un\s+)?(nouveau\s+)?devis|nouveau devis|\bdevis\b.*\b(admin|projet)/i.test(lower),
    /créer?\s+(un\s+)?(nouveau\s+)?client|nouveau client|client nommé|client nomme/i.test(lower),
    /créer?\s+(un\s+)?(nouveau\s+)?projet|nouveau projet/i.test(lower),
    /tâches?\s+dans\s+le\s+calendrier|créer?\s+des\s+tâches|planif\w*\s+au\s+calendrier/i.test(lower),
    /également|egalement|\baussi\b|en plus|par ailleurs/i.test(lower),
  ];
  const hits = intentFlags.filter(Boolean).length;
  const daysMentioned = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi']
    .filter(d => lower.includes(d));

  if (daysMentioned.length >= 2 && /tâche|tache|calendrier|planif/i.test(lower)) return true;
  if (hits >= 2) return true;
  if (/devis|nouveau client|client nommé/i.test(lower) && /calendrier|tâche|tache/i.test(lower)) return true;

  const sentences = (text.match(/[.!?]+/g) || []).length;
  if (sentences >= 2 && text.length > 160 && !WORKSHOP_PLAN_RE.test(lower)) return true;
  return false;
}

function looksLikeListDayPlan(message) {
  const text = String(message || '').trim();
  if (!text) return false;
  const lower = text.toLowerCase();
  const hasDate = /demain|lundi|mardi|mercredi|jeudi|vendredi/i.test(lower);
  if (!hasDate) return false;

  const planIntent = /planifie[rz]?|programme[rz]?|prévois|prevoyez|organise[rz]?|journée|journee|étapes?\s+(de\s+|pour\s+)?(demain|lundi|mardi|mercredi|jeudi|vendredi)|planning\s+(de\s+)?demain/i.test(lower);
  const hasWorkshop = WORKSHOP_PLAN_RE.test(lower);
  const body = stripPlanPrefix(text);
  const segments = splitPlanItems(body);
  const listSepCount = (body.match(/\s*,\s*|\s+puis\s+|\s+ensuite\s+/gi) || []).length;
  const sentenceCount = (text.match(/[.!?]+/g) || []).length;
  const isCompactList = text.length < 220 && sentenceCount <= 1 && listSepCount >= 1 && segments.length >= 2;

  return (planIntent && hasWorkshop && segments.length >= 1)
    || (isCompactList && hasWorkshop);
}

export function isDayPlanMessage(message) {
  if (isMultiIntentErpMessage(message)) return false;
  return looksLikeListDayPlan(message);
}

/** Wall-clock America/Toronto → Date UTC (évite 08:30 serveur = 04:30 affichage QC). */
export function torontoWallTime(baseDate, hours, minutes) {
  const y = baseDate.getFullYear();
  const mo = baseDate.getMonth();
  const d = baseDate.getDate();
  const utcGuess = Date.UTC(y, mo, d, hours, minutes, 0);
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Toronto',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = Object.fromEntries(
    dtf.formatToParts(new Date(utcGuess))
      .filter(p => p.type !== 'literal')
      .map(p => [p.type, p.value])
  );
  const hour = Number(parts.hour) % 24;
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    hour,
    Number(parts.minute),
    Number(parts.second)
  );
  return new Date(utcGuess - (asUtc - utcGuess));
}

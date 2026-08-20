/** Classification des messages « planning journée » vs multi-intentions ERP (sans I/O). */

/** Retire métadonnées injectées (historique, contexte page) — ne jamais les router vers plan_day. */
export function stripAssistantMeta(message) {
  return String(message || '')
    .replace(/\n?\[Suite de conversation[\s\S]*$/i, '')
    .replace(/\n?\[Contexte page[\s\S]*$/i, '')
    .replace(/\n?\[[0-9]+\s*fichier\(s\)[\s\S]*$/i, '')
    .replace(/\n?\[Extraction[\s\S]*$/i, '')
    .trim();
}

/** « Supprime toutes les tâches de demain » / « vide le planning » — pas une liste à planifier. */
export function isClearDayIntent(message) {
  const text = stripAssistantMeta(message);
  const m = text.toLowerCase();
  if (!m) return false;

  const clearVerb = /\b(supprim\w*|effac\w*|retir\w*|annul\w*|vide[rz]?|enl[eè]v\w*|clear|reset)\b/i.test(m);
  if (!clearVerb) return false;

  const dayHint = /\b(demain|aujourd['’]?hui|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|journ[eé]e|planning)\b/i.test(m);
  const bulkTasks = /\b(toutes?\s+les\s+t[aâ]ches?|tout(es)?\s+les\s+[eé]tapes?|les\s+t[aâ]ches?|le\s+planning|tout\s+le\s+planning|toutes?\s+les\s+[eé]tapes?)\b/i.test(m)
    || /\bt[aâ]che\b/i.test(m) && /\b(toute|toutes|tout)\b/i.test(m);

  // « Supprime toute les tache de demain et on refait… »
  if (bulkTasks && dayHint) return true;
  // « Vide / efface le planning de demain »
  if (/\b(planning|journ[eé]e)\b/i.test(m) && dayHint) return true;
  // « Efface demain » / « Annule le planning demain »
  if (/\b(effac\w*|vid(e|er)|annul\w*)\b/i.test(m) && /\bdemain\b/i.test(m)) return true;
  return false;
}

/** Imperatif supprimer + tâche (singulier) — hors clear-day bulk. */
export function isDeleteTaskIntent(message) {
  const m = stripAssistantMeta(message).toLowerCase();
  if (!m || isClearDayIntent(m)) return false;
  const clearVerb = /\b(supprim\w*|effac\w*|retir\w*)\b/i.test(m);
  const taskWord = /\b(t[aâ]ches?|[eé]tapes?)\b/i.test(m);
  return clearVerb && taskWord;
}

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
    /\b(todo|to-?do|tableau de bord|dashboard)\b/i.test(lower) && /t[aâ]che|calendrier|admin/i.test(lower),
    /\badmin\b/i.test(lower) && /(calendrier|projet|t[aâ]che\s+(atelier|finition|d[eé]bitage))/i.test(lower),
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

/**
 * Texte assez riche pour exiger un plan multi-actions (pas un simple create_task mot-clé).
 * Couvre : multi-intent, listes, « créer des tâches depuis ce texte », prose longue.
 */
export function wantsSmartTaskPlan(message) {
  const text = String(message || '').trim();
  if (!text) return false;

  // Consigne explicite d’analyse / extraction — même si ça ressemble à une liste
  if (/cr[eé]er?\s+des\s+t[aâ]ches|extraire?\s+(les\s+)?t[aâ]ches|depuis\s+(ce\s+)?(texte|message)|analyse[rz]?\s+.+\s+(t[aâ]ches?|actions?)|d[eé]couper?\s+en\s+t[aâ]ches/i.test(text)) {
    return true;
  }

  if (isDayPlanMessage(text)) return false;
  if (isMultiIntentErpMessage(text)) return true;

  const sentences = (text.match(/[.!?]+/g) || []).length;
  const lines = text.split(/\n/).map(l => l.trim()).filter(Boolean);
  const bulletish = lines.filter(l => /^[-•*]|\d+[.)]/.test(l)).length;
  if (bulletish >= 2) return true;
  if (lines.length >= 3 && /t[aâ]che|calendrier|todo|admin|planif|demain|lundi|mardi/i.test(text)) return true;
  if (text.length >= 140 && sentences >= 2 && /t[aâ]che|calendrier|todo|planif|admin|demain|mardi|mercredi|jeudi|vendredi/i.test(text)) {
    return true;
  }
  return false;
}

/** Titre d’action court — évite de coller toute la phrase dictée. */
export function cleanTaskTitle(raw, { max = 90 } = {}) {
  let t = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  t = t
    .replace(/^(ajoute[rz]?|cr[eé]e[rz]?|nouvelle?|créer?\s+une?|fais|faire|mettre|mets)\s+(une?\s+)?(t[aâ]che|todo|rappel)?\s*/i, '')
    .replace(/^(t[aâ]che|todo|rappel)\s*[:\-–—]?\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  const cut = t.split(/(?<=[.!?])\s+|\s+[—–]\s+/)[0] || t;
  t = cut.trim();
  if (t.length > max) t = `${t.slice(0, max - 1).trim()}…`;
  if (t && /^[a-zàâäéèêëïîôùûüç]/.test(t)) {
    t = t.charAt(0).toUpperCase() + t.slice(1);
  }
  return t;
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
  const clean = stripAssistantMeta(message);
  if (isClearDayIntent(clean) || isDeleteTaskIntent(clean)) return false;
  if (isMultiIntentErpMessage(clean)) return false;
  return looksLikeListDayPlan(clean);
}

/** Nettoie une réponse Lia avant affichage / stockage (fuites prompt, préfixe miroir). */
export function sanitizeAssistantReply(reply) {
  let r = String(reply || '').trim();
  if (!r) return r;
  r = r.replace(/^Lia\s*:\s*/i, '');
  const suiteIdx = r.search(/\[Suite de conversation/i);
  if (suiteIdx >= 0) r = r.slice(0, suiteIdx).trim();
  // Historique collé en fin de bulle (ex. « Utilisateur: … »)
  r = r.replace(/\n(?:Utilisateur|Lia)\s*:\s*[\s\S]*$/i, '').trim();
  return r;
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

/** « Mets Olive demain 8h » / « quart Mehdi lundi » — pas une tâche calendrier. */
export function wantsCreateShift(message) {
  const t = String(message || '').toLowerCase();
  if (!t.trim()) return false;
  if (/\b(quart|shift|horaire)\b/.test(t)) return true;
  if (/mett(re|s)\s+(olive|mehdi)/.test(t)) return true;
  if (/\b(olive|mehdi)\b/.test(t) && /(\d{1,2}\s*h|\bdemain\b|\blundi\b|\bmardi\b|\bmercredi\b|\bjeudi\b|\bvendredi\b)/.test(t)) {
    return true;
  }
  return false;
}

/** « Mets ça au calendrier mardi 9h » / « planifie livraison James ». */
export function wantsScheduleOnCalendar(message) {
  const t = String(message || '').toLowerCase();
  if (!t.trim() || wantsCreateShift(t)) return false;
  if (/calendrier/.test(t)) return true;
  if (/mett(re|s)\s+(ça|ca|le|la|une?|cette)?\s*(tâche|tache|rdv|livraison)?.{0,24}(calendrier|mardi|lundi|demain)/.test(t)) {
    return true;
  }
  if (/\b(planifie[rz]?|programme[rz]?)\b/.test(t) && /\b(demain|lundi|mardi|mercredi|jeudi|vendredi|\d{1,2}\s*h)\b/.test(t)) {
    return true;
  }
  return false;
}

/** Titre d’un RDV : « Mets livraison James au calendrier demain 9h » → « livraison James ». */
export function calendarTitleFromMessage(message) {
  let t = String(message || '').trim();
  t = t.replace(/^(mets[e]?|mettre|ajoute[rz]?|ajouter|planifie[rz]?|programme[rz]?)\s+/i, '');
  t = t.replace(/\s+(au|dans le|sur le)\s+calendrier\b/gi, ' ');
  t = t.replace(/\bcalendrier\b/gi, ' ');
  t = t.replace(/\b(demain|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\b/gi, ' ');
  t = t.replace(/\bà\s+\d{1,2}\s*h(\s*\d{2})?\b/gi, ' ');
  t = t.replace(/\b\d{1,2}\s*h(\s*\d{2})?\b/gi, ' ');
  t = t.replace(/\s{2,}/g, ' ').replace(/^[\s,;:.]+|[\s,;:.]+$/g, '').trim();
  if (t.length < 2) return 'RDV atelier';
  return t.slice(0, 200);
}

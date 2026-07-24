import { isMaterialInfoMessage } from './skill-actions.js';

/**
 * Routeur décisionnel Lia — ordre d'exécution des canaux IA.
 * - skill_only  : skills ERP / dashboard (ui_*) — pas d'appel API
 * - cursor      : demande_modification_erp — agent Cursor sur le VPS
 * - llm_skill   : Claude/OpenAI interprète → exécute une skill
 * - llm_only    : Claude répond sans action ERP
 */

/** Actions exécutables sans LLM quand le déclencheur est explicite. */
export const SKILL_ONLY_ACTIONS = new Set([
  'list_skills', 'list_today', 'list_tomorrow', 'list_project_tasks',
  'list_emails', 'list_quotes', 'list_invoices', 'list_expenses',
  'list_web_orders', 'list_mail_threads',
  'erp_manual', 'atelier_habits', 'plan_day',
  'ui_edit_mode', 'ui_add_todo_list', 'ui_move_section',
  'ui_hide_section', 'ui_show_section', 'ui_reset_layout',
  'sync_wordpress', 'sync_web_orders', 'sync_web_photos',
]);

/** Actions métier — jamais redirigées vers Cursor par erreur. */
export const BUSINESS_ACTIONS = new Set([
  'create_task', 'complete_task', 'update_task', 'delete_task', 'schedule_task',
  'create_project', 'update_project', 'delete_project', 'search_projects', 'get_project',
  'add_project_material',
  'create_client', 'update_client', 'delete_client',
  'create_expense', 'list_expenses', 'delete_expense',
  'create_quote', 'update_quote', 'get_quote', 'send_quote', 'convert_quote',
  'create_invoice', 'send_invoice',
  'list_emails', 'search_emails', 'get_email', 'list_mail_threads',
  'create_fabrication_plan', 'search_memory',
  'create_project_from_quote_email', 'atelier_habits',
]);

/**
 * Demande explicite de modification code / interface ERP → Cursor.
 * Volontairement plus strict que l'ancien isErpCodeChangeRequest :
 * « créer une facture » ou « modifier le devis » ne doivent PAS déclencher Cursor.
 */
export function isExplicitCursorRequest(message = '', pageContext = null) {
  const m = String(message);

  if (/demande\s*(à\s*)?cursor|lance\s*cursor|cursor\s*agent|modifie\s*(le\s*)?code|change\s*(le\s*)?code|développe\s*(le\s*)?(module|feature|écran)|refactor|passerelle\s*cursor/i.test(m)) {
    return true;
  }

  if (/modifie\s*(l['']?\s*)?erp|améliore\s*(l['']?\s*)?erp|fais\s*[eé]voluer\s*(l['']?\s*)?erp|nouvelle\s*fonctionnalit[ée]|nouveau\s*module/i.test(m)) {
    return true;
  }

  if (/cliquer\s+(sur|pour|dessus)|en\s*cliquant|rendre\s+cliquable/i.test(m) && /(interface|page|écran|dashboard|facture|devis)/i.test(m)) {
    return true;
  }

  if (/[eé]diteur\s*visuel|wysiwyg|document\s*[eé]ditable|preview\s*(facture|devis)|aper[cç]u\s*(facture|devis)/i.test(m)) {
    return true;
  }

  if (/planification\s*des\s*d[eé]parts|pr[eé]-?r[eé]ponses?\s*(mail|gmail)|crée\s*une\s*passerelle/i.test(m)) {
    return true;
  }

  const hasFeatureIntent = /(j['']aimerais|on\s+pourrait|il\s+faudrait|fais\s+en\s+sorte|ajoute\s+(la\s+)?possibilit|rends?\s+(possible|cliquable)|pouvoir\s+(visualiser|modifier|cliquer))/i.test(m);
  const hasCodeTarget = /(interface|page|écran|bouton|dashboard|module|code|layout|composant|composante|ui\b|api\b|backend|frontend)/i.test(m);
  if (hasFeatureIntent && hasCodeTarget) {
    return true;
  }

  const pointed = pageContext?.meta?.element || pageContext?.element;
  if (pointed && /modifie|change|ajoute|enlève|enleve|déplace|deplace|couleur|taille|texte|bouton|cliquable/i.test(m)) {
    return true;
  }

  return false;
}

/** @deprecated Utiliser isExplicitCursorRequest — conservé pour compatibilité. */
export function isErpCodeChangeRequest(message = '') {
  return isExplicitCursorRequest(message);
}

export function isConversationalOnly(message = '') {
  const m = String(message).trim();
  if (m.length < 4) return false;
  return /^(comment|pourquoi|qu['']est-ce|c['']est quoi|explique|aide-moi à comprendre|dis-moi|raconte|bonjour|salut|merci)\b/i.test(m)
    && !/\b(créer?|crée|ajoute|cocher|modifier|supprime|envoie|planifie|liste|facture|devis|projet|tâche)\b/i.test(m);
}

export function needsLlmParsing(message = '', pageContext = null) {
  const m = String(message).trim();
  if (m.length > 120) return true;
  if (pageContext?.type === 'quote' && /ajoute|change|modifie|prix|ligne|titre/i.test(m)) return true;
  if (/demain|après-demain|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche/i.test(m) && /mail|tâche|projet|finition/i.test(m)) return true;
  if (/^(oui|ok|celui|celle|ce\s|ça|le premier|la première|même|meme)\b/i.test(m)) return true;
  return false;
}

/**
 * Valide une action proposée par le LLM avant exécution.
 * Empêche Cursor sur des actions métier et vice-versa.
 */
export function validateLlmAction(actionType, message, pageContext = null) {
  if (!actionType || actionType === 'null' || actionType === 'none') {
    return { valid: true, actionType: null, redirected: false };
  }

  // Info matériel mal classée en tâche par le LLM
  if ((actionType === 'create_task' || actionType === 'create_fabrication_plan') && isMaterialInfoMessage(message)) {
    return { valid: true, actionType: 'add_project_material', redirected: true, reason: 'material_not_task' };
  }

  if (actionType === 'demande_modification_erp') {
    if (isExplicitCursorRequest(message, pageContext)) {
      return { valid: true, actionType, redirected: false, reason: 'cursor_explicit' };
    }
    return {
      valid: false,
      actionType: null,
      redirected: true,
      reason: 'cursor_not_explicit',
      hint: 'Demande métier ou dashboard — pas de Cursor',
    };
  }

  if (BUSINESS_ACTIONS.has(actionType) && isExplicitCursorRequest(message, pageContext)) {
    return {
      valid: true,
      actionType: 'demande_modification_erp',
      redirected: true,
      reason: 'business_to_cursor',
    };
  }

  return { valid: true, actionType, redirected: false };
}

/**
 * Évalue si un skill matché peut s'exécuter sans LLM.
 */
export function isHighConfidenceSkillMatch(skill, message) {
  if (!skill) return false;
  const patterns = skill.trigger_patterns || [];
  const lower = message.toLowerCase();
  let bestLen = 0;
  for (const p of patterns) {
    const pl = p.toLowerCase();
    if (lower.includes(pl) && pl.length > bestLen) bestLen = pl.length;
  }
  if (SKILL_ONLY_ACTIONS.has(skill.action_type)) return bestLen >= 4;
  return bestLen >= 10;
}

/**
 * Résout le canal d'exécution pour un message Lia.
 * @returns {{ channel: string, reason: string, skill?: object }}
 */
export async function resolveAssistantRoute({
  message,
  pageContext = null,
  attachments = [],
  matchSkillFn = null,
  isDayPlanFn = null,
}) {
  const { isAssistantAiEnabled } = await import('./settings.js');

  if (!(await isAssistantAiEnabled())) {
    return { channel: 'skill_only', reason: 'ai_disabled' };
  }

  if (isDayPlanFn?.(message)) {
    return { channel: 'skill_only', reason: 'day_plan' };
  }

  if (isExplicitCursorRequest(message, pageContext)) {
    return { channel: 'cursor', reason: 'explicit_code_request' };
  }

  const skill = matchSkillFn ? await matchSkillFn(message) : null;

  if (skill?.action_type === 'demande_modification_erp') {
    return { channel: 'cursor', reason: 'cursor_skill_match', skill };
  }

  if (skill && isHighConfidenceSkillMatch(skill, message)) {
    return { channel: 'skill_only', reason: 'high_confidence_skill', skill };
  }

  if (isConversationalOnly(message) && !skill) {
    return { channel: 'llm_only', reason: 'conversational' };
  }

  if (skill || needsLlmParsing(message, pageContext) || attachments.length > 0) {
    return { channel: 'llm_skill', reason: skill ? 'skill_needs_parsing' : 'complex_message', skill };
  }

  return { channel: 'llm_skill', reason: 'default' };
}

export function formatRoutingLog(route) {
  return `[Lia route: ${route.channel} — ${route.reason}]`;
}

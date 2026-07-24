/**
 * Protocole d'appel IA NEYA — catalogue skills + format de réponse actions.
 * Boucle : Lia → action → ACTION_CHECK → réinterprétation → autre action ou réponse finale.
 */
import pool from '../db/pool.js';
import { ACTION_TYPES } from './skill-actions.js';

export const MAX_ACTION_STEPS = 5;
export const PROTOCOL_VERSION = '1.2.0';

/** Métadonnées stables des actions (indépendantes du seed DB). */
export const ACTION_CATALOG = [
  { type: 'create_task', usage: 'Créer une tâche (project_id null = hors checklist ; garder client_id + related_project_id pour l\'historique)', params: { title: 'string', type: 'debitage|usinage|assemblage|finition|admin', project_name: 'string?', project_id: 'number|null?', client_id: 'number?', related_project_id: 'number?' } },
  { type: 'create_project', usage: 'Créer un projet simple', params: { name: 'string', client_id: 'number?' } },
  { type: 'create_project_from_quote_email', usage: 'Devis Gmail/PDF → client + projet(s) + devis + tâches', params: { query: 'string (ex. Alexandra, The NNS)', message_id: 'string?', max: 'number?' } },
  { type: 'complete_task', usage: 'Cocher une tâche', params: { task_title: 'string', project_name: 'string?', project_id: 'number?' } },
  { type: 'update_task', usage: 'Modifier tâche (titre/statut)', params: { task_title: 'string', new_title: 'string?', status: 'done|todo?', project_name: 'string?' } },
  { type: 'delete_task', usage: 'Supprimer une tâche', params: { task_title: 'string', project_id: 'number?' } },
  { type: 'unlink_task', usage: 'Détacher une tâche du projet (admin mal classée / « pas en rapport »)', params: { task_title: 'string?', task_id: 'number?', project_id: 'number?' } },
  { type: 'list_project_tasks', usage: 'Lister tâches d’un projet', params: { project_name: 'string?', project_id: 'number?' } },
  { type: 'update_project', usage: 'Notes / deadline / budget / statut projet', params: { project_name: 'string?', project_id: 'number?', notes: 'string?', append_notes: 'boolean?', status: 'active|done?', deadline: 'YYYY-MM-DD?', budget_estimated: 'number?' } },
  { type: 'search_projects', usage: 'Chercher projets', params: { query: 'string', status: 'active|done?' } },
  { type: 'get_project', usage: 'Détail projet + tâches', params: { project_id: 'number?', query: 'string?' } },
  { type: 'list_projects', usage: 'Liste projets', params: { status: 'string?' } },
  { type: 'create_client', usage: 'Créer client (name + email/phone/address/city ; From mail OK si PDF illisible)', params: { name: 'string', email: 'string?', phone: 'string?', address: 'string?', city: 'string?', from: 'string?', contact: 'string?', notes: 'string?' } },
  { type: 'update_client', usage: 'Maj client', params: { client_name: 'string?', client_id: 'number?', email: 'string?', phone: 'string?', address: 'string?' } },
  { type: 'list_clients', usage: 'Liste clients', params: {} },
  { type: 'list_emails', usage: 'Lister Gmail / sections', params: { max: 'number?', category: 'clients|fournisseurs|a_repondre|projets?' } },
  { type: 'search_emails', usage: 'Recherche Gmail (query COURT)', params: { query: 'string', max: 'number?' } },
  { type: 'get_email', usage: 'Lire un mail', params: { query: 'string?', index: 'number?', message_id: 'string?' } },
  { type: 'list_mail_threads', usage: 'Fils ERP liés', params: { client_id: 'number?', project_id: 'number?', unlinked: 'boolean?' } },
  { type: 'import_mail_dates_to_project', usage: 'Dates mails → projet / carnet heures', params: { query: 'string', project_name: 'string' } },
  { type: 'create_fabrication_plan', usage: 'Étapes atelier sur un projet', params: { project_name: 'string?', steps: '[{title,type,estimated_minutes}]', notes: 'string?' } },
  { type: 'create_quote', usage: 'Créer devis', params: { title: 'string', amount: 'number?', lines: 'array?', client_id: 'number?' } },
  { type: 'update_quote', usage: 'Modifier devis ouvert', params: { add_line: 'string?', qty: 'number?', price: 'number?', line_match: 'string?', title: 'string?', notes: 'string?', status: 'draft|sent|accepted?' } },
  { type: 'get_quote', usage: 'Lire devis', params: { quote_id: 'number?' } },
  { type: 'send_quote', usage: 'Envoyer devis courriel', params: { quote_id: 'number?' } },
  { type: 'convert_quote', usage: 'Devis → facture', params: { quote_id: 'number?', deposit_percent: 'number?' } },
  { type: 'create_invoice', usage: 'Créer facture (données)', params: { title: 'string?', amount: 'number?' } },
  { type: 'send_invoice', usage: 'Envoyer facture', params: { invoice_id: 'number?' } },
  { type: 'list_quotes', usage: 'Lister devis', params: {} },
  { type: 'list_invoices', usage: 'Lister factures', params: {} },
  { type: 'plan_day', usage: 'Planifier plusieurs tâches demain', params: {} },
  { type: 'list_today', usage: 'Tâches du jour', params: {} },
  { type: 'list_tomorrow', usage: 'Tâches demain', params: {} },
  { type: 'schedule_task', usage: 'Planifier une tâche', params: { task_title: 'string?' } },
  { type: 'create_expense', usage: 'Créer dépense', params: { amount: 'number?', category: 'string?' } },
  { type: 'list_expenses', usage: 'Lister dépenses', params: {} },
  { type: 'search_memory', usage: 'Mémoire atelier', params: { query: 'string' } },
  { type: 'erp_manual', usage: 'Aide manuel ERP', params: { topic: 'string?' } },
  { type: 'demande_modification_erp', usage: 'Lancer Cursor VPS (code/UI)', params: { prompt: 'string?', feature: 'mail_planning|ui_change|…?' } },
  { type: 'atelier_habits', usage: 'Habitudes atelier', params: { rule: 'string?', section: 'string?' } },
  { type: 'list_skills', usage: 'Lister skills', params: {} },
  { type: 'create_skill', usage: 'Créer skill', params: { name: 'string', description: 'string?', triggers: 'string[]?' } },
  { type: 'update_skill', usage: 'Modifier skill', params: { name: 'string', enabled: 'boolean?' } },
];

export const RESPONSE_SCHEMA = {
  type: 'object',
  required: ['reply', 'action'],
  properties: {
    reply: {
      type: 'string',
      description: 'Texte court pour l’utilisateur (français)',
    },
    action: {
      type: 'object',
      required: ['type', 'params'],
      properties: {
        type: {
          type: ['string', 'null'],
          description: `Une des actions: ${ACTION_TYPES.join(' | ')} — ou null si réponse finale`,
        },
        params: {
          type: 'object',
          description: 'Paramètres de l’action (voir catalogue)',
          additionalProperties: true,
        },
      },
    },
    done: {
      type: 'boolean',
      description: 'true = réponse finale à l’utilisateur (pas d’autre action)',
    },
  },
  examples: [
    { reply: 'Je cherche les devis Alexandra…', action: { type: 'create_project_from_quote_email', params: { query: 'Alexandra' } }, done: false },
    { reply: 'Tâche cochée.', action: { type: 'complete_task', params: { project_name: 'Banc Olive', task_title: 'finition' } }, done: false },
    { reply: 'Projets créés à partir des devis. Tout est bon.', action: { type: null, params: {} }, done: true },
  ],
};

/** Schéma du reçu renvoyé à Lia après chaque skill. */
export const ACTION_CHECK_SCHEMA = {
  type: 'object',
  required: ['ok', 'check', 'action_type', 'summary'],
  properties: {
    ok: { type: 'boolean', description: 'true si la skill s’est bien effectuée' },
    check: { type: 'string', enum: ['OK', 'FAIL', 'PARTIAL'], description: 'Statut court pour Lia' },
    skill_executed: { type: 'boolean' },
    action_type: { type: 'string' },
    params: { type: 'object' },
    summary: { type: 'string', description: 'Résultat métier (base de la réponse utilisateur)' },
    actions_count: { type: 'number' },
    executed_action_types: { type: 'array', items: { type: 'string' } },
  },
};

export const USAGE_PROTOCOL = `
PROTOCOLE D'UTILISATION (obligatoire)
1. Réponds UNIQUEMENT en JSON conforme au RESPONSE_SCHEMA — pas de markdown, pas de texte hors JSON.
2. Choisis UNE action pertinente dans le catalogue (action.type). Mets les paramètres dans action.params.
3. Pour mail / client / projet / devis / planification : action.type NE DOIT PAS être null au premier tour.
4. Ne demande PAS à l’utilisateur d’ouvrir une fiche si une action existe (search_*, get_*, create_*, update_*).
5. search_emails.query = mot COURT (nom client), jamais la phrase entière.
6. Canal d’exécution : le backend OU MCP neya_run_action exécute {type, params} puis te renvoie un ACTION_CHECK.
7. ACTION_CHECK (reçu après chaque skill) :
   - check=OK / ok=true → skill effectuée. Appuie-toi sur summary pour parler à l’utilisateur.
   - check=FAIL / ok=false → échec ou info manquante : corrige avec une autre action, ou explique clairement.
   - check=PARTIAL → partiel : continue si utile, sinon finalise honnêtement.
8. Après un ACTION_CHECK : soit une NOUVELLE action (done:false), soit réponse FINALE (action.type null, done:true).
9. Ne réinvente JAMAIS le résultat : la reply finale doit coller au(x) ACTION_CHECK reçu(s).
10. Maximum quelques actions en chaîne ; dès que la demande est satisfaite → done:true.
`.trim();

export async function loadSkillsFromDb() {
  try {
    const { rows } = await pool.query(
      `SELECT name, description, action_type, trigger_patterns, enabled
       FROM assistant_skills WHERE enabled = true ORDER BY name`
    );
    return rows.map(r => ({
      name: r.name,
      description: r.description,
      action_type: r.action_type,
      triggers: r.trigger_patterns || [],
    }));
  } catch {
    return [];
  }
}

export async function buildAssistantProtocol({ includeAutonomyRules = true } = {}) {
  const skills = await loadSkillsFromDb();
  const catalogByType = Object.fromEntries(ACTION_CATALOG.map(a => [a.type, a]));
  const actions = ACTION_TYPES.map(type => catalogByType[type] || { type, usage: type, params: {} });

  return {
    version: PROTOCOL_VERSION,
    role: 'Lia — assistant NEYA ERP (atelier meubles)',
    channel: {
      http: 'POST /api/assistant/chat',
      action: 'POST /api/assistant/action',
      continue: 'POST /api/assistant/continue',
      protocol: 'GET /api/assistant/protocol',
      mcp: {
        list_skills: 'neya_list_skills',
        run_action: 'neya_run_action',
        continue_from_check: 'neya_continue_from_check',
        protocol_resource: 'neya://assistant/protocol',
        chat: 'neya_assistant_message',
      },
    },
    usage_protocol: USAGE_PROTOCOL,
    response_schema: RESPONSE_SCHEMA,
    action_check_schema: ACTION_CHECK_SCHEMA,
    response_format_example: RESPONSE_SCHEMA.examples[0],
    actions,
    skills,
    max_action_steps: MAX_ACTION_STEPS,
    autonomy_rules: includeAutonomyRules
      ? [
        'Agir seule : lancer l’action plutôt que décrire quoi cliquer.',
        'Après chaque ACTION_CHECK : autre action ou réponse finale (done:true).',
        'create_project_from_quote_email pour devis Gmail/PDF → projets.',
        'demande_modification_erp pour changer le code/UI (pas create_invoice).',
      ]
      : [],
  };
}

/** Bloc texte injecté dans le system prompt LLM. */
export async function buildProtocolPromptBlock() {
  const protocol = await buildAssistantProtocol();
  const skillLines = protocol.skills
    .map(s => `- ${s.name} → ${s.action_type}: ${s.description || ''}`)
    .join('\n');
  const actionLines = protocol.actions
    .slice(0, 80)
    .map(a => `- ${a.type}: ${a.usage} | params ${JSON.stringify(a.params)}`)
    .join('\n');

  return `
===== PROTOCOLE IA NEYA (skills + actions + réponse + checks) =====
${protocol.usage_protocol}

FORMAT DE RÉPONSE (JSON strict) :
${JSON.stringify(RESPONSE_SCHEMA.examples[0], null, 2)}
Finale après CHECK : ${JSON.stringify(RESPONSE_SCHEMA.examples[2])}
Schéma : {"reply":"…","action":{"type":"<ACTION_TYPES|null>","params":{…}},"done":true|false}
ACTION_TYPES = ${ACTION_TYPES.join('|')}

ACTION_CHECK (tu le reçois après chaque exécution MCP/backend) :
{"ok":true,"check":"OK","action_type":"…","summary":"…","actions_count":1}
→ si CHECK OK : réponds simplement à partir de summary, ou enchaîne une autre action.
→ si CHECK FAIL : corrige ou explique.

CATALOGUE ACTIONS :
${actionLines}

SKILLS ACTIVÉES (déclencheurs ERP) :
${skillLines || '(aucune skill DB)'}

BOUCLE : ta JSON → exécution → ACTION_CHECK → tu réinterprètes → autre action OU done:true.
===== FIN PROTOCOLE =====
`.trim();
}

function looksLikeFailure(reply, actions) {
  const text = String(reply || '');
  if (/erreur|impossible|échou|echec|échec|inconnu|non connecté|non disponible/i.test(text)) return true;
  if (/introuvable|aucune|précisez|requis/i.test(text) && (!actions || !actions.length)) return true;
  return false;
}

/**
 * Reçu de confirmation pour Lia après exécution d’une skill.
 */
export function buildActionCheck(type, params, result = {}) {
  const reply = String(result.reply || result.error || '');
  const actions = Array.isArray(result.actions) ? result.actions : [];
  const hardError = Boolean(result.error);
  const failed = hardError || looksLikeFailure(reply, actions);
  let check = 'OK';
  if (failed) check = 'FAIL';
  else if (actions.length === 0 && /aucun|vide|pas (de|d')/i.test(reply)) check = 'PARTIAL';

  return {
    ok: check === 'OK',
    check,
    skill_executed: Boolean(type) && !hardError,
    action_type: type || null,
    params: params || {},
    summary: reply.slice(0, 1500),
    actions_count: actions.length,
    executed_action_types: actions.map(a => a.type).filter(Boolean),
    timestamp: new Date().toISOString(),
  };
}

export function liaInstructionForCheck(check) {
  if (!check) return 'Pas de check — réponds honnêtement.';
  if (check.check === 'OK') {
    return 'CHECK OK — skill effectuée. Soit enchaîne une autre action (done:false), soit réponse finale claire basée sur summary (action.type null, done:true).';
  }
  if (check.check === 'PARTIAL') {
    return 'CHECK PARTIAL — résultat partiel. Continue avec une autre action si utile, sinon finalise (done:true) en restant fidèle au summary.';
  }
  return 'CHECK FAIL — skill non effectuée ou échouée. Corrige avec une autre action / autres params, ou explique clairement à l’utilisateur (done:true).';
}

export function parseLiaDecision(parsed) {
  if (!parsed || typeof parsed !== 'object') return { actionType: null, actionParams: {}, reply: '', done: true };
  let actionType = parsed.action?.type ?? parsed.action_type ?? null;
  let actionParams = parsed.action?.params || parsed.params || {};
  if (!actionType && Array.isArray(parsed.actions) && parsed.actions[0]) {
    actionType = parsed.actions[0].type || parsed.actions[0].action_type;
    actionParams = parsed.actions[0].params || {};
  }
  if (actionType === 'null' || actionType === 'none' || actionType === '') actionType = null;
  const done = parsed.done === true || actionType == null;
  return {
    actionType,
    actionParams: actionParams || {},
    reply: String(parsed.reply || ''),
    done,
  };
}

/**
 * Exécute une action + enveloppe ACTION_CHECK pour Lia / MCP.
 */
export async function executeProtocolAction({ type, params = {}, message = '', pageContext = null }) {
  if (!type) {
    const empty = { reply: 'Aucune action demandée (action.type null).', actions: [] };
    const check = buildActionCheck(null, params, empty);
    return { ...empty, check, lia_instruction: liaInstructionForCheck(check) };
  }
  if (!ACTION_TYPES.includes(type)) {
    const empty = {
      reply: `Action inconnue « ${type} ». Actions valides : ${ACTION_TYPES.slice(0, 20).join(', ')}…`,
      actions: [],
      error: 'unknown_action',
    };
    const check = buildActionCheck(type, params, empty);
    return { ...empty, check, lia_instruction: liaInstructionForCheck(check) };
  }
  try {
    const { runSkillAction } = await import('./skill-actions.js');
    const synthetic = Object.keys(params || {}).length
      ? `${JSON.stringify(params)} ${message || ''}`.trim()
      : (message || type);
    const result = await runSkillAction(type, synthetic, pageContext, {}, params);
    const check = buildActionCheck(type, params, result);
    return {
      ...result,
      check,
      lia_instruction: liaInstructionForCheck(check),
    };
  } catch (err) {
    const empty = { reply: `Erreur skill « ${type} » : ${err.message}`, actions: [], error: err.message };
    const check = buildActionCheck(type, params, empty);
    return { ...empty, check, lia_instruction: liaInstructionForCheck(check) };
  }
}

export function buildCheckFeedbackMessage({ userMessage, checks, step }) {
  const last = checks[checks.length - 1];
  return `
[RETOUR EXÉCUTION — étape ${step}]
Demande utilisateur d'origine : ${String(userMessage || '').slice(0, 800)}

ACTION_CHECK :
${JSON.stringify(last, null, 2)}

${liaInstructionForCheck(last)}

Checks précédents : ${JSON.stringify(checks.map(c => ({ check: c.check, action_type: c.action_type, ok: c.ok })))}

Réponds en JSON : soit une nouvelle action, soit {"reply":"…résumé pour l'utilisateur…","action":{"type":null,"params":{}},"done":true}
`.trim();
}

/**
 * Lia réinterprète un ou plusieurs ACTION_CHECK (sans exécuter).
 */
export async function continueFromChecks({
  userMessage,
  checks = [],
  history = [],
  pageContext = null,
}) {
  const { callAssistantLLM } = await import('./ai-chat.js');
  const checkMsg = buildCheckFeedbackMessage({
    userMessage,
    checks: checks.length ? checks : [{ ok: false, check: 'FAIL', action_type: null, summary: 'Aucun check fourni', params: {} }],
    step: checks.length || 1,
  });
  const hist = [
    ...(history || []),
    { role: 'user', content: String(userMessage || '').slice(0, 1000) },
    {
      role: 'assistant',
      content: JSON.stringify({
        reply: 'Action exécutée, j’attends le check.',
        action: { type: checks[checks.length - 1]?.action_type || null, params: {} },
        done: false,
      }),
    },
  ];
  const parsed = await callAssistantLLM(checkMsg, hist, pageContext);
  if (!parsed) {
    const last = checks[checks.length - 1];
    return {
      reply: last?.summary || 'Action terminée.',
      action: { type: null, params: {} },
      done: true,
      checks,
    };
  }
  const decision = parseLiaDecision(parsed);
  return {
    reply: decision.reply || lastSummary(checks),
    action: { type: decision.actionType, params: decision.actionParams },
    done: decision.done,
    checks,
    raw: parsed,
  };
}

function lastSummary(checks) {
  return checks[checks.length - 1]?.summary || 'OK';
}

/**
 * Boucle Lia complète : décision → exécution → check → réinterprétation → …
 * Utilisée par le chat ERP (et optionnellement MCP).
 */
export async function runLiaActionLoop({
  message,
  history = [],
  pageContext = null,
  maxSteps = MAX_ACTION_STEPS,
  initialParsed = null,
}) {
  const { callAssistantLLM } = await import('./ai-chat.js');

  let parsed = initialParsed;
  if (!parsed) {
    parsed = await callAssistantLLM(message, history, pageContext);
  }
  if (!parsed) return null;

  const allActions = [];
  const checks = [];
  let lastUserFacingReply = String(parsed.reply || '');
  let loopHistory = [...(history || [])];

  for (let step = 0; step < maxSteps; step++) {
    const decision = parseLiaDecision(parsed);

    // Pas d’action → réponse finale pour l’utilisateur
    if (!decision.actionType) {
      return {
        reply: decision.reply || lastUserFacingReply || lastSummary(checks) || 'OK',
        actions: allActions,
        checks,
        done: true,
        steps: step,
      };
    }

    if (!ACTION_TYPES.includes(decision.actionType)) {
      return {
        reply: decision.reply || `Action inconnue « ${decision.actionType} ».`,
        actions: allActions,
        checks,
        done: true,
        steps: step,
      };
    }

    const exec = await executeProtocolAction({
      type: decision.actionType,
      params: decision.actionParams,
      message,
      pageContext,
    });
    checks.push(exec.check);
    if (exec.actions?.length) allActions.push(...exec.actions);
    lastUserFacingReply = exec.reply || decision.reply || lastUserFacingReply;

    loopHistory = [
      ...loopHistory,
      { role: 'user', content: step === 0 ? message : `Suite demande: ${String(message).slice(0, 400)}` },
      {
        role: 'assistant',
        content: JSON.stringify({
          reply: decision.reply,
          action: { type: decision.actionType, params: decision.actionParams },
          done: false,
        }),
      },
    ];

    const checkMsg = buildCheckFeedbackMessage({ userMessage: message, checks, step: step + 1 });
    parsed = await callAssistantLLM(checkMsg, loopHistory, pageContext);

    if (!parsed) {
      return {
        reply: lastUserFacingReply,
        actions: allActions,
        checks,
        done: true,
        steps: step + 1,
      };
    }
  }

  return {
    reply: lastUserFacingReply || lastSummary(checks),
    actions: allActions,
    checks,
    done: true,
    steps: maxSteps,
  };
}

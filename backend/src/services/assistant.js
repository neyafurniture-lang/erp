import pool from '../db/pool.js';
import { tryMemoryCommand } from './assistant-memory.js';
import {
  ACTION_TYPES,
  extractAmount,
  extractMoneyAmount,
  extractQuotedText,
  extractAfterKeyword,
  createProjectFromStandard,
  isDayPlanMessage,
  runSkillAction,
  wantsUnlinkFromProject,
} from './skill-actions.js';

export { ACTION_TYPES };

async function matchSkill(message) {
  const { rows: skills } = await pool.query('SELECT * FROM assistant_skills WHERE enabled = true ORDER BY id');
  const lower = message.toLowerCase();
  let best = null;
  let bestLen = 0;
  for (const skill of skills) {
    const patterns = skill.trigger_patterns || [];
    for (const p of patterns) {
      const pl = p.toLowerCase();
      if (lower.includes(pl) && pl.length > bestLen) {
        best = skill;
        bestLen = pl.length;
      }
    }
  }
  return best;
}

async function enrichPageContext(ctx) {
  if (!ctx?.type || !ctx?.id) return null;

  if (ctx.type === 'project') {
    const { rows } = await pool.query(`
      SELECT p.*, c.name AS client_name
      FROM projects p
      LEFT JOIN clients c ON c.id = p.client_id
      WHERE p.id = $1
    `, [ctx.id]);
    if (!rows[0]) return null;
    const { rows: tasks } = await pool.query(
      'SELECT id, title, status, sort_order, type FROM tasks WHERE project_id = $1 ORDER BY sort_order, id',
      [ctx.id]
    );
    let clientProjects = [];
    if (rows[0].client_id) {
      const { rows: cps } = await pool.query(
        `SELECT id, name, status, deadline
         FROM projects
         WHERE client_id = $1
         ORDER BY CASE WHEN status = 'active' THEN 0 ELSE 1 END, created_at DESC
         LIMIT 12`,
        [rows[0].client_id]
      );
      clientProjects = cps;
    }
    return {
      ...ctx,
      label: rows[0].name,
      project: rows[0],
      tasks,
      isCustom: !rows[0].standard_id,
      client_id: rows[0].client_id || null,
      client_name: rows[0].client_name || null,
      clientProjects,
    };
  }

  if (ctx.type === 'client') {
    const { rows } = await pool.query('SELECT * FROM clients WHERE id = $1', [ctx.id]);
    if (!rows[0]) return null;
    const { rows: projects } = await pool.query(
      `SELECT id, name, status, deadline, budget_estimated
       FROM projects
       WHERE client_id = $1
       ORDER BY CASE WHEN status = 'active' THEN 0 ELSE 1 END, created_at DESC
       LIMIT 15`,
      [ctx.id]
    );
    return {
      ...ctx,
      label: rows[0].name,
      client: rows[0],
      client_id: ctx.id,
      projects,
    };
  }

  if (ctx.type === 'standard') {
    const { rows } = await pool.query('SELECT * FROM standards WHERE id = $1', [ctx.id]);
    if (!rows[0]) return null;
    const meta = typeof rows[0].meta === 'string' ? JSON.parse(rows[0].meta) : rows[0].meta;
    return { ...ctx, label: rows[0].name, standard: rows[0], sku: meta?.sku };
  }

  if (ctx.type === 'quote') {
    const { rows } = await pool.query(`
      SELECT q.*, c.name AS client_name, c.email AS client_email, p.name AS project_name
      FROM quotes q
      LEFT JOIN clients c ON c.id = q.client_id
      LEFT JOIN projects p ON p.id = q.project_id
      WHERE q.id = $1
    `, [ctx.id]);
    if (!rows[0]) return null;
    const q = rows[0];
    const lines = typeof q.lines === 'string' ? JSON.parse(q.lines || '[]') : (q.lines || []);
    return {
      ...ctx,
      label: q.title || q.quote_number || `Devis #${q.id}`,
      quote: { ...q, lines },
      client_id: q.client_id,
      project_id: q.project_id,
    };
  }

  if (ctx.type === 'invoice') {
    const { rows } = await pool.query(`
      SELECT i.*, c.name AS client_name, p.name AS project_name
      FROM invoices i
      LEFT JOIN clients c ON c.id = i.client_id
      LEFT JOIN projects p ON p.id = i.project_id
      WHERE i.id = $1
    `, [ctx.id]);
    if (!rows[0]) return null;
    const inv = rows[0];
    const lines = typeof inv.lines === 'string' ? JSON.parse(inv.lines || '[]') : (inv.lines || []);
    return {
      ...ctx,
      label: inv.title || inv.invoice_number || `Facture #${inv.id}`,
      invoice: { ...inv, lines },
      client_id: inv.client_id,
      project_id: inv.project_id,
    };
  }

  return ctx;
}

function contextPrefix(ctx) {
  if (!ctx) return '';
  if (ctx.type === 'project') {
    const custom = ctx.isCustom ? ' (checklist atelier)' : ' (fiche catalogue)';
    const pending = ctx.tasks?.filter(t => t.status !== 'done').length ?? 0;
    const clientBit = ctx.client_name ? ` — client « ${ctx.client_name} »` : '';
    const hist = Array.isArray(ctx.clientProjects) && ctx.clientProjects.length > 1
      ? ` — ${ctx.clientProjects.length} projets client en historique`
      : '';
    return `[Contexte page : projet « ${ctx.label} »${custom}${clientBit}${hist}${pending ? ` — ${pending} tâche(s) en cours` : ''}]\n`;
  }
  if (ctx.type === 'client') {
    const n = Array.isArray(ctx.projects) ? ctx.projects.length : 0;
    return `[Contexte page : client « ${ctx.label} »${n ? ` — ${n} projet(s) historique` : ''}]\n`;
  }
  if (ctx.type === 'standard') return `[Contexte page : fiche « ${ctx.label} »${ctx.sku ? ` (${ctx.sku})` : ''}]\n`;
  if (ctx.type === 'quote') {
    const q = ctx.quote;
    const n = Array.isArray(q?.lines) ? q.lines.length : 0;
    return `[Contexte page : devis « ${ctx.label} » (${q?.quote_number || '#' + ctx.id}) — ${q?.status || '?'} — ${n} ligne(s) — ${q?.client_name || 'sans client'}]\n`;
  }
  if (ctx.type === 'invoice') {
    return `[Contexte page : facture « ${ctx.label} » (${ctx.invoice?.invoice_number || '#' + ctx.id})]\n`;
  }
  return '';
}

async function executeSkill(skill, message, pageContext = null, actionParams = null) {
  const actionType = skill.action_type;

  if (actionType === 'list_skills') {
    const skills = await getSkills();
    const list = skills.map(s => {
      const patterns = (s.trigger_patterns || []).slice(0, 3).join(', ');
      return `${s.enabled ? '✓' : '○'} ${s.name} → ${s.action_type}${patterns ? ` (${patterns}…)` : ''}`;
    }).join('\n');
    return {
      reply: `Skills NEYA (${skills.length}) — modifiables via « activer/désactiver skill X » :\n${list}\n\nTypes d'action : ${ACTION_TYPES.join(', ')}`,
      actions: [{ type: 'list_skills', data: skills }],
    };
  }

  if (actionType === 'create_skill') {
    return handleCreateSkillFromChat(message);
  }

  if (actionType === 'update_skill') {
    return handleUpdateSkillFromChat(message);
  }

  return runSkillAction(actionType, message, pageContext, skill, actionParams);
}

function parseSkillName(message) {
  const quoted = extractQuotedText(message);
  if (quoted) return quoted;
  const m = message.match(/skill\s+([a-z0-9_-]+)/i);
  return m ? m[1] : null;
}

function parseTriggersFromMessage(message) {
  const m = message.match(/déclencheurs?\s+(.+?)(?:\s+pour\s+|\s+action\s+|$)/i)
    || message.match(/triggers?\s+(.+?)(?:\s+for\s+|\s+action\s+|$)/i);
  if (m) return m[1].split(/[,;]/).map(s => s.trim()).filter(Boolean);
  return null;
}

function parseActionTypeFromMessage(message) {
  const m = message.match(/action\s+([a-z_]+)/i);
  if (m && ACTION_TYPES.includes(m[1])) return m[1];
  for (const t of ACTION_TYPES) {
    if (message.toLowerCase().includes(t)) return t;
  }
  return null;
}

async function handleCreateSkillFromChat(message) {
  const name = parseSkillName(message) || extractAfterKeyword(message, ['skill', 'capacité', 'capacite']);
  const actionType = parseActionTypeFromMessage(message);
  const triggers = parseTriggersFromMessage(message);

  if (!name || !actionType) {
    return {
      reply: 'Format : « ajouter skill « mon_skill » déclencheurs mot1,mot2 action complete_task »\n'
        + `Actions valides : ${ACTION_TYPES.join(', ')}`,
      actions: [],
    };
  }

  const patterns = triggers?.length ? triggers : [name.replace(/_/g, ' ')];
  try {
    const skill = await createSkill({
      name: name.replace(/\s+/g, '_').toLowerCase(),
      description: `Créé via chat — ${actionType}`,
      trigger_patterns: patterns,
      action_type: actionType,
    });
    return {
      reply: `Skill « ${skill.name} » créée (${actionType}) — déclencheurs : ${patterns.join(', ')}`,
      actions: [{ type: 'create_skill', data: skill }],
    };
  } catch (err) {
    return { reply: `Impossible de créer la skill : ${err.message}`, actions: [] };
  }
}

async function handleUpdateSkillFromChat(message) {
  const name = parseSkillName(message);
  if (!name) {
    return { reply: 'Précisez le nom : « activer skill create_task » ou « désactiver skill list_today »', actions: [] };
  }

  const { rows } = await pool.query('SELECT * FROM assistant_skills WHERE name ILIKE $1', [name]);
  const skill = rows[0];
  if (!skill) return { reply: `Skill « ${name} » introuvable.`, actions: [] };

  const updates = {};
  if (/désactiver|desactiver|disable/i.test(message)) updates.enabled = false;
  else if (/activer|enable/i.test(message)) updates.enabled = true;

  const newTriggers = parseTriggersFromMessage(message);
  if (newTriggers) updates.trigger_patterns = newTriggers;

  const newAction = parseActionTypeFromMessage(message);
  if (newAction && /action|type/i.test(message)) updates.action_type = newAction;

  if (!Object.keys(updates).length) {
    return {
      reply: `Skill « ${skill.name} » : ${skill.enabled ? 'active' : 'inactive'}, action ${skill.action_type}, déclencheurs ${(skill.trigger_patterns || []).join(', ')}`,
      actions: [],
    };
  }

  const updated = await updateSkill(skill.id, updates);
  return {
    reply: `Skill « ${updated.name} » mise à jour.${updated.enabled ? ' (active)' : ' (désactivée)'}`,
    actions: [{ type: 'update_skill', data: updated }],
  };
}

async function tryOpenAI(message, history, pageContext = null) {
  const { callAssistantLLM } = await import('./ai-chat.js');
  const { ACTION_TYPES } = await import('./skill-actions.js');

  const parsed = await callAssistantLLM(message, history, pageContext);
  if (!parsed) return null;

  let actionType = parsed.action?.type || parsed.action_type || null;
  let actionParams = parsed.action?.params || parsed.params || {};
  // Compat si le modèle renvoie "actions": [{ type }]
  if (!actionType && Array.isArray(parsed.actions) && parsed.actions[0]) {
    actionType = parsed.actions[0].type || parsed.actions[0].action_type;
    actionParams = parsed.actions[0].params || {};
  }
  if (actionType === 'null' || actionType === 'none') actionType = null;

  // Garde-fou routeur : info matériel ≠ tâche, Cursor seulement sur demande explicite
  try {
    const { validateLlmAction } = await import('./ai-router.js');
    const check = validateLlmAction(actionType, message, pageContext);
    actionType = check.valid ? check.actionType : null;
  } catch { /* routeur indisponible — garder l'action telle quelle */ }

  if (actionType && ACTION_TYPES.includes(actionType)) {
    const fakeSkill = { action_type: actionType, name: actionType };
    const result = await executeSkill(fakeSkill, message, pageContext, actionParams || {});
    return { reply: parsed.reply || result.reply, actions: result.actions };
  }
  return { reply: parsed.reply || 'OK', actions: [] };
}

function contextExamples(ctx) {
  if (ctx.type === 'project') {
    return '• « Cocher finition »\n• « Demain finition banc olive, mail client »\n• « Dépense 120$ matériaux »\n• « Liste tâches »';
  }
  if (ctx.type === 'client') {
    return '• « Nouveau projet »\n• « Email client@exemple.com »\n• « Liste projets »\n• « Créer devis »';
  }
  if (ctx.type === 'quote') {
    return '• « Ajoute une ligne caissons 2400$ »\n• « Change le prix de la table à 1800 »\n• « Titre Devis ENNS v2 »\n• « Retiens que le client veut livraison en août »\n• « Envoyer devis »';
  }
  return '• « Créer projet depuis cette fiche »';
}

export function detectAttachmentIntent(message, attachments = []) {
  if (attachments.length > 0) return null;
  const m = message.toLowerCase();

  // L'utilisateur parle d'un mail déjà reçu — ne pas demander de joindre via le trombone
  if (/mail|courriel|gmail|envoi|envoy[eé]|bo[iî]te|cherche.*facture|facture.*mail|celle du mail|du mail de|dans les mail/i.test(m)) {
    return null;
  }

  if (/(?:joindre|pi[eè]ce jointe|attacher|envoyer (?:un |le |la |les )?(?:fichier|photo|plan|pdf|reçu|recu|document|image))/i.test(m)) {
    return { hint: 'votre fichier (photo, PDF, plan…)' };
  }
  if (/(?:voici (?:le |la |un |une )?(?:plan|photo|fichier|pdf|reçu|recu))/i.test(m)) {
    return { hint: 'le fichier mentionné' };
  }
  // Ne pas bloquer « dépense 85$ » / « créer facture 500 » — montant explicite = skill, pas PJ
  if (/(?:dépense|depense|reçu|recu|facture)/i.test(m) && /\d+/.test(m)
    && !/(\d+(?:[.,]\d+)?)\s*\$/.test(m)
    && !/(?:cr[eé]er?|nouvelle?|enregistrer|ajoute|ajouter|saisir)\b/i.test(m)) {
    return { hint: 'le reçu ou la facture' };
  }
  return null;
}

export function wantsEmailAttachmentImport(message, history = []) {
  const m = String(message || '').toLowerCase();
  if (/mail|courriel|gmail|envoi|envoy/i.test(m) && /facture|re[cç]u|invoice|facturation|document|pdf|pi[eè]ce jointe|pj\b/i.test(m)) {
    return true;
  }
  if (/cherche|trouve|ouvre|lis|montre|rentre|entre|saisir|classer|ranger|importer/i.test(m) && /mail|courriel|gmail/i.test(m)) {
    return true;
  }
  if (/celle du mail|du mail de|mail de/i.test(m)) return true;
  if (/rentre|entre|saisir|importer/i.test(m) && /facture|re[cç]u|invoice/i.test(m)) {
    const recent = (history || []).slice(-6).map(h => String(h.content || '')).join(' ').toLowerCase();
    if (/mail|courriel|gmail|olive|envoi|facturation/i.test(recent)) return true;
  }
  return false;
}

function needsHistoryContext(message) {
  const m = message.trim();
  if (m.length < 80 && /^(oui|ok|non|celui|celle|ce\s|ça|ca|le premier|la première|sur celui|ce projet|même|meme|aussi|pour lui|pour elle|celui-là|celle-là)/i.test(m)) {
    return true;
  }
  return /^(crée|creer|ajoute|cocher|modifier|supprime|envoie|planifie)\b/i.test(m) && m.length < 60;
}

function enrichMessageWithHistory(message, history) {
  if (!history?.length || !needsHistoryContext(message)) return message;
  const recent = history.slice(-6).map(h => {
    const who = h.role === 'user' ? 'Utilisateur' : 'Lia';
    const text = String(h.content || '').replace(/\n\[Contexte page[^\]]*\]/g, '').trim();
    return `${who}: ${text.slice(0, 500)}`;
  }).join('\n');
  return `${message}\n\n[Suite de conversation — ne redemande pas ce qui est déjà ci-dessus]\n${recent}`;
}

function wantsFabricationPlan(message) {
  const m = String(message || '').toLowerCase();
  return /plan\s*(de\s*)?fabrication|checklist\s*(atelier|prod)?|étapes?\s+(atelier|prod|fabrication)|creer?\s+(les\s+)?étapes|crée\s+(les\s+)?étapes|a\s+partir\s+de|à\s+partir\s+de|linker|lier\s+(au\s+)?projet|dans\s+le\s+projet|ajoute\s+(les\s+)?étapes/.test(m);
}

async function buildFabricationFromAttachments(message, attachments, pageContext) {
  const {
    extractAllAttachments,
    formatExtractsForPrompt,
    proposeFabricationPlanFromText,
  } = await import('./attachment-extract.js');

  const extracts = await extractAllAttachments(attachments);
  const hasText = extracts.some(e => (e.text || '').trim().length > 40);
  if (!hasText) {
    return {
      reply: `Fichier(s) reçu(s) (${attachments.map(a => a.name).join(', ')}), mais je n'ai pas pu en extraire assez de texte.\n`
        + 'Réessayez avec un PDF texte, un .txt, ou une capture claire — ou listez les étapes à créer.',
      actions: [{ type: 'store_attachments', data: attachments }],
      attachments,
    };
  }

  const projectHint = pageContext?.type === 'project' ? pageContext.label : null;
  const proposed = await proposeFabricationPlanFromText({ message, extracts, projectHint });
  if (!proposed) {
    return {
      reply: `J'ai lu le fichier, mais je n'ai pas pu construire un plan clair. Contenu extrait (extrait) :\n`
        + `${extracts.map(e => e.text).join('\n').slice(0, 800)}\n\n`
        + 'Précisez le projet et les étapes, ou rouvrez le projet et renvoyez.',
      actions: [{ type: 'store_attachments', data: attachments }],
      attachments,
    };
  }

  const result = await runSkillAction('create_fabrication_plan', message, pageContext, {}, {
    project_name: proposed.project_query || proposed.project_name,
    project_query: proposed.project_query,
    steps: proposed.steps,
    notes: proposed.notes || proposed.summary,
    summary: proposed.summary,
    source_files: attachments.map(a => a.name),
    link_email: proposed.link_email,
  });

  return {
    reply: result.reply,
    actions: [...(result.actions || []), { type: 'store_attachments', data: attachments }],
    attachments,
  };
}

export async function processMessage(message, attachments = [], rawContext = null) {
  const pageContext = await enrichPageContext(rawContext);

  let attachmentExtractNote = '';
  let extracts = [];
  if (attachments.length) {
    try {
      const { extractAllAttachments, formatExtractsForPrompt } = await import('./attachment-extract.js');
      extracts = await extractAllAttachments(attachments);
      attachmentExtractNote = formatExtractsForPrompt(extracts);
    } catch (err) {
      attachmentExtractNote = `\n[Extraction fichiers échouée: ${err.message}]`;
    }
  }

  const attachmentNote = attachments.length
    ? `\n[${attachments.length} fichier(s): ${attachments.map(a => a.name).join(', ')}]`
    : '';

  const contextNote = pageContext ? `\n${contextPrefix(pageContext).trim()}` : '';
  const storedUserMsg = message + attachmentNote + contextNote;

  await pool.query(
    'INSERT INTO assistant_messages (role, content, attachments) VALUES ($1,$2,$3)',
    ['user', storedUserMsg, JSON.stringify(attachments)]
  );

  // Historique : saute le message qu'on vient d'insérer (OFFSET 1)
  const { rows: history } = await pool.query(
    'SELECT role, content FROM assistant_messages ORDER BY created_at DESC LIMIT 20 OFFSET 1'
  );
  const chronHistory = history.reverse();
  const contextualMessage = enrichMessageWithHistory(
    message + attachmentNote + contextNote + attachmentExtractNote,
    chronHistory
  );

  const memoryResult = await tryMemoryCommand(message, {
    projectId: pageContext?.type === 'project' ? pageContext.id : pageContext?.project_id || null,
    clientId: pageContext?.type === 'client' ? pageContext.id : pageContext?.client_id || null,
    quoteId: pageContext?.type === 'quote' ? pageContext.id : null,
  });
  if (memoryResult.handled) {
    await pool.query(
      'INSERT INTO assistant_messages (role, content, actions_taken) VALUES ($1,$2,$3)',
      ['assistant', memoryResult.reply, JSON.stringify(memoryResult.actions || [])]
    );
    return memoryResult;
  }

  // Facture / doc dans un mail Gmail — chercher et importer sans demander le trombone
  if (!attachments.length && wantsEmailAttachmentImport(message, chronHistory)) {
    const mailImport = await runSkillAction('import_email_attachment', contextualMessage, pageContext);
    await pool.query(
      'INSERT INTO assistant_messages (role, content, actions_taken, attachments) VALUES ($1,$2,$3,$4)',
      ['assistant', mailImport.reply, JSON.stringify(mailImport.actions || []), JSON.stringify(mailImport.attachments || [])]
    );
    return mailImport;
  }

  const attachIntent = detectAttachmentIntent(message, attachments);
  if (attachIntent) {
    const attachResult = {
      reply: `📎 Appuyez sur « Joindre » pour ajouter ${attachIntent.hint}, puis renvoyez votre message.`,
      actions: [{ type: 'request_attachment', data: attachIntent }],
      attachments: [],
    };
    await pool.query(
      'INSERT INTO assistant_messages (role, content, actions_taken, attachments) VALUES ($1,$2,$3,$4)',
      ['assistant', attachResult.reply, JSON.stringify(attachResult.actions), '[]']
    );
    return attachResult;
  }

  // Fichier + demande de plan / lien projet → exécuter vraiment (ne pas juste « j'ai reçu »)
  if (attachments.length && wantsFabricationPlan(message)) {
    const fab = await buildFabricationFromAttachments(message, attachments, pageContext);
    await pool.query(
      'INSERT INTO assistant_messages (role, content, actions_taken, attachments) VALUES ($1,$2,$3,$4)',
      ['assistant', fab.reply, JSON.stringify(fab.actions || []), JSON.stringify(fab.attachments || [])]
    );
    return fab;
  }

  // Toute pièce jointe → lire / classer / ranger (pas seulement « reçu »)
  if (attachments.length) {
    const studied = await handleAttachments(message, attachments, pageContext, extracts);
    await pool.query(
      'INSERT INTO assistant_messages (role, content, actions_taken, attachments) VALUES ($1,$2,$3,$4)',
      ['assistant', studied.reply, JSON.stringify(studied.actions || []), JSON.stringify(studied.attachments || [])]
    );
    return studied;
  }

  // Fast-path : skill sûre (lecture / sync / manuel) matchée avec confiance → pas d'appel LLM
  try {
    const { SKILL_ONLY_ACTIONS, isHighConfidenceSkillMatch, needsLlmParsing } = await import('./ai-router.js');
    const fastSkill = await matchSkill(message);
    if (
      fastSkill
      && SKILL_ONLY_ACTIONS.has(fastSkill.action_type)
      && isHighConfidenceSkillMatch(fastSkill, message)
      && message.trim().length <= 80
      && !needsLlmParsing(message, pageContext)
    ) {
      const fast = await executeSkill(fastSkill, contextualMessage, pageContext);
      await pool.query(
        'INSERT INTO assistant_messages (role, content, actions_taken) VALUES ($1,$2,$3)',
        ['assistant', fast.reply, JSON.stringify(fast.actions || [])]
      );
      return fast;
    }
  } catch { /* routeur indisponible — continuer avec le LLM */ }

  // Correction « pas lié à ce projet » avant le LLM (évite de recréer la tâche dans le projet ouvert)
  if (wantsUnlinkFromProject(message)) {
    const unlinkResult = await runSkillAction('unlink_task', message, pageContext);
    await pool.query(
      'INSERT INTO assistant_messages (role, content, actions_taken) VALUES ($1,$2,$3)',
      ['assistant', unlinkResult.reply, JSON.stringify(unlinkResult.actions || [])]
    );
    return unlinkResult;
  }

  // Devis Gmail/PDF → projets (avant LLM / create_project générique)
  {
    const { detectCreateProjectFromQuoteEmailIntent } = await import('./project-from-quote-email.js');
    if (detectCreateProjectFromQuoteEmailIntent(message)) {
      const quoteImport = await runSkillAction('create_project_from_quote_email', message, pageContext);
      await pool.query(
        'INSERT INTO assistant_messages (role, content, actions_taken) VALUES ($1,$2,$3)',
        ['assistant', quoteImport.reply, JSON.stringify(quoteImport.actions || [])]
      );
      return quoteImport;
    }
  }

  async function runKeywordActions(msg = message) {
    if (isDayPlanMessage(msg)) {
      return runSkillAction('plan_day', msg, pageContext);
    }
    if (wantsUnlinkFromProject(msg)) {
      return runSkillAction('unlink_task', msg, pageContext);
    }
    const { detectCreateProjectFromQuoteEmailIntent } = await import('./project-from-quote-email.js');
    if (detectCreateProjectFromQuoteEmailIntent(msg)) {
      return runSkillAction('create_project_from_quote_email', msg, pageContext);
    }
    const skill = await matchSkill(msg);
    if (skill) return executeSkill(skill, msg, pageContext);
    if (/cocher|marquer|termin|fait|complét/i.test(msg) && /tâche|étape|finition|débitage|assemblage|projet|sur /i.test(msg)) {
      return runSkillAction('complete_task', msg, pageContext);
    }
    if (/supprimer|retirer|effacer/i.test(msg) && /tâche|étape/i.test(msg)) {
      return runSkillAction('delete_task', msg, pageContext);
    }
    if (/ajouter|ajoute|étape|checklist|nouvelle tâche|créer tâche|t[aâ]che\s+admin/i.test(msg)) {
      return runSkillAction('create_task', msg, pageContext);
    }
    if (/descriptif|description|note(s)? (du )?projet|modifier (le )?projet|deadline|budget|renommer projet/i.test(msg)) {
      return runSkillAction('update_project', msg, pageContext);
    }
    if (pageContext?.type === 'project' && /modifier|deadline|budget|renommer/i.test(msg)) {
      return runSkillAction('update_project', msg, pageContext);
    }
    if (/cherche.*(projet|mémoire)|trouve.*(projet)|anciens? projets|projets? termin/i.test(msg)) {
      if (/mémoire|souvenir/i.test(msg)) return runSkillAction('search_memory', msg, pageContext);
      return runSkillAction('search_projects', msg, pageContext);
    }
    if (pageContext?.type === 'client' && /projet|nouveau/i.test(msg)) {
      return runSkillAction('create_project', msg, pageContext);
    }
    if (pageContext?.type === 'client' && /email|téléphone|telephone|renommer|modifier/i.test(msg)) {
      return runSkillAction('update_client', msg, pageContext);
    }
    if (pageContext?.type === 'standard' && /projet|créer|depuis/i.test(msg)) {
      return createProjectFromStandard(pageContext, msg);
    }
    if (pageContext?.type === 'quote') {
      if (/envoie|envoyer|mail devis/i.test(msg)) return runSkillAction('send_quote', msg, pageContext);
      if (/convertir|facturer|acompte/i.test(msg)) return runSkillAction('convert_quote', msg, pageContext);
      if (/montre|voir|détail|contenu|lignes du devis|lis le devis/i.test(msg)) {
        return runSkillAction('get_quote', msg, pageContext);
      }
      if (/ajoute|ajouter|ligne|prix|change|modifie|titre|note|supprime|retire|status|statut|brouillon|accept/i.test(msg)) {
        return runSkillAction('update_quote', msg, pageContext);
      }
    }
    if (wantsEmailAttachmentImport(msg)) {
      return runSkillAction('import_email_attachment', msg, pageContext);
    }
    return null;
  }

  let result = await tryOpenAI(contextualMessage, chronHistory, pageContext);

  // Si Claude répond sans action ERP, tenter les skills (liste projets, cocher, etc.)
  if (result && (!result.actions || result.actions.length === 0)) {
    const skillResult = await runKeywordActions(contextualMessage);
    if (skillResult?.actions?.length) {
      result = {
        reply: skillResult.reply || result.reply,
        actions: skillResult.actions,
        attachments: skillResult.attachments,
      };
    }
  }

  if (!result) {
    result = await runKeywordActions(contextualMessage);
    if (!result) {
      if (pageContext) {
        result = {
          reply: `${contextPrefix(pageContext).trim()}\n\nExemples :\n${contextExamples(pageContext)}\n\n• « Liste skills » pour voir les capacités`,
          actions: [],
        };
      } else {
        result = {
          reply: `Commandes ERP :\n• Planifier : « Demain finition banc olive, mail The NNS »\n• Créer : tâche, projet, client, dépense\n• Modifier : cocher tâche, deadline, budget, email client\n• Lister : tâches du jour, demain, projets, clients, dépenses, skills\n• Gérer skills : « liste skills », « activer skill X »\n\nJoignez photos, PDF ou reçus — je les lis, classe et range.`,
          actions: [],
        };
      }
    }
  }

  await pool.query(
    'INSERT INTO assistant_messages (role, content, actions_taken, attachments) VALUES ($1,$2,$3,$4)',
    ['assistant', result.reply, JSON.stringify(result.actions || []), JSON.stringify(result.attachments || [])]
  );

  return result;
}

async function handleAttachments(message, attachments, pageContext = null, preExtracts = null) {
  const {
    extractAllAttachments,
    classifyAndStudyAttachments,
    formatStudyReply,
  } = await import('./attachment-extract.js');

  const extracts = preExtracts?.length ? preExtracts : await extractAllAttachments(attachments);
  const names = attachments.map(a => a.name).filter(Boolean);
  const projectHint = pageContext?.type === 'project' ? pageContext.label : null;
  const projectId = pageContext?.type === 'project' ? pageContext.id : null;

  const study = await classifyAndStudyAttachments({ message, extracts, projectHint });
  const actions = [{ type: 'document_classified', data: { ...study, files: names } }];
  const extras = [];

  // Demande explicite de plan → pipeline fabrication
  if (wantsFabricationPlan(message) || (study.suggested_actions || []).includes('fabrication_plan') && /plan|étape|fabrication|checklist/i.test(message)) {
    return buildFabricationFromAttachments(message, attachments, pageContext);
  }

  // Ticket / facture → dépense si montant ou intention claire
  const wantsExpense = (study.suggested_actions || []).includes('expense')
    || /dépense|facture|reçu|acheté|ticket/i.test(message)
    || study.doc_type === 'receipt'
    || study.doc_type === 'supplier_invoice';

  if (wantsExpense) {
    const expenseAction = await maybeCreateExpenseFromAttachments(
      message,
      attachments,
      pageContext,
      study
    );
    if (expenseAction) {
      actions.push(expenseAction);
      extras.push(`Dépense enregistrée${study.amount ? ` (${study.amount} $)` : ''}${projectId ? ` sur « ${pageContext.label} »` : ''}.`);
    } else if (study.doc_type === 'receipt' || study.doc_type === 'supplier_invoice') {
      extras.push('Pour créer la dépense : indiquez le montant (ex. « Dépense 85$ matériaux ») ou scannez via Dépenses → Scanner ticket.');
    }
  }

  // Ranger dans les notes du projet ouvert (ou projet suggéré)
  const wantsNotes = (study.suggested_actions || []).includes('project_notes')
    || Boolean(projectId)
    || /note|range|classer|ajoute|projet/i.test(message);

  if (wantsNotes && study.summary) {
    const noteBlock = [
      `[PJ ${new Date().toISOString().slice(0, 10)}] ${study.label_fr}`,
      study.summary,
      ...(study.key_facts || []).map(f => `- ${f}`),
      names.length ? `Fichiers : ${names.join(', ')}` : '',
    ].filter(Boolean).join('\n');

    if (projectId) {
      try {
        const result = await runSkillAction('update_project', message, pageContext, {}, {
          project_id: projectId,
          append_notes: true,
          notes: noteBlock,
        });
        if (result?.actions?.length) {
          actions.push(...result.actions);
          extras.push(`Notes ajoutées au projet « ${pageContext.label} ».`);
        }
      } catch { /* ignore */ }
    } else if (study.suggested_project_query) {
      extras.push(`Projet suggéré : « ${study.suggested_project_query} » — ouvrez-le ou dites « ajoute aux notes du projet ${study.suggested_project_query} ».`);
    }
  }

  // Plan client clair sans projet → proposer fabrication
  if (study.doc_type === 'client_plan' && !extras.some(e => /plan de fabrication|Notes ajoutées/i.test(e))) {
    extras.push('Dites « crée un plan de fabrication » (avec le nom du projet) pour générer les étapes atelier.');
  }

  actions.push({ type: 'store_attachments', data: attachments });

  return {
    reply: formatStudyReply(study, { fileNames: names, extras: extras.join('\n') }),
    actions,
    attachments,
    study,
  };
}

async function maybeCreateExpenseFromAttachments(message, attachments, pageContext = null, study = null) {
  const amount = Number(study?.amount) || extractMoneyAmount(message) || null;
  if (!amount && !/dépense|reçu|facture/i.test(message) && study?.doc_type !== 'receipt') {
    // facture fournisseur sans montant : ne pas créer 0$
    if (study?.doc_type === 'supplier_invoice') return null;
    if (!study?.amount) return null;
  }
  if (!amount) return null;

  const receipt = attachments.find(a => /image|pdf/i.test(a.type || ''));
  let category = 'materiaux';
  if (/outil/i.test(message)) category = 'outils';
  else if (/transport/i.test(message)) category = 'transport';
  else if (study?.vendor && /home\s*depot|rona|canac/i.test(study.vendor)) category = 'materiaux';

  const projectId = pageContext?.type === 'project' ? pageContext.id : null;
  const description = [
    study?.label_fr || message.slice(0, 120) || 'Via assistant',
    study?.vendor ? `(${study.vendor})` : '',
  ].filter(Boolean).join(' ').slice(0, 300);

  const { normalizePurchaseDate, extractDateFromText, todayISODate } = await import('./expense-date.js');
  const expenseDate = normalizePurchaseDate(study?.date)
    || extractDateFromText(`${study?.summary || ''} ${(study?.key_facts || []).join(' ')} ${message}`)
    || todayISODate();

  const { rows } = await pool.query(
    `INSERT INTO expenses (amount, category, description, receipt_url, project_id, date)
     VALUES ($1,$2,$3,$4,$5,$6::date) RETURNING *`,
    [amount, category, description, receipt?.url || attachments[0]?.url, projectId, expenseDate]
  );
  return { type: 'create_expense', data: rows[0] };
}

export async function getSkills() {
  const { rows } = await pool.query('SELECT * FROM assistant_skills ORDER BY name');
  return rows.map(s => ({
    ...s,
    trigger_patterns: typeof s.trigger_patterns === 'string' ? JSON.parse(s.trigger_patterns) : (s.trigger_patterns || []),
    action_config: typeof s.action_config === 'string' ? JSON.parse(s.action_config) : (s.action_config || {}),
  }));
}

export async function getSkillById(id) {
  const skills = await getSkills();
  return skills.find(s => s.id === Number(id)) || null;
}

export async function createSkill(data) {
  const { name, description, trigger_patterns, action_type, action_config, enabled } = data;
  if (!ACTION_TYPES.includes(action_type)) {
    throw new Error(`action_type invalide. Valeurs : ${ACTION_TYPES.join(', ')}`);
  }
  const { rows } = await pool.query(
    `INSERT INTO assistant_skills (name, description, trigger_patterns, action_type, action_config, enabled)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [
      name,
      description || '',
      JSON.stringify(trigger_patterns || []),
      action_type,
      JSON.stringify(action_config || {}),
      enabled !== false,
    ]
  );
  return rows[0];
}

export async function updateSkill(id, data) {
  const existing = await getSkillById(id);
  if (!existing) throw new Error('Skill introuvable');

  const name = data.name ?? existing.name;
  const description = data.description ?? existing.description;
  const trigger_patterns = data.trigger_patterns ?? existing.trigger_patterns;
  const action_type = data.action_type ?? existing.action_type;
  const action_config = data.action_config ?? existing.action_config;
  const enabled = data.enabled ?? existing.enabled;

  if (!ACTION_TYPES.includes(action_type)) {
    throw new Error(`action_type invalide. Valeurs : ${ACTION_TYPES.join(', ')}`);
  }

  const { rows } = await pool.query(
    `UPDATE assistant_skills SET name=$1, description=$2, trigger_patterns=$3, action_type=$4, action_config=$5, enabled=$6
     WHERE id=$7 RETURNING *`,
    [name, description, JSON.stringify(trigger_patterns), action_type, JSON.stringify(action_config), enabled, id]
  );
  return rows[0];
}

export async function deleteSkill(id) {
  const { rowCount } = await pool.query('DELETE FROM assistant_skills WHERE id = $1', [id]);
  if (!rowCount) throw new Error('Skill introuvable');
  return { ok: true };
}

export async function getChatHistory() {
  const { rows } = await pool.query('SELECT * FROM assistant_messages ORDER BY created_at ASC LIMIT 50');
  return rows;
}

export async function seedDefaultSkills() {
  const defaults = [
    { name: 'create_task', description: 'Créer une tâche', trigger_patterns: ['créer tâche', 'ajouter tâche', 'nouvelle tâche', 'task', 'ajouter étape'], action_type: 'create_task' },
    { name: 'create_project', description: 'Créer un projet', trigger_patterns: ['créer projet', 'nouveau projet', 'project'], action_type: 'create_project' },
    { name: 'plan_day', description: 'Planifier plusieurs étapes', trigger_patterns: ['planifier demain', 'journée de demain', 'étapes demain', 'pour demain', 'planning demain'], action_type: 'plan_day' },
    { name: 'schedule_task', description: 'Planifier au calendrier', trigger_patterns: ['planifier', 'programmer', 'calendrier', 'demain', 'lundi'], action_type: 'schedule_task' },
    { name: 'create_expense', description: 'Enregistrer une dépense', trigger_patterns: ['dépense', 'acheté', 'payé pour'], action_type: 'create_expense' },
    { name: 'list_today', description: 'Tâches du jour', trigger_patterns: ["aujourd'hui", 'tâches du jour', 'planning jour'], action_type: 'list_today' },
    { name: 'list_tomorrow', description: 'Tâches de demain', trigger_patterns: ['demain matin', 'tâches demain', 'planning demain', 'voir demain'], action_type: 'list_tomorrow' },
    { name: 'create_client', description: 'Ajouter un client', trigger_patterns: ['nouveau client', 'ajouter client'], action_type: 'create_client' },
    { name: 'complete_task', description: 'Marquer tâche terminée', trigger_patterns: ['cocher', 'marquer fait', 'terminé', 'complété', 'fait'], action_type: 'complete_task' },
    { name: 'update_task', description: 'Modifier une tâche', trigger_patterns: ['modifier tâche', 'renommer tâche', 'mettre à jour tâche'], action_type: 'update_task' },
    { name: 'delete_task', description: 'Supprimer une tâche', trigger_patterns: ['supprimer tâche', 'retirer tâche', 'effacer tâche'], action_type: 'delete_task' },
    { name: 'list_project_tasks', description: 'Lister tâches du projet', trigger_patterns: ['liste tâches', 'tâches du projet', 'voir tâches'], action_type: 'list_project_tasks' },
    { name: 'update_project', description: 'Modifier le projet', trigger_patterns: ['modifier projet', 'deadline', 'budget projet', 'statut projet'], action_type: 'update_project' },
    { name: 'update_client', description: 'Modifier le client', trigger_patterns: ['modifier client', 'email client', 'téléphone client'], action_type: 'update_client' },
    { name: 'list_projects', description: 'Lister les projets', trigger_patterns: ['liste projets', 'mes projets', 'voir projets'], action_type: 'list_projects' },
    { name: 'list_clients', description: 'Lister les clients', trigger_patterns: ['liste clients', 'voir clients'], action_type: 'list_clients' },
    { name: 'list_expenses', description: 'Lister les dépenses', trigger_patterns: ['liste dépenses', 'dépenses du projet', 'voir dépenses'], action_type: 'list_expenses' },
    { name: 'list_skills', description: 'Lister les skills', trigger_patterns: ['liste skills', 'capacités', 'commandes disponibles', 'skills'], action_type: 'list_skills' },
    { name: 'create_skill', description: 'Créer une skill', trigger_patterns: ['ajouter skill', 'nouvelle skill', 'nouvelle capacité'], action_type: 'create_skill' },
    { name: 'update_skill', description: 'Modifier une skill', trigger_patterns: ['activer skill', 'désactiver skill', 'modifier skill'], action_type: 'update_skill' },
    { name: 'create_quote', description: 'Créer un devis', trigger_patterns: ['créer devis', 'nouveau devis', 'devis'], action_type: 'create_quote' },
    { name: 'create_invoice', description: 'Créer une facture', trigger_patterns: ['créer facture', 'nouvelle facture', 'facture'], action_type: 'create_invoice' },
    { name: 'convert_quote', description: 'Convertir devis en facture', trigger_patterns: ['convertir devis', 'facturer devis', 'acompte'], action_type: 'convert_quote' },
    { name: 'send_quote', description: 'Envoyer devis par courriel', trigger_patterns: ['envoyer devis', 'mail devis'], action_type: 'send_quote' },
    { name: 'send_invoice', description: 'Envoyer facture par courriel', trigger_patterns: ['envoyer facture', 'mail facture'], action_type: 'send_invoice' },
    { name: 'list_quotes', description: 'Lister les devis', trigger_patterns: ['liste devis', 'voir devis'], action_type: 'list_quotes' },
    { name: 'list_invoices', description: 'Lister les factures', trigger_patterns: ['liste factures', 'voir factures'], action_type: 'list_invoices' },
    { name: 'delete_project', description: 'Supprimer un projet', trigger_patterns: ['supprimer projet', 'effacer projet'], action_type: 'delete_project' },
    { name: 'delete_client', description: 'Supprimer un client', trigger_patterns: ['supprimer client'], action_type: 'delete_client' },
    { name: 'delete_expense', description: 'Supprimer une dépense', trigger_patterns: ['supprimer dépense'], action_type: 'delete_expense' },
    { name: 'update_standard', description: 'Modifier fiche standard', trigger_patterns: ['modifier fiche', 'prix fiche', 'dimensions fiche'], action_type: 'update_standard' },
    { name: 'sync_wordpress', description: 'Sync complète site web', trigger_patterns: ['sync wordpress', 'sync site', 'sync web', 'synchroniser site'], action_type: 'sync_wordpress' },
    { name: 'sync_web_orders', description: 'Importer commandes web', trigger_patterns: ['sync commandes', 'commandes web', 'import commandes'], action_type: 'sync_web_orders' },
    { name: 'sync_web_photos', description: 'Récupérer photos du site', trigger_patterns: ['photos site', 'récupérer photos', 'sync photos', 'images site', 'photos web'], action_type: 'sync_web_photos' },
    { name: 'list_web_orders', description: 'Lister commandes web', trigger_patterns: ['liste commandes web', 'commandes du site'], action_type: 'list_web_orders' },
    { name: 'ui_edit_mode', description: 'Activer/désactiver édition dashboard', trigger_patterns: ['mode édition', 'éditer dashboard', 'déplacer sections', 'réorganiser dashboard', 'fermer édition'], action_type: 'ui_edit_mode' },
    { name: 'ui_add_todo_list', description: 'Ajouter une liste todo sur le dashboard', trigger_patterns: ['ajouter todo', 'nouvelle todo', 'liste todo', 'ajoute une todo', 'créer liste todo'], action_type: 'ui_add_todo_list' },
    { name: 'ui_move_section', description: 'Déplacer une section du dashboard', trigger_patterns: ['déplacer section', 'monter section', 'descendre section', 'bouger todo'], action_type: 'ui_move_section' },
    { name: 'ui_hide_section', description: 'Masquer une section', trigger_patterns: ['masquer section', 'cacher section', 'hide section'], action_type: 'ui_hide_section' },
    { name: 'ui_show_section', description: 'Afficher une section', trigger_patterns: ['afficher section', 'montrer section', 'show section'], action_type: 'ui_show_section' },
    { name: 'ui_reset_layout', description: 'Réinitialiser le layout dashboard', trigger_patterns: ['reset dashboard', 'réinitialiser dashboard', 'layout par défaut'], action_type: 'ui_reset_layout' },
  ];

  for (const s of defaults) {
    await pool.query(
      `INSERT INTO assistant_skills (name, description, trigger_patterns, action_type)
       VALUES ($1,$2,$3,$4) ON CONFLICT (name) DO NOTHING`,
      [s.name, s.description, JSON.stringify(s.trigger_patterns), s.action_type]
    );
  }

  const { ERP_MANUAL_SKILL_INSTRUCTION } = await import('../content/erp-manual.js');
  await pool.query(
    `INSERT INTO assistant_skills (name, description, trigger_patterns, action_type, action_config, enabled)
     VALUES ($1,$2,$3,$4,$5,true)
     ON CONFLICT (name) DO UPDATE SET
       description = EXCLUDED.description,
       trigger_patterns = EXCLUDED.trigger_patterns,
       action_type = EXCLUDED.action_type,
       action_config = EXCLUDED.action_config,
       enabled = true`,
    [
      'erp_manual',
      'Manuel ERP — aide, tutoriels, liens vers les modules',
      JSON.stringify([
        'manuel', 'aide erp', 'manuel erp', 'comment faire', 'comment utiliser', 'tutoriel',
        'guide erp', 'documentation erp', 'help erp', 'comment ça marche', 'comment ca marche',
        'subtilité erp', 'comment connecter gmail', 'comment scanner',
      ]),
      'erp_manual',
      JSON.stringify({ instruction: ERP_MANUAL_SKILL_INSTRUCTION }),
    ]
  );

  const extraSkills = [
    {
      name: 'search_projects',
      description: 'Chercher projets (en cours ou anciens) par nom/client/notes',
      triggers: ['cherche projet', 'trouver projet', 'projet olive', 'anciens projets', 'projets terminés', 'liste projets'],
      action: 'search_projects',
    },
    {
      name: 'get_project',
      description: 'Détail complet d\'un projet + tâches',
      triggers: ['détail projet', 'voir projet', 'infos projet', 'montre le projet'],
      action: 'get_project',
    },
    {
      name: 'search_memory',
      description: 'Chercher dans la mémoire atelier',
      triggers: ['mémoire', 'qu\'est-ce que tu retiens', 'souvenir', 'cherche en mémoire'],
      action: 'search_memory',
    },
    {
      name: 'list_emails',
      description: 'Lister les courriels Gmail (boîte / sections)',
      triggers: [
        'liste mails', 'liste courriels', 'mes mails', 'boîte mail', 'boite mail',
        'voir mails', 'mails non lus', 'courriels clients', 'mails fournisseurs',
      ],
      action: 'list_emails',
    },
    {
      name: 'search_emails',
      description: 'Rechercher dans Gmail',
      triggers: [
        'cherche mail', 'chercher mail', 'cherche courriel', 'rechercher mail',
        'mails de', 'courriels de', 'trouve le mail', 'cherche dans gmail',
      ],
      action: 'search_emails',
    },
    {
      name: 'get_email',
      description: 'Lire le contenu d\'un courriel',
      triggers: [
        'ouvre le mail', 'ouvrir mail', 'lis le mail', 'lire mail', 'contenu du mail',
        'montre le mail', 'détail mail', 'ouvre le courriel',
      ],
      action: 'get_email',
    },
    {
      name: 'import_email_attachment',
      description: 'Importer une facture/PJ depuis Gmail (sans joindre au chat)',
      triggers: [
        'facture du mail', 'cherche la facture', 'rentre cette facture', 'mail de olive',
        'dans les mails', 'pièce jointe du mail', 'importer depuis gmail',
      ],
      action: 'import_email_attachment',
    },
    {
      name: 'scan_mail_invoice_todos',
      description: 'Scanner les factures Gmail et les classer en todos admin À payer / À recevoir',
      triggers: [
        'classer les factures', 'factures à payer', 'à payer facture', 'a payer facture',
        'factures à recevoir', 'scanner factures', 'scan factures', 'facture olive',
        'olive a envoyé', 'classer factures mail', 'todos factures',
      ],
      action: 'scan_mail_invoice_todos',
    },
    {
      name: 'list_mail_threads',
      description: 'Lister les fils courriel liés ERP',
      triggers: ['fils courriel', 'conversations mail', 'mails liés', 'threads mail'],
      action: 'list_mail_threads',
    },
    {
      name: 'create_fabrication_plan',
      description: 'Créer un plan de fabrication (étapes) sur un projet depuis un texte/fichier',
      triggers: [
        'plan de fabrication', 'plan fabrication', 'crée les étapes', 'créer checklist',
        'étapes atelier', 'à partir du fichier', 'à partir du mail', 'linker dans le projet',
      ],
      action: 'create_fabrication_plan',
    },
    {
      name: 'update_quote',
      description: 'Modifier un devis (lignes, prix, titre, notes, statut)',
      triggers: [
        'modifier devis', 'ajoute une ligne', 'ajouter ligne devis', 'change le prix',
        'prix de la', 'titre devis', 'notes devis', 'update quote',
      ],
      action: 'update_quote',
    },
    {
      name: 'get_quote',
      description: 'Lire le devis ouvert / détail devis',
      triggers: ['voir devis', 'détail devis', 'lignes du devis', 'montre le devis', 'lis le devis'],
      action: 'get_quote',
    },
  ];
  for (const s of extraSkills) {
    await pool.query(
      `INSERT INTO assistant_skills (name, description, trigger_patterns, action_type, enabled)
       VALUES ($1,$2,$3,$4,true)
       ON CONFLICT (name) DO UPDATE SET
         description = EXCLUDED.description,
         trigger_patterns = EXCLUDED.trigger_patterns,
         action_type = EXCLUDED.action_type,
         enabled = true`,
      [s.name, s.description, JSON.stringify(s.triggers), s.action]
    );
  }
}

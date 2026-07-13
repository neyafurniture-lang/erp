import pool from '../db/pool.js';
import { createQuoteRecord, createInvoiceRecord, convertQuoteToInvoice } from './invoice-helpers.js';
import { sendDocumentEmail } from './document-email.js';

const DAY_MAP = {
  lundi: 1, mardi: 2, mercredi: 3, jeudi: 4, vendredi: 5, samedi: 6, dimanche: 0,
};

export const ACTION_TYPES = [
  'create_task', 'create_project', 'schedule_task', 'plan_day', 'create_expense', 'list_today', 'list_tomorrow', 'create_client',
  'complete_task', 'update_task', 'delete_task', 'list_project_tasks',
  'update_project', 'update_client', 'list_projects', 'list_clients', 'list_expenses',
  'list_skills', 'create_skill', 'update_skill',
  'create_quote', 'create_invoice', 'convert_quote', 'send_quote', 'send_invoice',
  'list_quotes', 'list_invoices', 'delete_project', 'delete_client', 'delete_expense',
  'update_standard', 'sync_wordpress', 'sync_web_orders', 'list_web_orders', 'sync_web_photos',
  'ui_edit_mode', 'ui_add_todo_list', 'ui_move_section', 'ui_hide_section', 'ui_show_section', 'ui_reset_layout',
  'erp_manual',
];

export function extractAmount(text) {
  const m = text.match(/(\d+(?:[.,]\d+)?)\s*\$?/);
  return m ? parseFloat(m[1].replace(',', '.')) : null;
}

export function extractDuration(text) {
  const h = text.match(/(\d+)\s*h/i);
  if (h) return parseInt(h[1]) * 60;
  const m = text.match(/(\d+)\s*min/i);
  if (m) return parseInt(m[1]);
  return 60;
}

export function parseDateHint(text) {
  const lower = text.toLowerCase();
  const now = new Date();
  if (lower.includes('demain')) {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    return d;
  }
  if (lower.includes('aujourd')) return now;
  for (const [day, dow] of Object.entries(DAY_MAP)) {
    if (lower.includes(day)) {
      const d = new Date(now);
      const diff = (dow - d.getDay() + 7) % 7 || 7;
      d.setDate(d.getDate() + diff);
      return d;
    }
  }
  const iso = text.match(/(\d{4}-\d{2}-\d{2})/);
  if (iso) return new Date(iso[1]);
  const fr = text.match(/(\d{1,2})\s+(janvier|février|fevrier|mars|avril|mai|juin|juillet|août|aout|septembre|octobre|novembre|décembre|decembre)/i);
  if (fr) {
    const months = { janvier: 0, février: 1, fevrier: 1, mars: 2, avril: 3, mai: 4, juin: 5, juillet: 6, août: 7, aout: 7, septembre: 8, octobre: 9, novembre: 10, décembre: 11, decembre: 11 };
    const d = new Date(now.getFullYear(), months[fr[2].toLowerCase()], parseInt(fr[1]));
    return d;
  }
  const timeMatch = lower.match(/(\d{1,2})[h:](\d{2})?/);
  if (timeMatch) {
    const d = new Date(now);
    d.setHours(parseInt(timeMatch[1]), parseInt(timeMatch[2] || '0'), 0, 0);
    return d;
  }
  return null;
}

export function extractQuotedText(text) {
  const m = text.match(/["«'](.+?)["»']/);
  return m ? m[1] : null;
}

export function extractAfterKeyword(text, keywords) {
  const lower = text.toLowerCase();
  for (const kw of keywords) {
    const idx = lower.indexOf(kw);
    if (idx !== -1) {
      return text.slice(idx + kw.length).trim().replace(/^(pour|de|du|la|le|un|une|en|comme)\s+/i, '');
    }
  }
  return null;
}

function parseStatus(message) {
  if (/terminé|termine|fini|fait|done|complét|complete/i.test(message)) return 'done';
  if (/en cours|progress|wip/i.test(message)) return 'in_progress';
  if (/à faire|a faire|todo|reprendre/i.test(message)) return 'todo';
  return null;
}

function parseProjectStatus(message) {
  if (/terminé|termine|livré|livre|completed/i.test(message)) return 'completed';
  if (/pause|en pause|on hold/i.test(message)) return 'on_hold';
  if (/actif|active|en cours/i.test(message)) return 'active';
  if (/annulé|annule|cancel/i.test(message)) return 'cancelled';
  return null;
}

function taskHintFromMessage(message) {
  const quoted = extractQuotedText(message);
  if (quoted) return quoted;
  const after = extractAfterKeyword(message, [
    'cocher', 'marquer', 'terminer', 'compléter', 'completer', 'fait',
    'supprimer', 'retirer', 'effacer', 'renommer', 'modifier', 'tâche', 'étape',
  ]);
  if (after) return after.replace(/\s+(comme|en)\s+.*/i, '').trim();
  const words = message.split(/\s+/).filter(w => w.length > 3 && !/tâche|étape|projet|client/i.test(w));
  return words.slice(-2).join(' ') || null;
}

function findTaskByHint(hint, tasks, preferPending = true) {
  if (!tasks?.length) return null;
  const pool_ = preferPending ? tasks.filter(t => t.status !== 'done') : tasks;
  const list = pool_.length ? pool_ : tasks;
  if (!hint) return list[0];
  const lower = hint.toLowerCase();
  return list.find(t => t.title.toLowerCase().includes(lower))
    || list.find(t => lower.includes(t.title.toLowerCase().slice(0, 4)))
    || list[0];
}

function parseRename(message) {
  const m = message.match(/renommer\s+(.+?)\s+en\s+(.+)/i)
    || message.match(/appeler\s+(.+?)\s+(.+)/i);
  if (m) return { hint: m[1].trim(), newTitle: m[2].trim() };
  const quoted = extractQuotedText(message);
  if (quoted && /renommer|appeler/i.test(message)) return { hint: null, newTitle: quoted };
  return null;
}

function parseEmail(message) {
  const m = message.match(/[\w.+-]+@[\w.-]+\.\w+/);
  return m ? m[0] : null;
}

function parsePhone(message) {
  const m = message.match(/(\+?1?\s?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/);
  return m ? m[0].replace(/\s/g, ' ') : null;
}

export async function createProjectFromStandard(pageContext, message) {
  const std = pageContext.standard;
  if (!std) return { reply: 'Fiche introuvable.', actions: [] };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const name = extractQuotedText(message)
      || extractAfterKeyword(message, ['projet', 'project'])
      || `${std.name} — ${new Date().toLocaleDateString('fr-CA')}`;
    const clientId = pageContext.type === 'client' ? pageContext.id : null;

    const { rows: projects } = await client.query(
      `INSERT INTO projects (name, client_id, status, standard_id, budget_estimated)
       VALUES ($1,$2,'active',$3,0) RETURNING *`,
      [name.slice(0, 200), clientId, std.id]
    );
    const project = projects[0];

    const steps = typeof std.steps === 'string' ? JSON.parse(std.steps) : (std.steps || []);
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      await client.query(
        `INSERT INTO tasks (project_id, title, description, type, status, estimated_minutes, sort_order)
         VALUES ($1,$2,$3,$4,'todo',$5,$6)`,
        [project.id, step.description || step.phase, step.instructions, step.phase || 'admin', step.estimated_minutes || 60, i]
      );
    }

    await client.query('COMMIT');
    return {
      reply: `Projet créé depuis la fiche « ${std.name} » : « ${project.name} » (${steps.length} étapes)`,
      actions: [{ type: 'create_project', data: project }],
    };
  } catch (err) {
    await client.query('ROLLBACK');
    return { reply: `Erreur création projet : ${err.message}`, actions: [] };
  } finally {
    client.release();
  }
}

async function insertTaskForProject(projectId, title, type, minutes) {
  let estMinutes = minutes;
  let sortOrder = 0;
  if (projectId) {
    const { rows: proj } = await pool.query('SELECT standard_id FROM projects WHERE id = $1', [projectId]);
    if (proj[0] && !proj[0].standard_id) estMinutes = null;
    const { rows: ord } = await pool.query(
      'SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM tasks WHERE project_id = $1',
      [projectId]
    );
    sortOrder = ord[0]?.n ?? 0;
  }
  const { rows } = await pool.query(
    `INSERT INTO tasks (project_id, title, type, status, estimated_minutes, sort_order)
     VALUES ($1,$2,$3,'todo',$4,$5) RETURNING *`,
    [projectId, title.slice(0, 200), type, estMinutes, sortOrder]
  );
  return rows[0];
}

async function resolveProjectTasks(projectId, pageContext) {
  if (pageContext?.type === 'project' && pageContext.tasks) return pageContext.tasks;
  if (!projectId) return [];
  const { rows } = await pool.query(
    'SELECT id, title, status, sort_order, type, estimated_minutes FROM tasks WHERE project_id = $1 ORDER BY sort_order, id',
    [projectId]
  );
  return rows;
}

const PLAN_STOPWORDS = new Set([
  'pour', 'de', 'du', 'des', 'le', 'la', 'les', 'un', 'une', 'et', 'à', 'a', 'en', 'sur', 'avec', 'mon', 'ma', 'mes',
]);
const TYPE_HINTS = [
  { type: 'finition', re: /finition|vernis|ponçage|poncage|huile|teinture/i },
  { type: 'debitage', re: /débitage|debitage/i },
  { type: 'usinage', re: /usinage|cnc/i },
  { type: 'assemblage', re: /assemblage|montage/i },
  { type: 'admin', re: /mail|courriel|email|e-mail|appel|facture|devis|admin|relance/i },
];

function defaultMinutesForType(type) {
  const map = { finition: 120, debitage: 90, usinage: 90, assemblage: 120, admin: 30 };
  return map[type] || 60;
}

function inferTaskType(text) {
  for (const { type, re } of TYPE_HINTS) {
    if (re.test(text)) return type;
  }
  return 'admin';
}

function stripPlanPrefix(message) {
  return message
    .replace(/^(planifie[rz]?|programme[rz]?|prévois|prevoyez|organise[rz]?)\s+(ma\s+)?(journée|journee|planning|étapes?|etapes?)\s+(de\s+|pour\s+)?(demain|lundi|mardi|mercredi|jeudi|vendredi)\s*[:,-]?\s*/i, '')
    .replace(/^(mes\s+)?(étapes?|etapes?)\s+(de\s+|pour\s+)?(demain|lundi|mardi|mercredi|jeudi|vendredi)\s*[:,-]?\s*/i, '')
    .replace(/^(demain|pour\s+demain|lundi|mardi|mercredi|jeudi|vendredi)\s*[:,-]?\s*/i, '')
    .trim();
}

function splitPlanItems(text) {
  return text
    .split(/\s*(?:,|;|\.|\bet\b|\bpuis\b|\baprès\b|\bapres\b|\bensuite\b)\s*/i)
    .map(s => s.trim())
    .filter(s => s.length > 2 && !/^(demain|pour|planifier|programmer|journée|journee|matin|après-midi)$/i.test(s));
}

function tokenizeForMatch(text) {
  return text
    .toLowerCase()
    .normalize('NFD').replace(/\p{Diacritic}/gu, '')
    .split(/[\s'-]+/)
    .filter(w => w.length >= 2 && !PLAN_STOPWORDS.has(w));
}

async function fetchProjectsForMatching() {
  const { rows } = await pool.query(`
    SELECT p.id, p.name, c.name AS client_name
    FROM projects p
    LEFT JOIN clients c ON c.id = p.client_id
    WHERE p.status IN ('active', 'on_hold')
    ORDER BY p.created_at DESC
    LIMIT 80
  `);
  return rows;
}

function scoreProject(project, words) {
  const hay = `${project.name} ${project.client_name || ''}`
    .toLowerCase()
    .normalize('NFD').replace(/\p{Diacritic}/gu, '');
  let score = 0;
  for (const w of words) {
    const norm = w.normalize('NFD').replace(/\p{Diacritic}/gu, '');
    if (hay.includes(norm)) score += norm.length >= 4 ? 2 : 1;
  }
  return score;
}

async function matchProjectFromText(text, pageContext) {
  let words = tokenizeForMatch(text);
  words = words.filter(w => !TYPE_HINTS.some(({ re }) => re.test(w)));
  if (!words.length) {
    if (pageContext?.type === 'project') return { id: pageContext.id, name: pageContext.label };
    return null;
  }

  const projects = await fetchProjectsForMatching();
  let best = null;
  let bestScore = 0;
  for (const p of projects) {
    const s = scoreProject(p, words);
    if (s > bestScore) {
      best = p;
      bestScore = s;
    }
  }
  if (bestScore >= 1) return best;
  if (pageContext?.type === 'project') return { id: pageContext.id, name: pageContext.label };
  return null;
}

function formatPlanTitle(segment, type, project) {
  const labels = { finition: 'Finition', debitage: 'Débitage', usinage: 'Usinage', assemblage: 'Assemblage' };
  if (labels[type] && project) return `${labels[type]} — ${project.name}`;
  if (labels[type] && type !== 'admin') return labels[type];
  const cleaned = segment.replace(/^(pour|de|du|la|le)\s+/i, '').trim();
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

async function findOrCreatePlannedTask({ segment, type, project, pageContext }) {
  const title = formatPlanTitle(segment, type, project);
  const minutes = defaultMinutesForType(type);

  if (project?.id) {
    const tasks = await resolveProjectTasks(project.id, pageContext);
    const pending = tasks.filter(t => t.status !== 'done');
    const byType = pending.find(t => t.type === type && ['finition', 'debitage', 'usinage', 'assemblage'].includes(type));
    const byTitle = pending.find(t => {
      const tl = t.title.toLowerCase();
      return segment.toLowerCase().split(/\s+/).some(w => w.length > 3 && tl.includes(w));
    });
    if (byTitle) return byTitle;
    if (byType) return byType;
    return insertTaskForProject(project.id, title, type, minutes);
  }

  const { rows } = await pool.query(
    `INSERT INTO tasks (title, type, status, estimated_minutes, sort_order)
     VALUES ($1,$2,'todo',$3,0) RETURNING *`,
    [title.slice(0, 200), type, minutes]
  );
  return rows[0];
}

export function isDayPlanMessage(message) {
  const lower = message.toLowerCase();
  const hasDate = /demain|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche/i.test(lower);
  const multiItems = /,| et | puis | ensuite/i.test(lower);
  const planIntent = /planif|journée|journee|étapes|etapes|programme|prévois|prevoyez|organise/i.test(lower);
  const workKeywords = /finition|débitage|debitage|usinage|assemblage|mail|courriel|tâche|tache|étape|etape/i.test(lower);
  const segments = splitPlanItems(stripPlanPrefix(message));
  return (
    (hasDate && segments.length >= 2 && workKeywords)
    || (planIntent && hasDate)
    || (hasDate && multiItems && workKeywords)
  );
}

async function planDay(message, pageContext) {
  const planDate = parseDateHint(message) || (() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d;
  })();

  const body = stripPlanPrefix(message);
  const items = splitPlanItems(body);
  if (!items.length) {
    return {
      reply: 'Dites par ex. : « Demain finition banc olive Mehdi, mail pour The NNS, débitage table chêne »',
      actions: [],
    };
  }

  const dayStart = new Date(planDate);
  if (!parseDateHint(message) || !/\d{1,2}[h:]\d{0,2}/i.test(message)) {
    dayStart.setHours(8, 30, 0, 0);
  } else {
    dayStart.setSeconds(0, 0);
  }

  const actions = [];
  const lines = [];
  let cursor = new Date(dayStart);

  for (const segment of items) {
    const type = inferTaskType(segment);
    const project = await matchProjectFromText(segment, pageContext);
    const task = await findOrCreatePlannedTask({ segment, type, project, pageContext });
    const minutes = task.estimated_minutes || defaultMinutesForType(type);
    const end = new Date(cursor.getTime() + minutes * 60000);

    const { rows } = await pool.query(
      'UPDATE tasks SET start_time=$1, end_time=$2 WHERE id=$3 RETURNING *',
      [cursor.toISOString(), end.toISOString(), task.id]
    );
    const scheduled = rows[0];

    actions.push({ type: 'plan_day', data: scheduled });
    const timeStr = cursor.toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit' });
    const projLabel = project ? ` (${project.name})` : '';
    lines.push(`• ${timeStr} — ${scheduled.title}${projLabel}`);
    cursor = end;
  }

  const dateLabel = dayStart.toLocaleDateString('fr-CA', { weekday: 'long', day: 'numeric', month: 'long' });
  return {
    reply: `Planning ${dateLabel} — ${items.length} étape(s) :\n${lines.join('\n')}`,
    actions,
  };
}

async function listTomorrow() {
  const { rows } = await pool.query(`
    SELECT t.*, p.name as project_name FROM tasks t
    LEFT JOIN projects p ON p.id = t.project_id
    WHERE DATE(t.start_time) = CURRENT_DATE + INTERVAL '1 day'
    ORDER BY t.start_time
    LIMIT 20
  `);
  if (!rows.length) {
    return { reply: 'Rien de planifié pour demain. Dites par ex. « Demain finition banc olive, mail The NNS ».', actions: [] };
  }
  const list = rows.map(t => {
    const time = t.start_time
      ? new Date(t.start_time).toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit' })
      : '—';
    return `• ${time} — ${t.title}${t.project_name ? ` (${t.project_name})` : ''}`;
  }).join('\n');
  return { reply: `Demain :\n${list}`, actions: [{ type: 'list_tomorrow', data: rows }] };
}

export async function runSkillAction(actionType, message, pageContext = null, skill = {}) {
  const actions = [];
  const projectId = pageContext?.type === 'project' ? pageContext.id : null;
  const clientId = pageContext?.type === 'client' ? pageContext.id : null;

  switch (actionType) {
    case 'create_task': {
      const title = extractQuotedText(message)
        || extractAfterKeyword(message, ['tâche', 'task', 'étape', 'checklist', 'ajouter'])
        || 'Nouvelle tâche';
      let type = 'admin';
      if (/débitage|cnc|usinage/i.test(message)) type = /cnc|usinage/i.test(message) ? 'usinage' : 'debitage';
      else if (/assemblage/i.test(message)) type = 'assemblage';
      else if (/finition|vernis|ponçage/i.test(message)) type = 'finition';
      const minutes = extractDuration(message);
      const task = await insertTaskForProject(projectId, title, type, minutes);
      actions.push({ type: 'create_task', data: task });
      const linked = projectId ? ` dans le projet « ${pageContext.label} »` : '';
      const dur = task.estimated_minutes != null ? ` (${task.estimated_minutes} min)` : '';
      return { reply: `Tâche créée${linked} : « ${task.title} »${dur}`, actions };
    }

    case 'create_project': {
      if (pageContext?.type === 'standard') return createProjectFromStandard(pageContext, message);
      const name = extractQuotedText(message) || extractAfterKeyword(message, ['projet', 'project']) || 'Nouveau projet';
      const { rows } = await pool.query(
        `INSERT INTO projects (name, client_id, status) VALUES ($1,$2,'active') RETURNING *`,
        [name.slice(0, 200), clientId]
      );
      actions.push({ type: 'create_project', data: rows[0] });
      const linked = clientId ? ` pour le client « ${pageContext.label} »` : '';
      return { reply: `Projet créé${linked} : « ${rows[0].name} »`, actions };
    }

    case 'schedule_task': {
      const dateHint = parseDateHint(message);
      const titleHint = extractQuotedText(message) || taskHintFromMessage(message);
      const tasks = await resolveProjectTasks(projectId, pageContext);
      let task = findTaskByHint(titleHint, tasks);
      if (!task) {
        const params = [];
        let q = `SELECT * FROM tasks WHERE status != 'done'`;
        if (projectId) { params.push(projectId); q += ` AND project_id = $${params.length}`; }
        q += ' ORDER BY sort_order, created_at DESC LIMIT 1';
        const { rows } = await pool.query(q, params);
        task = rows[0];
      } else {
        const { rows } = await pool.query('SELECT * FROM tasks WHERE id = $1', [task.id]);
        task = rows[0];
      }
      if (!task) {
        const hint = projectId ? ` dans le projet « ${pageContext.label} »` : '';
        return { reply: `Aucune tâche à planifier${hint}. Créez-en une d'abord.`, actions };
      }
      const start = dateHint || new Date();
      if (!dateHint) start.setHours(9, 0, 0, 0);
      const end = new Date(start.getTime() + (task.estimated_minutes || 60) * 60000);
      const { rows } = await pool.query(
        'UPDATE tasks SET start_time=$1, end_time=$2 WHERE id=$3 RETURNING *',
        [start.toISOString(), end.toISOString(), task.id]
      );
      actions.push({ type: 'schedule_task', data: rows[0] });
      return { reply: `« ${rows[0].title} » planifié le ${start.toLocaleString('fr-CA')}`, actions };
    }

    case 'plan_day':
      return planDay(message, pageContext);

    case 'list_tomorrow':
      return listTomorrow();

    case 'create_expense': {
      const amount = extractAmount(message) || 0;
      let category = 'materiaux';
      if (/outil/i.test(message)) category = 'outils';
      else if (/transport/i.test(message)) category = 'transport';
      else if (/atelier/i.test(message)) category = 'atelier';
      else if (/admin/i.test(message)) category = 'admin';
      const desc = extractAfterKeyword(message, ['dépense', 'acheté', 'payé']) || message;
      const { rows } = await pool.query(
        `INSERT INTO expenses (amount, category, description, project_id) VALUES ($1,$2,$3,$4) RETURNING *`,
        [amount, category, desc.slice(0, 300), projectId]
      );
      actions.push({ type: 'create_expense', data: rows[0] });
      const linked = projectId ? ` (projet « ${pageContext.label} »)` : '';
      return { reply: `Dépense enregistrée${linked} : ${amount.toFixed(2)} $ (${category})`, actions };
    }

    case 'list_today': {
      const { rows } = await pool.query(`
        SELECT t.*, p.name as project_name FROM tasks t
        LEFT JOIN projects p ON p.id = t.project_id
        WHERE DATE(t.start_time) = CURRENT_DATE
           OR (t.start_time IS NOT NULL AND t.start_time <= NOW() + INTERVAL '1 day')
        ORDER BY t.start_time LIMIT 15
      `);
      if (!rows.length) return { reply: 'Aucune tâche planifiée pour aujourd\'hui.', actions };
      const list = rows.map(t => `• ${t.title}${t.start_time ? ` (${new Date(t.start_time).toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit' })})` : ''}`).join('\n');
      actions.push({ type: 'list_today', data: rows });
      return { reply: `Tâches du jour :\n${list}`, actions };
    }

    case 'create_client': {
      const name = extractQuotedText(message) || extractAfterKeyword(message, ['client']) || 'Nouveau client';
      const { rows } = await pool.query('INSERT INTO clients (name) VALUES ($1) RETURNING *', [name.slice(0, 200)]);
      actions.push({ type: 'create_client', data: rows[0] });
      return { reply: `Client ajouté : « ${rows[0].name} »`, actions };
    }

    case 'complete_task':
    case 'update_task': {
      const tasks = await resolveProjectTasks(projectId, pageContext);
      const rename = parseRename(message);
      const hint = rename?.hint || taskHintFromMessage(message);
      const taskRef = findTaskByHint(hint, tasks);
      if (!taskRef) {
        return { reply: projectId
          ? `Aucune tâche trouvée dans « ${pageContext.label} ».`
          : 'Ouvrez un projet ou précisez la tâche entre guillemets.', actions };
      }
      const { rows: existing } = await pool.query('SELECT * FROM tasks WHERE id = $1', [taskRef.id]);
      const t = existing[0];
      const status = parseStatus(message) || (actionType === 'complete_task' ? 'done' : t.status);
      const newTitle = rename?.newTitle || (extractQuotedText(message) && /renommer|appeler/i.test(message) ? extractQuotedText(message) : null);
      const { rows } = await pool.query(
        `UPDATE tasks SET title=$1, status=$2 WHERE id=$3 RETURNING *`,
        [newTitle || t.title, status, t.id]
      );
      actions.push({ type: 'update_task', data: rows[0] });
      const parts = [];
      if (status !== t.status) parts.push(`statut → ${status}`);
      if (newTitle && newTitle !== t.title) parts.push(`renommée « ${newTitle} »`);
      return {
        reply: `Tâche « ${rows[0].title} » mise à jour${parts.length ? ` (${parts.join(', ')})` : ''}.`,
        actions,
      };
    }

    case 'delete_task': {
      const tasks = await resolveProjectTasks(projectId, pageContext);
      const hint = taskHintFromMessage(message);
      const taskRef = findTaskByHint(hint, tasks, false);
      if (!taskRef) return { reply: 'Tâche introuvable.', actions };
      await pool.query('DELETE FROM tasks WHERE id = $1', [taskRef.id]);
      actions.push({ type: 'delete_task', data: { id: taskRef.id, title: taskRef.title } });
      return { reply: `Tâche supprimée : « ${taskRef.title} »`, actions };
    }

    case 'list_project_tasks': {
      const id = projectId;
      if (!id) return { reply: 'Ouvrez un projet pour voir ses tâches, ou dites « tâches du jour ».', actions: [] };
      const tasks = await resolveProjectTasks(id, pageContext);
      if (!tasks.length) return { reply: `Aucune tâche dans « ${pageContext?.label || 'ce projet'} ».`, actions };
      const list = tasks.map(t => {
        const mark = t.status === 'done' ? '✓' : '○';
        return `${mark} ${t.title}${t.status !== 'todo' ? ` [${t.status}]` : ''}`;
      }).join('\n');
      actions.push({ type: 'list_project_tasks', data: tasks });
      return { reply: `Tâches — ${pageContext.label} :\n${list}`, actions };
    }

    case 'update_project': {
      const id = projectId;
      if (!id) return { reply: 'Ouvrez la page d\'un projet pour le modifier.', actions };
      const { rows: existing } = await pool.query('SELECT * FROM projects WHERE id = $1', [id]);
      const p = existing[0];
      if (!p) return { reply: 'Projet introuvable.', actions };
      const name = extractQuotedText(message) || (/renommer|appeler/i.test(message) ? extractAfterKeyword(message, ['renommer', 'appeler']) : null);
      const status = parseProjectStatus(message);
      const deadline = parseDateHint(message);
      const budget = extractAmount(message);
      const notes = /note/i.test(message) ? extractAfterKeyword(message, ['note', 'notes']) : null;
      const { rows } = await pool.query(
        `UPDATE projects SET name=$1, status=$2, deadline=$3, budget_estimated=$4, notes=$5 WHERE id=$6 RETURNING *`,
        [
          name || p.name,
          status || p.status,
          deadline ? deadline.toISOString().slice(0, 10) : p.deadline,
          budget != null && /budget/i.test(message) ? budget : p.budget_estimated,
          notes ?? p.notes,
          id,
        ]
      );
      actions.push({ type: 'update_project', data: rows[0] });
      return { reply: `Projet « ${rows[0].name} » mis à jour.`, actions };
    }

    case 'update_client': {
      const id = clientId;
      if (!id) return { reply: 'Ouvrez la fiche d\'un client pour le modifier.', actions };
      const { rows: existing } = await pool.query('SELECT * FROM clients WHERE id = $1', [id]);
      const c = existing[0];
      if (!c) return { reply: 'Client introuvable.', actions };
      const name = extractQuotedText(message) || (/renommer|appeler/i.test(message) ? extractAfterKeyword(message, ['renommer', 'appeler']) : null);
      const email = parseEmail(message) || c.email;
      const phone = parsePhone(message) || c.phone;
      const { rows } = await pool.query(
        'UPDATE clients SET name=$1, email=$2, phone=$3 WHERE id=$4 RETURNING *',
        [name || c.name, email, phone, id]
      );
      actions.push({ type: 'update_client', data: rows[0] });
      return { reply: `Client « ${rows[0].name} » mis à jour.`, actions };
    }

    case 'list_projects': {
      const { rows } = await pool.query(`
        SELECT p.*, c.name AS client_name FROM projects p
        LEFT JOIN clients c ON c.id = p.client_id
        ORDER BY p.created_at DESC LIMIT 20
      `);
      if (!rows.length) return { reply: 'Aucun projet.', actions };
      const list = rows.map(p => `• ${p.name} [${p.status}]${p.client_name ? ` — ${p.client_name}` : ''}`).join('\n');
      actions.push({ type: 'list_projects', data: rows });
      return { reply: `Projets (${rows.length}) :\n${list}`, actions };
    }

    case 'list_clients': {
      const { rows } = await pool.query('SELECT * FROM clients ORDER BY name LIMIT 30');
      if (!rows.length) return { reply: 'Aucun client.', actions };
      const list = rows.map(c => `• ${c.name}${c.email ? ` — ${c.email}` : ''}`).join('\n');
      actions.push({ type: 'list_clients', data: rows });
      return { reply: `Clients (${rows.length}) :\n${list}`, actions };
    }

    case 'list_expenses': {
      let q = 'SELECT e.*, p.name AS project_name FROM expenses e LEFT JOIN projects p ON p.id = e.project_id';
      const params = [];
      if (projectId) { params.push(projectId); q += ` WHERE e.project_id = $${params.length}`; }
      q += ' ORDER BY e.date DESC, e.created_at DESC LIMIT 20';
      const { rows } = await pool.query(q, params);
      if (!rows.length) return { reply: projectId ? 'Aucune dépense pour ce projet.' : 'Aucune dépense.', actions };
      const list = rows.map(e => `• ${Number(e.amount).toFixed(2)} $ — ${e.category}${e.project_name ? ` (${e.project_name})` : ''}`).join('\n');
      actions.push({ type: 'list_expenses', data: rows });
      return { reply: `Dépenses :\n${list}`, actions };
    }

    case 'create_quote': {
      const clientId = pageContext?.type === 'client' ? pageContext.id : null;
      if (!clientId) return { reply: 'Ouvrez la fiche client ou précisez le client.', actions };
      const title = extractQuotedText(message) || extractAfterKeyword(message, ['devis', 'quote']) || 'Devis';
      const amount = extractAmount(message);
      const lines = amount
        ? [{ description: title, qty: 1, price: amount }]
        : [{ description: title, qty: 1, price: 0 }];
      const quote = await createQuoteRecord({ client_id: clientId, title, lines });
      actions.push({ type: 'create_quote', data: quote });
      return { reply: `Devis ${quote.quote_number} créé pour « ${pageContext?.label || 'client'} »`, actions };
    }

    case 'create_invoice': {
      const clientId = pageContext?.type === 'client' ? pageContext.id : null;
      if (!clientId) return { reply: 'Ouvrez la fiche client pour créer une facture.', actions };
      const title = extractQuotedText(message) || extractAfterKeyword(message, ['facture', 'invoice']) || 'Facture';
      const amount = extractAmount(message) || 0;
      const inv = await createInvoiceRecord({
        client_id: clientId,
        project_id: pageContext?.type === 'project' ? pageContext.id : null,
        title,
        lines: [{ description: title, qty: 1, price: amount }],
      });
      actions.push({ type: 'create_invoice', data: inv });
      return { reply: `Facture #${inv.invoice_number} créée`, actions };
    }

    case 'convert_quote': {
      let quoteId = null;
      if (pageContext?.type === 'client' && pageContext.client?.quotes?.[0]) {
        quoteId = pageContext.client.quotes[0].id;
      }
      const pctMatch = message.match(/(\d+)\s*%/);
      const deposit = pctMatch ? Number(pctMatch[1]) : 100;
      if (!quoteId) {
        const { rows } = await pool.query(
          "SELECT id FROM quotes WHERE status IN ('draft','sent') ORDER BY created_at DESC LIMIT 1"
        );
        quoteId = rows[0]?.id;
      }
      if (!quoteId) return { reply: 'Aucun devis à convertir.', actions };
      const inv = await convertQuoteToInvoice(quoteId, deposit);
      actions.push({ type: 'convert_quote', data: inv });
      return { reply: `Facture #${inv.invoice_number} créée depuis le devis`, actions };
    }

    case 'send_quote':
    case 'send_invoice': {
      const isQuote = actionType === 'send_quote';
      let docId = null;
      if (isQuote && pageContext?.type === 'client') {
        const { rows } = await pool.query(
          'SELECT id FROM quotes WHERE client_id=$1 ORDER BY created_at DESC LIMIT 1', [pageContext.id]
        );
        docId = rows[0]?.id;
      }
      if (!isQuote && pageContext?.type === 'client') {
        const { rows } = await pool.query(
          'SELECT id FROM invoices WHERE client_id=$1 ORDER BY created_at DESC LIMIT 1', [pageContext.id]
        );
        docId = rows[0]?.id;
      }
      if (!docId) return { reply: `Aucun ${isQuote ? 'devis' : 'facture'} à envoyer.`, actions };
      try {
        await sendDocumentEmail(isQuote ? 'quote' : 'invoice', docId);
        actions.push({ type: actionType, data: { id: docId } });
        return { reply: `${isQuote ? 'Devis' : 'Facture'} envoyé(e) par courriel au client.`, actions };
      } catch (e) {
        return { reply: `Envoi impossible : ${e.message}`, actions };
      }
    }

    case 'list_quotes': {
      const params = [];
      let q = `SELECT q.*, c.name AS client_name FROM quotes q LEFT JOIN clients c ON c.id=q.client_id`;
      if (pageContext?.type === 'client') { params.push(pageContext.id); q += ` WHERE q.client_id=$${params.length}`; }
      q += ' ORDER BY q.created_at DESC LIMIT 15';
      const { rows } = await pool.query(q, params);
      if (!rows.length) return { reply: 'Aucun devis.', actions };
      const list = rows.map(r => `• ${r.quote_number} — ${r.title || r.client_name} (${r.status})`).join('\n');
      actions.push({ type: 'list_quotes', data: rows });
      return { reply: `Devis :\n${list}`, actions };
    }

    case 'list_invoices': {
      const params = [];
      let q = `SELECT i.*, c.name AS client_name FROM invoices i LEFT JOIN clients c ON c.id=i.client_id`;
      if (pageContext?.type === 'client') { params.push(pageContext.id); q += ` WHERE i.client_id=$${params.length}`; }
      q += ' ORDER BY i.created_at DESC LIMIT 15';
      const { rows } = await pool.query(q, params);
      if (!rows.length) return { reply: 'Aucune facture.', actions };
      const list = rows.map(r => `• #${r.invoice_number} — ${r.title || r.client_name} (${r.status})`).join('\n');
      actions.push({ type: 'list_invoices', data: rows });
      return { reply: `Factures :\n${list}`, actions };
    }

    case 'delete_project': {
      const id = projectId;
      if (!id) return { reply: 'Ouvrez un projet pour le supprimer.', actions };
      await pool.query('DELETE FROM projects WHERE id=$1', [id]);
      actions.push({ type: 'delete_project', data: { id } });
      return { reply: `Projet « ${pageContext.label} » supprimé.`, actions };
    }

    case 'delete_client': {
      const id = clientId;
      if (!id) return { reply: 'Ouvrez la fiche client.', actions };
      await pool.query('DELETE FROM clients WHERE id=$1', [id]);
      actions.push({ type: 'delete_client', data: { id } });
      return { reply: `Client « ${pageContext.label} » supprimé.`, actions };
    }

    case 'delete_expense': {
      const amount = extractAmount(message);
      const params = [];
      let q = 'DELETE FROM expenses WHERE id IN (SELECT id FROM expenses';
      if (projectId) { params.push(projectId); q += ` WHERE project_id=$${params.length}`; }
      q += ' ORDER BY created_at DESC LIMIT 1) RETURNING *';
      const { rows } = await pool.query(q, params);
      if (!rows[0]) return { reply: 'Aucune dépense à supprimer.', actions };
      actions.push({ type: 'delete_expense', data: rows[0] });
      return { reply: `Dépense supprimée (${Number(rows[0].amount).toFixed(2)} $).`, actions };
    }

    case 'update_standard': {
      if (pageContext?.type !== 'standard') return { reply: 'Ouvrez une fiche standard à modifier.', actions };
      const std = pageContext.standard;
      const meta = typeof std.meta === 'string' ? JSON.parse(std.meta) : { ...(std.meta || {}) };
      const price = extractAmount(message);
      if (price && /prix|budget/i.test(message)) meta.prix_catalogue = price;
      const dimMatch = message.match(/(\d+)\s*[x×]\s*(\d+)/i);
      if (dimMatch) meta.dimensions = `${dimMatch[1]} x ${dimMatch[2]}`;
      const name = extractQuotedText(message);
      const newName = name && /renommer|appeler/i.test(message) ? name : std.name;
      await pool.query('UPDATE standards SET name=$1, meta=$2 WHERE id=$3', [newName, JSON.stringify(meta), std.id]);
      actions.push({ type: 'update_standard', data: { id: std.id, name: newName } });
      return { reply: `Fiche « ${newName} » mise à jour.`, actions };
    }

    case 'sync_wordpress': {
      try {
        const { fullWebSync } = await import('./wordpress.js');
        const result = await fullWebSync();
        actions.push({ type: 'sync_wordpress', data: result });
        return {
          reply: `Sync neyafurniture.ca terminée :\n• ${result.products.matched} fiches produits liées\n• ${result.products.photos_downloaded ?? 0} photos récupérées\n• ${result.orders.imported} nouvelles commandes, ${result.orders.updated} mises à jour`,
          actions,
        };
      } catch (e) {
        return { reply: `Sync site web échouée : ${e.message}`, actions: [] };
      }
    }

    case 'sync_web_orders': {
      try {
        const { syncWordPressOrders } = await import('./wordpress.js');
        const result = await syncWordPressOrders();
        actions.push({ type: 'sync_web_orders', data: result });
        return {
          reply: `Commandes web importées : ${result.imported} nouvelle(s), ${result.updated} mise(s) à jour (${result.orders_found} sur le site).`,
          actions,
        };
      } catch (e) {
        return { reply: `Import commandes échoué : ${e.message}`, actions: [] };
      }
    }

    case 'sync_web_photos': {
      try {
        const { syncWebPhotos } = await import('./wordpress.js');
        const result = await syncWebPhotos();
        actions.push({ type: 'sync_web_photos', data: result });
        return {
          reply: `Photos du site récupérées : ${result.photos_downloaded} image(s) pour ${result.matched} fiche(s) produit.`,
          actions,
        };
      } catch (e) {
        return { reply: `Récupération photos échouée : ${e.message}`, actions: [] };
      }
    }

    case 'list_web_orders': {
      const { listWebOrders } = await import('./wordpress.js');
      const rows = await listWebOrders(15);
      if (!rows.length) return { reply: 'Aucune commande web synchronisée. Dites « sync site ».', actions };
      const list = rows.map(o => `• #${o.order_number} — ${o.customer_name} (${o.status}) ${Number(o.total).toFixed(0)}$`).join('\n');
      actions.push({ type: 'list_web_orders', data: rows });
      return { reply: `Commandes web :\n${list}`, actions };
    }

    case 'ui_edit_mode': {
      const { setEditMode, getDashboardLayout } = await import('./ui-layout.js');
      const enable = !/désactiver|fermer|quitter|stop|off/i.test(message);
      const layout = await setEditMode(enable);
      actions.push({ type: 'ui_edit_mode', data: layout });
      return {
        reply: enable
          ? 'Mode édition du dashboard activé. Maintenez une section pour la déplacer (↑↓), ou demandez « ajoute une todo atelier ».'
          : 'Mode édition désactivé.',
        actions,
      };
    }

    case 'ui_add_todo_list': {
      const { addTodoSection } = await import('./ui-layout.js');
      const title = extractQuotedText(message)
        || extractAfterKeyword(message, ['todo', 'liste', 'ajouter'])
        || 'Nouvelle todo';
      const layout = await addTodoSection({ title: title.slice(0, 60) });
      actions.push({ type: 'ui_add_todo_list', data: layout });
      return {
        reply: `Liste todo « ${title} » ajoutée au dashboard (mode édition activé). Maintenez-la pour la déplacer.`,
        actions,
      };
    }

    case 'ui_move_section': {
      const { moveSection, getDashboardLayout } = await import('./ui-layout.js');
      const direction = /haut|up|monter|au-dessus/i.test(message) ? 'up' : 'down';
      const layout = await getDashboardLayout();
      const words = message.toLowerCase();
      let section = layout.sections.find(s =>
        (s.title && words.includes(String(s.title).toLowerCase()))
        || (s.label && words.includes(String(s.label).toLowerCase()))
        || words.includes(s.id.replace('todo:', ''))
      );
      if (!section && /todo/i.test(message)) {
        section = layout.sections.filter(s => s.type === 'todo').slice(-1)[0];
      }
      if (!section) {
        const names = layout.sections.map(s => s.label || s.title || s.id).join(', ');
        return { reply: `Précisez la section à déplacer. Disponibles : ${names}`, actions: [] };
      }
      const next = await moveSection(section.id, direction);
      actions.push({ type: 'ui_move_section', data: next });
      return {
        reply: `Section « ${section.label || section.title} » déplacée vers le ${direction === 'up' ? 'haut' : 'bas'}.`,
        actions,
      };
    }

    case 'ui_hide_section':
    case 'ui_show_section': {
      const { setSectionVisible, getDashboardLayout } = await import('./ui-layout.js');
      const visible = actionType === 'ui_show_section';
      const layout = await getDashboardLayout();
      const words = message.toLowerCase();
      const section = layout.sections.find(s =>
        (s.title && words.includes(String(s.title).toLowerCase()))
        || (s.label && words.includes(String(s.label).toLowerCase()))
      );
      if (!section) return { reply: 'Précisez le nom de la section à afficher/masquer.', actions: [] };
      const next = await setSectionVisible(section.id, visible);
      actions.push({ type: actionType, data: next });
      return {
        reply: `Section « ${section.label || section.title} » ${visible ? 'affichée' : 'masquée'}.`,
        actions,
      };
    }

    case 'ui_reset_layout': {
      const { defaultDashboardLayout, saveDashboardLayout } = await import('./ui-layout.js');
      const layout = await saveDashboardLayout(defaultDashboardLayout());
      actions.push({ type: 'ui_reset_layout', data: layout });
      return { reply: 'Disposition du dashboard réinitialisée.', actions };
    }

    case 'erp_manual': {
      const { buildManualReply } = await import('../content/erp-manual.js');
      const { reply, href, section } = buildManualReply(message);
      actions.push({ type: 'navigate', data: { href, section } });
      return { reply: reply.replace(/\*\*/g, ''), actions };
    }

    default:
      return { reply: `Action « ${actionType} » non implémentée.`, actions: [] };
  }
}

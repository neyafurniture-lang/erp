import pool from '../db/pool.js';
import { createQuoteRecord, createInvoiceRecord, convertQuoteToInvoice } from './invoice-helpers.js';
import { sendDocumentEmail } from './document-email.js';

const DAY_MAP = {
  lundi: 1, mardi: 2, mercredi: 3, jeudi: 4, vendredi: 5, samedi: 6, dimanche: 0,
};

export const ACTION_TYPES = [
  'create_task', 'create_project', 'create_project_from_quote_email', 'schedule_task', 'plan_day', 'create_expense', 'list_today', 'list_tomorrow', 'create_client',
  'complete_task', 'update_task', 'delete_task', 'unlink_task', 'list_project_tasks',
  'update_project', 'update_client', 'list_projects', 'list_clients', 'list_expenses',
  'search_projects', 'search_memory', 'get_project', 'add_project_material',
  'list_emails', 'search_emails', 'get_email', 'import_email_attachment', 'scan_mail_invoice_todos', 'list_mail_threads',
  'import_mail_dates_to_project',
  'create_fabrication_plan',
  'list_skills', 'create_skill', 'update_skill',
  'create_quote', 'create_invoice', 'convert_quote', 'send_quote', 'send_invoice',
  'list_quotes', 'list_invoices', 'update_quote', 'get_quote',
  'delete_project', 'delete_client', 'delete_expense',
  'update_standard', 'sync_wordpress', 'sync_web_orders', 'list_web_orders', 'sync_web_photos',
  'ui_edit_mode', 'ui_add_todo_list', 'ui_move_section', 'ui_hide_section', 'ui_show_section', 'ui_reset_layout',
  'erp_manual', 'atelier_habits',
];

/** Message qui décrit un matériau / stock à ajouter au projet (pas une tâche atelier). */
export function isMaterialInfoMessage(message = '') {
  const m = String(message || '');
  if (!/\b(mat[eé]riau|mat[eé]riaux|mat[eé]riel|contreplaqu[eé]|mdf|ch[eê]ne|bois|vis|colle|panneau|plaque|quincaillerie|fer|acier|verre)\b/i.test(m)) {
    return false;
  }
  return /\b(ajouter|ajoute|besoin|pr[eé]voir|commander|pr[eé]voir|noter|inscrire|mettre|pr[eé]voir)\b/i.test(m)
    || /\b(x\s*\d+|\d+\s*(feuilles?|plaques?|unit[eé]s?|pi[eè]ces?))\b/i.test(m);
}

/** Extrait un éventuel objet params JSON préfixé au message (mode LLM). */
export function extractActionParams(message) {
  const raw = String(message || '').trim();
  if (raw.startsWith('{')) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return { params: parsed, text: '' };
      }
    } catch { /* maybe JSON + text */ }
    const m = raw.match(/^(\{[\s\S]*?\})\s+([\s\S]*)$/);
    if (m) {
      try {
        return { params: JSON.parse(m[1]), text: m[2] };
      } catch { /* fallthrough */ }
    }
  }
  return { params: {}, text: raw };
}

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
  if (/en cours|progress|wip|doing/i.test(message)) return 'doing';
  if (/à faire|a faire|todo|reprendre/i.test(message)) return 'todo';
  return null;
}

function parseProjectStatus(message) {
  if (/terminé|termine|livré|livre|completed|done|fermer/i.test(message)) return 'done';
  if (/pause|en pause|on hold/i.test(message)) return 'paused';
  if (/actif|active|en cours|rouvrir|réouvrir|reouvrir/i.test(message)) return 'active';
  if (/annulé|annule|cancel/i.test(message)) return 'cancelled';
  return null;
}

async function resolveProjectByHint(hint, pageContext = null) {
  if (pageContext?.type === 'project' && pageContext.id && !hint) {
    const { rows } = await pool.query(
      `SELECT p.*, c.name AS client_name FROM projects p
       LEFT JOIN clients c ON c.id = p.client_id WHERE p.id = $1`,
      [pageContext.id]
    );
    return rows[0] || null;
  }
  if (hint != null && String(hint).match(/^\d+$/)) {
    const { rows } = await pool.query(
      `SELECT p.*, c.name AS client_name FROM projects p
       LEFT JOIN clients c ON c.id = p.client_id WHERE p.id = $1`,
      [Number(hint)]
    );
    if (rows[0]) return rows[0];
  }
  const q = String(hint || '').trim().toLowerCase();
  if (!q) {
    if (pageContext?.type === 'project' && pageContext.id) {
      const { rows } = await pool.query(
        `SELECT p.*, c.name AS client_name FROM projects p
         LEFT JOIN clients c ON c.id = p.client_id WHERE p.id = $1`,
        [pageContext.id]
      );
      return rows[0] || null;
    }
    return null;
  }
  const { rows } = await pool.query(
    `SELECT p.*, c.name AS client_name FROM projects p
     LEFT JOIN clients c ON c.id = p.client_id
     WHERE LOWER(p.name) LIKE $1
        OR LOWER(COALESCE(c.name, '')) LIKE $1
        OR LOWER(COALESCE(p.notes, '')) LIKE $1
     ORDER BY
       CASE WHEN p.status = 'active' THEN 0 ELSE 1 END,
       CASE WHEN LOWER(p.name) = $2 THEN 0 WHEN LOWER(p.name) LIKE $2 || '%' THEN 1 ELSE 2 END,
       p.created_at DESC
     LIMIT 8`,
    [`%${q}%`, q]
  );
  if (!rows.length) return null;
  const exact = rows.find(p => p.name.toLowerCase() === q);
  return exact || rows[0];
}

async function resolveProjectId(params, message, pageContext) {
  if (params?.project_id) return Number(params.project_id);
  const hint = params?.project_name || params?.project || params?.query
    || extractQuotedText(message)
    || (/projet\s+[«"']?([^«"'.,\n]+)/i.exec(message)?.[1])
    || (/\b(?:sur|pour|du|de)\s+(?:le\s+)?projet\s+([^\n,.]+)/i.exec(message)?.[1])
    || (/\b(?:sur|pour)\s+([A-Za-zÀ-ÿ0-9][A-Za-zÀ-ÿ0-9\s-]{1,40})(?:\s*$|,|\.|et\b)/i.exec(message)?.[1])
    || null;
  const cleaned = hint ? String(hint).trim().replace(/\s+(tâche|etape|étape|finition|cocher).*$/i, '').trim() : null;
  if (cleaned || pageContext?.type === 'project') {
    const p = await resolveProjectByHint(cleaned, pageContext);
    return p?.id || null;
  }
  return pageContext?.type === 'project' ? pageContext.id : null;
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

/** Soft-contexte client / projet d'origine (sans forcer la checklist atelier). */
async function resolveSoftTaskContext(pageContext, params = {}) {
  let clientId = params.client_id != null && params.client_id !== '' && params.client_id !== 'null'
    ? Number(params.client_id) : null;
  let relatedProjectId = params.related_project_id != null && params.related_project_id !== '' && params.related_project_id !== 'null'
    ? Number(params.related_project_id) : null;

  if (pageContext?.type === 'client') {
    clientId = clientId || pageContext.id;
  } else if (pageContext?.type === 'project') {
    relatedProjectId = relatedProjectId || pageContext.id;
    clientId = clientId || pageContext.client_id || pageContext.project?.client_id || null;
  } else {
    if (pageContext?.client_id) clientId = clientId || pageContext.client_id;
    if (pageContext?.project_id) relatedProjectId = relatedProjectId || pageContext.project_id;
  }

  if (relatedProjectId && !clientId) {
    const { rows } = await pool.query('SELECT client_id FROM projects WHERE id = $1', [relatedProjectId]);
    clientId = rows[0]?.client_id || null;
  }
  return { clientId: clientId || null, relatedProjectId: relatedProjectId || null };
}

async function insertTaskForProject(projectId, title, type, minutes, extras = {}) {
  let estMinutes = minutes;
  let sortOrder = 0;
  let clientId = extras.clientId ?? null;
  let relatedProjectId = extras.relatedProjectId ?? null;
  const description = extras.description ?? null;

  if (projectId) {
    const { rows: proj } = await pool.query('SELECT standard_id, client_id FROM projects WHERE id = $1', [projectId]);
    if (proj[0] && !proj[0].standard_id) estMinutes = null;
    if (!clientId) clientId = proj[0]?.client_id || null;
    const { rows: ord } = await pool.query(
      'SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM tasks WHERE project_id = $1',
      [projectId]
    );
    sortOrder = ord[0]?.n ?? 0;
  } else {
    const { rows: ord } = await pool.query(
      'SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM tasks WHERE project_id IS NULL'
    );
    sortOrder = ord[0]?.n ?? 0;
  }

  const { rows } = await pool.query(
    `INSERT INTO tasks (project_id, client_id, related_project_id, title, description, type, status, estimated_minutes, sort_order)
     VALUES ($1,$2,$3,$4,$5,$6,'todo',$7,$8) RETURNING *`,
    [projectId, clientId, relatedProjectId, title.slice(0, 200), description, type, estMinutes, sortOrder]
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

/** Tâche admin / finance / hors projet — ne pas forcer le projet ouvert dans le chat. */
export function shouldCreateStandaloneTask(message, title = '', params = {}) {
  if (params && Object.prototype.hasOwnProperty.call(params, 'project_id')
    && (params.project_id === null || params.project_id === '' || params.project_id === 'null')) {
    return true;
  }
  if (params?.standalone === true || params?.no_project === true) return true;
  const text = `${message || ''} ${title || ''}`;
  if (/sans\s+(le\s+)?projet|hors\s+projet|pas\s+de\s+projet|tâche\s+(libre|globale)/i.test(text)) return true;
  if (/t[aâ]che\s+admin\b|\badmin\s*[-–—:]/i.test(text)) return true;
  const adminOps = /\b(transfert(\s+bancaire)?|remboursement|paiement|comptabilit[eé]|imp[oô]ts?|tps|tvq|salaire|paie|virement)\b/i.test(text);
  const workshop = /\b(finition|d[eé]bitage|assemblage|usinage|cnc|pon[cç]age|vernis|d[eé]coupe)\b/i.test(text);
  const namedProject = /\b(sur|pour|du|de)\s+(le\s+)?projet\b|\bprojet\s+[«"']?[A-Za-zÀ-ÿ]/i.test(text);
  if (adminOps && !workshop && !namedProject) return true;
  if (/\badmin\b/i.test(text) && !workshop && !namedProject) return true;
  return false;
}

/** Correction utilisateur : la tâche ne doit pas rester sur le projet ouvert. */
export function wantsUnlinkFromProject(message) {
  const m = String(message || '');
  return /pas\s+(en\s+rapport|li[eé]|reli[eé]|associ[eé])|sans\s+(le\s+)?projet|hors\s+(du\s+)?projet|mauvais\s+projet|pas\s+(pour|sur|dans)\s+(le\s+)?projet|d[eé]tach(e|er)|retir(e|er)\s+(du|le)\s+projet|ce\s+n['']?est\s+pas\s+(li[eé]|en\s+rapport|pour\s+(ce|le)\s+projet)|pas\s+celui[- ]l[aà]|pas\s+ce\s+projet/i.test(m);
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
    WHERE p.status IN ('active', 'paused')
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

export async function runSkillAction(actionType, message, pageContext = null, skill = {}, actionParams = null) {
  const actions = [];
  const extracted = extractActionParams(message);
  const params = { ...(extracted.params || {}), ...(actionParams || {}) };
  const text = extracted.text || (Object.keys(extracted.params || {}).length ? '' : String(message || ''));
  const msg = text || String(message || '');

  let projectId = pageContext?.type === 'project' ? pageContext.id : null;
  // Aussi résoudre le projet depuis le message même sans params explicites
  if (!projectId) {
    projectId = await resolveProjectId(params, msg, pageContext) || projectId;
  }
  const clientId = pageContext?.type === 'client' ? pageContext.id : null;

  switch (actionType) {
    case 'search_projects':
    case 'list_projects': {
      const q = String(params.query || params.project_name || params.q || extractQuotedText(msg) || '').trim();
      const statusFilter = params.status || null;
      const values = [];
      let sql = `
        SELECT p.*, c.name AS client_name,
          (SELECT COUNT(*)::int FROM tasks t WHERE t.project_id = p.id AND t.status != 'done') AS tasks_open,
          (SELECT COUNT(*)::int FROM tasks t WHERE t.project_id = p.id AND t.status = 'done') AS tasks_done
        FROM projects p
        LEFT JOIN clients c ON c.id = p.client_id
        WHERE 1=1`;
      if (q) {
        values.push(`%${q.toLowerCase()}%`);
        sql += ` AND (LOWER(p.name) LIKE $${values.length}
          OR LOWER(COALESCE(c.name,'')) LIKE $${values.length}
          OR LOWER(COALESCE(p.notes,'')) LIKE $${values.length})`;
      }
      if (statusFilter) {
        values.push(statusFilter);
        sql += ` AND p.status = $${values.length}`;
      }
      sql += ` ORDER BY CASE WHEN p.status = 'active' THEN 0 ELSE 1 END, p.created_at DESC LIMIT 25`;
      const { rows } = await pool.query(sql, values);
      if (!rows.length) {
        return { reply: q ? `Aucun projet trouvé pour « ${q} ».` : 'Aucun projet.', actions };
      }
      const list = rows.map(p => {
        const notes = p.notes ? ` — notes: ${String(p.notes).slice(0, 80)}` : '';
        return `• #${p.id} « ${p.name} » [${p.status}]${p.client_name ? ` — ${p.client_name}` : ''} (${p.tasks_done || 0}✓/${(p.tasks_done || 0) + (p.tasks_open || 0)})${notes}`;
      }).join('\n');
      actions.push({ type: actionType, data: rows });
      return { reply: `Projets${q ? ` « ${q} »` : ''} :\n${list}`, actions };
    }

    case 'get_project': {
      const id = await resolveProjectId(params, msg, pageContext);
      if (!id) return { reply: 'Précisez le projet (nom ou id).', actions: [] };
      const { rows } = await pool.query(
        `SELECT p.*, c.name AS client_name FROM projects p
         LEFT JOIN clients c ON c.id = p.client_id WHERE p.id = $1`,
        [id]
      );
      if (!rows[0]) return { reply: 'Projet introuvable.', actions: [] };
      const p = rows[0];
      const { rows: tasks } = await pool.query(
        'SELECT id, title, status, type FROM tasks WHERE project_id = $1 ORDER BY sort_order, id',
        [id]
      );
      const taskLines = tasks.slice(0, 20).map(t => `${t.status === 'done' ? '✓' : '○'} ${t.title}`).join('\n');
      actions.push({ type: 'get_project', data: { ...p, tasks } });
      return {
        reply: `Projet #${p.id} « ${p.name} » [${p.status}]${p.client_name ? ` — ${p.client_name}` : ''}\n`
          + `Deadline: ${p.deadline || '—'} | Budget: ${p.budget_estimated || 0}$\n`
          + `Notes: ${p.notes || '(aucune)'}\n`
          + (taskLines ? `Tâches:\n${taskLines}` : 'Aucune tâche.'),
        actions,
      };
    }

    case 'search_memory': {
      const q = String(params.query || params.q || extractQuotedText(msg) || msg.replace(/mémoire|memoire|cherche|retiens|souvenir/gi, '').trim()).trim();
      const { rows } = await pool.query(
        `SELECT * FROM assistant_memories
         WHERE active = true
           AND ($1::text = '' OR LOWER(content) LIKE $2 OR LOWER(COALESCE(category,'')) LIKE $2)
         ORDER BY confidence DESC, updated_at DESC
         LIMIT 20`,
        [q, `%${q.toLowerCase()}%`]
      );
      if (!rows.length) return { reply: q ? `Rien en mémoire pour « ${q} ».` : 'Mémoire vide.', actions };
      const list = rows.map(m => `• [${m.category}] ${m.content}${m.project_id ? ` (projet #${m.project_id})` : ''}`).join('\n');
      actions.push({ type: 'search_memory', data: rows });
      return { reply: `Mémoire atelier${q ? ` « ${q} »` : ''} :\n${list}`, actions };
    }

    case 'create_task': {
      // Ignorer le préfixe [Contexte page : projet « … »] pour ne pas voler le titre
      const cleanMsg = String(msg || '')
        .replace(/\n?\[Contexte page[\s\S]*$/i, '')
        .replace(/\n?\[Suite de conversation[\s\S]*$/i, '')
        .replace(/\n?\[[0-9]+ fichier\(s\)[\s\S]*$/i, '')
        .trim();
      let title = params.title || extractQuotedText(cleanMsg)
        || extractAfterKeyword(cleanMsg, [
          'nouvelle tâche', 'nouvelle tache', 'créer tâche', 'creer tache', 'créer tache',
          'ajouter tâche', 'ajoute tâche', 'ajouter tache', 'ajoute tache',
          'tâche', 'tache', 'task', 'étape', 'etape', 'checklist', 'ajouter', 'ajoute',
        ]);
      if (!title || title.length < 2) {
        if (cleanMsg && cleanMsg.length <= 180 && /t[aâ]che|admin|transfert|paiement|finition|assemblage|d[eé]bitage/i.test(cleanMsg)) {
          title = cleanMsg.replace(/^(ajoute[rz]?|cr[eé]e[rz]?|nouvelle)\s+/i, '').trim();
        }
      }
      // Si le LLM/extract a repris le nom du projet ouvert, reconstruire depuis la consigne
      if (pageContext?.label && title && title.toLowerCase() === String(pageContext.label).toLowerCase() && cleanMsg) {
        const rebuilt = extractAfterKeyword(cleanMsg, ['tâche', 'tache', 'task', 'ajouter', 'ajoute'])
          || cleanMsg.replace(/^(ajoute[rz]?|cr[eé]e[rz]?|nouvelle)\s+/i, '').trim();
        if (rebuilt && rebuilt.toLowerCase() !== String(pageContext.label).toLowerCase()) title = rebuilt;
      }
      title = (title || 'Nouvelle tâche').replace(/\s+/g, ' ').trim();
      if (/^admin\b/i.test(title)) {
        title = title
          .replace(/^admin\s*[-–—:]?\s*/i, 'Admin – ')
          .replace(/^Admin – (faire|à faire|a faire)\s+/i, 'Admin – ');
        // Capitaliser le premier mot après le préfixe
        title = title.replace(/^(Admin – )([a-zàâäéèêëïîôùûüç])/i, (_, p, c) => `${p}${c.toUpperCase()}`);
      }
      let type = params.type || 'admin';
      if (!params.type) {
        if (/débitage|cnc|usinage/i.test(msg)) type = /cnc|usinage/i.test(msg) ? 'usinage' : 'debitage';
        else if (/assemblage/i.test(msg)) type = 'assemblage';
        else if (/finition|vernis|ponçage/i.test(msg)) type = 'finition';
        else if (shouldCreateStandaloneTask(msg, title, params) || shouldCreateStandaloneTask(message, title, params)) {
          type = 'admin';
        }
      }
      const minutes = params.estimated_minutes || extractDuration(msg);
      const soft = await resolveSoftTaskContext(pageContext, params);
      // Admin / finance / « sans projet » : hors checklist atelier, mais client + projet d'origine conservés
      if (shouldCreateStandaloneTask(msg, title, params) || shouldCreateStandaloneTask(message, title, params)) {
        const task = await insertTaskForProject(null, title, type || 'admin', minutes, {
          clientId: soft.clientId,
          relatedProjectId: soft.relatedProjectId,
        });
        actions.push({ type: 'create_task', data: task });
        const ctxBits = [];
        if (soft.clientId) {
          const { rows: crows } = await pool.query('SELECT name FROM clients WHERE id = $1', [soft.clientId]);
          if (crows[0]?.name) ctxBits.push(`client « ${crows[0].name} »`);
        }
        if (soft.relatedProjectId) {
          const { rows: prows } = await pool.query('SELECT name FROM projects WHERE id = $1', [soft.relatedProjectId]);
          if (prows[0]?.name) ctxBits.push(`contexte « ${prows[0].name} »`);
        }
        const ctxNote = ctxBits.length ? ` — ${ctxBits.join(', ')} conservé` : '';
        return {
          reply: `Tâche « ${task.title} » créée hors checklist projet (admin / générale)${ctxNote}.`,
          actions,
        };
      }
      // Projet explicite dans params/message d'abord ; sinon hint page ouverte (atelier)
      let pid = null;
      if (params?.project_id != null && params.project_id !== '' && params.project_id !== 'null') {
        pid = Number(params.project_id);
      } else if (params?.project_name || /\bprojet\b/i.test(msg)) {
        pid = await resolveProjectId(params, msg, null);
      }
      if (!pid && pageContext?.type === 'project') pid = pageContext.id;
      if (!pid) pid = await resolveProjectId(params, msg, pageContext);
      if (!pid) {
        return { reply: 'Précisez le projet (ex. « ajoute finition sur projet Olive »), ou dites « tâche admin » / « sans projet ».', actions: [] };
      }
      const task = await insertTaskForProject(pid, title, type, minutes, {
        clientId: soft.clientId,
      });
      actions.push({ type: 'create_task', data: task });
      const { rows: pname } = await pool.query('SELECT name FROM projects WHERE id = $1', [pid]);
      return {
        reply: `Tâche « ${task.title} » ajoutée au projet « ${pname[0]?.name || `#${pid}`} ».`,
        actions,
      };
    }

    case 'unlink_task': {
      let task = null;
      const hint = params.task_title || params.task || extractQuotedText(msg) || null;
      const pid = pageContext?.type === 'project'
        ? pageContext.id
        : (params.project_id != null && params.project_id !== '' ? Number(params.project_id) : null);

      if (params.task_id) {
        const { rows } = await pool.query('SELECT * FROM tasks WHERE id = $1', [Number(params.task_id)]);
        task = rows[0] || null;
      }
      if (!task && hint && pid) {
        const tasks = await resolveProjectTasks(pid, pageContext);
        task = findTaskByHint(hint, tasks, false);
      }
      if (!task && pid) {
        const { rows } = await pool.query(
          `SELECT * FROM tasks WHERE project_id = $1
           ORDER BY created_at DESC NULLS LAST, id DESC LIMIT 10`,
          [pid]
        );
        task = rows.find(t => t.type === 'admin'
          || /admin|transfert|paiement|remboursement|bancaire|virement/i.test(t.title))
          || rows[0]
          || null;
      }
      if (!task) {
        const { rows } = await pool.query(
          `SELECT * FROM tasks
           WHERE project_id IS NOT NULL
             AND (type = 'admin' OR title ~* 'admin|transfert|paiement|remboursement|bancaire')
           ORDER BY created_at DESC NULLS LAST, id DESC
           LIMIT 1`
        );
        task = rows[0] || null;
      }
      if (!task) {
        return {
          reply: 'Aucune tâche à détacher. Indiquez le titre ou ouvrez le projet concerné.',
          actions: [],
        };
      }
      if (!task.project_id) {
        return {
          reply: `La tâche « ${task.title} » n'est déjà plus dans une checklist projet`
            + (task.client_id || task.related_project_id ? ' (contexte client/historique conservé).' : '.'),
          actions: [],
        };
      }
      const { rows: proj } = await pool.query(
        'SELECT id, name, client_id FROM projects WHERE id = $1',
        [task.project_id]
      );
      const oldName = proj[0]?.name || `#${task.project_id}`;
      const keepClientId = task.client_id || proj[0]?.client_id || null;
      const keepRelated = task.related_project_id || task.project_id;
      const { rows } = await pool.query(
        `UPDATE tasks
         SET project_id = NULL,
             related_project_id = COALESCE(related_project_id, $2),
             client_id = COALESCE(client_id, $3)
         WHERE id = $1
         RETURNING *`,
        [task.id, keepRelated, keepClientId]
      );
      actions.push({ type: 'unlink_task', data: rows[0] });
      const ctxBits = [];
      if (keepClientId) {
        const { rows: crows } = await pool.query('SELECT name FROM clients WHERE id = $1', [keepClientId]);
        if (crows[0]?.name) ctxBits.push(`client « ${crows[0].name} »`);
      }
      if (keepRelated) ctxBits.push(`historique « ${oldName} »`);
      const ctxNote = ctxBits.length ? ` Contexte ${ctxBits.join(' / ')} conservé.` : '';
      return {
        reply: `Compris — « ${rows[0].title} » retirée de la checklist « ${oldName} » (admin / générale).${ctxNote}`,
        actions,
      };
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
      const amount = extractAmount(message) || Number(params.amount) || 0;
      if (!amount || amount <= 0) {
        return { reply: 'Indiquez un montant (ex. « dépense 85$ matériaux »).', actions };
      }
      let category = 'materiaux';
      if (/outil/i.test(message) || params.category === 'outils') category = 'outils';
      else if (/transport/i.test(message) || params.category === 'transport') category = 'transport';
      else if (/atelier/i.test(message) || params.category === 'atelier') category = 'atelier';
      else if (/admin/i.test(message) || params.category === 'admin') category = 'admin';
      else if (params.category) category = String(params.category);
      const desc = extractAfterKeyword(message, ['dépense', 'acheté', 'payé']) || message;
      const { normalizePurchaseDate, extractDateFromText, todayISODate } = await import('./expense-date.js');
      const expenseDate = normalizePurchaseDate(params.date)
        || extractDateFromText(message)
        || todayISODate();
      const { rows } = await pool.query(
        `INSERT INTO expenses (amount, category, description, project_id, date) VALUES ($1,$2,$3,$4,$5::date) RETURNING *`,
        [amount, category, desc.slice(0, 300), projectId, expenseDate]
      );
      actions.push({ type: 'create_expense', data: rows[0] });
      const linked = projectId ? ` (projet « ${pageContext.label} »)` : '';
      return {
        reply: `Dépense enregistrée${linked} : ${amount.toFixed(2)} $ (${category}) · date ${expenseDate}`,
        actions,
      };
    }

    case 'list_today': {
      const { rows } = await pool.query(`
        SELECT t.*, p.name as project_name FROM tasks t
        LEFT JOIN projects p ON p.id = t.project_id
        WHERE t.start_time IS NOT NULL
          AND DATE(t.start_time AT TIME ZONE 'America/Toronto') = (CURRENT_TIMESTAMP AT TIME ZONE 'America/Toronto')::date
        ORDER BY t.start_time LIMIT 20
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
      const pid = projectId || await resolveProjectId(params, msg, pageContext);
      const tasks = await resolveProjectTasks(pid, pid === pageContext?.id ? pageContext : null);
      const rename = parseRename(msg);
      const hint = params.task_title || params.task || params.title || rename?.hint || taskHintFromMessage(msg);
      let taskRef = null;
      if (params.task_id) {
        taskRef = tasks.find(t => t.id === Number(params.task_id))
          || (await pool.query('SELECT * FROM tasks WHERE id = $1', [Number(params.task_id)])).rows[0];
      } else {
        taskRef = findTaskByHint(hint, tasks);
      }
      if (!taskRef && !pid) {
        return { reply: 'Précisez le projet et la tâche (ex. « cocher finition sur Olive »).', actions: [] };
      }
      if (!taskRef) {
        return { reply: pid
          ? `Aucune tâche trouvée${hint ? ` pour « ${hint} »` : ''} dans le projet #${pid}.`
          : 'Ouvrez un projet ou précisez la tâche.', actions: [] };
      }
      const { rows: existing } = await pool.query('SELECT * FROM tasks WHERE id = $1', [taskRef.id]);
      const t = existing[0];
      const status = params.status
        || parseStatus(msg)
        || (actionType === 'complete_task' ? 'done' : t.status);
      const newTitle = params.new_title || rename?.newTitle
        || (extractQuotedText(msg) && /renommer|appeler/i.test(msg) ? extractQuotedText(msg) : null);
      const { rows } = await pool.query(
        `UPDATE tasks SET title=$1, status=$2 WHERE id=$3 RETURNING *`,
        [newTitle || t.title, status, t.id]
      );
      const { syncProjectStatusFromTasks } = await import('./project-status-sync.js');
      await syncProjectStatusFromTasks(t.project_id, { fromStatus: t.status, toStatus: status });
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
      const pid = projectId || await resolveProjectId(params, msg, pageContext);
      const tasks = await resolveProjectTasks(pid, pid === pageContext?.id ? pageContext : null);
      const hint = params.task_title || params.task || taskHintFromMessage(msg);
      const taskRef = params.task_id
        ? (tasks.find(t => t.id === Number(params.task_id)) || { id: Number(params.task_id) })
        : findTaskByHint(hint, tasks, false);
      if (!taskRef?.id) return { reply: 'Tâche introuvable.', actions };
      const { rows: existing } = await pool.query('SELECT * FROM tasks WHERE id = $1', [taskRef.id]);
      if (!existing[0]) return { reply: 'Tâche introuvable.', actions };
      const projectIdForSync = existing[0].project_id;
      await pool.query('DELETE FROM tasks WHERE id = $1', [taskRef.id]);
      if (projectIdForSync) {
        const { syncProjectStatusFromTasks } = await import('./project-status-sync.js');
        await syncProjectStatusFromTasks(projectIdForSync, {
          deleted: true,
          fromStatus: existing[0].status,
        });
      }
      actions.push({ type: 'delete_task', data: { id: existing[0].id, title: existing[0].title } });
      return { reply: `Tâche supprimée : « ${existing[0].title} »`, actions };
    }

    case 'list_project_tasks': {
      const id = projectId || await resolveProjectId(params, msg, pageContext);
      if (!id) return { reply: 'Précisez le projet (nom ou page ouverte).', actions: [] };
      const { rows: proj } = await pool.query('SELECT name FROM projects WHERE id = $1', [id]);
      const tasks = await resolveProjectTasks(id, id === pageContext?.id ? pageContext : null);
      if (!tasks.length) return { reply: `Aucune tâche dans « ${proj[0]?.name || id} ».`, actions };
      const list = tasks.map(t => {
        const mark = t.status === 'done' ? '✓' : '○';
        return `${mark} ${t.title}${t.status !== 'todo' ? ` [${t.status}]` : ''}`;
      }).join('\n');
      actions.push({ type: 'list_project_tasks', data: tasks });
      return { reply: `Tâches — ${proj[0]?.name || `#${id}`} :\n${list}`, actions };
    }

    case 'update_project': {
      const id = projectId || await resolveProjectId(params, msg, pageContext);
      if (!id) return { reply: 'Précisez le projet à modifier (nom ou id).', actions };
      const { rows: existing } = await pool.query('SELECT * FROM projects WHERE id = $1', [id]);
      const p = existing[0];
      if (!p) return { reply: 'Projet introuvable.', actions };
      const name = params.name || extractQuotedText(msg)
        || (/renommer|appeler/i.test(msg) ? extractAfterKeyword(msg, ['renommer', 'appeler']) : null);
      const status = params.status || parseProjectStatus(msg);
      const deadline = params.deadline ? new Date(params.deadline) : parseDateHint(msg);
      const budget = params.budget_estimated != null ? Number(params.budget_estimated) : extractAmount(msg);
      let notes = params.notes ?? params.description ?? null;
      if (notes == null && /note|descriptif|description|ajoute.*(note|descript)/i.test(msg)) {
        notes = extractAfterKeyword(msg, ['note', 'notes', 'descriptif', 'description']) || extractQuotedText(msg);
      }
      if (notes != null && params.append_notes && p.notes) {
        notes = `${p.notes}\n${notes}`;
      }
      let clientId = p.client_id;
      if (params.client_id !== undefined) {
        clientId = params.client_id === '' || params.client_id == null ? null : Number(params.client_id);
      } else if (pageContext?.type === 'client' && /lier|associer|assigner.*(client|ce client)/i.test(msg)) {
        clientId = pageContext.id;
      }
      const { rows } = await pool.query(
        `UPDATE projects SET name=$1, status=$2, deadline=$3, budget_estimated=$4, notes=$5, client_id=$6 WHERE id=$7 RETURNING *`,
        [
          name || p.name,
          status || p.status,
          deadline ? (deadline instanceof Date ? deadline.toISOString().slice(0, 10) : String(deadline).slice(0, 10)) : p.deadline,
          budget != null && (params.budget_estimated != null || /budget/i.test(msg)) ? budget : p.budget_estimated,
          notes != null ? notes : p.notes,
          clientId,
          id,
        ]
      );
      const { rows: full } = await pool.query(
        `SELECT p.*, c.name AS client_name FROM projects p
         LEFT JOIN clients c ON c.id = p.client_id WHERE p.id = $1`,
        [id]
      );
      actions.push({ type: 'update_project', data: full[0] || rows[0] });
      const linked = full[0]?.client_name ? ` — client : ${full[0].client_name}` : (clientId == null && p.client_id ? ' — client retiré' : '');
      return { reply: `Projet « ${rows[0].name} » mis à jour${linked}${notes != null ? ' (notes/descriptif)' : ''}.`, actions };
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

    case 'list_clients': {
      const { rows } = await pool.query('SELECT * FROM clients ORDER BY name LIMIT 30');
      if (!rows.length) return { reply: 'Aucun client.', actions };
      const list = rows.map(c => `• ${c.name}${c.email ? ` — ${c.email}` : ''}`).join('\n');
      actions.push({ type: 'list_clients', data: rows });
      return { reply: `Clients (${rows.length}) :\n${list}`, actions };
    }

    case 'list_expenses': {
      let q = 'SELECT e.*, p.name AS project_name FROM expenses e LEFT JOIN projects p ON p.id = e.project_id';
      const sqlParams = [];
      if (projectId) { sqlParams.push(projectId); q += ` WHERE e.project_id = $${sqlParams.length}`; }
      q += ' ORDER BY e.date DESC, e.created_at DESC LIMIT 20';
      const { rows } = await pool.query(q, sqlParams);
      if (!rows.length) return { reply: projectId ? 'Aucune dépense pour ce projet.' : 'Aucune dépense.', actions };
      const list = rows.map(e => `• ${Number(e.amount).toFixed(2)} $ — ${e.category}${e.project_name ? ` (${e.project_name})` : ''}`).join('\n');
      actions.push({ type: 'list_expenses', data: rows });
      return { reply: `Dépenses :\n${list}`, actions };
    }

    case 'list_emails': {
      try {
        const gmail = await import('./google-gmail.js');
        const { enrichInboxMessages } = await import('./mail-sort.js');
        const max = Math.min(Number(params.max) || 15, 30);
        const category = String(params.category || params.section || '').trim().toLowerCase();
        const { messages: raw } = await gmail.listMessages({ label: 'INBOX', max: Math.max(max, 25) });
        const { messages: enriched } = await enrichInboxMessages(raw || []);
        let list = enriched;
        if (category && category !== 'inbox') {
          list = enriched.filter(m => m.mailCategory === category);
        }
        list = list.slice(0, max);
        if (!list.length) {
          return {
            reply: category
              ? `Aucun courriel dans la section « ${category} ».`
              : 'Boîte de réception vide (ou Gmail non connecté).',
            actions,
          };
        }
        const lines = list.map((m, i) => {
          const unread = m.isUnread ? '● ' : '';
          const cat = m.mailCategory ? ` [${m.mailCategory}]` : '';
          const proj = m.project_name ? ` → ${m.project_name}` : '';
          return `${i + 1}. ${unread}${m.from || '?'} — ${m.subject || '(sans objet)'}${cat}${proj}\n   ${String(m.snippet || '').slice(0, 120)}`;
        }).join('\n');
        actions.push({ type: 'list_emails', data: list });
        return {
          reply: `Courriels récents (${list.length})${category ? ` — ${category}` : ''} :\n${lines}\n\nPour lire un message : « ouvre le mail 2 » ou get_email avec message_id.`,
          actions,
        };
      } catch (err) {
        return {
          reply: `Impossible d'accéder à Gmail : ${err.message}. Connectez Google dans Paramètres → Intégrations.`,
          actions,
        };
      }
    }

    case 'search_emails': {
      try {
        const gmail = await import('./google-gmail.js');
        const q = String(
          params.query || params.q || extractQuotedText(msg)
          || extractAfterKeyword(msg, ['cherche mail', 'chercher mail', 'cherche courriel', 'rechercher mail', 'mails de', 'courriels de', 'email de'])
          || msg.replace(/^(cherche|rechercher|trouver|liste)\s+(les?\s+)?(mails?|courriels?|emails?)\s*/i, '')
        ).trim();
        if (!q || q.length < 2) {
          return { reply: 'Précisez la recherche, ex. « cherche mails de The NNS » ou « mails facture ».', actions };
        }
        const max = Math.min(Number(params.max) || 12, 25);
        const { messages } = await gmail.searchMessages(q, max);
        if (!messages?.length) {
          return { reply: `Aucun courriel trouvé pour « ${q} ».`, actions };
        }
        const lines = messages.map((m, i) => (
          `${i + 1}. ${m.from || '?'} — ${m.subject || '(sans objet)'}\n   ${String(m.snippet || '').slice(0, 120)}`
        )).join('\n');
        actions.push({ type: 'search_emails', data: { query: q, messages } });
        return {
          reply: `Résultats Gmail pour « ${q} » (${messages.length}) :\n${lines}\n\nPour le contenu : get_email avec {"message_id":"…"} ou « ouvre le mail 1 ».`,
          actions,
        };
      } catch (err) {
        return {
          reply: `Recherche Gmail impossible : ${err.message}. Vérifiez la connexion Google.`,
          actions,
        };
      }
    }

    case 'get_email': {
      try {
        const gmail = await import('./google-gmail.js');
        let messageId = params.message_id || params.id || null;
        const indexHint = Number(params.index || params.n || msg.match(/(?:mail|courriel|message)\s*(?:n[o°]?\s*)?(\d+)/i)?.[1]);

        if (!messageId && indexHint >= 1) {
          const { messages } = await gmail.listMessages({ label: 'INBOX', max: Math.max(indexHint, 15) });
          messageId = messages?.[indexHint - 1]?.id || null;
        }
        if (!messageId) {
          const q = String(params.query || extractQuotedText(msg) || '').trim();
          if (q) {
            const { messages } = await gmail.searchMessages(q, 5);
            messageId = messages?.[0]?.id || null;
          }
        }
        if (!messageId) {
          return {
            reply: 'Indiquez quel mail : « ouvre le mail 1 », un message_id, ou un sujet entre guillemets.',
            actions,
          };
        }

        const full = await gmail.getMessage(messageId);
        const body = String(full.body || full.snippet || '').replace(/\s+/g, ' ').trim().slice(0, 2500);
        let erpHint = '';
        try {
          const { processGmailMessage } = await import('./email-threads.js');
          const thread = await processGmailMessage(messageId);
          if (thread?.client_name || thread?.project_name) {
            erpHint = `\nLien ERP : ${[thread.client_name && `client ${thread.client_name}`, thread.project_name && `projet ${thread.project_name}`].filter(Boolean).join(' · ')}`;
          }
          if (thread?.latest_synthesis?.summary) {
            erpHint += `\nSynthèse : ${thread.latest_synthesis.summary}`;
          }
        } catch { /* optional */ }

        actions.push({
          type: 'get_email',
          data: {
            id: full.id,
            threadId: full.threadId,
            subject: full.subject,
            from: full.from,
            date: full.date,
            snippet: full.snippet,
            attachments: full.attachments || [],
          },
        });
        const attNote = full.attachments?.length
          ? `\nPièces jointes (${full.attachments.length}) : ${full.attachments.map(a => a.filename).join(', ')}\n→ Dites « rentre cette facture du mail » pour importer automatiquement.`
          : '';
        return {
          reply: `De : ${full.from}\nObjet : ${full.subject}\nDate : ${full.date || '—'}${erpHint}${attNote}\n\n${body || '(corps vide)'}`,
          actions,
        };
      } catch (err) {
        return { reply: `Lecture du courriel impossible : ${err.message}`, actions };
      }
    }

    case 'import_email_attachment': {
      try {
        const { importAttachmentFromEmail } = await import('./mail-invoice-import.js');
        return await importAttachmentFromEmail(msg, pageContext, params);
      } catch (err) {
        return {
          reply: `Import depuis Gmail impossible : ${err.message}. Vérifiez la connexion Google et reformulez (ex. « facture du mail de Olive »).`,
          actions,
        };
      }
    }

    case 'scan_mail_invoice_todos': {
      try {
        const { scanMailInvoicesToAdminTasks } = await import('./mail-invoice-todos.js');
        const days = Number(params.days) || 30;
        const max = Number(params.max) || 50;
        const result = await scanMailInvoicesToAdminTasks({ days, max });
        const byPerson = {};
        for (const t of result.tasks || []) {
          const key = `${t.kind}:${t.person}`;
          byPerson[key] = (byPerson[key] || 0) + 1;
        }
        const lines = Object.entries(byPerson).map(([key, n]) => {
          const [kind, person] = key.split(':');
          const label = kind === 'a_recevoir' ? 'À recevoir' : 'À payer';
          return `• ${label} — ${person}${n > 1 ? ` (${n})` : ''}`;
        });
        actions.push({ type: 'scan_mail_invoice_todos', data: result });
        if (!result.classified && !result.created) {
          return {
            reply: `Aucune facture récente trouvée dans Gmail (${result.scanned || 0} message(s) scannés). Vérifiez que Gmail est connecté.`,
            actions,
          };
        }
        return {
          reply: [
            `Factures classées dans Admin (${result.classified} mail(s), ${result.created} nouvelle(s) todo(s)) :`,
            `• À payer : ${result.payable || 0}`,
            `• À recevoir : ${result.receivable || 0}`,
            lines.length ? `\nPar personne :\n${lines.join('\n')}` : null,
            '\nOuvre /admin pour cocher.',
          ].filter(Boolean).join('\n'),
          actions,
        };
      } catch (err) {
        return {
          reply: `Scan factures mail impossible : ${err.message}. Vérifiez Google / Gmail.`,
          actions,
        };
      }
    }

    case 'list_mail_threads': {
      try {
        const { listThreads } = await import('./email-threads.js');
        const rows = await listThreads({
          client_id: params.client_id || clientId || undefined,
          project_id: params.project_id || projectId || undefined,
          unlinked: params.unlinked,
          limit: Math.min(Number(params.max) || 15, 40),
        });
        if (!rows.length) {
          return {
            reply: 'Aucun fil ERP synchronisé. Sur /mail, lancez « Trier la boîte » ou ouvrez un message.',
            actions,
          };
        }
        const lines = rows.map(t => {
          const link = [t.client_name, t.project_name].filter(Boolean).join(' / ') || 'non lié';
          const cat = t.mail_category ? ` [${t.mail_category}]` : '';
          return `• ${t.subject || '(sans objet)'}${cat} — ${link}`;
        }).join('\n');
        actions.push({ type: 'list_mail_threads', data: rows });
        return { reply: `Fils courriel ERP (${rows.length}) :\n${lines}`, actions };
      } catch (err) {
        return { reply: `Fils courriel indisponibles : ${err.message}`, actions };
      }
    }

    case 'create_fabrication_plan': {
      const pid = projectId || await resolveProjectId(params, msg, pageContext);
      if (!pid) {
        return {
          reply: 'Indiquez le projet (ouvrez-le ou « plan fabrication sur projet Olive ») pour y créer les étapes.',
          actions,
        };
      }
      const { rows: projRows } = await pool.query(
        'SELECT p.*, c.name AS client_name FROM projects p LEFT JOIN clients c ON c.id = p.client_id WHERE p.id = $1',
        [pid]
      );
      const project = projRows[0];
      if (!project) return { reply: 'Projet introuvable.', actions };

      let steps = Array.isArray(params.steps) ? params.steps : [];
      if (!steps.length && params.plan_text) {
        steps = String(params.plan_text)
          .split(/\n+/)
          .map(l => l.replace(/^[-*•\d.)\s]+/, '').trim())
          .filter(l => l.length > 2)
          .map(title => ({ title, type: inferTaskType(title), estimated_minutes: defaultMinutesForType(inferTaskType(title)) }));
      }
      if (!steps.length) {
        // Découper le message après "plan" / "étapes"
        const after = extractAfterKeyword(msg, ['plan de fabrication', 'plan fabrication', 'étapes', 'checklist', 'plan'])
          || extractQuotedText(msg)
          || '';
        const bits = splitPlanItems(after || msg).slice(0, 12);
        steps = bits.map(title => ({
          title: title.slice(0, 200),
          type: inferTaskType(title),
          estimated_minutes: defaultMinutesForType(inferTaskType(title)),
        }));
      }
      steps = steps
        .map(s => ({
          title: String(s.title || s.description || '').trim().slice(0, 200),
          type: ['debitage', 'usinage', 'assemblage', 'finition', 'admin'].includes(s.type)
            ? s.type
            : inferTaskType(String(s.title || '')),
          estimated_minutes: Number(s.estimated_minutes) > 0
            ? Number(s.estimated_minutes)
            : defaultMinutesForType(inferTaskType(String(s.title || ''))),
        }))
        .filter(s => s.title.length > 1)
        .slice(0, 20);

      if (!steps.length) {
        return {
          reply: `Projet « ${project.name} » trouvé, mais aucune étape détectée. Joignez le mail/PDF ou listez les étapes.`,
          actions,
        };
      }

      const created = [];
      for (const step of steps) {
        const task = await insertTaskForProject(pid, step.title, step.type, step.estimated_minutes);
        created.push(task);
        actions.push({ type: 'create_task', data: task });
      }

      const notesExtra = params.notes || params.summary || null;
      const fileNote = params.source_files?.length
        ? `Fichiers liés : ${params.source_files.join(', ')}`
        : null;
      const noteParts = [project.notes, notesExtra, fileNote].filter(Boolean);
      if (notesExtra || fileNote) {
        await pool.query(
          'UPDATE projects SET notes = $1 WHERE id = $2',
          [noteParts.join('\n\n').slice(0, 4000), pid]
        );
      }

      // Lier un fil courriel récent au projet si demandé
      if (params.link_email !== false) {
        try {
          const { listThreads, linkThread } = await import('./email-threads.js');
          const q = (params.project_query || project.name || '').toLowerCase();
          const threads = await listThreads({ unlinked: true, limit: 20 });
          const match = threads.find(t => {
            const hay = `${t.subject || ''} ${(t.participant_emails || []).join(' ')}`.toLowerCase();
            return q && hay.includes(q.split(/\s+/)[0]);
          });
          if (match?.id) {
            await linkThread(match.id, { project_id: pid, client_id: project.client_id, link_source: 'assistant_plan' });
            actions.push({ type: 'link_email_thread', data: { thread_id: match.id, subject: match.subject } });
          }
        } catch { /* optional */ }
      }

      actions.push({ type: 'create_fabrication_plan', data: { project_id: pid, tasks: created } });
      const list = created.map((t, i) => `${i + 1}. ${t.title} (${t.type})`).join('\n');
      return {
        reply: `Plan de fabrication créé sur « ${project.name} » (${created.length} étapes) :\n${list}${notesExtra ? `\n\nNotes : ${notesExtra}` : ''}`,
        actions,
      };
    }

    case 'create_quote': {
      const clientIdForQuote = pageContext?.type === 'client'
        ? pageContext.id
        : pageContext?.type === 'quote'
          ? pageContext.client_id
          : params.client_id || null;
      if (!clientIdForQuote) return { reply: 'Ouvrez la fiche client ou un devis, ou précisez le client.', actions };
      const title = params.title || extractQuotedText(msg) || extractAfterKeyword(msg, ['devis', 'quote']) || 'Devis';
      const amount = params.amount != null ? Number(params.amount) : extractAmount(msg);
      const lines = Array.isArray(params.lines) && params.lines.length
        ? params.lines
        : amount
          ? [{ description: title, qty: 1, price: amount }]
          : [{ description: title, qty: 1, price: 0 }];
      const quote = await createQuoteRecord({
        client_id: clientIdForQuote,
        project_id: params.project_id || pageContext?.project_id || null,
        title,
        lines,
        notes: params.notes || null,
      });
      actions.push({ type: 'create_quote', data: quote });
      return { reply: `Devis ${quote.quote_number} créé`, actions };
    }

    case 'get_quote': {
      let qid = params.quote_id || (pageContext?.type === 'quote' ? pageContext.id : null);
      if (!qid && params.quote_number) {
        const { rows } = await pool.query('SELECT id FROM quotes WHERE quote_number ILIKE $1 LIMIT 1', [params.quote_number]);
        qid = rows[0]?.id;
      }
      if (!qid) {
        const { rows } = await pool.query('SELECT id FROM quotes ORDER BY created_at DESC LIMIT 1');
        qid = rows[0]?.id;
      }
      if (!qid) return { reply: 'Aucun devis trouvé.', actions };
      const { rows } = await pool.query(`
        SELECT q.*, c.name AS client_name, p.name AS project_name
        FROM quotes q
        LEFT JOIN clients c ON c.id = q.client_id
        LEFT JOIN projects p ON p.id = q.project_id
        WHERE q.id = $1
      `, [qid]);
      const q = rows[0];
      if (!q) return { reply: 'Devis introuvable.', actions };
      const lines = typeof q.lines === 'string' ? JSON.parse(q.lines || '[]') : (q.lines || []);
      const list = lines.map((l, i) => `${i + 1}. ${l.description || '—'} — ${l.qty || 0} × ${Number(l.price || 0).toFixed(2)} $`).join('\n');
      actions.push({ type: 'get_quote', data: { ...q, lines } });
      return {
        reply: `Devis ${q.quote_number} — ${q.title || 'sans titre'} [${q.status}]\nClient : ${q.client_name || '—'}\nProjet : ${q.project_name || '—'}\nTotal : ${Number(q.total || 0).toFixed(2)} $\n\nLignes :\n${list || '(vide)'}`,
        actions,
      };
    }

    case 'update_quote': {
      let qid = params.quote_id || (pageContext?.type === 'quote' ? pageContext.id : null);
      if (!qid && params.quote_number) {
        const { rows } = await pool.query('SELECT id FROM quotes WHERE quote_number ILIKE $1 LIMIT 1', [String(params.quote_number)]);
        qid = rows[0]?.id;
      }
      if (!qid) return { reply: 'Ouvrez un devis ou précisez quote_id / numéro.', actions };

      const { rows: existing } = await pool.query('SELECT * FROM quotes WHERE id = $1', [qid]);
      const q = existing[0];
      if (!q) return { reply: 'Devis introuvable.', actions };

      let lines = typeof q.lines === 'string' ? JSON.parse(q.lines || '[]') : (q.lines || []);
      if (!Array.isArray(lines)) lines = [];

      // Remplacement complet des lignes
      if (Array.isArray(params.lines) && params.lines.length) {
        lines = params.lines.map(l => ({
          description: String(l.description || '').trim(),
          qty: Number(l.qty) || 0,
          price: Number(l.price) || 0,
        }));
      }

      // Ajouter une ligne
      const addDesc = params.add_line || params.line_description
        || (/ajoute|ajouter|nouvelle ligne/i.test(msg)
          ? (extractQuotedText(msg) || extractAfterKeyword(msg, ['ligne', 'ajoute', 'ajouter', 'item']))
          : null);
      if (addDesc && !Array.isArray(params.lines)) {
        const qty = params.qty != null ? Number(params.qty) : (Number(msg.match(/(\d+(?:[.,]\d+)?)\s*[x×]/i)?.[1]?.replace(',', '.')) || 1);
        const price = params.price != null ? Number(params.price) : (extractAmount(msg) || 0);
        lines.push({ description: String(addDesc).slice(0, 300), qty, price });
      }

      // Modifier une ligne existante (par index 1-based ou par texte)
      if (params.update_line || params.line_index || /change|modifie|mets|met\s|prix de/i.test(msg)) {
        let idx = params.line_index != null ? Number(params.line_index) - 1 : -1;
        const needle = params.line_match || params.item
          || extractQuotedText(msg)
          || extractAfterKeyword(msg, ['ligne', 'prix de', 'change', 'modifie', 'mets']);
        if (idx < 0 && needle) {
          idx = lines.findIndex(l => String(l.description || '').toLowerCase().includes(String(needle).toLowerCase().slice(0, 40)));
        }
        if (idx >= 0 && idx < lines.length) {
          if (params.price != null || /prix|\$|dollar/i.test(msg)) {
            const price = params.price != null ? Number(params.price) : extractAmount(msg);
            if (price != null) lines[idx] = { ...lines[idx], price };
          }
          if (params.qty != null) lines[idx] = { ...lines[idx], qty: Number(params.qty) };
          if (params.new_description) lines[idx] = { ...lines[idx], description: String(params.new_description) };
        }
      }

      // Supprimer une ligne
      if (params.remove_line || (/supprime|retire|enlève|enleve/.test(msg) && /ligne|item/i.test(msg))) {
        const needle = params.remove_line || extractQuotedText(msg);
        if (needle) {
          lines = lines.filter(l => !String(l.description || '').toLowerCase().includes(String(needle).toLowerCase()));
        } else if (params.line_index != null) {
          const i = Number(params.line_index) - 1;
          if (i >= 0) lines.splice(i, 1);
        }
      }

      const title = params.title
        || (/titre|renommer|appeler/i.test(msg) ? (extractQuotedText(msg) || extractAfterKeyword(msg, ['titre', 'renommer', 'appeler'])) : null)
        || q.title;
      const notes = params.notes != null
        ? (params.append_notes && q.notes ? `${q.notes}\n${params.notes}` : params.notes)
        : (/note/i.test(msg) ? (extractAfterKeyword(msg, ['note', 'notes']) || q.notes) : q.notes);
      const status = params.status
        || (/brouillon|draft/i.test(msg) ? 'draft' : null)
        || (/envoyé|envoye|sent/i.test(msg) && !/envoyer|mail/i.test(msg) ? 'sent' : null)
        || (/accepté|accepte|accepted/i.test(msg) ? 'accepted' : null)
        || (/refusé|refuse|rejected/i.test(msg) ? 'rejected' : null)
        || q.status;

      const subtotal = lines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.price) || 0), 0);
      const total = Math.round(subtotal * 1.14975 * 100) / 100;

      const { rows } = await pool.query(
        `UPDATE quotes SET
          title = $1, notes = $2, status = $3, lines = $4,
          subtotal = $5, total = $6,
          project_id = COALESCE($7, project_id)
         WHERE id = $8 RETURNING *`,
        [
          title,
          notes,
          status,
          JSON.stringify(lines),
          subtotal,
          total,
          params.project_id || null,
          qid,
        ]
      );

      // Mémoire devis : retenir un fait si demandé dans le même message
      if (/retiens|mémorise|memorise/i.test(msg)) {
        try {
          const { saveMemory } = await import('./assistant-memory.js');
          const fact = extractAfterKeyword(msg, ['retiens que', 'retiens', 'mémorise que', 'mémorise', 'memorise'])
            || extractQuotedText(msg);
          if (fact) {
            await saveMemory({
              content: fact,
              category: 'quote',
              quoteId: qid,
              clientId: rows[0].client_id,
              projectId: rows[0].project_id,
              source: 'assistant',
            });
          }
        } catch { /* optional */ }
      }

      actions.push({ type: 'update_quote', data: { ...rows[0], lines } });
      const preview = lines.slice(0, 8).map((l, i) => `${i + 1}. ${l.description} — ${l.qty}×${Number(l.price).toFixed(2)}$`).join('\n');
      return {
        reply: `Devis ${rows[0].quote_number} mis à jour (${lines.length} lignes, total ${total.toFixed(2)} $).\n${preview}`,
        actions,
      };
    }

    case 'create_invoice': {
      let clientId = pageContext?.type === 'client' ? pageContext.id : null;
      let projId = pageContext?.type === 'project' ? pageContext.id : null;
      if (!clientId && projId) {
        const { rows: pr } = await pool.query('SELECT client_id FROM projects WHERE id = $1', [projId]);
        clientId = pr[0]?.client_id || null;
      }
      if (!clientId) return { reply: 'Ouvrez la fiche client (ou un projet lié à un client) pour créer une facture.', actions };
      const title = extractQuotedText(message) || extractAfterKeyword(message, ['facture', 'invoice']) || 'Facture';
      const amount = extractAmount(message) || 0;
      const inv = await createInvoiceRecord({
        client_id: clientId,
        project_id: projId,
        title,
        lines: [{ description: title, qty: 1, price: amount }],
      });
      actions.push({ type: 'create_invoice', data: inv });
      return { reply: `Facture #${inv.invoice_number} créée`, actions };
    }

    case 'convert_quote': {
      let quoteId = params.quote_id || (pageContext?.type === 'quote' ? pageContext.id : null);
      if (!quoteId && pageContext?.type === 'client' && pageContext.client?.quotes?.[0]) {
        quoteId = pageContext.client.quotes[0].id;
      }
      const pctMatch = msg.match(/(\d+)\s*%/);
      const deposit = params.deposit_percent != null ? Number(params.deposit_percent) : (pctMatch ? Number(pctMatch[1]) : 100);
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
      let docId = params.quote_id || params.invoice_id || null;
      if (!docId && isQuote && pageContext?.type === 'quote') docId = pageContext.id;
      if (!docId && isQuote && pageContext?.type === 'client') {
        const { rows } = await pool.query(
          'SELECT id FROM quotes WHERE client_id=$1 ORDER BY created_at DESC LIMIT 1', [pageContext.id]
        );
        docId = rows[0]?.id;
      }
      if (!docId && !isQuote && pageContext?.type === 'invoice') docId = pageContext.id;
      if (!docId && !isQuote && pageContext?.type === 'client') {
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
      let q = 'DELETE FROM expenses WHERE id IN (SELECT id FROM expenses WHERE 1=1';
      if (projectId) {
        params.push(projectId);
        q += ` AND project_id=$${params.length}`;
      }
      if (amount && amount > 0) {
        params.push(amount);
        q += ` AND amount=$${params.length}`;
      }
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

    case 'list_skills': {
      const { rows: skills } = await pool.query('SELECT * FROM assistant_skills ORDER BY name');
      const list = skills.map(s => {
        const patterns = (s.trigger_patterns || []).slice(0, 3).join(', ');
        return `${s.enabled ? '✓' : '○'} ${s.name} → ${s.action_type}${patterns ? ` (${patterns}…)` : ''}`;
      }).join('\n');
      actions.push({ type: 'list_skills', data: skills });
      return {
        reply: `Skills NEYA (${skills.length}) :\n${list || '(aucune)'}`,
        actions,
      };
    }

    case 'create_skill': {
      const name = params.name
        || extractQuotedText(msg)
        || extractAfterKeyword(msg, ['skill', 'capacité', 'capacite']);
      const action_type = params.action_type
        || (msg.match(/action\s+([a-z_]+)/i) || [])[1];
      if (!name || !action_type || !ACTION_TYPES.includes(action_type)) {
        return {
          reply: 'Format : skill « nom » action complete_task. Ou params {name, action_type, triggers}.',
          actions,
        };
      }
      const triggers = Array.isArray(params.triggers)
        ? params.triggers
        : (params.trigger_patterns || [String(name).replace(/_/g, ' ')]);
      const skillName = String(name).replace(/\s+/g, '_').toLowerCase().slice(0, 80);
      const { rows } = await pool.query(
        `INSERT INTO assistant_skills (name, description, trigger_patterns, action_type, enabled)
         VALUES ($1,$2,$3,$4,true)
         ON CONFLICT (name) DO UPDATE SET
           description = EXCLUDED.description,
           trigger_patterns = EXCLUDED.trigger_patterns,
           action_type = EXCLUDED.action_type,
           enabled = true
         RETURNING *`,
        [
          skillName,
          params.description || `Via protocol — ${action_type}`,
          JSON.stringify(triggers),
          action_type,
        ]
      );
      actions.push({ type: 'create_skill', data: rows[0] });
      return { reply: `Skill « ${rows[0].name} » créée (${action_type}).`, actions };
    }

    case 'update_skill': {
      const name = params.name || extractQuotedText(msg) || (msg.match(/skill\s+([a-z0-9_-]+)/i) || [])[1];
      if (!name) return { reply: 'Précisez le skill (ex. « activer skill create_task »).', actions };
      const { rows } = await pool.query('SELECT * FROM assistant_skills WHERE name ILIKE $1', [name]);
      if (!rows[0]) return { reply: `Skill « ${name} » introuvable.`, actions };
      const skill = rows[0];
      let enabled = skill.enabled;
      let action_type = skill.action_type;
      let triggers = skill.trigger_patterns;
      if (params.enabled !== undefined) enabled = !!params.enabled;
      else if (/désactiver|desactiver|disable/i.test(msg)) enabled = false;
      else if (/activer|enable/i.test(msg)) enabled = true;
      if (params.action_type && ACTION_TYPES.includes(params.action_type)) action_type = params.action_type;
      if (Array.isArray(params.triggers)) triggers = params.triggers;
      const { rows: updated } = await pool.query(
        `UPDATE assistant_skills SET enabled=$1, action_type=$2, trigger_patterns=$3 WHERE id=$4 RETURNING *`,
        [enabled, action_type, JSON.stringify(triggers || []), skill.id]
      );
      actions.push({ type: 'update_skill', data: updated[0] });
      return {
        reply: `Skill « ${updated[0].name} » mise à jour${updated[0].enabled ? ' (active)' : ' (désactivée)'}.`,
        actions,
      };
    }

    case 'import_mail_dates_to_project': {
      const id = projectId || await resolveProjectId(params, msg, pageContext);
      if (!id) return { reply: 'Précisez le projet (page ouverte ou nom).', actions };
      const { scanProjectInstallationDates } = await import('./installation-billing.js');
      const result = await scanProjectInstallationDates(id);
      actions.push({ type: 'import_mail_dates_to_project', data: result });
      const n = result?.billing?.dates?.length || result?.dates?.length || 0;
      return {
        reply: n
          ? `Dates d’installation scannées pour le projet #${id} (${n} date(s)). Voir l’onglet Installation.`
          : `Scan terminé — aucune date d’installation trouvée pour le projet #${id}.`,
        actions,
      };
    }

    case 'create_project_from_quote_email': {
      const {
        createProjectsFromQuoteEmails,
        extractQuoteImportQuery,
      } = await import('./project-from-quote-email.js');
      const query = params.query || extractQuoteImportQuery(msg) || extractQuotedText(msg);
      const message_id = params.message_id || params.messageId || null;
      const max = Number(params.max || params.maxEmails || 4) || 4;
      try {
        const result = await createProjectsFromQuoteEmails({
          query,
          messageId: message_id,
          maxEmails: max,
        });
        actions.push({ type: 'create_project_from_quote_email', data: result });
        if (result.actions?.length) actions.push(...result.actions);
        const n = result.created?.length || 0;
        const names = (result.created || []).map(c => c.project?.name).filter(Boolean).join(', ');
        return {
          reply: n
            ? `Créé ${n} projet(s) depuis les devis${result.client?.name ? ` pour ${result.client.name}` : ''}${names ? ` : ${names}` : ''}.`
            : 'Aucun projet créé — vérifiez la requête ou les PJ devis.',
          actions,
        };
      } catch (err) {
        return { reply: err.message || 'Import devis mail impossible.', actions };
      }
    }

    case 'atelier_habits': {
      const { appendHabit, readHabitsFile } = await import('./atelier-habits.js');
      const rule = params.rule || params.habit
        || extractAfterKeyword(msg, ['habitude', 'habitude :', 'règle', 'regle', 'ajoute']);
      if (!rule) {
        const { content } = readHabitsFile();
        actions.push({ type: 'atelier_habits', data: { content } });
        return {
          reply: `Habitudes atelier actuelles :\n${String(content || '').slice(0, 1500)}`,
          actions,
        };
      }
      const result = appendHabit({ section: params.section || 'Général', rule });
      actions.push({ type: 'atelier_habits', data: result });
      return {
        reply: result.already
          ? `Cette habitude est déjà enregistrée.`
          : `Habitude ajoutée${params.section ? ` (${params.section})` : ''} : ${String(rule).trim()}.`,
        actions,
      };
    }

    case 'add_project_material': {
      const id = projectId || await resolveProjectId(params, msg, pageContext);
      if (!id) return { reply: 'Précisez le projet (page ouverte ou nom).', actions };
      const description = params.description
        || extractQuotedText(msg)
        || extractAfterKeyword(msg, ['matériau', 'materiau', 'matériel', 'materiel', 'ajoute', 'ajouter'])
        || msg.replace(/^(ajoute|ajouter|noter|prévoir|prevoir)\s+/i, '').trim();
      if (!description) return { reply: 'Précisez le matériau (ex. « ajoute 2 plaques MDF »).', actions };
      const qtyMatch = String(description).match(/(\d+(?:[.,]\d+)?)\s*(feuilles?|plaques?|unit[eé]s?|pi[eè]ces?)?/i)
        || msg.match(/x\s*(\d+)/i);
      const quantity = params.quantity != null
        ? Number(params.quantity)
        : (qtyMatch ? parseFloat(String(qtyMatch[1]).replace(',', '.')) : 1);
      const unit_cost = params.unit_cost != null ? Number(params.unit_cost) : 0;
      const { rows } = await pool.query(
        `INSERT INTO project_materials (project_id, inventory_item_id, description, quantity, unit, unit_cost, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [id, params.inventory_item_id || null, String(description).slice(0, 500), quantity || 1, params.unit || 'unité', unit_cost, params.notes || null]
      );
      actions.push({ type: 'add_project_material', data: rows[0] });
      return {
        reply: `Matériau ajouté au projet #${id} : ${rows[0].description} (×${rows[0].quantity}).`,
        actions,
      };
    }

    default:
      return { reply: `Action « ${actionType} » non implémentée.`, actions: [] };
  }
}

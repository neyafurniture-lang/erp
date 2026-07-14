import pool from '../db/pool.js';
import { createQuoteRecord, createInvoiceRecord, convertQuoteToInvoice } from './invoice-helpers.js';
import { sendDocumentEmail } from './document-email.js';
import {
  createProjectsFromQuoteEmails,
  detectCreateProjectFromQuoteEmailIntent,
  extractQuoteImportQuery,
} from './project-from-quote-email.js';

export { detectCreateProjectFromQuoteEmailIntent };

const DAY_MAP = {
  lundi: 1, mardi: 2, mercredi: 3, jeudi: 4, vendredi: 5, samedi: 6, dimanche: 0,
};

export const ACTION_TYPES = [
  'create_task', 'create_project', 'schedule_task', 'plan_day', 'create_expense', 'list_today', 'list_tomorrow', 'create_client',
  'complete_task', 'update_task', 'delete_task', 'list_project_tasks',
  'update_project', 'update_client', 'list_projects', 'list_clients', 'list_expenses',
  'search_projects', 'search_memory', 'get_project',
  'list_emails', 'search_emails', 'get_email', 'list_mail_threads',
  'import_mail_dates_to_project',
  'create_project_from_quote_email',
  'create_fabrication_plan',
  'list_skills', 'create_skill', 'update_skill',
  'create_quote', 'create_invoice', 'convert_quote', 'send_quote', 'send_invoice',
  'list_quotes', 'list_invoices', 'update_quote', 'get_quote',
  'delete_project', 'delete_client', 'delete_expense',
  'update_standard', 'sync_wordpress', 'sync_web_orders', 'list_web_orders', 'sync_web_photos',
  'ui_edit_mode', 'ui_add_todo_list', 'ui_move_section', 'ui_hide_section', 'ui_show_section', 'ui_reset_layout',
  'erp_manual',
  'demande_modification_erp',
  'atelier_habits',
];

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
  if (/en cours|progress|wip/i.test(message)) return 'in_progress';
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
  const m = String(message || '').match(/[\w.+-]+@[\w.-]+\.\w+/);
  return m ? m[0] : null;
}

function parsePhone(message) {
  const m = String(message || '').match(/(\+?1?\s?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/);
  return m ? m[0].replace(/\s+/g, ' ').trim() : null;
}

function parseAddress(message) {
  const m = String(message || '').match(
    /(?:adresse|addr|habites?|situé[e]?)\s*(?:[:\-]|est|=)?\s*([^,;.\n]{6,120})/i
  );
  if (m) return m[1].trim();
  const civic = String(message || '').match(/\b(\d{1,5}\s+[A-Za-zÀ-ÿ0-9 .'\-]{3,60}(?:rue|avenue|av\.|blvd|boulevard|chemin|ch\.|route|rang)[^,;.\n]*)/i);
  return civic ? civic[1].trim() : null;
}

function parseCity(message) {
  const m = String(message || '').match(/(?:ville|à)\s*(?:[:\-])?\s*([A-Za-zÀ-ÿ\-\s']{2,40})/i);
  return m ? m[1].trim().replace(/\s+(email|tél|tel|phone|adresse).*$/i, '') : null;
}

/** Extraire nom + contacts depuis une phrase naturelle. */
export function parseClientContact(message, params = {}) {
  const email = params.email || parseEmail(message);
  const phone = params.phone || parsePhone(message);
  const address = params.address || parseAddress(message);
  const city = params.city || parseCity(message);
  let name = params.client_name || params.name || extractQuotedText(message)
    || extractAfterKeyword(message, [
      'nouveau client', 'ajouter client', 'ajoute client', 'crée client', 'creer client',
      'client', 'contact', 'pour',
    ]);
  if (name) {
    name = String(name)
      .replace(email || '', '')
      .replace(phone || '', '')
      .replace(/adresse\s*[:\-]?.*/i, '')
      .replace(/[,|;]+/g, ' ')
      .replace(/\b(email|courriel|téléphone|telephone|tel|phone|adresse|ville)\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
  if (!name || name.length < 2) {
    const cleaned = String(message || '')
      .replace(/^(nouveau|ajouter|ajoute|crée|creer|créer)\s+(un\s+|le\s+)?(client|contact)\s*/i, '')
      .replace(email || '', '')
      .replace(phone || '', '')
      .replace(/[,|;]+/g, ' ')
      .trim();
    const first = cleaned.split(/\s+/).slice(0, 4).join(' ').trim();
    if (first.length >= 2 && !/^(email|tel|adresse)/i.test(first)) name = first;
  }
  return {
    name: name ? name.slice(0, 200) : null,
    email: email || null,
    phone: phone || null,
    address: address || null,
    city: city || null,
  };
}

export async function resolveClientId(params = {}, message = '', pageContext = null) {
  if (pageContext?.type === 'client' && pageContext.id) return pageContext.id;
  if (params.client_id) return Number(params.client_id);
  const contact = parseClientContact(message, params);
  const needle = String(params.client_name || params.name || contact.name || '').trim().toLowerCase();
  if (!needle || needle.length < 2) return null;
  const { rows } = await pool.query(
    `SELECT id, name FROM clients
     WHERE LOWER(name) = $1
        OR LOWER(name) LIKE $2
     ORDER BY CASE WHEN LOWER(name) = $1 THEN 0 ELSE 1 END, LENGTH(name) ASC
     LIMIT 1`,
    [needle, `%${needle}%`]
  );
  return rows[0]?.id || null;
}

/** Intent courriel libre (français). */
export function detectMailIntent(message = '') {
  if (detectCreateProjectFromQuoteEmailIntent(message)) return null;
  const m = String(message);
  if (/(ouvre|ouvrir|lis|lire|montre|regarde|détail|contenu).{0,40}(mail|courriel|message)\b/i.test(m)
    || /(?:mail|courriel|message)\s*(?:n[o°]?\s*)?\d+/i.test(m)) {
    return 'get_email';
  }
  if (/(cherche|recherch|trouve|trouver|regarde).{0,50}(mail|courriel|gmail|inbox)/i.test(m)
    || /(mail|courriel|gmail).{0,30}(de|pour|concernant|à propos|sur)\s+\S+/i.test(m)
    || /(infos?|coordonn|adresse|téléphone|telephone).{0,40}(mail|courriel)/i.test(m)
    || /(dans|via|depuis).{0,15}(mes\s+)?(mails?|courriels?|gmail)/i.test(m)) {
    return 'search_emails';
  }
  if (/(liste|voir|montre)\s+(mes\s+|les\s+)?(mails?|courriels?)/i.test(m)
    || /\bmes\s+(mails?|courriels?)\b/i.test(m)
    || /bo[iî]te\s*(mail|de\s*r[eé]ception)/i.test(m)
    || /mails?\s+(non\s+lus|clients|fournisseurs)/i.test(m)) {
    return 'list_emails';
  }
  return null;
}

/** Récupérer dates (souvent via mails) → projet (+ carnet d'heures). */
export function detectImportMailDatesIntent(message = '') {
  if (detectCreateProjectFromQuoteEmailIntent(message)) return null;
  const m = String(message);
  const hasDates = /\b(dates?|horaires?|agenda|calendrier|événements?|evenements?)\b/i.test(m)
    || /\b(r[eé]cup[eè]re|rep[eè]re|extrais|extraire)\b/i.test(m);
  const hasProjectWork = /\bprojets?\b|\binscri[st]|\bcarnets?\b|\bheures?\b|\btableau\b|\bplanifie/i.test(m);
  const hasContact = /\bwaita\b|\bcorridor\b|en\s+lien\s+avec\s+\w+|(mails?|courriels?|gmail)/i.test(m);
  if (hasDates && hasProjectWork && hasContact) return 'import_mail_dates_to_project';
  if (hasDates && hasContact && /\b(inscrit|inscris|ajoute|noter?|agenda|calendrier|projet)\b/i.test(m)) {
    return 'import_mail_dates_to_project';
  }
  return null;
}

export function extractProjectHintFromMessage(message = '') {
  const m = String(message || '');
  const a = m.match(
    /\b(?:l['']?\s*)?e?projets?\s+([A-Za-zÀ-ÿ0-9][\wÀ-ÿ'’.-]*(?:\s+[A-Za-zÀ-ÿ0-9][\wÀ-ÿ'’.-]*){0,5})/i
  );
  if (a?.[1]) {
    return a[1]
      .replace(/\s+(en\s+lien|et\s+(inscrit|inscris|crée|creer|crée|tout|un|une)|tout\b|avec\b).*$/i, '')
      .trim();
  }
  if (/\bcorridor\b/i.test(m)) return 'corridor';
  return null;
}

export function extractContactFromMessage(message = '') {
  const m = String(message || '');
  const lien = m.match(/en\s+lien\s+avec\s+([A-Za-zÀ-ÿ][\wÀ-ÿ'’.-]+)/i);
  if (lien?.[1]) return lien[1];
  const known = m.match(/\b(waita)\b/i);
  if (known?.[1]) return known[1];
  return extractMailSearchQuery(m) || null;
}

function wantsHoursLogbook(message = '') {
  return /\b(carnet|heures?|tableau|feuille\s+de\s+temps|timesheet|calcul\s+d['']?heure)\b/i.test(message);
}

function plannedMinutesForLabel(label = '', start = '', end = '') {
  const fromTimes = minutesBetweenTimes(start, end);
  if (fromTimes && fromTimes >= 30) return fromTimes;
  const l = String(label).toLowerCase();
  const bits = [];
  // Tester démontage AVANT montage (sinon « démontage » matche « montage »)
  if (/\bd[eé]montage\b/.test(l)) bits.push(150);
  else if (/\bmontage\b/.test(l)) bits.push(210);
  if (/\bm[eé]diation\b/.test(l)) bits.push(180);
  if (bits.length) return bits.reduce((a, b) => a + b, 0);
  return 180;
}

function parseClockToken(raw = '') {
  const s = String(raw || '').trim().toLowerCase()
    .replace(/\s+/g, '')
    .replace(/h(?=\d)/, ':')
    .replace(/h$/, ':00')
    .replace(/am$/, '')
    .replace(/pm$/, '');
  let m = s.match(/^(\d{1,2})(?::(\d{2}))?$/);
  if (!m) return null;
  let h = Number(m[1]);
  let min = Number(m[2] || 0);
  if (/pm/i.test(raw) && h < 12) h += 12;
  if (/am/i.test(raw) && h === 12) h = 0;
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

function minutesBetweenTimes(start, end) {
  const a = parseClockToken(start);
  const b = parseClockToken(end);
  if (!a || !b) return null;
  const [ah, am] = a.split(':').map(Number);
  const [bh, bm] = b.split(':').map(Number);
  let mins = (bh * 60 + bm) - (ah * 60 + am);
  if (mins <= 0) mins += 24 * 60;
  return mins;
}

function formatHm(hm) {
  if (!hm) return '';
  const [h, m] = hm.split(':');
  return `${Number(h)}:${m}`;
}

/** Repérer montage / médiation / démontage (+ horaires) dans un segment. */
function extractWorkSlots(segment = '') {
  const text = String(segment || '')
    .replace(/&[#\w]+;/g, ' ')
    .replace(/[<>]/g, ' ')
    .replace(/[>]{1,}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return [];

  const slots = [];
  const re = /\b(montage|d[eé]montage|m[eé]diation)\b(?:[^0-9\n]{0,35}?)?(?:(?:[àa]|de|:)\s*)?(\d{1,2}(?::\d{2})?\s*(?:h(?:\d{2})?|am|pm)?)?(?:\s*(?:-|–|—|à|a|au|jusqu['’]?[aà]?)\s*)?(\d{1,2}(?::\d{2})?\s*(?:h(?:\d{2})?|am|pm)?)?/gi;
  let m;
  while ((m = re.exec(text)) !== null) {
    const kind = m[1].toLowerCase()
      .normalize('NFD').replace(/\p{M}/gu, '')
      .replace('demontage', 'démontage')
      .replace('mediation', 'médiation');
    const pretty = kind.charAt(0).toUpperCase() + kind.slice(1);
    const start = parseClockToken(m[2] || '');
    const end = parseClockToken(m[3] || '');
    slots.push({ kind: pretty, start, end });
  }
  return slots;
}

function summarizeSlots(slots = []) {
  if (!slots.length) return null;
  const kinds = [...new Set(slots.map(s => s.kind))];
  const starts = slots.map(s => s.start).filter(Boolean).sort();
  const ends = slots.map(s => s.end).filter(Boolean).sort();
  const start = starts[0] || '';
  const end = ends[ends.length - 1] || '';
  let planned = 0;
  for (const s of slots) {
    const mins = minutesBetweenTimes(s.start, s.end);
    if (mins) planned += mins;
    else planned += plannedMinutesForLabel(s.kind);
  }
  // Si plages se chevauchent sur la même journée, plafonner à debut→fin globale
  const span = minutesBetweenTimes(start, end);
  if (span && span < planned) planned = span;
  if (!planned) planned = plannedMinutesForLabel(kinds.join(' · '));
  return {
    label: kinds.join(' · '),
    start: start ? formatHm(start) : '',
    end: end ? formatHm(end) : '',
    planned_minutes: planned,
    planned_hours: Math.round((planned / 60) * 4) / 4,
  };
}

function isJunkEventLabel(label = '') {
  const l = String(label || '').toLowerCase();
  if (!l || l.length < 3) return true;
  if (/@|neyafurniture|salut\s+mehdi|fais[- ]moi savoir|tel que discut|message d['']origine|forwarded|>{2,}/i.test(l)) return true;
  if (/^[,:\s]*[àa]\s+\d{1,2}\s*h/.test(l)) return true;
  if (!/\b(montage|d[eé]montage|m[eé]diation|livraison|horaire|mandat)\b/i.test(l) && l.length > 60) return true;
  return false;
}

function conciseLabelFromRaw(rawLabel = '', source = {}) {
  const slots = extractWorkSlots(rawLabel);
  const summarized = summarizeSlots(slots);
  if (summarized) return summarized;
  const cleaned = String(rawLabel || '')
    .replace(/https?:\S+/g, '')
    .replace(/&[#\w]+;/g, ' ')
    .replace(/[<>]/g, ' ')
    .replace(/[>]{1,}/g, ' ')
    .replace(/\b(salut|bonjour|allo|merci|fais[- ]moi savoir|tel que discut)[\s\S]*/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 48);
  if (isJunkEventLabel(cleaned)) {
    return {
      label: /mandat/i.test(source.subject || '') ? 'Mandat' : 'Intervention',
      start: '',
      end: '',
      planned_minutes: 180,
      planned_hours: 3,
    };
  }
  return {
    label: cleaned || 'Intervention',
    start: '',
    end: '',
    planned_minutes: plannedMinutesForLabel(cleaned),
    planned_hours: plannedMinutesForLabel(cleaned) / 60,
  };
}

const HOURS_LOG_MARKER = '<!-- neya-hours-logbook -->';

function buildHoursLogbookMarkdown(rows, { contact, projectName } = {}) {
  const header = `${HOURS_LOG_MARKER}\n## Carnet d'heures${projectName ? ` — ${projectName}` : ''}${contact ? ` (source : ${contact})` : ''}\n`;
  const tableHeader = '| Date | Travaux | H prévues | Début | Fin | H réelles | Notes |\n|------|---------|-----------|-------|-----|-----------|-------|\n';
  const body = rows.map(r => {
    const d = r.dateKey || r.date;
    const planned = Number(r.planned_hours || 0).toFixed(1).replace('.0', '');
    const actual = r.actual_hours != null && r.actual_hours !== '' ? String(r.actual_hours) : '';
    return `| ${d} | ${(r.label || '').replace(/\|/g, '/')} | ${planned} | ${r.start || ''} | ${r.end || ''} | ${actual} | ${(r.notes || '').replace(/\|/g, '/')} |`;
  }).join('\n');
  return `${header}${tableHeader}${body}\n`;
}

async function upsertProjectHoursLogbook(project, events, { contact, replace = true } = {}) {
  const rows = events
    .filter(ev => !isJunkEventLabel(ev.label))
    .map(ev => {
      const concise = conciseLabelFromRaw(ev.label, { subject: ev.sourceSubject });
      const start = ev.start || concise.start || '';
      const end = ev.end || concise.end || '';
      const planned_minutes = ev.planned_minutes || concise.planned_minutes || plannedMinutesForLabel(concise.label, start, end);
      return {
        dateKey: ev.dateKey,
        label: concise.label,
        planned_minutes,
        planned_hours: Math.round((planned_minutes / 60) * 4) / 4,
        start,
        end,
        actual_hours: '',
        notes: '',
        taskId: ev.taskId || null,
      };
    });

  const prevMeta = typeof project.meta === 'string' ? JSON.parse(project.meta || '{}') : (project.meta || {});
  let merged;
  if (replace) {
    merged = rows.sort((a, b) => String(a.dateKey).localeCompare(String(b.dateKey)));
  } else {
    const prevLog = (prevMeta.hours_logbook?.rows || []).filter(r => !isJunkEventLabel(r.label));
    const byDay = new Map(prevLog.map(r => [r.dateKey, r]));
    for (const r of rows) {
      const old = byDay.get(r.dateKey);
      const keepActual = old && (old.actual_hours !== '' && old.actual_hours != null);
      byDay.set(r.dateKey, {
        ...(old || {}),
        ...r,
        // Conserver saisie manuelle réelle ; rafraîchir libellés/prévu/début/fin
        start: r.start || old?.start || '',
        end: r.end || old?.end || '',
        actual_hours: keepActual ? old.actual_hours : '',
        notes: old?.notes || '',
      });
    }
    merged = [...byDay.values()].sort((a, b) => String(a.dateKey).localeCompare(String(b.dateKey)));
  }

  const hours_logbook = {
    updated_at: new Date().toISOString(),
    source: contact || 'mail',
    rows: merged,
    planned_total: merged.reduce((s, r) => s + Number(r.planned_hours || 0), 0),
    actual_total: merged.reduce((s, r) => s + (r.actual_hours === '' || r.actual_hours == null ? 0 : Number(r.actual_hours)), 0),
  };
  const meta = { ...prevMeta, hours_logbook };

  const md = buildHoursLogbookMarkdown(merged, { contact, projectName: project.name });
  let notes = String(project.notes || '');
  if (notes.includes(HOURS_LOG_MARKER)) {
    notes = notes.replace(new RegExp(`${HOURS_LOG_MARKER}[\\s\\S]*?(?=\\n##(?!#)|$)`), md.trimEnd() + '\n');
  } else {
    notes = `${notes.trim()}\n\n${md}`.trim();
  }

  const { rows: updated } = await pool.query(
    `UPDATE projects SET meta = $1::jsonb, notes = $2 WHERE id = $3 RETURNING *`,
    [JSON.stringify(meta), notes, project.id]
  );
  return { project: updated[0], hours_logbook, markdown: md };
}

const MAIL_QUERY_STOP = /\b(et|puis|ensuite|pour|afin\s+de|ensuite)\s+(rep[eè]re|rep[eé]rer|trouve|trouver|extrais|extraire|note|noter|synth[eé]tise|r[eé]sume|liste|identifie|donne|dis[- ]?moi|r[eé]cup[eè]re)\b/i;
const MAIL_INSTRUCTION_RE = /\b(dates?|evenements?|événements?|coordonn|adresse|t[eé]l[eé]phone|horaire|quand|r[eé]sume|synth[eè]se)\b/i;

/** Nettoie une requête Gmail : enlève l’instruction utilisateur après le mot-clé. */
export function cleanMailSearchQuery(raw = '') {
  let q = String(raw || '').trim();
  if (!q) return '';

  // Couper à « et repère… », « puis extrais… », etc.
  const stop = q.match(MAIL_QUERY_STOP);
  if (stop && stop.index > 0) {
    q = q.slice(0, stop.index).trim();
  }

  // Couper à virgule + instruction
  const commaParts = q.split(/\s*,\s*/);
  if (commaParts.length > 1 && MAIL_INSTRUCTION_RE.test(commaParts.slice(1).join(' '))) {
    q = commaParts[0].trim();
  }

  // Si trop long et contient une instruction, garder le début (mots de recherche)
  if (q.split(/\s+/).length > 6 && MAIL_INSTRUCTION_RE.test(q)) {
    const words = q.split(/\s+/);
    const cut = words.findIndex(w => MAIL_INSTRUCTION_RE.test(w) || /^(et|puis|pour)$/i.test(w));
    if (cut > 0) q = words.slice(0, cut).join(' ').trim();
  }

  return q.replace(/^["'«]+|["'»]+$/g, '').trim();
}

export function extractMailSearchQuery(message = '') {
  const quoted = extractQuotedText(message);
  if (quoted) return cleanMailSearchQuery(quoted);

  const after = extractAfterKeyword(message, [
    'cherche dans mes mails', 'cherche dans mes courriels', 'cherche dans gmail',
    'cherche mail', 'chercher mail', 'cherche courriel', 'rechercher mail',
    'mails de', 'courriels de', 'mail de', 'courriel de', 'email de',
    'regarde le mail de', 'regarde mail de', 'trouve le mail',
  ]);
  if (after && after.length >= 2) return cleanMailSearchQuery(after);

  const stripped = String(message || '')
    .replace(/^(cherche|rechercher|trouver|trouve|regarde|lis|ouvre|montre).{0,50}?(mails?|courriels?|emails?|gmail)\s*(de|pour|sur|concernant|à propos)?\s*/i, '')
    .replace(/^(dans|via|depuis)\s+(mes\s+)?(mails?|courriels?)\s*/i, '')
    .trim();
  return cleanMailSearchQuery(stripped);
}

function wantsMailDates(message = '') {
  return /\b(dates?|evenements?|événements?|evenment|horaire|quand|calendrier|agenda)\b/i.test(message);
}

function wantsScheduleFromMail(message = '') {
  return /\b(rep[eè]re|note|noter|ajoute|ajouter|planifie|planifier|calendrier|agenda|programme|enregistre|dans\s+l['']?agenda)\b/i.test(message)
    || wantsMailDates(message);
}

const FR_MONTHS = {
  janvier: 0, février: 1, fevrier: 1, mars: 2, avril: 3, mai: 4, juin: 5,
  juillet: 6, août: 7, aout: 7, septembre: 8, octobre: 9, novembre: 10, décembre: 11, decembre: 11,
};

function resolveFrenchDate(day, monthName, yearHint = null) {
  const month = FR_MONTHS[String(monthName || '').toLowerCase()];
  if (month == null || !day) return null;
  const now = new Date();
  let year = yearHint ? Number(yearHint) : now.getFullYear();
  if (year < 100) year += 2000;
  let d = new Date(year, month, Number(day), 9, 0, 0, 0);
  // Si la date est déjà passée de >30j et pas d'année explicite → année suivante
  if (!yearHint && d.getTime() < now.getTime() - 30 * 86400000) {
    d = new Date(year + 1, month, Number(day), 9, 0, 0, 0);
  }
  return d;
}

function formatEventDate(d) {
  return d.toLocaleDateString('fr-CA', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

function eventKey(d) {
  return d.toISOString().slice(0, 10);
}

function isMailMetaDateContext(before = '', after = '') {
  // Fenêtre courte — un header plus loin dans le fil ne doit pas tuer les vraies dates
  const nearBefore = String(before || '').slice(-50).toLowerCase();
  const nearAfter = String(after || '').slice(0, 48).toLowerCase();
  const ctx = `${nearBefore} ${nearAfter}`;
  if (/\ba\s+[eé]crit\b|\b[eé]crit\s*:|forwarded message|message d['']origine|de\s*:\s*\S+@|@neyafurniture|@gmail\.|contact@/i.test(ctx)) {
    return true;
  }
  // Header style "Le mar. 30 juin 2026, à 11 h 43"
  if (/\ble\s+(lun|mar|mer|jeu|ven|sam|dim)\.?\s*$/i.test(nearBefore.trim())
    && (/\b[aà]\s+\d{1,2}\s*h\b/.test(nearAfter) || /\b\d{4}\b/.test(nearAfter.slice(0, 8)))) {
    return true;
  }
  // Suite d'en-tête collée: ", à 11 h 43, Neya <contact…"
  if (/^\s*,?\s*[aà]\s+\d{1,2}\s*h/.test(nearAfter) && /neya|contact@|mehdi/.test(nearAfter)) {
    return true;
  }
  return false;
}

function labelFromAfterColon(tail = '') {
  return String(tail)
    .split(/(?=(?:lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|\d{1,2}\s+(?:janvier|février|fevrier|mars|avril|mai|juin|juillet|août|aout|septembre|octobre|novembre|décembre|decembre)))/i)[0]
    .replace(/https?:\S+/g, '')
    .replace(/&[#\w]+;/g, ' ')
    .replace(/^[\s:–\-•>]+/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
}

/** Extraire événements datés + libellé concis depuis un corps de mail. */
export function extractEventsFromText(text = '', source = {}) {
  const raw = String(text || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[#\w]+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!raw) return [];
  const byDay = new Map();

  const pushEv = (date, rawLabel, priority = 1) => {
    if (!date || Number.isNaN(date.getTime())) return;
    if (isJunkEventLabel(rawLabel) && !extractWorkSlots(rawLabel).length) return;
    const concise = conciseLabelFromRaw(rawLabel, source);
    const ev = {
      date,
      dateKey: eventKey(date),
      label: concise.label,
      start: concise.start,
      end: concise.end,
      planned_minutes: concise.planned_minutes,
      planned_hours: concise.planned_hours,
      priority,
      sourceSubject: source.subject || null,
      sourceFrom: source.from || null,
    };
    if (isJunkEventLabel(ev.label) && !/\b(montage|médiation|démontage|intervention|mandat)\b/i.test(ev.label)) return;
    const prev = byDay.get(ev.dateKey);
    // Préférer priorité haute, puis label avec créneaux, puis label plus court/propre
    const score = (e) => (e.priority || 0) * 100 + (e.start ? 20 : 0) + (extractWorkSlots(e.label).length ? 10 : 0) - Math.min(String(e.label).length, 40);
    if (!prev || score(ev) >= score(prev)) byDay.set(ev.dateKey, ev);
  };

  // Blocs datés : "10 juillet: …" / "Dimanche 19 juillet - …"
  const lined = raw.matchAll(
    /(?:(?:lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\s+)?(\d{1,2})\s+(janvier|février|fevrier|mars|avril|mai|juin|juillet|août|aout|septembre|octobre|novembre|décembre|decembre)(?:\s+(\d{4}))?\s*[:\-–]\s*/gi
  );
  for (const m of lined) {
    const d = resolveFrenchDate(m[1], m[2], m[3]);
    if (!d) continue;
    const idx = (m.index || 0) + m[0].length;
    const before = raw.slice(Math.max(0, (m.index || 0) - 30), m.index || 0);
    const after = labelFromAfterColon(raw.slice(idx, idx + 180));
    if (isMailMetaDateContext(before, after)) continue;
    pushEv(d, after, 4);
  }

  // Dates sans deux-points : "Dimanche 12 juillet médiation…"
  const loose = raw.matchAll(
    /(?:(?:lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\s+)?(?:le\s+)?(\d{1,2})\s+(janvier|février|fevrier|mars|avril|mai|juin|juillet|août|aout|septembre|octobre|novembre|décembre|decembre)(?:\s+(\d{4}))?/gi
  );
  for (const m of loose) {
    const d = resolveFrenchDate(m[1], m[2], m[3]);
    if (!d) continue;
    const idx = m.index ?? 0;
    const before = raw.slice(Math.max(0, idx - 50), idx);
    const after = raw.slice(idx + m[0].length, idx + m[0].length + 140);
    if (isMailMetaDateContext(before, after)) continue;
    if (byDay.get(eventKey(d))?.priority >= 4) continue;
    if (!extractWorkSlots(after).length && !/\b(montage|d[eé]montage|m[eé]diation)\b/i.test(after.slice(0, 60))) continue;
    pushEv(d, labelFromAfterColon(after), 2);
  }

  return [...byDay.values()]
    .map(({ priority, ...rest }) => rest)
    .filter(ev => !isJunkEventLabel(ev.label) || extractWorkSlots(ev.label).length)
    .sort((a, b) => a.date - b.date);
}

async function scheduleMailEvents(events, { query, pageContext, subjectHint, projectId: forcedProjectId = null }) {
  const actions = [];
  const created = [];
  if (!events.length) return { actions, created };

  let projectId = forcedProjectId || (pageContext?.type === 'project' ? pageContext.id : null);
  if (!projectId) {
    const hint = query || subjectHint || '';
    const p = await resolveProjectByHint(hint, pageContext)
      || await resolveProjectByHint('corridor', pageContext)
      || await resolveProjectByHint('waita', pageContext);
    projectId = p?.id || null;
  }

  for (const ev of events) {
    const minutes = ev.planned_minutes || plannedMinutesForLabel(ev.label, ev.start, ev.end);
    const { rows: existing } = await pool.query(
      `SELECT id, title FROM tasks
       WHERE status != 'done'
         AND project_id IS NOT DISTINCT FROM $4
         AND DATE(start_time) = $1::date
         AND (LOWER(title) LIKE $2 OR LOWER(title) LIKE $3)
       LIMIT 1`,
      [
        ev.dateKey,
        `%${String(query || '').toLowerCase().slice(0, 20)}%`,
        `%${ev.label.toLowerCase().slice(0, 20)}%`,
        projectId,
      ]
    );
    if (existing[0]) {
      created.push({ ...ev, skipped: true, taskId: existing[0].id, title: existing[0].title, planned_minutes: minutes });
      continue;
    }

    const title = `${ev.label} — ${query || 'mail'}`.replace(/\s+/g, ' ').trim().slice(0, 180);
    const type = 'admin';
    let task;
    if (projectId) {
      task = await insertTaskForProject(projectId, title, type, minutes);
    } else {
      const { rows } = await pool.query(
        `INSERT INTO tasks (title, type, status, estimated_minutes, sort_order)
         VALUES ($1,$2,'todo',$3,0) RETURNING *`,
        [title, type, minutes]
      );
      task = rows[0];
    }
    const start = new Date(ev.date);
    const clock = parseClockToken(ev.start || '9:00') || '09:00';
    const [hh, mm] = clock.split(':').map(Number);
    start.setHours(hh, mm, 0, 0);
    const end = new Date(start.getTime() + minutes * 60000);
    const { rows } = await pool.query(
      'UPDATE tasks SET start_time=$1, end_time=$2 WHERE id=$3 RETURNING *',
      [start.toISOString(), end.toISOString(), task.id]
    );
    actions.push({ type: 'schedule_task', data: rows[0] });
    actions.push({ type: 'create_task', data: rows[0] });
    created.push({ ...ev, skipped: false, taskId: rows[0].id, title: rows[0].title, planned_minutes: minutes });
  }
  return { actions, created, projectId };
}

async function collectEventsFromMessages(messages, q) {
  const gmail = await import('./google-gmail.js');
  const ranked = [...messages].sort((a, b) => {
    const score = (m) => {
      let s = 0;
      const from = String(m.from || '').toLowerCase();
      if (q && from.includes(String(q).toLowerCase())) s += 3;
      if (!/^re:/i.test(m.subject || '')) s += 2;
      if (/mandat|horaire|dates|montage/i.test(m.subject || '')) s += 2;
      return s;
    };
    return score(b) - score(a);
  });

  const allEvents = [];
  for (const m of ranked.slice(0, 6)) {
    let body = String(m.snippet || '');
    try {
      const full = await gmail.getMessage(m.id);
      body = `${full.subject || ''}\n${full.snippet || ''}\n${full.body || ''}`;
    } catch { /* snippet */ }
    for (const ev of extractEventsFromText(body, { subject: m.subject, from: m.from })) {
      allEvents.push(ev);
    }
  }

  const byDay = new Map();
  for (const ev of allEvents) {
    const prev = byDay.get(ev.dateKey);
    if (!prev || ev.label.length > prev.label.length) byDay.set(ev.dateKey, ev);
  }
  const uniqueEvents = [...byDay.values()].sort((a, b) => a.date - b.date)
    .filter(ev => {
      const now = Date.now();
      return ev.date.getTime() > now - 14 * 86400000 || ev.date.getTime() > now;
    });
  return { uniqueEvents, ranked };
}

async function importMailDatesToProject(message, pageContext, params = {}) {
  const gmail = await import('./google-gmail.js');
  const mailQ = cleanMailSearchQuery(String(
    params.query || params.contact || extractContactFromMessage(message) || 'waita'
  ));
  const projectHint = String(
    params.project_name || params.project || extractProjectHintFromMessage(message) || ''
  ).trim() || (pageContext?.type === 'project' ? null : 'corridor');

  let project = projectHint
    ? await resolveProjectByHint(projectHint, pageContext)
    : null;
  if (!project) project = await resolveProjectByHint(null, pageContext);
  if (!project && /\bcorridor\b/i.test(message)) {
    project = await resolveProjectByHint('corridor', pageContext);
  }
  if (!project) {
    return {
      reply: `Projet introuvable${projectHint ? ` pour « ${projectHint} »` : ''}. Créez-le ou donnez le nom exact (ex. Corridor Culturel).`,
      actions: [],
    };
  }

  let usedQuery = mailQ;
  let { messages } = await gmail.searchMessages(mailQ || 'waita', 12);
  if (!messages?.length && mailQ !== 'corridor') {
    const retry = await gmail.searchMessages('corridor', 12);
    if (retry.messages?.length) {
      messages = retry.messages;
      usedQuery = 'corridor';
    }
  }
  if (!messages?.length) {
    return {
      reply: `Aucun mail trouvé pour « ${mailQ} ». Impossible d’extraire les dates pour « ${project.name} ».`,
      actions: [],
    };
  }

  const { uniqueEvents, ranked } = await collectEventsFromMessages(messages, usedQuery);
  if (!uniqueEvents.length) {
    return {
      reply: `J’ai lu ${messages.length} mail(s) « ${usedQuery} », mais aucune date d’événement claire. Ouvre le fil Waita si besoin.`,
      actions: [{ type: 'search_emails', data: { query: usedQuery, messages } }],
    };
  }

  const sched = await scheduleMailEvents(uniqueEvents, {
    query: usedQuery,
    pageContext: { type: 'project', id: project.id, label: project.name },
    subjectHint: ranked[0]?.subject,
    projectId: project.id,
  });

  const eventsWithTasks = uniqueEvents.map(ev => {
    const c = sched.created.find(x => x.dateKey === ev.dateKey);
    return { ...ev, taskId: c?.taskId || null };
  });

  const makeLogbook = wantsHoursLogbook(message) || /import_mail|carnet|heures|tableau|projet/i.test(message);
  let logbookResult = null;
  if (makeLogbook) {
    logbookResult = await upsertProjectHoursLogbook(project, eventsWithTasks, { contact: usedQuery });
  }

  const actions = [
    { type: 'search_emails', data: { query: usedQuery, messages, events: uniqueEvents } },
    ...sched.actions,
  ];
  if (logbookResult) {
    actions.push({ type: 'update_project', data: logbookResult.project });
    actions.push({ type: 'hours_logbook', data: logbookResult.hours_logbook });
  }
  actions.push({ type: 'navigate', data: { href: `/projects/${project.id}?tab=hours` } });

  const planned = sched.created.filter(c => !c.skipped);
  const skipped = sched.created.filter(c => c.skipped);
  const table = uniqueEvents.map((ev, i) => {
    const h = (plannedMinutesForLabel(ev.label) / 60).toFixed(1).replace(/\.0$/, '');
    return `${i + 1}. ${formatEventDate(ev.date)} — ${ev.label} (${h} h prévues)`;
  }).join('\n');

  let reply = `C’est fait pour le projet « ${project.name} » (#${project.id}), à partir des mails « ${usedQuery} ».\n\n`
    + `Agenda inscrit :\n${table}`;
  if (planned.length) reply += `\n\n${planned.length} tâche(s) créée(s)/planifiée(s) sur le projet.`;
  if (skipped.length) reply += `\n(${skipped.length} déjà présentes, non dupliquées.)`;
  if (logbookResult) {
    reply += `\n\nCarnet d’heures par jour créé (tableau) — onglet Heures du projet. Colonnes : date, travaux, h prévues, début, fin, h réelles.`;
  }
  reply += `\n\nJe t’ouvre le projet.`;

  return { reply, actions };
}

async function analyzeMailSearchAndAct({ q, messages, userMessage, pageContext }) {
  const wantsDates = wantsMailDates(userMessage);
  const wantsSchedule = wantsScheduleFromMail(userMessage);
  const { uniqueEvents, ranked } = await collectEventsFromMessages(messages, q);

  const actions = [{ type: 'search_emails', data: { query: q, messages, events: uniqueEvents } }];

  let scheduleBlock = '';
  if (wantsSchedule && uniqueEvents.length) {
    const projectHint = extractProjectHintFromMessage(userMessage);
    let forcedId = pageContext?.type === 'project' ? pageContext.id : null;
    if (!forcedId && projectHint) {
      const p = await resolveProjectByHint(projectHint, pageContext);
      forcedId = p?.id || null;
    }
    const result = await scheduleMailEvents(uniqueEvents, {
      query: q,
      pageContext,
      subjectHint: ranked[0]?.subject,
      projectId: forcedId,
    });
    actions.push(...result.actions);

    if (wantsHoursLogbook(userMessage) && result.projectId) {
      const { rows } = await pool.query('SELECT * FROM projects WHERE id = $1', [result.projectId]);
      if (rows[0]) {
        const withTasks = uniqueEvents.map(ev => {
          const c = result.created.find(x => x.dateKey === ev.dateKey);
          return { ...ev, taskId: c?.taskId || null };
        });
        const log = await upsertProjectHoursLogbook(rows[0], withTasks, { contact: q });
        actions.push({ type: 'update_project', data: log.project });
        actions.push({ type: 'hours_logbook', data: log.hours_logbook });
        actions.push({ type: 'navigate', data: { href: `/projects/${result.projectId}?tab=hours` } });
        scheduleBlock += `\n\nCarnet d’heures créé sur le projet (#${result.projectId}).`;
      }
    }

    const planned = result.created.filter(c => !c.skipped);
    const skipped = result.created.filter(c => c.skipped);
    if (planned.length) {
      scheduleBlock += `\n\nÉtapes suivantes — ${planned.length} tâche(s) ajoutée(s) au calendrier :\n`
        + planned.map(c => `• ${formatEventDate(c.date)} — ${c.title}`).join('\n');
    }
    if (skipped.length) {
      scheduleBlock += `\n(déjà planifié : ${skipped.map(c => formatEventDate(c.date)).join(', ')})`;
    }
    if (result.projectId) {
      scheduleBlock += `\nLié au projet #${result.projectId}.`;
    } else {
      scheduleBlock += `\nAstuce : nommez le projet (ex. Corridor) pour y rattacher ces tâches.`;
    }
  }

  const contact = ranked.find(m => String(m.from || '').toLowerCase().includes(String(q).toLowerCase()))?.from
    || ranked[0]?.from
    || q;
  let reply = `J’ai trouvé ${messages.length} mail(s) liés à « ${q} »`;
  if (contact) reply += ` (ex. ${contact})`;
  reply += '.';

  if (uniqueEvents.length) {
    reply += `\n\nAgenda extrait des échanges :\n`
      + uniqueEvents.map((ev, i) => `${i + 1}. ${formatEventDate(ev.date)} — ${ev.label}`).join('\n');
  } else if (wantsDates) {
    reply += '\n\nJe n’ai pas repéré de dates d’événement claires dans les messages lus.';
  }

  if (!wantsDates && !wantsSchedule) {
    reply += '\n\nAperçu :\n'
      + ranked.slice(0, 4).map((s, i) => `${i + 1}. ${s.subject}\n   ${String(s.snippet || '').slice(0, 120)}`).join('\n');
  }

  reply += scheduleBlock;

  if (uniqueEvents.length && !wantsSchedule) {
    reply += `\n\nDis « ajoute ces dates à l’agenda du projet Corridor » pour les inscrire + carnet d’heures.`;
  }

  return { reply, actions };
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
  let clientId = pageContext?.type === 'client' ? pageContext.id : null;
  if (!clientId) {
    clientId = await resolveClientId(params, msg, pageContext) || null;
  }

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
      const title = params.title || extractQuotedText(msg)
        || extractAfterKeyword(msg, ['tâche', 'task', 'étape', 'checklist', 'ajouter'])
        || 'Nouvelle tâche';
      let pid = projectId || await resolveProjectId(params, msg, pageContext);
      let type = params.type || 'admin';
      if (!params.type) {
        if (/débitage|cnc|usinage/i.test(msg)) type = /cnc|usinage/i.test(msg) ? 'usinage' : 'debitage';
        else if (/assemblage/i.test(msg)) type = 'assemblage';
        else if (/finition|vernis|ponçage/i.test(msg)) type = 'finition';
      }
      const minutes = params.estimated_minutes || extractDuration(msg);
      if (!pid) {
        return { reply: 'Précisez le projet (ex. « ajoute finition sur projet Olive »).', actions: [] };
      }
      const task = await insertTaskForProject(pid, title, type, minutes);
      actions.push({ type: 'create_task', data: task });
      return { reply: `Tâche créée dans le projet #${pid} : « ${task.title} »`, actions };
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
      const contact = parseClientContact(msg, params);
      const name = contact.name || 'Nouveau client';
      const { rows } = await pool.query(
        `INSERT INTO clients (name, email, phone, address, city)
         VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [name, contact.email, contact.phone, contact.address, contact.city]
      );
      actions.push({ type: 'create_client', data: rows[0] });
      actions.push({ type: 'navigate', data: { href: `/clients/${rows[0].id}` } });
      const bits = [];
      if (rows[0].email) bits.push(rows[0].email);
      if (rows[0].phone) bits.push(rows[0].phone);
      if (rows[0].address) bits.push(rows[0].address);
      return {
        reply: `Client ajouté : « ${rows[0].name} »${bits.length ? ` — ${bits.join(' · ')}` : ''}`,
        actions,
      };
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
      const { rows } = await pool.query(
        `UPDATE projects SET name=$1, status=$2, deadline=$3, budget_estimated=$4, notes=$5 WHERE id=$6 RETURNING *`,
        [
          name || p.name,
          status || p.status,
          deadline ? (deadline instanceof Date ? deadline.toISOString().slice(0, 10) : String(deadline).slice(0, 10)) : p.deadline,
          budget != null && (params.budget_estimated != null || /budget/i.test(msg)) ? budget : p.budget_estimated,
          notes != null ? notes : p.notes,
          id,
        ]
      );
      actions.push({ type: 'update_project', data: rows[0] });
      return { reply: `Projet « ${rows[0].name} » mis à jour${notes != null ? ' (notes/descriptif)' : ''}.`, actions };
    }

    case 'update_client': {
      const id = clientId || await resolveClientId(params, msg, pageContext);
      if (!id) {
        return {
          reply: 'Précisez le client (ex. « email de Dupont = jean@x.com ») ou ouvrez sa fiche.',
          actions,
        };
      }
      const { rows: existing } = await pool.query('SELECT * FROM clients WHERE id = $1', [id]);
      const c = existing[0];
      if (!c) return { reply: 'Client introuvable.', actions };
      const contact = parseClientContact(msg, params);
      const rename = extractQuotedText(msg) && /renommer|appeler/i.test(msg)
        ? extractQuotedText(msg)
        : (/renommer|appeler/i.test(msg) ? extractAfterKeyword(msg, ['renommer', 'appeler']) : null);
      const finalName = params.name || rename || c.name;
      const email = contact.email || params.email || c.email;
      const phone = contact.phone || params.phone || c.phone;
      const address = contact.address || params.address || c.address;
      const city = contact.city || params.city || c.city;
      const { rows } = await pool.query(
        `UPDATE clients SET name=$1, email=$2, phone=$3, address=$4, city=$5 WHERE id=$6 RETURNING *`,
        [finalName, email, phone, address, city, id]
      );
      actions.push({ type: 'update_client', data: rows[0] });
      const bits = [];
      if (rows[0].email) bits.push(rows[0].email);
      if (rows[0].phone) bits.push(rows[0].phone);
      if (rows[0].address) bits.push(rows[0].address);
      return {
        reply: `Client « ${rows[0].name} » mis à jour${bits.length ? ` — ${bits.join(' · ')}` : ''}.`,
        actions,
      };
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
        const q = cleanMailSearchQuery(String(
          params.query || params.q || extractMailSearchQuery(msg) || extractQuotedText(msg) || ''
        ));
        if (!q || q.length < 2) {
          return { reply: 'Précisez la recherche, ex. « cherche mails waita » ou « mails de Dupont ».', actions };
        }
        const max = Math.min(Number(params.max) || 12, 25);
        let { messages } = await gmail.searchMessages(q, max);
        let usedQuery = q;
        if (!messages?.length) {
          const short = q.split(/\s+/)[0];
          if (short && short.length >= 2 && short.toLowerCase() !== q.toLowerCase()) {
            const retry = await gmail.searchMessages(short, max);
            if (retry.messages?.length) {
              messages = retry.messages;
              usedQuery = short;
            }
          }
        }
        if (!messages?.length) {
          return { reply: `Aucun courriel trouvé pour « ${q} ».`, actions };
        }

        // Si l'utilisateur vise un projet + carnet → pipeline import complet
        if (detectImportMailDatesIntent(`${msg} ${message || ''}`) || wantsHoursLogbook(msg)) {
          return importMailDatesToProject(message || msg, pageContext, { ...params, query: usedQuery });
        }

        return analyzeMailSearchAndAct({
          q: usedQuery,
          messages,
          userMessage: `${msg} ${message || ''}`,
          pageContext,
        });
      } catch (err) {
        return {
          reply: `Recherche Gmail impossible : ${err.message}. Vérifiez la connexion Google.`,
          actions,
        };
      }
    }

    case 'import_mail_dates_to_project': {
      try {
        return await importMailDatesToProject(message || msg, pageContext, params);
      } catch (err) {
        return {
          reply: `Import des dates impossible : ${err.message}`,
          actions,
        };
      }
    }

    case 'create_project_from_quote_email': {
      try {
        const q = String(
          params.query
          || params.client_name
          || params.q
          || extractQuoteImportQuery(msg)
          || extractQuotedText(msg)
          || ''
        ).trim();
        const result = await createProjectsFromQuoteEmails({
          query: q,
          maxEmails: Math.min(Number(params.max) || 4, 6),
          messageId: params.message_id || params.id || null,
        });
        for (const a of result.actions || []) actions.push(a);
        const lines = result.created.map((c, i) => {
          const p = c.project;
          const quote = c.quote;
          return `${i + 1}. Projet « ${p.name} » (#${p.id}) — devis ${quote.quote_number} (${quote.total} $ TTC) — ${c.tasks_count} tâches → /projects/${p.id}`;
        }).join('\n');
        const files = (result.emails_used || [])
          .map(e => `• ${e.subject} (${(e.files || []).join(', ') || 'sans PJ'})`)
          .join('\n');
        actions.push({ type: 'navigate', data: { href: `/clients/${result.client.id}` } });
        if (result.created[0]?.project?.id) {
          actions.push({ type: 'navigate', data: { href: `/projects/${result.created[0].project.id}` } });
        }
        return {
          reply: `Client « ${result.client?.name} » prêt. ${result.created.length} projet(s) créé(s) depuis les devis Gmail/PDF :\n${lines}\n\nMails utilisés :\n${files}`,
          actions,
        };
      } catch (err) {
        return { reply: `Création projet depuis devis : ${err.message}`, actions };
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
          const q = String(params.query || extractMailSearchQuery(msg) || extractQuotedText(msg) || '').trim();
          if (q && q.length >= 2) {
            const { messages } = await gmail.searchMessages(q, 5);
            messageId = messages?.[0]?.id || null;
            if (!messageId) {
              return { reply: `Aucun courriel trouvé pour « ${q} ».`, actions };
            }
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
          },
        });
        return {
          reply: `De : ${full.from}\nObjet : ${full.subject}\nDate : ${full.date || '—'}${erpHint}\n\n${body || '(corps vide)'}`,
          actions,
        };
      } catch (err) {
        return { reply: `Lecture du courriel impossible : ${err.message}`, actions };
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

      const { normalizeQuoteDocument, serializeQuoteDocument, flattenQuoteLines } = await import('./quote-document.js');
      const doc = normalizeQuoteDocument(q.lines);
      let lines = flattenQuoteLines(doc);

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

      const storedDoc = serializeQuoteDocument({
        ...doc,
        sections: [{ ...(doc.sections[0] || { id: 'main', title: 'Travaux' }), lines: lines.length ? lines : [{ description: '', qty: 1, price: 0 }] }],
      });
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
          JSON.stringify(storedDoc),
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
      let clientId = pageContext?.type === 'client' ? pageContext.id : (params.client_id || null);
      if (!clientId && pageContext?.type === 'project' && pageContext.project?.client_id) {
        clientId = pageContext.project.client_id;
      }
      if (!clientId) {
        const nameGuess = extractQuotedText(message)
          || extractAfterKeyword(message, ['facture pour', 'facture client', 'client']);
        if (nameGuess && nameGuess.length >= 2) {
          const { rows } = await pool.query(
            `SELECT id, name FROM clients WHERE LOWER(name) LIKE $1 ORDER BY LENGTH(name) ASC LIMIT 1`,
            [`%${nameGuess.toLowerCase()}%`]
          );
          if (rows[0]) clientId = rows[0].id;
        }
      }
      if (!clientId) {
        return {
          reply: 'Pour créer une facture métier : précisez le client (« nouvelle facture pour Dupont ») ou ouvrez sa fiche. Si vous vouliez une feature UI (éditeur, clic…), redites-le — je lance Cursor.',
          actions: [],
        };
      }
      const title = extractQuotedText(message) || extractAfterKeyword(message, ['facture', 'invoice']) || 'Facture';
      const amount = extractAmount(message) || 0;
      const inv = await createInvoiceRecord({
        client_id: clientId,
        project_id: pageContext?.type === 'project' ? pageContext.id : null,
        title,
        lines: [{ description: title, qty: 1, price: amount }],
      });
      actions.push({ type: 'create_invoice', data: inv });
      actions.push({ type: 'navigate', data: { href: `/invoices/${inv.id}` } });
      return { reply: `Facture #${inv.invoice_number} créée — ouvrez-la pour l’éditeur visuel.`, actions };
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

    case 'atelier_habits': {
      try {
        const { readHabitsFile, appendHabit } = await import('./atelier-habits.js');
        const rule = String(
          params.rule || params.habit || extractQuotedText(msg) || extractAfterKeyword(msg, [
            'ajoute une habitude', 'ajouter une habitude', 'nouvelle habitude',
            'habitude :', 'habitude:', 'retiens comme habitude',
          ]) || ''
        ).trim().replace(/^[-•*]\s*/, '');

        const section = String(params.section || 'Général').trim() || 'Général';
        const wantsList = /liste|voir|montre|quelles?\s+habitudes|lire\s+habitudes/i.test(msg) && !rule;

        if (rule && !wantsList) {
          const result = appendHabit({ section, rule });
          actions.push({ type: 'atelier_habits', data: { appended: !result.already, rule, section } });
          actions.push({ type: 'navigate', data: { href: '/settings?tab=habits' } });
          return {
            reply: result.already
              ? `Cette habitude existe déjà dans ATELIER_HABITS.md.`
              : `Habitude ajoutée (${section}) : « ${rule} ». Lia et Cursor s'y conformeront.`,
            actions,
          };
        }

        const data = readHabitsFile();
        const preview = String(data.content || '').trim().slice(0, 2500);
        actions.push({ type: 'atelier_habits', data: { path: data.path } });
        actions.push({ type: 'navigate', data: { href: '/settings?tab=habits' } });
        return {
          reply: `Bonnes habitudes atelier (${data.path}) :\n\n${preview}${preview.length >= 2500 ? '\n…' : ''}\n\nPour en ajouter : « ajoute une habitude : … »`,
          actions,
        };
      } catch (e) {
        return { reply: `Habitudes atelier : ${e.message}`, actions: [] };
      }
    }

    case 'demande_modification_erp': {
      try {
        const { startAgentRun, getCursorConfig } = await import('./cursor-agent.js');
        const cfg = await getCursorConfig();
        if (!cfg.configured) {
          return {
            reply: 'Clé Cursor API manquante. Allez dans Paramètres → Agent Cursor pour la configurer, puis redemandez.',
            actions: [{ type: 'navigate', data: { href: '/settings?tab=cursor' } }],
          };
        }
        if (cfg.runtime !== 'cloud' && cfg.host && !cfg.host.available) {
          return {
            reply: `Runner Cursor hôte hors ligne : ${cfg.host.error || 'service arrêté'}. Vérifiez neya-cursor-agent sur le VPS.`,
            actions: [],
          };
        }

        const feature = String(params.feature || params.template || '').toLowerCase();
        const rawPrompt = String(
          params.prompt
          || params.request
          || params.description
          || extractQuotedText(msg)
          || extractAfterKeyword(msg, [
            'modifie l\'erp', 'modifier l\'erp', 'modification erp', 'change le code',
            'demande modification', 'fais évoluer', 'améliore l\'erp', 'améliore l\'interface',
            'change l\'interface', 'modifie l\'interface', 'modifie la boîte', 'modifie la boite',
            'ajoute dans le mail', 'ajoute au mail', 'crée une passerelle', 'lance cursor',
            'demande à cursor', 'fais modifier', 'éditeur visuel', 'visualiser les factures',
            'en cliquant', 'modifier directement',
          ])
          || msg
        ).trim();

        const TEMPLATES = {
          mail_planning: `Dans le repo NEYA ERP (frontend Next.js + backend Express), enrichis le module Courriel (/mail) pour l'atelier :

1. Planification des départs : UI pour planifier / voir les départs liés aux projets/livraisons depuis la boîte mail (dates, projet, statut).
2. Pré-réponses en proposition : pour les mails à répondre, proposer 1–3 brouillons de réponse (IA) que l'utilisateur peut éditer puis envoyer via Gmail existant.
3. Intégration cohérente avec l'UI mail actuelle (sobre, pas de cards "AI bubble"), réutiliser google-gmail.js et les routes /api/gmail/*.
4. Commence par un plan court puis implémente les fichiers concrets (backend + frontend).`,
          mail_prereply: `Dans NEYA ERP, ajoute des propositions de pré-réponse IA dans /mail : analyse du fil, 2–3 brouillons éditables, envoi via Gmail API existante. Style UI sobre. Plan court puis code.`,
          invoice_visual: `Dans NEYA ERP (Next.js frontend), sur /invoices et /invoices/[id] :

1. Au clic sur une facture dans la liste → ouvrir la fiche.
2. Afficher la facture comme un document/aperçu éditable (éditeur visuel) : titre, client, notes, lignes (description, qté, prix), totaux.
3. Cliquer un champ ou une ligne = éditer directement ; enregistrer via PUT /api/invoices/:id (lines, title, notes, etc.).
4. Style sobre cohérent avec l'ERP (pas de gros cards orange arrondis). Réutilise EasyTable si utile.
5. Plan court puis implémentation concrète.`,
          ui_change: `Dans NEYA ERP, applique cette modification d'interface (Next.js frontend, style existant sobre — pas de pills orange "AI") :\n\n${rawPrompt}\n\nTouche uniquement les fichiers nécessaires. Plan court puis implémentation.`,
          passerelle_cursor: `Dans NEYA ERP, vérifie / améliore la passerelle Cursor hôte VPS (deploy/cursor-host-runner + skill assistant demande_modification_erp + Paramètres Agent Cursor). Corrige les bugs éventuels et documente brièvement.`,
        };

        let agentPrompt;
        if (feature && TEMPLATES[feature]) {
          agentPrompt = TEMPLATES[feature];
          if (feature === 'ui_change' && rawPrompt.length > 15) {
            agentPrompt = TEMPLATES.ui_change;
          }
        } else if (/[eé]diteur\s*visuel|visualiser\s*(les\s*)?facture|facture.*cliqu|cliquer.*facture|modifier\s*directement.*facture|aper[cç]u\s*facture/i.test(rawPrompt + ' ' + msg)) {
          agentPrompt = TEMPLATES.invoice_visual + `\n\nPrécisions utilisateur :\n${rawPrompt}`;
        } else if (/planif.*d[eé]part|d[eé]part.*mail|pr[eé]-?r[eé]ponse|pr[eé]r[eé]ponse|bo[iî]te\s*mail.*(planif|d[eé]part|r[eé]ponse)/i.test(rawPrompt + ' ' + msg)) {
          agentPrompt = TEMPLATES.mail_planning;
          if (rawPrompt.length > 40 && !/planif|d[eé]part|pr[eé]/i.test(rawPrompt)) {
            agentPrompt += `\n\nPrécisions utilisateur :\n${rawPrompt}`;
          } else if (rawPrompt.length > 80) {
            agentPrompt += `\n\nPrécisions utilisateur :\n${rawPrompt}`;
          }
        } else if (/passerelle\s*cursor|agent\s*cursor|host\s*runner/i.test(rawPrompt + ' ' + msg)) {
          agentPrompt = TEMPLATES.passerelle_cursor + `\n\nDemande :\n${rawPrompt}`;
        } else if (/interface|ui|écran|page|bouton|layout|dashboard|halo|orbe/i.test(rawPrompt + ' ' + msg)) {
          agentPrompt = TEMPLATES.ui_change;
        } else {
          if (rawPrompt.length < 12) {
            return {
              reply: 'Décrivez la modification ERP (interface, mail, module…). Ex. « ajoute la planification des départs dans la boîte mail ».',
              actions: [],
            };
          }
          agentPrompt = `Dans le repo NEYA ERP (Express backend + Next.js frontend, prod sur VPS /opt/neya-erp), applique cette demande utilisateur de façon autonome.\nStyle UI : sobre, cohérent avec l'existant (éviter look "AI bubble").\nFais un plan court puis les modifications concrètes.\n\nDemande :\n${rawPrompt}`;
        }

        const pointed = pageContext?.meta?.element;
        if (pointed) {
          agentPrompt = `Cible UI pointée par l'utilisateur dans l'ERP (page ${pointed.pathname || pageContext.pathname || '?'}) :
- sélecteur: ${pointed.selector}
- tag: ${pointed.tag}${pointed.id ? ` #${pointed.id}` : ''}
- texte visible: « ${(pointed.text || pointed.label || '').slice(0, 120)} »
- classes: ${(pointed.classes || []).join(' ') || '—'}
- heading section: ${pointed.heading || '—'}
JSON: ${JSON.stringify(pointed)}

Modifie précisément cet élément / cette zone (ou le composant Next.js qui le rend). ${agentPrompt}`;
        }

        try {
          const { getHabitsPromptBlock } = await import('./atelier-habits.js');
          const habits = getHabitsPromptBlock();
          if (habits) {
            agentPrompt = `${habits}\n\n---\n\n${agentPrompt}`;
          }
        } catch {
          /* optional */
        }

        const run = await startAgentRun({
          prompt: agentPrompt,
          label: (params.label || rawPrompt || feature || 'modif ERP').slice(0, 80),
          source: 'assistant_skill',
        });

        actions.push({
          type: 'demande_modification_erp',
          data: { run_id: run.id, status: run.status, label: run.label },
        });
        actions.push({ type: 'navigate', data: { href: '/settings?tab=cursor' } });

        return {
          reply: `Modification ERP lancée via Cursor sur le VPS (run #${run.id}). Backup Git créé automatiquement. Suivi dans Paramètres → Agent Cursor — je m'en occupe, tu peux continuer.`,
          actions,
        };
      } catch (e) {
        return { reply: `Impossible de lancer Cursor : ${e.message}`, actions: [] };
      }
    }

    default:
      return { reply: `Action « ${actionType} » non implémentée.`, actions: [] };
  }
}

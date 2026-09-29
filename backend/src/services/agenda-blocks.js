/**
 * Agenda personnel ↔ carnet d’heures projet ↔ pointages.
 * Lecture et placement uniquement : aucune fonction ici ne supprime des lignes existantes,
 * sauf removeLogbookRow (déplacement explicite d’un bloc créé depuis l’agenda).
 */

export function parseProjectMeta(meta) {
  if (typeof meta === 'string') {
    try { return JSON.parse(meta || '{}'); } catch { return {}; }
  }
  return meta && typeof meta === 'object' ? meta : {};
}

export function normalizeName(name) {
  return String(name || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

export function namesMatch(a, b) {
  const x = normalizeName(a);
  const y = normalizeName(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const fx = x.split(/\s+/)[0];
  const fy = y.split(/\s+/)[0];
  return fx.length > 2 && fx === fy;
}

export function canonicalPersonName(people, employeeName) {
  const list = Array.isArray(people) ? people.map(String) : [];
  const hit = list.find(p => namesMatch(p, employeeName));
  if (hit) return hit;
  const name = String(employeeName || '').trim();
  if (name) return name;
  return list[0] || 'Mehdi';
}

export function isLogbookRowLinked(row) {
  const id = Number(row?.time_entry_id);
  return Number.isFinite(id) && id > 0;
}

/** Le carnet historique reste la source projet tant qu’il contient des heures non liées. */
export function projectLaborUsesLogbook(unlinkedLogbookHours) {
  return Number(unlinkedLogbookHours) > 0;
}

export function dateKeyOf(row) {
  const raw = String(row?.dateKey || row?.date_iso || row?.date || '').trim();
  const iso = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (iso) return iso[1];
  const fr = raw.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})/);
  if (fr) {
    const day = fr[1].padStart(2, '0');
    const month = fr[2].padStart(2, '0');
    return `${fr[3]}-${month}-${day}`;
  }
  return '';
}

export function hmToMinutes(hm) {
  const m = String(hm || '').trim().match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

export function minutesToHm(mins) {
  const day = 24 * 60;
  const m = ((Math.round(mins) % day) + day) % day;
  const h = Math.floor(m / 60);
  const min = m % 60;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

export function hoursBetweenHm(start, end) {
  const a = hmToMinutes(start);
  const b = hmToMinutes(end);
  if (a == null || b == null || b <= a) return 0;
  return Math.round(((b - a) / 60) * 100) / 100;
}

export function rowHoursTotal(row) {
  const hoursMap = row?.hours && typeof row.hours === 'object' ? row.hours : null;
  if (hoursMap) {
    let sum = 0;
    let any = false;
    for (const v of Object.values(hoursMap)) {
      if (v === '' || v == null) continue;
      const n = Number(v);
      if (!Number.isFinite(n)) continue;
      sum += n;
      any = true;
    }
    if (any) return Math.round(sum * 100) / 100;
  }
  if (row?.actual_hours != null && row.actual_hours !== '') {
    const n = Number(row.actual_hours);
    if (Number.isFinite(n)) return Math.round(n * 100) / 100;
  }
  return 0;
}

export function rowMatchesPerson(row, people, person) {
  const target = String(person || '').trim();
  if (!target) return true;
  const hours = row?.hours && typeof row.hours === 'object' ? row.hours : null;
  if (hours) {
    let anyPositive = false;
    let matchedPositive = false;
    for (const [name, val] of Object.entries(hours)) {
      const n = val === '' || val == null ? 0 : Number(val);
      if (Number.isFinite(n) && n > 0) {
        anyPositive = true;
        if (namesMatch(name, target)) matchedPositive = true;
      }
    }
    if (anyPositive) return matchedPositive;
  }
  const list = Array.isArray(people) && people.length ? people : ['Mehdi'];
  return list.some(p => namesMatch(p, target));
}

function blockFromItem(item, startMin, endMin, inferred) {
  const { row, index, project } = item;
  const total = rowHoursTotal(row);
  const label = row.label || '';
  return {
    id: `log:${project.id}:${index}`,
    kind: isLogbookRowLinked(row) ? 'linked' : 'logbook',
    project_id: project.id,
    project_name: project.name,
    row_index: index,
    time_entry_id: isLogbookRowLinked(row) ? Number(row.time_entry_id) : null,
    date: dateKeyOf(row),
    start_hm: minutesToHm(startMin),
    end_hm: minutesToHm(endMin),
    hours: total,
    title: label ? `${project.name} · ${label}` : project.name,
    label,
    notes: row.notes || '',
    inferred,
    placed_from: row.placed_from || null,
    preserve_hours: row.placed_from !== 'agenda',
  };
}

/**
 * Place chaque ligne sur la journée.
 * Créneaux explicites (début + fin) restent où ils sont.
 * Les autres s’empilent après, à partir de 8 h, selon la durée enregistrée.
 * Aucune ligne en entrée n’est écartée.
 */
export function placeLogbookRows(items, { dayStartMin = 8 * 60 } = {}) {
  const explicit = [];
  const loose = [];
  for (const item of items) {
    const startM = hmToMinutes(item.row.start);
    const endM = hmToMinutes(item.row.end);
    if (startM != null && endM != null && endM > startM) explicit.push({ item, startM, endM });
    else loose.push(item);
  }

  const placed = [];
  let cursor = dayStartMin;
  for (const { item, startM, endM } of explicit) {
    placed.push(blockFromItem(item, startM, endM, false));
    cursor = Math.max(cursor, endM + 15);
  }
  for (const item of loose) {
    const total = rowHoursTotal(item.row);
    const dur = total > 0 ? Math.round(total * 60) : 30;
    const capped = Math.min(Math.max(dur, 30), 12 * 60);
    let startMin = cursor;
    let endMin = startMin + capped;
    if (endMin > 22 * 60) {
      startMin = dayStartMin;
      endMin = Math.min(startMin + capped, 22 * 60);
    }
    placed.push(blockFromItem(item, startMin, endMin, true));
    cursor = endMin + 15;
    if (cursor >= 21 * 60) cursor = dayStartMin;
  }
  return placed;
}

export function blocksFromProjects(projects, { from, to, person } = {}) {
  const fromD = from ? String(from).slice(0, 10) : null;
  const toD = to ? String(to).slice(0, 10) : null;
  const byDate = new Map();

  for (const project of projects || []) {
    const log = parseProjectMeta(project.meta).hours_logbook;
    if (!log || !Array.isArray(log.rows)) continue;
    log.rows.forEach((row, index) => {
      const date = dateKeyOf(row);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
      if (fromD && date < fromD) return;
      if (toD && date > toD) return;
      if (person && !rowMatchesPerson(row, log.people, person)) return;
      const arr = byDate.get(date) || [];
      arr.push({ row, index, project: { id: project.id, name: project.name } });
      byDate.set(date, arr);
    });
  }

  const blocks = [];
  for (const [, items] of byDate) {
    items.sort((a, b) => a.project.id - b.project.id || a.index - b.index);
    blocks.push(...placeLogbookRows(items));
  }
  return blocks;
}

export function blocksFromTimeEntries(entries, linkedIds) {
  const linked = linkedIds instanceof Set ? linkedIds : new Set(linkedIds || []);
  const out = [];
  for (const e of entries || []) {
    if (linked.has(Number(e.id))) continue;
    const hours = Number(e.hours);
    const projectName = e.project_name || '';
    out.push({
      id: `entry:${e.id}`,
      kind: 'time_entry',
      time_entry_id: Number(e.id),
      project_id: e.project_id || null,
      project_name: projectName,
      employee_id: e.employee_id,
      employee_name: e.employee_name || '',
      start_at: e.started_at,
      end_at: e.ended_at,
      hours: Number.isFinite(hours) ? Math.round(hours * 100) / 100 : null,
      title: projectName || 'Mes heures',
      label: '',
      notes: e.notes || '',
      inferred: false,
      placed_from: e.source === 'agenda' ? 'agenda' : null,
      preserve_hours: false,
    });
  }
  return out;
}

export function attachLinkedTimes(blocks, entries) {
  const byId = new Map((entries || []).map(e => [Number(e.id), e]));
  return (blocks || []).map(b => {
    if (!b.time_entry_id) return b;
    const e = byId.get(Number(b.time_entry_id));
    if (!e) return b;
    return {
      ...b,
      start_at: e.started_at,
      end_at: e.ended_at,
      employee_id: e.employee_id,
      employee_name: e.employee_name || b.employee_name || '',
      inferred: false,
    };
  });
}

export function assembleAgendaBlocks({ projects, entries, from, to, person } = {}) {
  const logBlocks = blocksFromProjects(projects, { from, to, person });
  const linkedIds = new Set(logBlocks.map(b => b.time_entry_id).filter(Boolean));
  const placed = attachLinkedTimes(logBlocks, entries);
  const entryBlocks = blocksFromTimeEntries(entries, linkedIds);
  return [...placed, ...entryBlocks];
}

function cloneLog(meta) {
  const parsed = parseProjectMeta(meta);
  const existing = parsed.hours_logbook && typeof parsed.hours_logbook === 'object'
    ? parsed.hours_logbook
    : {};
  const people = Array.isArray(existing.people) ? existing.people.map(String) : [];
  const rows = Array.isArray(existing.rows)
    ? existing.rows.map(r => ({ ...r, hours: { ...(r.hours || {}) } }))
    : [];
  return { existing, people, rows };
}

function totalsFor(people, rows) {
  const totals = {};
  for (const p of people) {
    totals[p] = Math.round(rows.reduce((s, r) => {
      const n = Number(r.hours?.[p]);
      return s + (Number.isFinite(n) ? n : 0);
    }, 0) * 100) / 100;
  }
  return totals;
}

/** Ajoute une ligne sans retirer ni vider les lignes déjà là. */
export function buildLogbookWithAppendedRow(meta, row, personName) {
  const { existing, people, rows } = cloneLog(meta);
  const person = canonicalPersonName(people, personName);
  const nextPeople = people.includes(person) ? people : [...people, person];
  if (!nextPeople.length) nextPeople.push(person);
  const hours = {};
  for (const p of nextPeople) {
    if (p === person && row.hours_value != null && row.hours_value !== '') hours[p] = row.hours_value;
    else hours[p] = '';
  }
  rows.push({
    dateKey: row.dateKey,
    label: row.label || '',
    planned_hours: row.planned_hours ?? '',
    start: row.start || '',
    end: row.end || '',
    notes: row.notes || '',
    hours,
    time_entry_id: row.time_entry_id || null,
    placed_from: row.placed_from || 'agenda',
  });
  return {
    ...existing,
    people: nextPeople,
    rows,
    totals: totalsFor(nextPeople, rows),
    source: existing.source || 'manuel',
  };
}

/** Met à jour une seule ligne. Les autres lignes restent identiques. */
export function buildLogbookWithRowPatch(meta, rowIndex, patch = {}) {
  const { existing, people, rows } = cloneLog(meta);
  if (!existing.rows || !rows[rowIndex]) {
    return { ok: false, error: 'Ligne du carnet introuvable' };
  }
  let nextPeople = people.length ? [...people] : ['Mehdi'];
  const current = rows[rowIndex];
  const next = { ...current, hours: { ...(current.hours || {}) } };
  if (patch.dateKey) next.dateKey = patch.dateKey;
  if (patch.start != null) next.start = patch.start;
  if (patch.end != null) next.end = patch.end;
  if (patch.label != null) next.label = patch.label;
  if (patch.notes != null) next.notes = patch.notes;
  if (patch.time_entry_id !== undefined) next.time_entry_id = patch.time_entry_id;
  if (patch.placed_from && !next.placed_from) next.placed_from = patch.placed_from;
  if (patch.personHours?.name != null && patch.personHours.value != null && patch.preserveHours !== true) {
    const person = canonicalPersonName(nextPeople, patch.personHours.name);
    if (!nextPeople.includes(person)) nextPeople = [...nextPeople, person];
    next.hours[person] = patch.personHours.value;
  }
  const nextRows = rows.map((r, i) => (i === rowIndex ? next : r));
  return {
    ok: true,
    row: next,
    logbook: {
      ...existing,
      people: nextPeople,
      rows: nextRows,
      totals: totalsFor(nextPeople, nextRows),
      source: existing.source || 'manuel',
    },
  };
}

export function findLogbookLink(projects, timeEntryId) {
  const id = Number(timeEntryId);
  if (!id) return null;
  for (const project of projects || []) {
    const rows = parseProjectMeta(project.meta).hours_logbook?.rows;
    if (!Array.isArray(rows)) continue;
    const index = rows.findIndex(r => Number(r.time_entry_id) === id);
    if (index >= 0) return { projectId: project.id, index, row: rows[index] };
  }
  return null;
}

/** Retire une seule ligne (déplacement d’un bloc agenda). Les autres restent. */
export function buildLogbookWithoutRow(meta, rowIndex) {
  const { existing, people, rows } = cloneLog(meta);
  if (!rows[rowIndex]) return { ok: false, error: 'Ligne du carnet introuvable' };
  const removed = rows[rowIndex];
  const nextRows = rows.filter((_, i) => i !== rowIndex);
  const nextPeople = people.length ? people : ['Mehdi'];
  return {
    ok: true,
    removed,
    emptied: nextRows.length === 0,
    logbook: {
      ...existing,
      people: nextPeople,
      rows: nextRows,
      totals: totalsFor(nextPeople, nextRows),
      source: existing.source || 'manuel',
    },
  };
}

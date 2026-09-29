/** Dates locales pour l’agenda (évite le décalage UTC). */

export function localISODate(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function hmFromDate(d) {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function combineLocal(dateKey, hm) {
  const [y, m, d] = String(dateKey || '').split('-').map(Number);
  const [hh, mm] = String(hm || '00:00').split(':').map(Number);
  return new Date(y, (m || 1) - 1, d || 1, hh || 0, mm || 0, 0, 0);
}

export function addDays(d, n) {
  const c = new Date(d);
  c.setDate(c.getDate() + n);
  return c;
}

export function startOfWeek(d) {
  const c = new Date(d);
  c.setHours(12, 0, 0, 0);
  const dow = (c.getDay() + 6) % 7;
  c.setDate(c.getDate() - dow);
  return c;
}

export function slotPayload({ date, start, end, project_id, label, notes, employee_id, id }) {
  const started = combineLocal(date, start);
  const ended = combineLocal(date, end);
  const body = {
    date,
    start,
    end,
    started_at: started.toISOString(),
    ended_at: ended.toISOString(),
    project_id: project_id ? Number(project_id) : null,
    label: label || '',
    notes: notes || '',
  };
  if (employee_id) body.employee_id = Number(employee_id);
  if (id) body.id = id;
  return body;
}

export function blockView(block) {
  if (block?.start_at) {
    const start = new Date(block.start_at);
    const end = block.end_at ? new Date(block.end_at) : new Date(start.getTime() + 3600000);
    return {
      start,
      end,
      date: localISODate(start),
      startHm: hmFromDate(start),
      endHm: hmFromDate(end),
      inferred: false,
    };
  }
  const start = combineLocal(block?.date, block?.start_hm || '08:00');
  let end = combineLocal(block?.date, block?.end_hm || '09:00');
  if (!(end > start)) end = new Date(start.getTime() + 30 * 60000);
  return {
    start,
    end,
    date: block?.date || localISODate(start),
    startHm: block?.start_hm || hmFromDate(start),
    endHm: block?.end_hm || hmFromDate(end),
    inferred: !!block?.inferred,
  };
}

export function blockOnDate(block, dateKey) {
  return blockView(block).date === dateKey;
}

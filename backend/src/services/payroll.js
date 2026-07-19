import pool from '../db/pool.js';

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function round2(n) {
  return Math.round(num(n) * 100) / 100;
}

function normalizeName(name) {
  return String(name || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function parseMeta(meta) {
  if (!meta) return {};
  if (typeof meta === 'string') {
    try { return JSON.parse(meta); } catch { return {}; }
  }
  return meta;
}

/** Période de paie bi-mensuelle (1–15 / 16–fin). */
export function resolvePayPeriod(refDate = new Date()) {
  const d = new Date(refDate);
  if (Number.isNaN(d.getTime())) return resolvePayPeriod(new Date());
  const y = d.getFullYear();
  const m = d.getMonth();
  const day = d.getDate();
  const pad = (n) => String(n).padStart(2, '0');
  if (day <= 15) {
    return {
      start: `${y}-${pad(m + 1)}-01`,
      end: `${y}-${pad(m + 1)}-15`,
      label: `1–15 ${d.toLocaleDateString('fr-CA', { month: 'long', year: 'numeric' })}`,
    };
  }
  const last = new Date(y, m + 1, 0).getDate();
  return {
    start: `${y}-${pad(m + 1)}-16`,
    end: `${y}-${pad(m + 1)}-${pad(last)}`,
    label: `16–${last} ${d.toLocaleDateString('fr-CA', { month: 'long', year: 'numeric' })}`,
  };
}

export function shiftPeriod(startIso, direction = -1) {
  const start = new Date(`${startIso}T12:00:00`);
  start.setDate(start.getDate() + (direction < 0 ? -1 : 16));
  return resolvePayPeriod(start);
}

async function ensurePayrollTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS payroll_periods (
      id SERIAL PRIMARY KEY,
      start_date DATE NOT NULL,
      end_date DATE NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      notes TEXT,
      paid_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (start_date, end_date)
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS payroll_lines (
      id SERIAL PRIMARY KEY,
      period_id INT NOT NULL REFERENCES payroll_periods(id) ON DELETE CASCADE,
      employee_id INT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
      hours_worked NUMERIC(10,2) NOT NULL DEFAULT 0,
      hours_scheduled NUMERIC(10,2) NOT NULL DEFAULT 0,
      hourly_rate NUMERIC(10,2) NOT NULL DEFAULT 0,
      gross NUMERIC(12,2) NOT NULL DEFAULT 0,
      deductions NUMERIC(12,2) NOT NULL DEFAULT 0,
      advances NUMERIC(12,2) NOT NULL DEFAULT 0,
      net NUMERIC(12,2) NOT NULL DEFAULT 0,
      source_breakdown JSONB NOT NULL DEFAULT '{}',
      notes TEXT,
      UNIQUE (period_id, employee_id)
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS payroll_todos (
      id SERIAL PRIMARY KEY,
      period_id INT NOT NULL REFERENCES payroll_periods(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      done BOOLEAN NOT NULL DEFAULT false,
      sort_order INT NOT NULL DEFAULT 0,
      due_date DATE,
      link_href TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_payroll_todos_period ON payroll_todos(period_id)`);
}

async function hoursFromLogbook(start, end) {
  const { rows: projects } = await pool.query('SELECT id, name, meta FROM projects');
  const byPerson = {};
  for (const project of projects) {
    const log = parseMeta(project.meta).hours_logbook;
    if (!log || !Array.isArray(log.rows)) continue;
    for (const row of log.rows) {
      const dateKey = String(row.dateKey || row.date_iso || row.date || '').slice(0, 10);
      if (!dateKey || dateKey < start || dateKey > end) continue;
      const hoursMap = row.hours && typeof row.hours === 'object' ? row.hours : null;
      if (hoursMap) {
        for (const [person, hrs] of Object.entries(hoursMap)) {
          const key = normalizeName(person);
          if (!key) continue;
          byPerson[key] = round2((byPerson[key] || 0) + num(hrs));
        }
      } else if (row.actual_hours != null && row.actual_hours !== '') {
        const people = Array.isArray(log.people) && log.people.length ? log.people : ['Mehdi'];
        const key = normalizeName(people[0]);
        byPerson[key] = round2((byPerson[key] || 0) + num(row.actual_hours));
      }
    }
  }
  return byPerson;
}

async function hoursFromTimeEntries(start, end) {
  try {
    const { rows } = await pool.query(
      `SELECT te.employee_id,
              COALESCE(SUM(
                EXTRACT(EPOCH FROM (te.ended_at - te.started_at)) / 3600.0
              ), 0)::float AS hours
       FROM time_entries te
       WHERE te.ended_at IS NOT NULL
         AND te.started_at::date <= $2::date
         AND te.ended_at::date >= $1::date
       GROUP BY te.employee_id`,
      [start, end]
    );
    const map = {};
    for (const r of rows) map[r.employee_id] = round2(r.hours);
    return map;
  } catch {
    return {};
  }
}

async function hoursFromShifts(start, end) {
  try {
    const { rows } = await pool.query(
      `SELECT employee_id,
              COALESCE(SUM(EXTRACT(EPOCH FROM (end_at - start_at)) / 3600.0), 0)::float AS hours
       FROM shifts
       WHERE start_at::date <= $2::date AND end_at::date >= $1::date
       GROUP BY employee_id`,
      [start, end]
    );
    const map = {};
    for (const r of rows) map[r.employee_id] = round2(r.hours);
    return map;
  } catch {
    return {};
  }
}

const DEFAULT_TODOS = [
  { title: 'Vérifier les heures de chaque employé', link_href: '/team', sort_order: 1 },
  { title: 'Valider les taux horaires', link_href: '/team', sort_order: 2 },
  { title: 'Saisir avances / déductions si besoin', link_href: '/paie', sort_order: 3 },
  { title: 'Préparer les virements Interac / paie', link_href: '/paie', sort_order: 4 },
  { title: 'Noter le paiement en Dépenses (salaires)', link_href: '/expenses', sort_order: 5 },
  { title: 'Marquer la période comme payée', link_href: '/paie', sort_order: 6 },
];

async function ensurePeriodRow(start, end) {
  const { rows } = await pool.query(
    `INSERT INTO payroll_periods (start_date, end_date, status)
     VALUES ($1::date, $2::date, 'open')
     ON CONFLICT (start_date, end_date) DO UPDATE SET updated_at = NOW()
     RETURNING *`,
    [start, end]
  );
  const period = rows[0];
  const { rows: todos } = await pool.query(
    'SELECT id FROM payroll_todos WHERE period_id = $1 LIMIT 1',
    [period.id]
  );
  if (!todos[0]) {
    for (const t of DEFAULT_TODOS) {
      await pool.query(
        `INSERT INTO payroll_todos (period_id, title, sort_order, link_href)
         VALUES ($1, $2, $3, $4)`,
        [period.id, t.title, t.sort_order, t.link_href]
      );
    }
  }
  return period;
}

/**
 * Calcule la paie pour une période (style QuickBooks : heures × taux − déductions).
 */
export async function computePayrollOverview({ start, end } = {}) {
  await ensurePayrollTables();
  const periodDates = start && end
    ? { start, end, label: `${start} → ${end}` }
    : resolvePayPeriod(new Date());

  const period = await ensurePeriodRow(periodDates.start, periodDates.end);

  const { rows: employees } = await pool.query(
    `SELECT id, name, role, hourly_rate::float AS hourly_rate, color, active
     FROM employees WHERE active IS DISTINCT FROM false ORDER BY name`
  );

  const [logbook, timeEntries, shifts] = await Promise.all([
    hoursFromLogbook(periodDates.start, periodDates.end),
    hoursFromTimeEntries(periodDates.start, periodDates.end),
    hoursFromShifts(periodDates.start, periodDates.end),
  ]);

  const { rows: savedLines } = await pool.query(
    'SELECT * FROM payroll_lines WHERE period_id = $1',
    [period.id]
  );
  const savedByEmp = Object.fromEntries(savedLines.map(l => [l.employee_id, l]));

  const lines = [];
  for (const emp of employees) {
    const key = normalizeName(emp.name);
    const first = key.split(/\s+/)[0];
    const hLog = num(logbook[key] ?? logbook[first] ?? 0);
    const hTime = num(timeEntries[emp.id] ?? 0);
    const hShift = num(shifts[emp.id] ?? 0);
    // Payable : carnet + pointage (sans double-compter si un seul source)
    const hoursWorked = round2(hLog + hTime);
    const rate = num(emp.hourly_rate);
    const saved = savedByEmp[emp.id];
    const deductions = saved ? num(saved.deductions) : 0;
    const advances = saved ? num(saved.advances) : 0;
    const gross = round2(hoursWorked * rate);
    const net = round2(Math.max(0, gross - deductions - advances));
    const breakdown = {
      hours_logbook: hLog,
      hours_time_entries: hTime,
      hours_scheduled_shifts: hShift,
    };

    // Upsert computed line (preserve deductions/advances/notes)
    const { rows: upserted } = await pool.query(
      `INSERT INTO payroll_lines (
         period_id, employee_id, hours_worked, hours_scheduled, hourly_rate,
         gross, deductions, advances, net, source_breakdown, notes
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11)
       ON CONFLICT (period_id, employee_id) DO UPDATE SET
         hours_worked = EXCLUDED.hours_worked,
         hours_scheduled = EXCLUDED.hours_scheduled,
         hourly_rate = EXCLUDED.hourly_rate,
         gross = EXCLUDED.gross,
         net = GREATEST(0, EXCLUDED.gross - payroll_lines.deductions - payroll_lines.advances),
         source_breakdown = EXCLUDED.source_breakdown,
         deductions = payroll_lines.deductions,
         advances = payroll_lines.advances,
         notes = payroll_lines.notes
       RETURNING *`,
      [
        period.id,
        emp.id,
        hoursWorked,
        hShift,
        rate,
        gross,
        deductions,
        advances,
        net,
        JSON.stringify(breakdown),
        saved?.notes || null,
      ]
    );

    const line = upserted[0];
    lines.push({
      ...line,
      employee_name: emp.name,
      employee_role: emp.role,
      employee_color: emp.color,
      hours_worked: num(line.hours_worked),
      hours_scheduled: num(line.hours_scheduled),
      hourly_rate: num(line.hourly_rate),
      gross: num(line.gross),
      deductions: num(line.deductions),
      advances: num(line.advances),
      net: num(line.net),
      source_breakdown: line.source_breakdown || breakdown,
    });
  }

  const { rows: todos } = await pool.query(
    `SELECT * FROM payroll_todos WHERE period_id = $1 ORDER BY sort_order, id`,
    [period.id]
  );

  const totals = lines.reduce((acc, l) => {
    acc.hours_worked = round2(acc.hours_worked + l.hours_worked);
    acc.hours_scheduled = round2(acc.hours_scheduled + l.hours_scheduled);
    acc.gross = round2(acc.gross + l.gross);
    acc.deductions = round2(acc.deductions + l.deductions);
    acc.advances = round2(acc.advances + l.advances);
    acc.net = round2(acc.net + l.net);
    return acc;
  }, { hours_worked: 0, hours_scheduled: 0, gross: 0, deductions: 0, advances: 0, net: 0 });

  const todosDone = todos.filter(t => t.done).length;

  return {
    period: {
      ...period,
      label: periodDates.label || `${period.start_date} → ${period.end_date}`,
      start_date: String(period.start_date).slice(0, 10),
      end_date: String(period.end_date).slice(0, 10),
    },
    lines,
    todos,
    totals,
    progress: {
      todos_done: todosDone,
      todos_total: todos.length,
      pct: todos.length ? Math.round((todosDone / todos.length) * 100) : 0,
    },
    hint: 'Heures = carnet projets + pointage. Les shifts planifiés sont affichés à titre indicatif.',
  };
}

export async function updatePayrollLine(periodId, employeeId, patch = {}) {
  await ensurePayrollTables();
  const { rows: existing } = await pool.query(
    'SELECT * FROM payroll_lines WHERE period_id = $1 AND employee_id = $2',
    [periodId, employeeId]
  );
  if (!existing[0]) throw new Error('Ligne de paie introuvable — rechargez la période');
  const line = existing[0];
  const deductions = patch.deductions !== undefined ? num(patch.deductions) : num(line.deductions);
  const advances = patch.advances !== undefined ? num(patch.advances) : num(line.advances);
  const notes = patch.notes !== undefined ? patch.notes : line.notes;
  const gross = num(line.gross);
  const net = round2(Math.max(0, gross - deductions - advances));
  const { rows } = await pool.query(
    `UPDATE payroll_lines
     SET deductions = $1, advances = $2, notes = $3, net = $4
     WHERE id = $5 RETURNING *`,
    [deductions, advances, notes, net, line.id]
  );
  return rows[0];
}

export async function setPayrollPeriodStatus(periodId, status) {
  await ensurePayrollTables();
  const allowed = new Set(['open', 'review', 'paid']);
  if (!allowed.has(status)) throw new Error('Statut invalide');
  const { rows } = await pool.query(
    `UPDATE payroll_periods
     SET status = $1,
         paid_at = CASE WHEN $1 = 'paid' THEN COALESCE(paid_at, NOW()) ELSE NULL END,
         updated_at = NOW()
     WHERE id = $2 RETURNING *`,
    [status, periodId]
  );
  if (!rows[0]) throw new Error('Période introuvable');
  return rows[0];
}

export async function togglePayrollTodo(todoId, done) {
  await ensurePayrollTables();
  const { rows } = await pool.query(
    `UPDATE payroll_todos SET done = $1 WHERE id = $2 RETURNING *`,
    [Boolean(done), todoId]
  );
  if (!rows[0]) throw new Error('Tâche introuvable');
  return rows[0];
}

export async function addPayrollTodo(periodId, { title, link_href = null, due_date = null }) {
  await ensurePayrollTables();
  if (!title?.trim()) throw new Error('Titre requis');
  const { rows: max } = await pool.query(
    'SELECT COALESCE(MAX(sort_order), 0)::int AS m FROM payroll_todos WHERE period_id = $1',
    [periodId]
  );
  const { rows } = await pool.query(
    `INSERT INTO payroll_todos (period_id, title, sort_order, link_href, due_date)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [periodId, title.trim(), (max[0]?.m || 0) + 1, link_href, due_date]
  );
  return rows[0];
}

export { ensurePayrollTables };

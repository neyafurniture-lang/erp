import pool from '../db/pool.js';

const MONTH_LABELS_FR = [
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre',
];

function emptyMonth(month) {
  return {
    month,
    label: MONTH_LABELS_FR[month - 1],
    revenue_invoiced: 0,
    revenue_draft: 0,
    revenue_collected: 0,
    payments: 0,
    expenses_total: 0,
    expenses_by_category: {},
    labor_hours: 0,
    labor_cost: 0,
    labor_by_person: {},
    me_hours: 0,
    me_cost: 0,
    profit_invoiced: 0,
    profit_collected: 0,
  };
}

function parseMeta(meta) {
  if (!meta) return {};
  if (typeof meta === 'string') {
    try { return JSON.parse(meta); } catch { return {}; }
  }
  return typeof meta === 'object' ? meta : {};
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function round2(v) {
  return Math.round(num(v) * 100) / 100;
}

function normalizeName(name) {
  return String(name || '').trim().toLowerCase();
}

/** Trouve le taux horaire d’une personne (nom exact ou prénom). */
function rateForPerson(rateMap, personName) {
  const key = normalizeName(personName);
  if (!key) return 0;
  if (rateMap[key] != null) return rateMap[key];
  const first = key.split(/\s+/)[0];
  if (first && rateMap[first] != null) return rateMap[first];
  for (const [k, rate] of Object.entries(rateMap)) {
    if (k.startsWith(first) || first.startsWith(k.split(/\s+/)[0])) return rate;
  }
  return 0;
}

function bumpPerson(bucket, person, hours, rate) {
  const h = num(hours);
  if (h <= 0) return;
  const name = String(person || 'Inconnu').trim() || 'Inconnu';
  if (!bucket[name]) bucket[name] = { hours: 0, cost: 0, rate };
  bucket[name].hours = round2(bucket[name].hours + h);
  bucket[name].cost = round2(bucket[name].cost + h * rate);
}

function isMePerson(personName, meName) {
  const a = normalizeName(personName);
  const b = normalizeName(meName);
  if (!a || !b) return false;
  if (a === b) return true;
  const af = a.split(/\s+/)[0];
  const bf = b.split(/\s+/)[0];
  return af && bf && af === bf;
}

/**
 * P&L mensuel pour une année civile.
 * @param {number} year
 * @param {{ meName?: string }} [opts]
 */
export async function computeMonthlyPnl(year, opts = {}) {
  const y = Number(year) || new Date().getFullYear();
  const meName = String(opts.meName || 'Mehdi').trim() || 'Mehdi';

  const months = Array.from({ length: 12 }, (_, i) => emptyMonth(i + 1));

  const { rows: employees } = await pool.query(
    `SELECT id, name, hourly_rate::float AS hourly_rate, active
     FROM employees WHERE active IS DISTINCT FROM false ORDER BY name`
  );
  const rateMap = {};
  for (const e of employees) {
    rateMap[normalizeName(e.name)] = num(e.hourly_rate);
    const first = normalizeName(e.name).split(/\s+/)[0];
    if (first && rateMap[first] == null) rateMap[first] = num(e.hourly_rate);
  }
  const meRate = rateForPerson(rateMap, meName);

  const [invoicesRes, expensesRes, paymentsRes, projectsRes, timeRes] = await Promise.all([
    pool.query(
      `SELECT
         EXTRACT(MONTH FROM created_at)::int AS month,
         status,
         COALESCE(total, 0)::float AS total,
         COALESCE(amount_paid, 0)::float AS amount_paid
       FROM invoices
       WHERE EXTRACT(YEAR FROM created_at) = $1`,
      [y]
    ),
    pool.query(
      `SELECT
         EXTRACT(MONTH FROM date)::int AS month,
         COALESCE(category, 'autre') AS category,
         COALESCE(SUM(amount), 0)::float AS total
       FROM expenses
       WHERE EXTRACT(YEAR FROM date) = $1
       GROUP BY 1, 2`,
      [y]
    ),
    pool.query(
      `SELECT
         EXTRACT(MONTH FROM date)::int AS month,
         COALESCE(SUM(amount), 0)::float AS total
       FROM payments
       WHERE EXTRACT(YEAR FROM date) = $1
       GROUP BY 1`,
      [y]
    ).catch(() => ({ rows: [] })),
    pool.query('SELECT id, name, meta FROM projects'),
    pool.query(
      `SELECT
         EXTRACT(MONTH FROM te.started_at)::int AS month,
         e.name AS person,
         e.hourly_rate::float AS rate,
         COALESCE(SUM(
           EXTRACT(EPOCH FROM (COALESCE(te.ended_at, te.started_at) - te.started_at)) / 3600.0
         ), 0)::float AS hours
       FROM time_entries te
       JOIN employees e ON e.id = te.employee_id
       WHERE EXTRACT(YEAR FROM te.started_at) = $1
       GROUP BY 1, 2, 3`,
      [y]
    ).catch(() => ({ rows: [] })),
  ]);

  for (const row of invoicesRes.rows) {
    const m = months[row.month - 1];
    if (!m) continue;
    const total = num(row.total);
    const paid = num(row.amount_paid);
    if (row.status === 'draft') {
      m.revenue_draft = round2(m.revenue_draft + total);
    } else {
      m.revenue_invoiced = round2(m.revenue_invoiced + total);
    }
    m.revenue_collected = round2(m.revenue_collected + paid);
  }

  for (const row of expensesRes.rows) {
    const m = months[row.month - 1];
    if (!m) continue;
    const total = num(row.total);
    m.expenses_total = round2(m.expenses_total + total);
    const cat = row.category || 'autre';
    m.expenses_by_category[cat] = round2((m.expenses_by_category[cat] || 0) + total);
  }

  for (const row of paymentsRes.rows) {
    const m = months[row.month - 1];
    if (!m) continue;
    m.payments = round2(m.payments + num(row.total));
  }

  // Carnet d’heures projets (meta.hours_logbook)
  for (const project of projectsRes.rows) {
    const log = parseMeta(project.meta).hours_logbook;
    if (!log || !Array.isArray(log.rows)) continue;
    for (const row of log.rows) {
      const dateKey = row.dateKey || row.date_iso || row.date || '';
      const match = String(dateKey).match(/^(\d{4})-(\d{2})/);
      if (!match || Number(match[1]) !== y) continue;
      const month = Number(match[2]);
      const m = months[month - 1];
      if (!m) continue;
      const hoursMap = row.hours && typeof row.hours === 'object' ? row.hours : null;
      if (hoursMap) {
        for (const [person, hrs] of Object.entries(hoursMap)) {
          const rate = rateForPerson(rateMap, person);
          bumpPerson(m.labor_by_person, person, hrs, rate);
        }
      } else if (row.actual_hours != null && row.actual_hours !== '') {
        const people = Array.isArray(log.people) && log.people.length ? log.people : ['Mehdi'];
        const person = people[0];
        const rate = rateForPerson(rateMap, person);
        bumpPerson(m.labor_by_person, person, row.actual_hours, rate);
      }
    }
  }

  // Pointage time_entries
  for (const row of timeRes.rows) {
    const m = months[row.month - 1];
    if (!m) continue;
    const rate = num(row.rate) || rateForPerson(rateMap, row.person);
    bumpPerson(m.labor_by_person, row.person, row.hours, rate);
  }

  for (const m of months) {
    let laborHours = 0;
    let laborCost = 0;
    for (const [person, info] of Object.entries(m.labor_by_person)) {
      laborHours += info.hours;
      laborCost += info.cost;
      if (isMePerson(person, meName)) {
        m.me_hours = round2(m.me_hours + info.hours);
        m.me_cost = round2(m.me_cost + info.cost);
      }
    }
    m.labor_hours = round2(laborHours);
    m.labor_cost = round2(laborCost);
    // Encaissements : max(amount_paid factures du mois, paiements enregistrés du mois)
    // pour éviter de sous-compter si un seul des deux est rempli.
    const collected = Math.max(m.revenue_collected, m.payments);
    m.revenue_collected = round2(collected);
    m.profit_invoiced = round2(m.revenue_invoiced - m.expenses_total - m.labor_cost);
    m.profit_collected = round2(m.revenue_collected - m.expenses_total - m.labor_cost);
  }

  const sum = (key) => round2(months.reduce((s, m) => s + num(m[key]), 0));
  const expensesByCategoryYtd = {};
  const laborByPersonYtd = {};
  for (const m of months) {
    for (const [cat, amt] of Object.entries(m.expenses_by_category)) {
      expensesByCategoryYtd[cat] = round2((expensesByCategoryYtd[cat] || 0) + amt);
    }
    for (const [person, info] of Object.entries(m.labor_by_person)) {
      if (!laborByPersonYtd[person]) laborByPersonYtd[person] = { hours: 0, cost: 0, rate: info.rate };
      laborByPersonYtd[person].hours = round2(laborByPersonYtd[person].hours + info.hours);
      laborByPersonYtd[person].cost = round2(laborByPersonYtd[person].cost + info.cost);
    }
  }

  return {
    year: y,
    me: {
      name: meName,
      hourly_rate: meRate,
      hours: sum('me_hours'),
      cost: sum('me_cost'),
    },
    employees: employees.map(e => ({
      id: e.id,
      name: e.name,
      hourly_rate: num(e.hourly_rate),
    })),
    months,
    totals: {
      revenue_invoiced: sum('revenue_invoiced'),
      revenue_draft: sum('revenue_draft'),
      revenue_collected: sum('revenue_collected'),
      payments: sum('payments'),
      expenses_total: sum('expenses_total'),
      expenses_by_category: expensesByCategoryYtd,
      labor_hours: sum('labor_hours'),
      labor_cost: sum('labor_cost'),
      labor_by_person: laborByPersonYtd,
      me_hours: sum('me_hours'),
      me_cost: sum('me_cost'),
      profit_invoiced: sum('profit_invoiced'),
      profit_collected: sum('profit_collected'),
    },
  };
}

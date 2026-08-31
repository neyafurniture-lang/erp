import pool from '../db/pool.js';
import { getCompanyConfig } from './company-config.js';
import {
  computePayrollDeductions,
  mergeYtd,
  periodsPerYearFromDates,
  round2,
  sumYtdFromBreakdowns,
} from './payroll-qc.js';

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function parseBreakdown(raw) {
  if (!raw) return null;
  if (typeof raw === 'string') {
    try { return JSON.parse(raw); } catch { return null; }
  }
  return raw;
}

/** Colonnes paie / employé pour talons (migration idempotente). */
export async function ensurePayStubSchema() {
  await pool.query(`
    ALTER TABLE employees
      ADD COLUMN IF NOT EXISTS address_line1 TEXT,
      ADD COLUMN IF NOT EXISTS city TEXT,
      ADD COLUMN IF NOT EXISTS province TEXT DEFAULT 'QC',
      ADD COLUMN IF NOT EXISTS postal_code TEXT
  `);
  await pool.query(`
    ALTER TABLE payroll_periods
      ADD COLUMN IF NOT EXISTS pay_date DATE
  `);
  await pool.query(`
    ALTER TABLE payroll_lines
      ADD COLUMN IF NOT EXISTS deduction_breakdown JSONB NOT NULL DEFAULT '{}',
      ADD COLUMN IF NOT EXISTS breakdown_locked BOOLEAN NOT NULL DEFAULT false
  `);
}

function defaultPayDate(endDate) {
  const d = new Date(`${endDate}T12:00:00`);
  d.setDate(d.getDate() + 4);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Cumuls YTD avant la période courante (même année civile).
 * Inclut les périodes payées ou verrouillées dont end_date < currentEnd.
 */
export async function fetchYtdBeforePeriod(employeeId, periodEnd, taxYear) {
  const { rows } = await pool.query(
    `SELECT pl.deduction_breakdown, pl.gross, pl.net, pl.hours_worked
     FROM payroll_lines pl
     JOIN payroll_periods pp ON pp.id = pl.period_id
     WHERE pl.employee_id = $1
       AND EXTRACT(YEAR FROM pp.end_date)::int = $2
       AND pp.end_date < $3::date
       AND (pl.breakdown_locked = true OR pp.status = 'paid')
     ORDER BY pp.end_date`,
    [employeeId, taxYear, periodEnd]
  );
  const breakdowns = rows.map(r => parseBreakdown(r.deduction_breakdown)).filter(Boolean);
  if (!breakdowns.length) {
    return { gross: 0, net: 0, hours: 0, deductions: {}, earnings: 0 };
  }
  return sumYtdFromBreakdowns(breakdowns);
}

export async function computeLineBreakdown(line, period, employee, ytdBefore, overrides = {}) {
  const year = new Date(`${period.end_date}T12:00:00`).getFullYear();
  const periodsPerYear = periodsPerYearFromDates(period.start_date, period.end_date);
  const gross = num(line.gross);
  const hours = num(line.hours_worked);
  const rate = num(line.hourly_rate);

  const breakdown = computePayrollDeductions({
    gross,
    hours,
    rate,
    year,
    periodsPerYear,
    ytd: ytdBefore,
    overrides,
  });

  return breakdown;
}

/** Recalcule et enregistre le breakdown pour une ligne (si non verrouillée). */
export async function refreshLineBreakdown(periodId, employeeId) {
  await ensurePayStubSchema();
  const { rows: periods } = await pool.query('SELECT * FROM payroll_periods WHERE id = $1', [periodId]);
  const period = periods[0];
  if (!period) throw new Error('Période introuvable');

  const { rows: lines } = await pool.query(
    `SELECT pl.*, e.name AS employee_name
     FROM payroll_lines pl
     JOIN employees e ON e.id = pl.employee_id
     WHERE pl.period_id = $1 AND pl.employee_id = $2`,
    [periodId, employeeId]
  );
  const line = lines[0];
  if (!line) throw new Error('Ligne de paie introuvable');

  if (line.breakdown_locked) {
    return parseBreakdown(line.deduction_breakdown);
  }

  const taxYear = new Date(`${period.end_date}T12:00:00`).getFullYear();
  const ytdBefore = await fetchYtdBeforePeriod(employeeId, period.end_date, taxYear);

  const existing = parseBreakdown(line.deduction_breakdown);
  const overrides = existing?.overrides || {};

  const breakdown = await computeLineBreakdown(line, period, null, ytdBefore, overrides);
  const advances = num(line.advances);
  const net = round2(Math.max(0, breakdown.gross - breakdown.totalDeductions - advances));

  await pool.query(
    `UPDATE payroll_lines
     SET deduction_breakdown = $1::jsonb,
         deductions = $2,
         net = $3
     WHERE id = $4`,
    [JSON.stringify(breakdown), breakdown.totalDeductions, net, line.id]
  );

  if (!period.pay_date) {
    await pool.query(
      'UPDATE payroll_periods SET pay_date = $1 WHERE id = $2',
      [defaultPayDate(period.end_date), period.id]
    );
  }

  return breakdown;
}

/** Données complètes pour talon PDF (période + CDA). */
export async function buildPayStub(periodId, employeeId) {
  await ensurePayStubSchema();

  const { rows: periods } = await pool.query('SELECT * FROM payroll_periods WHERE id = $1', [periodId]);
  const period = periods[0];
  if (!period) throw new Error('Période introuvable');

  const payDate = period.pay_date || defaultPayDate(period.end_date);

  const { rows: empRows } = await pool.query(
    'SELECT * FROM employees WHERE id = $1',
    [employeeId]
  );
  const employee = empRows[0];
  if (!employee) throw new Error('Employé introuvable');

  const breakdown = await refreshLineBreakdown(periodId, employeeId);

  const { rows: lines } = await pool.query(
    'SELECT * FROM payroll_lines WHERE period_id = $1 AND employee_id = $2',
    [periodId, employeeId]
  );
  const line = lines[0];

  const taxYear = new Date(`${period.end_date}T12:00:00`).getFullYear();
  const ytdBefore = await fetchYtdBeforePeriod(employeeId, period.end_date, taxYear);
  const ytd = mergeYtd(ytdBefore, breakdown);

  const advances = num(line.advances);
  const net = round2(Math.max(0, num(breakdown.gross) - num(breakdown.totalDeductions) - advances));

  const company = await getCompanyConfig();

  return {
    company: {
      legalName: company.legalName,
      tradeName: company.tradeName,
      addressLine1: company.address?.line1,
      addressLine2: company.address?.line2,
    },
    employee: {
      id: employee.id,
      name: employee.name,
      addressLine1: employee.address_line1,
      city: employee.city,
      province: employee.province || 'QC',
      postalCode: employee.postal_code,
    },
    period: {
      id: period.id,
      startDate: String(period.start_date).slice(0, 10),
      endDate: String(period.end_date).slice(0, 10),
      payDate,
      status: period.status,
    },
    line: {
      hours: num(line.hours_worked),
      rate: num(line.hourly_rate),
      gross: num(breakdown.gross),
      deductions: num(breakdown.totalDeductions),
      advances,
      net,
      memo: line.notes,
    },
    current: breakdown,
    ytd,
    taxYear,
  };
}

/** Verrouille les breakdowns quand la période est payée. */
export async function lockPeriodBreakdowns(periodId) {
  await ensurePayStubSchema();
  const { rows: lines } = await pool.query(
    'SELECT employee_id FROM payroll_lines WHERE period_id = $1',
    [periodId]
  );
  for (const l of lines) {
    await refreshLineBreakdown(periodId, l.employee_id);
  }
  await pool.query(
    'UPDATE payroll_lines SET breakdown_locked = true WHERE period_id = $1',
    [periodId]
  );
}

export async function unlockPeriodBreakdowns(periodId) {
  await pool.query(
    'UPDATE payroll_lines SET breakdown_locked = false WHERE period_id = $1',
    [periodId]
  );
}

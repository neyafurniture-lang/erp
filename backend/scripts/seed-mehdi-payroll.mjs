/**
 * Génère ~7 mois de fiches de paie pour Mehdi (salaire annuel 62 000 $).
 * Bi-mensuel 1–15 / 16–fin (24 paies/an) → brut 2 583,33 $ / période.
 * Cumuls CDA recalculés chronologiquement ; historique marqué payé + verrouillé.
 *
 * Usage: node scripts/seed-mehdi-payroll.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pool from '../src/db/pool.js';
import { ensurePayStubSchema, buildPayStub } from '../src/services/payroll-stub.js';
import { computePayrollDeductions, mergeYtd, round2 } from '../src/services/payroll-qc.js';
import { generatePayStubPdf } from '../src/services/pay-stub-pdf.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ANNUAL_SALARY = 62000;
const PERIODS_PER_YEAR = 24;
const GROSS = round2(ANNUAL_SALARY / PERIODS_PER_YEAR); // 2583.33
const HOURS = 80;
const RATE = round2(GROSS / HOURS); // 32.29
const TAX_YEAR = 2026;
const FROM = { y: 2026, m: 2 };
const TO = { y: 2026, m: 9, lastHalf: false }; // jusqu’au 1–15 sept.

function pad(n) {
  return String(n).padStart(2, '0');
}

function lastDay(y, m) {
  return new Date(y, m, 0).getDate();
}

function defaultPayDate(endIso) {
  const d = new Date(`${endIso}T12:00:00`);
  d.setDate(d.getDate() + 4);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

function* biMonthlyPeriods() {
  let y = FROM.y;
  let m = FROM.m;
  while (y < TO.y || (y === TO.y && m <= TO.m)) {
    yield { start: `${y}-${pad(m)}-01`, end: `${y}-${pad(m)}-15` };
    if (y === TO.y && m === TO.m && !TO.lastHalf) break;
    const ld = lastDay(y, m);
    yield { start: `${y}-${pad(m)}-16`, end: `${y}-${pad(m)}-${pad(ld)}` };
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
}

async function main() {
  await ensurePayStubSchema();

  const { rows: emps } = await pool.query(
    `SELECT id, name, hourly_rate FROM employees
     WHERE active IS DISTINCT FROM false
       AND (name ILIKE 'mehdi%' OR name ILIKE '%mehdi%')
     ORDER BY id LIMIT 1`
  );
  const mehdi = emps[0];
  if (!mehdi) throw new Error('Employé Mehdi introuvable');

  await pool.query(
    `UPDATE employees SET
       hourly_rate = $1,
       address_line1 = COALESCE(NULLIF(address_line1, ''), '4842 Rue Fabre'),
       city = COALESCE(NULLIF(city, ''), 'Montréal'),
       province = COALESCE(NULLIF(province, ''), 'QC'),
       postal_code = COALESCE(NULLIF(postal_code, ''), 'H2J 3W2')
     WHERE id = $2`,
    [RATE, mehdi.id]
  );

  const periods = [...biMonthlyPeriods()];
  console.log(
    `Mehdi #${mehdi.id} — ${ANNUAL_SALARY} $/an → ${GROSS} $ × ${periods.length} paies (${RATE} $/h × ${HOURS} h)`
  );

  let ytd = { gross: 0, net: 0, hours: 0, deductions: {}, earnings: 0 };
  const summary = [];
  const pdfDir = path.resolve(__dirname, '../../.tmp/talons-mehdi');
  fs.mkdirSync(pdfDir, { recursive: true });

  for (let i = 0; i < periods.length; i++) {
    const { start, end } = periods[i];
    const isCurrent = i === periods.length - 1;
    const status = isCurrent ? 'open' : 'paid';
    const payDate = defaultPayDate(end);

    const { rows: periodRows } = await pool.query(
      `INSERT INTO payroll_periods (start_date, end_date, status, pay_date, paid_at, notes, updated_at)
       VALUES ($1::date, $2::date, $3, $4::date,
               CASE WHEN $3 = 'paid' THEN $4::timestamptz ELSE NULL END,
               $5, NOW())
       ON CONFLICT (start_date, end_date) DO UPDATE SET
         status = EXCLUDED.status,
         pay_date = EXCLUDED.pay_date,
         paid_at = EXCLUDED.paid_at,
         notes = EXCLUDED.notes,
         updated_at = NOW()
       RETURNING id`,
      [start, end, status, payDate, `Salaire annuel ${ANNUAL_SALARY} $ — historique Mehdi`]
    );
    const periodId = periodRows[0].id;

    const breakdown = computePayrollDeductions({
      gross: GROSS,
      hours: HOURS,
      rate: RATE,
      year: TAX_YEAR,
      periodsPerYear: PERIODS_PER_YEAR,
      ytd,
    });
    const net = breakdown.net;
    ytd = mergeYtd(ytd, breakdown);

    await pool.query(
      `INSERT INTO payroll_lines (
         period_id, employee_id, hours_worked, hours_scheduled, hourly_rate,
         gross, deductions, advances, net, source_breakdown, notes,
         deduction_breakdown, breakdown_locked
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,0,$8,$9::jsonb,$10,$11::jsonb,true)
       ON CONFLICT (period_id, employee_id) DO UPDATE SET
         hours_worked = EXCLUDED.hours_worked,
         hours_scheduled = EXCLUDED.hours_scheduled,
         hourly_rate = EXCLUDED.hourly_rate,
         gross = EXCLUDED.gross,
         deductions = EXCLUDED.deductions,
         advances = 0,
         net = EXCLUDED.net,
         source_breakdown = EXCLUDED.source_breakdown,
         notes = EXCLUDED.notes,
         deduction_breakdown = EXCLUDED.deduction_breakdown,
         breakdown_locked = true`,
      [
        periodId,
        mehdi.id,
        HOURS,
        HOURS,
        RATE,
        GROSS,
        breakdown.totalDeductions,
        net,
        JSON.stringify({
          hours_logbook: 0,
          hours_time_entries: 0,
          hours_scheduled_shifts: HOURS,
          salary_annual: ANNUAL_SALARY,
          seeded: true,
        }),
        `Salaire ${ANNUAL_SALARY} $/an — ${start} → ${end}`,
        JSON.stringify(breakdown),
      ]
    );

    const stub = await buildPayStub(periodId, mehdi.id);
    const pdfName = `talon-Mehdi-${end}.pdf`;
    const pdfPath = path.join(pdfDir, pdfName);
    await new Promise((resolve, reject) => {
      const out = fs.createWriteStream(pdfPath);
      out.on('finish', resolve);
      out.on('error', reject);
      try {
        generatePayStubPdf(stub, out);
      } catch (err) {
        reject(err);
      }
    });

    summary.push({
      periodId,
      period: `${start} → ${end}`,
      status,
      gross: GROSS,
      net,
      ytdGross: ytd.gross,
      ytdNet: ytd.net,
      pdf: pdfName,
    });
    console.log(
      `✓ ${start}→${end}  brut ${GROSS}  net ${net}  CDA ${ytd.gross}  [${status}] → ${pdfName}`
    );
  }

  console.log('\n=== Cumul CDA final ===');
  console.log(JSON.stringify(ytd, null, 2));
  console.log(`\nPDFs → ${pdfDir}`);
  fs.writeFileSync(path.join(pdfDir, 'summary.json'), JSON.stringify({ ytd, summary }, null, 2));

  await pool.end();
}

main().catch(async (err) => {
  console.error(err);
  try { await pool.end(); } catch { /* ignore */ }
  process.exit(1);
});

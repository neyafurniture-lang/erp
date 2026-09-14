import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  calcQppEmployee,
  calcQpipEmployee,
  computePayrollDeductions,
  periodsPerYearFromDates,
  round2,
} from './payroll-qc.js';

test('période bihebdomadaire → 26 paies/an', () => {
  assert.equal(periodsPerYearFromDates('2025-06-12', '2025-06-25'), 26);
});

test('période bimensuelle → 24 paies/an', () => {
  assert.equal(periodsPerYearFromDates('2025-06-01', '2025-06-15'), 24);
});

test('RRQ salarié — référence QuickBooks 560 $ brut', () => {
  const qpp = calcQppEmployee(560, { year: 2025, periodsPerYear: 26 });
  assert.equal(qpp, 27.22);
});

test('RQAP — référence QuickBooks 560 $ brut', () => {
  const qpip = calcQpipEmployee(560, { year: 2025 });
  assert.equal(qpip, 2.77);
});

test('breakdown complet — net référence ~522.67 sans impôt', () => {
  const b = computePayrollDeductions({
    gross: 560,
    hours: 28,
    rate: 20,
    year: 2025,
    periodsPerYear: 26,
    overrides: { ei: 7.34, fed_tax: 0, qc_tax: 0 },
  });
  assert.equal(b.gross, 560);
  assert.equal(b.deductions.find(d => d.code === 'qpp').employee, 27.22);
  assert.equal(b.deductions.find(d => d.code === 'qpip').employee, 2.77);
  assert.equal(b.deductions.find(d => d.code === 'ei').employee, 7.34);
  assert.equal(b.totalDeductions, round2(7.34 + 27.22 + 2.77));
  assert.equal(b.net, 522.67);
});

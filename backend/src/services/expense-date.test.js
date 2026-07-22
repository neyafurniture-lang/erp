import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizePurchaseDate,
  extractDateFromText,
  todayISODate,
  resolveExpenseDate,
} from './expense-date.js';

describe('expense-date', () => {
  it('normalise ISO et datetime', () => {
    assert.equal(normalizePurchaseDate('2026-07-15'), '2026-07-15');
    assert.equal(normalizePurchaseDate('2026-07-15T18:30:00.000Z'), '2026-07-15');
  });

  it('normalise JJ/MM/AAAA (Québec)', () => {
    assert.equal(normalizePurchaseDate('15/07/2026'), '2026-07-15');
    assert.equal(normalizePurchaseDate('15-07-2026'), '2026-07-15');
    assert.equal(normalizePurchaseDate('05/03/2026'), '2026-03-05');
  });

  it('détecte MM/DD quand le jour > 12', () => {
    assert.equal(normalizePurchaseDate('07/15/2026'), '2026-07-15');
  });

  it('extrait depuis texte ticket', () => {
    assert.equal(extractDateFromText('TOTAL 45.20$ Date: 15/07/2026 Merci'), '2026-07-15');
    assert.equal(extractDateFromText('Home Depot 2026-06-01 Rona'), '2026-06-01');
  });

  it('todayISODate est YYYY-MM-DD', () => {
    assert.match(todayISODate(), /^\d{4}-\d{2}-\d{2}$/);
  });

  it('resolveExpenseDate corrige une date trop ancienne (OCR)', () => {
    const r = resolveExpenseDate('2026-02-09', { referenceDate: '2026-07-21', maxDaysPast: 60 });
    assert.equal(r.date, '2026-07-21');
    assert.equal(r.adjusted, true);
    assert.equal(r.original, '2026-02-09');
    assert.equal(r.reason, 'too_old');
  });

  it('resolveExpenseDate garde une date récente', () => {
    const r = resolveExpenseDate('2026-07-17', { referenceDate: '2026-07-21', maxDaysPast: 60 });
    assert.equal(r.date, '2026-07-17');
    assert.equal(r.adjusted, false);
  });

  it('resolveExpenseDate refuse le futur lointain', () => {
    const r = resolveExpenseDate('2026-12-01', { referenceDate: '2026-07-21' });
    assert.equal(r.date, '2026-07-21');
    assert.equal(r.reason, 'future');
  });
});

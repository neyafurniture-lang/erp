import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DateOwner,
  addDays,
  buildCalendar,
  configurationParameters,
  isoDate,
  monthConfiguration,
  noon,
  numberOfInDatesForMonth,
  visibleCells,
  weekCells,
  weekConfiguration,
} from './jtapple-calendar.js';

test('in-dates : lundi, 1er septembre 2026 = mardi → 1 jour', () => {
  assert.equal(numberOfInDatesForMonth(noon(2026, 8, 1), 'monday'), 1);
});

test('in-dates : lundi, 1er janvier 2026 = jeudi → 3 jours', () => {
  assert.equal(numberOfInDatesForMonth(noon(2026, 0, 1), 'monday'), 3);
});

test('mois septembre 2026 : grille 6×7, hors mois estompables, sans trou', () => {
  const built = buildCalendar(monthConfiguration(noon(2026, 8, 1), noon(2026, 8, 30)));
  const cells = visibleCells(built, '2026-09-29', 6);
  assert.equal(cells.length, 42);
  assert.equal(cells[0].key, '2026-08-31');
  assert.equal(cells[0].owner, DateOwner.previousMonthOutsideBoundary);
  assert.equal(cells[1].key, '2026-09-01');
  assert.equal(cells[1].owner, DateOwner.thisMonth);
  assert.equal(cells[30].key, '2026-09-30');
  assert.equal(cells[31].key, '2026-10-01');
  assert.equal(cells[31].owner, DateOwner.followingMonthOutsideBoundary);
  const keys = cells.map(cell => cell.key);
  assert.equal(new Set(keys).size, 42);
});

test('semaine : jours continus, sans répétition, ancrés sur le lundi', () => {
  const built = buildCalendar(weekConfiguration(noon(2026, 0, 1), noon(2026, 2, 31)));
  assert.equal(built.cells[0].key, '2025-12-29');
  const keys = built.cells.map(cell => cell.key);
  assert.equal(new Set(keys).size, keys.length);
  for (let i = 1; i < keys.length; i += 1) {
    const prev = built.cells[i - 1].date;
    const next = built.cells[i].date;
    assert.equal(isoDate(addDays(prev, 1)), next && isoDate(next));
  }
  const january = built.cells.filter(cell => cell.key.startsWith('2026-01') && cell.owner === DateOwner.thisMonth);
  assert.equal(january.length, 31);
  const week = weekCells(built, '2026-01-31');
  assert.deepEqual(week.map(cell => cell.key), [
    '2026-01-26', '2026-01-27', '2026-01-28', '2026-01-29', '2026-01-30', '2026-01-31', '2026-02-01',
  ]);
});

test('semaine du 29 septembre 2026 : 28 sept. → 4 oct., une seule fois', () => {
  const built = buildCalendar(weekConfiguration(noon(2026, 7, 1), noon(2026, 10, 30)));
  const week = visibleCells(built, '2026-09-29', 1);
  assert.deepEqual(week.map(cell => cell.key), [
    '2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04',
  ]);
});

test('numberOfRows hors 1…6 retombe sur 6, et la semaine n’a pas de frontières strictes', () => {
  const month = configurationParameters({
    startDate: noon(2026, 8, 1),
    endDate: noon(2026, 8, 30),
    numberOfRows: 0,
  });
  assert.equal(month.numberOfRows, 6);
  assert.equal(month.hasStrictBoundaries, true);
  const week = weekConfiguration(noon(2026, 8, 1), noon(2026, 8, 30));
  assert.equal(week.numberOfRows, 1);
  assert.equal(week.hasStrictBoundaries, false);
  assert.equal(week.generateOutDates, 'off');
  assert.equal(week.generateInDates, 'forFirstMonthOnly');
});

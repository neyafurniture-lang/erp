import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isClearingHoursLogbook,
  applyHoursLogbookToMeta,
  restoreHoursLogbookFromPrev,
} from './hours-logbook.js';

describe('hours-logbook', () => {
  it('détecte un effacement accidentel', () => {
    assert.equal(
      isClearingHoursLogbook({ rows: [{ dateKey: '2026-07-20', hours: { Mehdi: 4 } }] }, { rows: [] }),
      true
    );
    assert.equal(
      isClearingHoursLogbook({ rows: [{ dateKey: '2026-07-20' }] }, { rows: [], confirm_clear: true }),
      false
    );
  });

  it('bloque l’écrasement vide et conserve les données', () => {
    const existing = {
      hours_logbook: {
        rows: [{ dateKey: '2026-07-20', hours: { Mehdi: 3 } }],
        people: ['Mehdi'],
      },
    };
    const result = applyHoursLogbookToMeta(existing, { rows: [] });
    assert.equal(result.blocked, true);
    assert.equal(result.meta.hours_logbook.rows.length, 1);
  });

  it('sauvegarde prev puis restaure', () => {
    const meta = {
      hours_logbook: {
        rows: [{ dateKey: '2026-07-20', hours: { Mehdi: 5 } }],
        people: ['Mehdi'],
      },
    };
    const saved = applyHoursLogbookToMeta(meta, {
      rows: [{ dateKey: '2026-07-21', hours: { Mehdi: 2 } }],
      people: ['Mehdi'],
    });
    assert.equal(saved.blocked, false);
    assert.equal(saved.meta.hours_logbook_prev.rows[0].dateKey, '2026-07-20');
    assert.equal(saved.meta.hours_logbook.rows[0].dateKey, '2026-07-21');

    const restored = restoreHoursLogbookFromPrev(saved.meta);
    assert.equal(restored.ok, true);
    assert.equal(restored.meta.hours_logbook.rows[0].dateKey, '2026-07-20');
  });
});

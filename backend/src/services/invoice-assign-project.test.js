import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAssignProjectId } from './invoice-email-router.js';

describe('normalizeAssignProjectId', () => {
  it('accepte un id projet numérique', () => {
    assert.equal(normalizeAssignProjectId(12), 12);
    assert.equal(normalizeAssignProjectId('7'), 7);
  });

  it('autorise les factures hors projet (frais atelier)', () => {
    assert.equal(normalizeAssignProjectId(null), null);
    assert.equal(normalizeAssignProjectId(''), null);
    assert.equal(normalizeAssignProjectId('null'), null);
    assert.equal(normalizeAssignProjectId('none'), null);
    assert.equal(normalizeAssignProjectId(0), null);
    assert.equal(normalizeAssignProjectId(-1), null);
  });
});

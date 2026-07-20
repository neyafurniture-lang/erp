import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildGmailSearchQuery } from './mail-search-query.js';

describe('buildGmailSearchQuery', () => {
  it('extrait olive + facture', () => {
    const q = buildGmailSearchQuery('cherche la facture dans les mail, celle du mail de olive');
    assert.match(q, /olive/i);
    assert.match(q, /facture|facturation|invoice/i);
  });

  it('utilise params.query si fourni', () => {
    assert.equal(buildGmailSearchQuery('x', { query: 'from:olive subject:facturation' }), 'from:olive subject:facturation');
  });
});

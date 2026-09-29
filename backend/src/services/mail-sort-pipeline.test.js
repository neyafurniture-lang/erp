import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeHeaderBulkScore,
  staticRuleCategory,
  DECISION_SOURCE,
  normalizeHeaderMap,
} from './mail-sort-pipeline.js';
import { classifyMailMessage } from './mail-sort.js';

describe('computeHeaderBulkScore (inbox-zero style)', () => {
  it('détecte un envoi bulk via List-Unsubscribe + Precedence', () => {
    const map = normalizeHeaderMap([
      { name: 'List-Unsubscribe', value: '<mailto:unsub@x.com>' },
      { name: 'Precedence', value: 'bulk' },
    ]);
    const { score, isStrongBulk } = computeHeaderBulkScore(map);
    assert.ok(score < 0.35);
    assert.equal(isStrongBulk, true);
  });

  it('laisse un mail direct proche du baseline', () => {
    const map = normalizeHeaderMap([{ name: 'Subject', value: 'Devis table chêne' }]);
    const { isStrongBulk } = computeHeaderBulkScore(map);
    assert.equal(isStrongBulk, false);
  });
});

describe('staticRuleCategory', () => {
  it('classe leevalleynews en promotions', () => {
    assert.equal(staticRuleCategory('updates@email.leevalleynews.com'), 'promotions');
  });
});

describe('resolveMailCategory header tier', () => {
  it('force promotions sur bulk headers sans client', async () => {
    const { resolveMailCategory } = await import('./mail-sort-pipeline.js');
    const result = await resolveMailCategory(
      {
        from: 'Shop <news@esp.example.com>',
        subject: 'Soldes',
        snippet: 'Profitez',
        labelIds: [],
        headers: {
          'list-unsubscribe': '<http://x>',
          precedence: 'bulk',
          'x-mailer': 'MailChimp Mailer',
        },
        manuallyStarred: false,
        matchedClientEmail: false,
        mustPassHuman: false,
        hardInvoice: false,
        isOutbound: false,
      },
      classifyMailMessage
    );
    assert.equal(result.category, 'promotions');
    assert.equal(result.source, DECISION_SOURCE.HEADER_BULK);
  });
});

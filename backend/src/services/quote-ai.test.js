import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { applySpellcheckCorrections, catalogPriceHints } from './quote-ai.js';

describe('applySpellcheckCorrections', () => {
  const quote = {
    title: 'Devis table chene',
    reference: '',
    notes: 'Fabrication sur mesure.',
    additional_notes: '',
    lines: {
      version: 2,
      sections: [{
        id: 'sec_1',
        title: 'Travaux',
        lines: [
          { description: 'Table chene massif', qty: 1, price: 2400 },
          { description: 'Livraison', qty: 1, price: 150 },
        ],
      }],
      additional_notes: '',
    },
  };

  it('corrige titre et descriptions sans toucher aux prix', () => {
    const result = applySpellcheckCorrections(quote, {
      title: 'Devis table chêne',
      notes: 'Fabrication sur mesure.',
      sections: [{
        title: 'Travaux',
        lines: [
          { description: 'Table chêne massif' },
          { description: 'Livraison' },
        ],
      }],
    });
    assert.equal(result.title, 'Devis table chêne');
    assert.equal(result.document.sections[0].lines[0].description, 'Table chêne massif');
    assert.equal(result.document.sections[0].lines[0].price, 2400);
    assert.equal(result.document.sections[0].lines[1].price, 150);
    assert.equal(result.changes.length, 2);
  });

  it('ne change rien si le texte est identique', () => {
    const result = applySpellcheckCorrections(quote, {
      title: 'Devis table chene',
      notes: 'Fabrication sur mesure.',
      sections: [{
        title: 'Travaux',
        lines: [
          { description: 'Table chene massif' },
          { description: 'Livraison' },
        ],
      }],
    });
    assert.equal(result.changes.length, 0);
  });
});

describe('catalogPriceHints', () => {
  it('expose le catalogue atelier', () => {
    const hints = catalogPriceHints();
    assert.ok(hints.length >= 3);
    assert.ok(hints.some(h => /L3|planche/i.test(`${h.sku} ${h.name}`)));
  });
});

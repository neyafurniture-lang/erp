import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  sectionSubtotal,
  flattenQuoteLines,
  normalizeQuoteDocument,
} from './quote-document.js';

describe('sectionSubtotal', () => {
  it('somme qty × prix des lignes significatives', () => {
    const total = sectionSubtotal({
      title: 'Fabrication',
      lines: [
        { description: 'Banc', qty: 2, price: 1000 },
        { description: 'Finition', qty: 1, price: 400 },
        { description: '   ', qty: 5, price: 999 },
      ],
    });
    assert.equal(total, 2400);
  });

  it('retourne 0 sans lignes utiles', () => {
    assert.equal(sectionSubtotal({ lines: [{ description: '', qty: 1, price: 10 }] }), 0);
    assert.equal(sectionSubtotal(null), 0);
  });

  it('les sous-totaux de tableaux additionnent le sous-total document', () => {
    const doc = normalizeQuoteDocument({
      version: 2,
      sections: [
        {
          title: 'Fabrication',
          lines: [
            { description: 'Caissons', qty: 1, price: 2000 },
            { description: 'Portes', qty: 2, price: 350 },
          ],
        },
        {
          title: 'Livraison',
          lines: [{ description: 'Livraison Montréal', qty: 1, price: 250 }],
        },
      ],
    });
    const a = sectionSubtotal(doc.sections[0]);
    const b = sectionSubtotal(doc.sections[1]);
    const flat = flattenQuoteLines(doc).reduce(
      (s, l) => s + (Number(l.qty) || 0) * (Number(l.price) || 0),
      0
    );
    assert.equal(a, 2700);
    assert.equal(b, 250);
    assert.equal(a + b, flat);
  });
});

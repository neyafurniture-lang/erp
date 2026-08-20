import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildQuoteDocumentFromAi, normalizeTasksFromAi } from './quote-from-brief.js';

describe('buildQuoteDocumentFromAi', () => {
  it('construit des sections avec prix et photos', () => {
    const doc = buildQuoteDocumentFromAi({
      sections: [{
        title: 'Fabrication',
        lines: [
          { description: 'Table chêne', qty: 1, price: 2800 },
          { description: '  ', qty: 1, price: 10 },
        ],
      }],
      additional_notes: 'Hors livraison',
    }, { photos: [{ url: '/uploads/quotes/a.jpg', caption: 'salon' }] });

    assert.equal(doc.sections[0].title, 'Fabrication');
    assert.equal(doc.sections[0].lines.length, 1);
    assert.equal(doc.sections[0].lines[0].price, 2800);
    assert.equal(doc.photos[0].url, '/uploads/quotes/a.jpg');
    assert.match(doc.additional_notes, /livraison/i);
  });

  it('accepte un tableau plat lines', () => {
    const doc = buildQuoteDocumentFromAi({
      lines: [{ description: 'Livraison', qty: 1, price: 150 }],
    });
    assert.equal(doc.sections[0].lines[0].description, 'Livraison');
  });
});

describe('normalizeTasksFromAi', () => {
  it('filtre et type les tâches', () => {
    const tasks = normalizeTasksFromAi({
      tasks: [
        { title: 'Débitage plateaux', type: 'debitage', estimated_minutes: 90 },
        { title: 'x' },
        { title: 'Sablage et huile Osmo' },
      ],
    });
    assert.equal(tasks.length, 2);
    assert.equal(tasks[0].type, 'debitage');
    assert.equal(tasks[1].type, 'finition');
  });
});

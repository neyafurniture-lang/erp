import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  expandPiecesForSku,
  framesNotReachedStage,
  computeSierraMissing,
  enrichTrackerRow,
  traverseList,
  formatTraversesLabel,
} from './sauna-cloud.js';

describe('Sierra cutting missing pieces', () => {
  it('compte 8 pièces pour 1× H2013 (2L+2S+2T13+2T20)', () => {
    const exp = expandPiecesForSku('H2013', 1);
    assert.equal(exp.pieces, 8);
    assert.equal(exp.traverses, 4);
    assert.equal(exp.by_length['33 cm'], 4); // 2 longs + 2 trav 13"
    assert.equal(exp.by_length['50.8 cm'], 4); // 2 shorts + 2 trav 20"
  });

  it('traverseList expose 2 longueurs par frame', () => {
    const list = traverseList({
      traverses: [
        { length_in: 13, count: 2 },
        { length_in: 26, count: 2 },
      ],
    });
    assert.equal(list.length, 2);
    assert.equal(formatTraversesLabel({ traverses: list }), '33 cm×2 + 66 cm×2');
  });

  it('framesNotReachedStage respecte le pipeline', () => {
    const row = {
      qty: 20,
      counts: { debited: 5, in_progress: 3, done: 2, delivered: 1 },
    };
    assert.equal(framesNotReachedStage(row, 'delivered'), 19); // 20-1
    assert.equal(framesNotReachedStage(row, 'done'), 17); // 20-(2+1)
    assert.equal(framesNotReachedStage(row, 'debited'), 9); // 20-(5+3+2+1)
  });

  it('computeSierraMissing baisse les pièces à couper quand on débite', () => {
    const before = computeSierraMissing([
      { sku: 'H2013', label: '20×13', qty: 20, counts: { debited: 0, in_progress: 0, done: 0, delivered: 0 } },
    ]);
    assert.equal(before.to_cut.frames, 20);
    assert.equal(before.to_cut.pieces, 20 * 8);

    const after = computeSierraMissing([
      { sku: 'H2013', label: '20×13', qty: 20, counts: { debited: 10, in_progress: 0, done: 0, delivered: 0 } },
    ]);
    assert.equal(after.to_cut.frames, 10);
    assert.equal(after.to_cut.pieces, 10 * 8);
  });

  it('enrichTrackerRow expose pieces_missing, côtés et traverses', () => {
    const row = enrichTrackerRow({
      sku: 'H3726',
      qty: 10,
      counts: { debited: 0, in_progress: 0, done: 0, delivered: 2 },
    });
    // 8 remaining × (2+2+4) = 64 ; 8×4 côtés ; 8×4 traverses
    assert.equal(row.remaining, 8);
    assert.equal(row.pieces_per_frame, 8);
    assert.equal(row.sides_per_frame, 4);
    assert.equal(row.traverses_per_frame, 4);
    assert.equal(row.pieces_missing, 64);
    assert.equal(row.sides_missing, 32);
    assert.equal(row.traverses_missing, 32);
  });

  it('H2013 : 4 côtés + 4 traverses (2×13 + 2×20)', () => {
    const row = enrichTrackerRow({
      sku: 'H2013',
      qty: 20,
      counts: { debited: 0, in_progress: 0, done: 0, delivered: 0 },
    });
    assert.equal(row.sides_per_frame, 4);
    assert.equal(row.traverses_per_frame, 4);
    assert.equal(row.sides_missing, 80);
    assert.equal(row.traverses_missing, 80);
  });

  it('aggregatePieceSizes regroupe les tailles côtés / traverses', async () => {
    const { aggregatePieceSizes } = await import('./sauna-cloud.js');
    const frames = [
      { sku: 'H2013', qty: 20 },
      { sku: 'H2026', qty: 10 },
    ];
    const sides = aggregatePieceSizes(frames, 'sides');
    const trav = aggregatePieceSizes(frames, 'traverses');
    // côtés 20": H2013 40 + H2026 20 = 60
    const side20 = sides.find((r) => r.length === '50.8 cm');
    assert.ok(side20);
    assert.equal(side20.qty, 60);
    // trav 20": H2013 40 + H2026 20 = 60 ; trav 26": H2026 20
    const trav20 = trav.find((r) => r.length === '50.8 cm');
    assert.equal(trav20.qty, 60);
    const trav26 = trav.find((r) => r.length === '66 cm');
    assert.equal(trav26.qty, 20);
    const trav13 = trav.find((r) => r.length === '33 cm');
    assert.equal(trav13.qty, 40); // H2013 only
  });

  it('formatLengthCm convertit pouces → cm', async () => {
    const { formatLengthCm, normalizeLengthKey } = await import('./sauna-cloud.js');
    assert.equal(formatLengthCm(20), '50.8 cm');
    assert.equal(formatLengthCm(13), '33 cm');
    assert.equal(normalizeLengthKey('20"'), '50.8 cm');
    assert.equal(normalizeLengthKey('50.8 cm'), '50.8 cm');
  });

  it('expose côtés/traverses débités (colonne) et déjà coupés', () => {
    const row = enrichTrackerRow({
      sku: 'H2013',
      qty: 20,
      counts: { debited: 5, in_progress: 3, done: 0, delivered: 0 },
    });
    // 5 en colonne Débité × 4 côtés / 4 trav.
    assert.equal(row.sides_debited, 20);
    assert.equal(row.traverses_debited, 20);
    // 8 placées (≥ débité) × 4 / 4
    assert.equal(row.sides_cut, 32);
    assert.equal(row.traverses_cut, 32);
  });

  it('computeSierraMissing.cut = commande − à couper', () => {
    const sierra = computeSierraMissing([
      { sku: 'H2013', label: '20×13', qty: 20, counts: { debited: 10, in_progress: 0, done: 0, delivered: 0 } },
    ]);
    assert.equal(sierra.to_cut.frames, 10);
    assert.equal(sierra.to_cut.sides, 40); // 10×4
    assert.equal(sierra.to_cut.traverses, 40); // 10×4
    assert.equal(sierra.cut.frames, 10);
    assert.equal(sierra.cut.sides, 40);
    assert.equal(sierra.cut.traverses, 40);
  });
});

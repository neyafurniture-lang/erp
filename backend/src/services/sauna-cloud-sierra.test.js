import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  expandPiecesForSku,
  framesNotReachedStage,
  computeSierraMissing,
  enrichTrackerRow,
} from './sauna-cloud.js';

describe('Sierra cutting missing pieces', () => {
  it('compte 6 pièces pour 1× H2013 (2L+2S+2T)', () => {
    const exp = expandPiecesForSku('H2013', 1);
    assert.equal(exp.pieces, 6);
    assert.equal(exp.by_length['13"'], 2);
    assert.equal(exp.by_length['20"'], 4); // 2 shorts + 2 traverses
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
    assert.equal(before.to_cut.pieces, 20 * 6);

    const after = computeSierraMissing([
      { sku: 'H2013', label: '20×13', qty: 20, counts: { debited: 10, in_progress: 0, done: 0, delivered: 0 } },
    ]);
    assert.equal(after.to_cut.frames, 10);
    assert.equal(after.to_cut.pieces, 10 * 6);
  });

  it('enrichTrackerRow expose pieces_missing', () => {
    const row = enrichTrackerRow({
      sku: 'H3726',
      qty: 10,
      counts: { debited: 0, in_progress: 0, done: 0, delivered: 2 },
    });
    // 8 remaining × (2+2+4) = 64
    assert.equal(row.remaining, 8);
    assert.equal(row.pieces_per_frame, 8);
    assert.equal(row.pieces_missing, 64);
  });
});

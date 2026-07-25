import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  canPreview,
  getPreviewMode,
  googleEmbedUrl,
  parseCsvPreview,
} from './drive-preview.js';

describe('drive-preview tableurs', () => {
  it('utilise docs.google.com pour Google Sheets (pas file/d/preview)', () => {
    const url = googleEmbedUrl({
      id: 'abc123',
      mimeType: 'application/vnd.google-apps.spreadsheet',
    });
    assert.equal(url, 'https://docs.google.com/spreadsheets/d/abc123/preview');
  });

  it('prévisualise xlsx / csv', () => {
    assert.equal(
      getPreviewMode({
        id: '1',
        name: 'prix.xlsx',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }),
      'office'
    );
    assert.equal(
      getPreviewMode({ id: '2', name: 'export.csv', mimeType: 'text/csv' }),
      'csv'
    );
    assert.equal(canPreview({ id: '1', name: 'a.xlsx', mimeType: 'application/vnd.ms-excel' }), true);
  });

  it('parseCsvPreview gère guillemets et colonnes', () => {
    const rows = parseCsvPreview('sku,qty\n"H2013, special",20\nH3726,10\n');
    assert.equal(rows.length, 3);
    assert.deepEqual(rows[0], ['sku', 'qty']);
    assert.deepEqual(rows[1], ['H2013, special', '20']);
    assert.deepEqual(rows[2], ['H3726', '10']);
  });
});

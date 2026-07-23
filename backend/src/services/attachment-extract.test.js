import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'zlib';
import {
  extractPdfStrings,
  inflatePdfStreams,
  isReadablePdfChunk,
  sanitizePdfExtractText,
} from './attachment-extract.js';

describe('PDF extract sanitization', () => {
  it('rejette les chunks binaires', () => {
    assert.equal(isReadablePdfChunk('Olive Richardson'), true);
    assert.equal(isReadablePdfChunk('\x00\x01\x02\x03\x04binary'), false);
    assert.equal(isReadablePdfChunk('x'), false);
  });

  it('nettoie un extrait bruité (cas Facturation 46)', () => {
    const noisy = [
      'Richardson',
      'Olive',
      'olive_richardson@yahoo.com',
      '\x00\x1f\x08\x12\x00gzipgarbage\x00\xff\xfe',
      'BT /F1 12 Tf (ok) Tj ET',
    ].join('\n');
    const clean = sanitizePdfExtractText(noisy);
    assert.match(clean, /Richardson/);
    assert.match(clean, /Olive/);
    assert.match(clean, /olive_richardson@yahoo\.com/);
    assert.doesNotMatch(clean, /\x00/);
    assert.doesNotMatch(clean, /gzipgarbage/);
  });

  it('extrait du texte PDF non compressé', () => {
    const pdf = Buffer.from(
      '%PDF-1.4\n'
      + 'BT /F1 12 Tf 100 700 Td (Olive Richardson) Tj ET\n'
      + 'BT (olive_richardson@yahoo.com) Tj ET\n'
      + '%%EOF\n',
      'latin1'
    );
    const text = extractPdfStrings(pdf);
    assert.match(text, /Olive Richardson/);
    assert.match(text, /olive_richardson@yahoo\.com/);
  });

  it('décompresse FlateDecode puis lit les littéraux', () => {
    const content = 'BT /F1 12 Tf (Facturation 46 - Olive Richardson) Tj ET';
    const compressed = zlib.deflateSync(Buffer.from(content, 'latin1'));
    const pdf = Buffer.concat([
      Buffer.from('%PDF-1.4\n1 0 obj<< /Filter /FlateDecode /Length '
        + compressed.length + ' >>stream\n', 'latin1'),
      compressed,
      Buffer.from('\nendstream\nendobj\n%%EOF\n', 'latin1'),
    ]);
    const inflated = inflatePdfStreams(pdf);
    assert.match(inflated, /Olive Richardson/);
    const text = extractPdfStrings(pdf);
    assert.match(text, /Olive Richardson/);
    assert.match(text, /Facturation 46/);
  });
});

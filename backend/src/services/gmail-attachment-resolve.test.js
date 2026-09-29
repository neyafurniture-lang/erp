import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractFileAttachments,
  resolveAttachmentPart,
  isSignatureOrInlineNoise,
} from './google-gmail.js';

describe('resolveAttachmentPart', () => {
  const payload = {
    mimeType: 'multipart/mixed',
    parts: [
      {
        filename: 'Facturation 46.pdf',
        mimeType: 'application/pdf',
        headers: [{ name: 'Content-Disposition', value: 'attachment; filename="Facturation 46.pdf"' }],
        body: { attachmentId: 'real-gmail-id-123', size: 2048 },
      },
    ],
  };

  it('trouve par attachmentId exact', () => {
    const resolved = resolveAttachmentPart(payload, { attachmentId: 'real-gmail-id-123' });
    assert.ok(resolved);
    assert.equal(resolved.attachmentId, 'real-gmail-id-123');
  });

  it('trouve par nom de fichier si l’ID est tronqué ou erroné', () => {
    const resolved = resolveAttachmentPart(payload, {
      attachmentId: 'wrong-id',
      filename: 'Facturation 46.pdf',
    });
    assert.ok(resolved);
    assert.equal(resolved.part.filename, 'Facturation 46.pdf');
  });

  it('trouve par nom de fichier passé comme attachmentId', () => {
    const resolved = resolveAttachmentPart(payload, { attachmentId: 'Facturation 46.pdf' });
    assert.ok(resolved);
    assert.equal(resolved.attachmentId, 'real-gmail-id-123');
  });

  it('ne devine PAS la PJ unique si un mauvais ID est fourni sans filename', () => {
    const resolved = resolveAttachmentPart(payload, { attachmentId: 'totally-wrong' });
    assert.equal(resolved, null);
  });

  it('détecte les PDF inline avec body.data', () => {
    const inlinePayload = {
      parts: [{
        mimeType: 'application/pdf',
        filename: 'devis.pdf',
        headers: [{ name: 'Content-Disposition', value: 'attachment; filename="devis.pdf"' }],
        body: { data: 'JVBERi0x', size: 8 },
      }],
    };
    const atts = extractFileAttachments(inlinePayload);
    assert.equal(atts.length, 1);
    assert.equal(atts[0].filename, 'devis.pdf');
    const resolved = resolveAttachmentPart(inlinePayload, { filename: 'devis.pdf' });
    assert.ok(resolved);
    assert.ok(resolved.part.body.data);
  });

  it('ignore image001.png CID signature', () => {
    const mixed = {
      mimeType: 'multipart/mixed',
      parts: [
        {
          filename: 'image001.png',
          mimeType: 'image/png',
          headers: [
            { name: 'Content-ID', value: '<img001@mail>' },
            { name: 'Content-Disposition', value: 'inline; filename="image001.png"' },
          ],
          body: { attachmentId: 'sig-id', size: 4200 },
        },
        {
          filename: 'Devis.pdf',
          mimeType: 'application/pdf',
          headers: [{ name: 'Content-Disposition', value: 'attachment; filename="Devis.pdf"' }],
          body: { attachmentId: 'pdf-id', size: 90000 },
        },
      ],
    };
    const atts = extractFileAttachments(mixed);
    assert.equal(atts.length, 1);
    assert.equal(atts[0].filename, 'Devis.pdf');
    assert.ok(isSignatureOrInlineNoise(mixed.parts[0], {
      filename: 'image001.png',
      mimeType: 'image/png',
      size: 4200,
    }));
  });

  it('résout un ID contenant un slash via filename', () => {
    const p = {
      parts: [{
        filename: 'plan.pdf',
        mimeType: 'application/pdf',
        headers: [{ name: 'Content-Disposition', value: 'attachment; filename="plan.pdf"' }],
        body: { attachmentId: 'abc/def+ghi==', size: 100 },
      }],
    };
    const resolved = resolveAttachmentPart(p, {
      attachmentId: 'abc', // tronqué
      filename: 'plan.pdf',
    });
    assert.ok(resolved);
    assert.equal(resolved.attachmentId, 'abc/def+ghi==');
  });
});

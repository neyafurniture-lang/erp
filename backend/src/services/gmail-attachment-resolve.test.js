import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractFileAttachments, resolveAttachmentPart } from './google-gmail.js';

describe('resolveAttachmentPart', () => {
  const payload = {
    mimeType: 'multipart/mixed',
    parts: [
      {
        filename: 'Facturation 46.pdf',
        mimeType: 'application/pdf',
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

  it('utilise la PJ unique si l’ID ne correspond pas', () => {
    const resolved = resolveAttachmentPart(payload, { attachmentId: 'totally-wrong' });
    assert.ok(resolved);
    assert.equal(resolved.attachmentId, 'real-gmail-id-123');
  });

  it('détecte les PDF inline avec body.data', () => {
    const inlinePayload = {
      parts: [{
        mimeType: 'application/pdf',
        filename: 'devis.pdf',
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
});

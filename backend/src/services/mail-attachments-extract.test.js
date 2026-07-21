import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// Test isolé de la logique d'extraction (copie minimale pour éviter deps OAuth)
function extractFileAttachments(payload, acc = []) {
  if (!payload) return acc;
  const filename = String(payload.filename || '').trim();
  const attachmentId = payload.body?.attachmentId;
  if (filename && attachmentId) {
    acc.push({
      id: attachmentId,
      filename,
      mimeType: payload.mimeType || 'application/octet-stream',
      size: Number(payload.body?.size) || 0,
    });
  }
  for (const part of payload.parts || []) extractFileAttachments(part, acc);
  return acc;
}

describe('extractFileAttachments', () => {
  it('ignore le corps text/html sans filename', () => {
    const payload = {
      mimeType: 'multipart/mixed',
      parts: [
        { mimeType: 'text/html', body: { attachmentId: 'body1', size: 100 } },
        {
          filename: 'plan.pdf',
          mimeType: 'application/pdf',
          body: { attachmentId: 'att1', size: 2048 },
        },
      ],
    };
    const atts = extractFileAttachments(payload);
    assert.equal(atts.length, 1);
    assert.equal(atts[0].filename, 'plan.pdf');
    assert.equal(atts[0].id, 'att1');
  });

  it('remonte les PJ nested multipart', () => {
    const payload = {
      parts: [{
        parts: [{
          filename: 'photo.jpg',
          mimeType: 'image/jpeg',
          body: { attachmentId: 'img1', size: 500 },
        }],
      }],
    };
    assert.equal(extractFileAttachments(payload).length, 1);
  });
});

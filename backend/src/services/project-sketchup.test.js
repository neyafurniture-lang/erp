import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isSketchupFile, isSketchupFilename } from './project-sketchup.js';

describe('project-sketchup helpers', () => {
  it('détecte .skp', () => {
    assert.equal(isSketchupFilename('Casino_Booth.skp'), true);
    assert.equal(isSketchupFilename('plan.pdf'), false);
  });

  it('détecte via mime ou nom', () => {
    assert.equal(isSketchupFile({ name: 'a.skp' }), true);
    assert.equal(isSketchupFile({ mimeType: 'application/vnd.sketchup.skp' }), true);
    assert.equal(isSketchupFile({ name: 'photo.jpg', mimeType: 'image/jpeg' }), false);
  });
});

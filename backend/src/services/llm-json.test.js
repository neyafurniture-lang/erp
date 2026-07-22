import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseLlmJson } from './llm-json.js';

describe('parseLlmJson', () => {
  it('parse un objet JSON simple', () => {
    const data = parseLlmJson('{"summary":"ok","key_points":[]}');
    assert.equal(data.summary, 'ok');
  });

  it('répare les retours à la ligne bruts dans une chaîne', () => {
    const raw = `{"summary": "ligne 1
ligne 2", "key_points": []}`;
    const data = parseLlmJson(raw);
    assert.match(data.summary, /ligne 1/);
  });
});

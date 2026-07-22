import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseLlmJson } from './llm-json.js';

describe('parseLlmJson', () => {
  it('parse un objet JSON simple', () => {
    const data = parseLlmJson('{"summary":"ok","key_points":[]}');
    assert.equal(data.summary, 'ok');
  });

  it('extrait un bloc markdown', () => {
    const data = parseLlmJson('Voici:\n```json\n{"summary":"mail","needs_response":true}\n```');
    assert.equal(data.summary, 'mail');
    assert.equal(data.needs_response, true);
  });

  it('répare les retours à la ligne bruts dans une chaîne', () => {
    const raw = `{
  "summary": "ligne 1
ligne 2",
  "key_points": [{"type":"info","text":"ok"}]
}`;
    const data = parseLlmJson(raw);
    assert.match(data.summary, /ligne 1/);
    assert.equal(data.key_points[0].text, 'ok');
  });

  it('répare un JSON tronqué en fermant les structures', () => {
    const raw = `{
  "summary": "partiel",
  "key_points": [{"type":"demande","text":"besoin devis"},
  "action_items": [{"text":"rappeler"`;
    const data = parseLlmJson(raw);
    assert.equal(data.summary, 'partiel');
    assert.ok(Array.isArray(data.key_points));
  });

  it('enlève les virgules traînantes', () => {
    const data = parseLlmJson('{"summary":"x","key_points":[{"type":"info","text":"a"},],}');
    assert.equal(data.summary, 'x');
    assert.equal(data.key_points.length, 1);
  });
});

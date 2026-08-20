/**
 * Parse / répare le JSON renvoyé par un LLM (Claude / OpenAI).
 * Gère fences markdown, troncature, virgules traînantes, caractères de contrôle.
 */

import {
  getAnthropicKey,
  getAnthropicModel,
  getOpenAIKey,
  getSetting,
  isAssistantAiEnabled,
} from './settings.js';

function stripFences(text) {
  let s = String(text || '').trim();
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) s = fenced[1].trim();
  return s;
}

function extractObjectSlice(text) {
  const s = stripFences(text);
  const start = s.indexOf('{');
  if (start < 0) return s;
  return s.slice(start);
}

/** Remplace les caractères de contrôle hors échappement JSON valide. */
function sanitizeControlChars(s) {
  let out = '';
  let inString = false;
  let escape = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    const code = ch.charCodeAt(0);
    if (inString) {
      if (escape) {
        out += ch;
        escape = false;
        continue;
      }
      if (ch === '\\') {
        out += ch;
        escape = true;
        continue;
      }
      if (ch === '"') {
        out += ch;
        inString = false;
        continue;
      }
      if (code < 0x20) {
        if (ch === '\n') out += '\\n';
        else if (ch === '\r') out += '\\r';
        else if (ch === '\t') out += '\\t';
        else out += ' ';
        continue;
      }
      out += ch;
      continue;
    }
    if (ch === '"') inString = true;
    out += ch;
  }
  return out;
}

function closeOpenStructures(cut) {
  let inString = false;
  let escape = false;
  let braces = 0;
  let brackets = 0;
  for (let i = 0; i < cut.length; i++) {
    const ch = cut[i];
    if (inString) {
      if (escape) escape = false;
      else if (ch === '\\') escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') braces++;
    else if (ch === '}') braces--;
    else if (ch === '[') brackets++;
    else if (ch === ']') brackets--;
  }
  if (inString) cut += '"';
  cut = cut.replace(/,\s*$/, '');
  while (brackets > 0) { cut += ']'; brackets--; }
  while (braces > 0) { cut += '}'; braces--; }
  return cut;
}

/**
 * Parse un objet JSON produit par un LLM.
 * @throws {Error} si impossible
 */
export function parseLlmJson(text) {
  let s = extractObjectSlice(text);
  if (!s) throw new Error('Réponse IA vide');

  const attempts = [
    s,
    sanitizeControlChars(s),
    sanitizeControlChars(s).replace(/,\s*([}\]])/g, '$1'),
  ];

  for (const candidate of attempts) {
    try {
      return JSON.parse(candidate);
    } catch { /* next */ }
  }

  // Coupe au dernier élément complet plausible puis ferme structures
  let cut = sanitizeControlChars(s);
  const lastGood = Math.max(
    cut.lastIndexOf('",'),
    cut.lastIndexOf('null,'),
    cut.lastIndexOf('true,'),
    cut.lastIndexOf('false,'),
    cut.lastIndexOf('},'),
    cut.lastIndexOf('],'),
  );
  if (lastGood > 20) {
    cut = cut.slice(0, lastGood + 1);
  }
  cut = cut.replace(/,\s*$/, '');
  cut = closeOpenStructures(cut);

  try {
    return JSON.parse(cut);
  } catch (err) {
    throw new Error(`JSON IA illisible (${err.message})`);
  }
}

/**
 * Appel Claude / OpenAI avec réponse JSON (objet).
 */
export async function callJsonLlm(prompt, {
  system = 'Tu es l’assistant NEYA Furniture (atelier Québec). Réponds UNIQUEMENT en JSON valide compact, sans markdown.',
  maxTokens = 4096,
} = {}) {
  if (!(await isAssistantAiEnabled())) {
    throw new Error('Assistant IA désactivé — activez-le dans Paramètres → Assistant IA');
  }

  const preferred = (await getSetting('ai_provider')) || 'anthropic';
  const errors = [];

  async function tryOpenAI(userPrompt) {
    const key = await getOpenAIKey();
    if (!key) return null;
    const model = (await getSetting('openai_model')) || 'gpt-4o-mini';
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        messages: [{ role: 'system', content: system }, { role: 'user', content: userPrompt }],
        response_format: { type: 'json_object' },
      }),
    });
    const raw = await res.text();
    if (!res.ok) throw new Error(`OpenAI ${res.status}: ${raw.slice(0, 180)}`);
    const data = JSON.parse(raw);
    return parseLlmJson(data.choices[0].message.content);
  }

  async function tryClaude(userPrompt) {
    const key = await getAnthropicKey();
    if (!key) return null;
    const model = await getAnthropicModel();
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        system,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });
    const raw = await res.text();
    if (!res.ok) throw new Error(`Claude ${res.status}: ${raw.slice(0, 180)}`);
    const data = JSON.parse(raw);
    const text = data.content?.find(b => b.type === 'text')?.text || data.content?.[0]?.text || '';
    return parseLlmJson(text);
  }

  async function runProvider(fn, label) {
    try {
      const first = await fn(prompt);
      if (first == null) return null;
      return first;
    } catch (e) {
      if (/JSON|parse|illisible|Expected/i.test(e.message)) {
        try {
          const second = await fn(`${prompt}\n\nIMPORTANT: JSON invalide précédent (${e.message}). Renvoie UNIQUEMENT un objet JSON valide.`);
          if (second == null) {
            errors.push(`${label}: ${e.message}`);
            return null;
          }
          return second;
        } catch (e2) {
          errors.push(`${label}: ${e2.message}`);
          return null;
        }
      }
      errors.push(`${label}: ${e.message}`);
      return null;
    }
  }

  const order = preferred === 'openai'
    ? [['OpenAI', tryOpenAI], ['Claude', tryClaude]]
    : [['Claude', tryClaude], ['OpenAI', tryOpenAI]];

  for (const [label, fn] of order) {
    const result = await runProvider(fn, label);
    if (result) return result;
  }

  if (!errors.length) {
    throw new Error('IA impossible — aucune clé API configurée (Claude / OpenAI)');
  }
  throw new Error(`IA impossible — ${errors.join(' | ')}`);
}

/**
 * Parse / répare le JSON renvoyé par un LLM (Claude / OpenAI).
 * Gère fences markdown, troncature, virgules traînantes, caractères de contrôle.
 */

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

  let cut = sanitizeControlChars(s);
  const lastGood = Math.max(
    cut.lastIndexOf('",'),
    cut.lastIndexOf('null,'),
    cut.lastIndexOf('true,'),
    cut.lastIndexOf('false,'),
    cut.lastIndexOf('},'),
    cut.lastIndexOf('],'),
  );
  if (lastGood > 20) cut = cut.slice(0, lastGood + 1);
  cut = cut.replace(/,\s*$/, '');
  cut = closeOpenStructures(cut);

  try {
    return JSON.parse(cut);
  } catch (err) {
    throw new Error(`JSON IA illisible (${err.message})`);
  }
}

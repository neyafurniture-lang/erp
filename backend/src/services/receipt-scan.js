import fs from 'fs';
import path from 'path';
import { getOpenAIKey, getAnthropicKey, getAnthropicModel, getSetting } from './settings.js';

const CATEGORY_HINT = 'materiaux|outils|transport|atelier|admin';

/** Prompt compact — pas de raw_text OCR (évite JSON tronqué / Unterminated string). */
const SCAN_PROMPT = `Tu analyses un ticket de caisse / reçu d'achat (Québec, français ou anglais).
Extrais les données et réponds UNIQUEMENT avec un objet JSON valide, sans markdown :
{
  "vendor": "nom du magasin",
  "amount": 0.00,
  "tax_tps": null,
  "tax_tvq": null,
  "date": "YYYY-MM-DD ou null",
  "category": "${CATEGORY_HINT}",
  "description": "résumé court des articles (max 120 caractères)",
  "payment_method": "carte|comptant|autre|null",
  "confidence": 0.0
}
Règles :
- amount = total TTC payé (nombre)
- category parmi materiaux|outils|transport|atelier|admin
- description courte, sans sauts de ligne ni guillemets non échappés
- confidence entre 0 et 1
- N'inclus PAS le texte OCR brut`;

function guessMime(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.pdf') return 'application/pdf';
  return 'image/jpeg';
}

function normalizeCategory(raw) {
  const c = String(raw || '').toLowerCase();
  if (['materiaux', 'matériaux', 'materials', 'bois', 'quincaillerie'].some(k => c.includes(k))) return 'materiaux';
  if (['outil', 'tools', 'equipment'].some(k => c.includes(k))) return 'outils';
  if (['transport', 'essence', 'gas', 'carburant', 'parking'].some(k => c.includes(k))) return 'transport';
  if (['atelier', 'shop', 'location'].some(k => c.includes(k))) return 'atelier';
  if (['admin', 'bureau', 'fourniture'].some(k => c.includes(k))) return 'admin';
  return 'materiaux';
}

function normalizeParsed(parsed) {
  return {
    vendor: parsed.vendor?.trim() || null,
    amount: parsed.amount != null && !Number.isNaN(Number(parsed.amount)) ? Number(parsed.amount) : null,
    tax_tps: parsed.tax_tps != null && !Number.isNaN(Number(parsed.tax_tps)) ? Number(parsed.tax_tps) : null,
    tax_tvq: parsed.tax_tvq != null && !Number.isNaN(Number(parsed.tax_tvq)) ? Number(parsed.tax_tvq) : null,
    date: parsed.date || null,
    category: normalizeCategory(parsed.category),
    description: String(parsed.description || parsed.vendor || 'Ticket de caisse').trim().slice(0, 240),
    payment_method: parsed.payment_method || null,
    raw_text: parsed.raw_text || '',
    confidence: parsed.confidence != null ? Number(parsed.confidence) : null,
    parsed_json: parsed,
  };
}

/** Répare un JSON tronqué (souvent mid-string après max_tokens). */
function repairTruncatedJson(text) {
  let s = String(text || '').trim();
  if (!s) throw new Error('Réponse IA vide');

  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) s = fenced[1].trim();

  const start = s.indexOf('{');
  if (start >= 0) s = s.slice(start);

  try {
    return JSON.parse(s);
  } catch {
    /* continue repair */
  }

  // Coupe au dernier champ complet plausible
  let cut = s;
  const lastGood = Math.max(
    cut.lastIndexOf('",'),
    cut.lastIndexOf('null,'),
    cut.lastIndexOf('true,'),
    cut.lastIndexOf('false,'),
    cut.lastIndexOf('},'),
    cut.search(/,\s*\d+(\.\d+)?\s*$/) >= 0 ? cut.length : -1,
  );
  if (lastGood > 20) {
    cut = cut.slice(0, lastGood + 1);
  }

  // Ferme les chaînes / objets ouverts
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
  // Enlève virgule traînante
  cut = cut.replace(/,\s*$/, '');
  while (brackets > 0) { cut += ']'; brackets--; }
  while (braces > 0) { cut += '}'; braces--; }

  try {
    return JSON.parse(cut);
  } catch (err) {
    // Dernier recours : champs clés via regex
    const pick = (key) => {
      const m = s.match(new RegExp(`"${key}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`));
      if (m) return m[1].replace(/\\"/g, '"');
      const n = s.match(new RegExp(`"${key}"\\s*:\\s*(-?\\d+(?:\\.\\d+)?)`));
      return n ? Number(n[1]) : null;
    };
    const vendor = pick('vendor');
    const amount = pick('amount');
    if (vendor || amount != null) {
      return {
        vendor: typeof vendor === 'string' ? vendor : null,
        amount,
        tax_tps: pick('tax_tps'),
        tax_tvq: pick('tax_tvq'),
        date: typeof pick('date') === 'string' ? pick('date') : null,
        category: typeof pick('category') === 'string' ? pick('category') : 'materiaux',
        description: typeof pick('description') === 'string' ? pick('description') : (vendor || 'Ticket de caisse'),
        payment_method: typeof pick('payment_method') === 'string' ? pick('payment_method') : null,
        confidence: pick('confidence'),
      };
    }
    throw new Error(`JSON ticket illisible (${err.message}). Réessayez avec une photo plus nette.`);
  }
}

function extractJsonObject(text) {
  return repairTruncatedJson(text);
}

async function scanWithOpenAI(filePath, mimeType) {
  const apiKey = await getOpenAIKey();
  if (!apiKey) throw new Error('Clé OpenAI absente');

  const model = (await getSetting('openai_model')) || 'gpt-4o-mini';
  const buf = fs.readFileSync(filePath);
  const dataUrl = `data:${mimeType};base64,${buf.toString('base64')}`;

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.1,
      max_tokens: 800,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: SCAN_PROMPT },
            { type: 'image_url', image_url: { url: dataUrl } },
          ],
        },
      ],
      response_format: { type: 'json_object' },
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `OpenAI Vision ${res.status}`);
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content || '';
  return normalizeParsed(extractJsonObject(content));
}

async function scanWithClaude(filePath, mimeType) {
  const apiKey = await getAnthropicKey();
  if (!apiKey) throw new Error('Clé Claude absente');

  const model = await getAnthropicModel();
  const buf = fs.readFileSync(filePath);
  const b64 = buf.toString('base64');

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: mimeType,
                data: b64,
              },
            },
            { type: 'text', text: `${SCAN_PROMPT}\nRéponds uniquement avec le JSON, sans markdown ni texte autour.` },
          ],
        },
      ],
    }),
  });

  const raw = await res.text();
  if (!res.ok) {
    throw new Error(`Claude Vision ${res.status}: ${raw.slice(0, 180)}`);
  }

  const data = JSON.parse(raw);
  const text = data.content?.find(b => b.type === 'text')?.text || data.content?.[0]?.text || '';
  return normalizeParsed(extractJsonObject(text));
}

/**
 * Scan ticket de caisse via Vision (OpenAI si dispo, sinon Claude).
 */
export async function scanReceiptImage(filePath, mimeType = null) {
  const type = mimeType || guessMime(filePath);
  if (/heic|heif/i.test(type)) {
    throw new Error(
      'Format HEIC non supporté. Utilisez l’appareil photo (« Scanner un ticket ») pour un JPG.'
    );
  }
  if (!type.startsWith('image/')) {
    throw new Error('Pour l\'instant, scannez une photo du ticket (PDF bientôt disponible)');
  }

  const preferred = (await getSetting('ai_provider')) || 'anthropic';
  const errors = [];

  const order = preferred === 'openai'
    ? [scanWithOpenAI, scanWithClaude]
    : [scanWithClaude, scanWithOpenAI];

  for (const fn of order) {
    try {
      return await fn(filePath, type);
    } catch (err) {
      errors.push(err.message);
    }
  }

  throw new Error(
    `Scan ticket impossible — ${errors.join(' | ')}. `
    + 'Ajoutez une clé OpenAI ou Claude dans Paramètres → Assistant IA.'
  );
}

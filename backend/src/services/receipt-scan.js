import fs from 'fs';
import path from 'path';
import { getOpenAIKey, getAnthropicKey, getAnthropicModel, getSetting } from './settings.js';

const CATEGORY_HINT = 'materiaux|outils|transport|atelier|admin';

const SCAN_PROMPT = `Tu analyses un ticket de caisse / reçu d'achat (Québec, français ou anglais).
Extrais les données et réponds UNIQUEMENT en JSON valide :
{
  "vendor": "nom du magasin",
  "amount": 0.00,
  "tax_tps": null,
  "tax_tvq": null,
  "date": "YYYY-MM-DD ou null",
  "category": "${CATEGORY_HINT}",
  "description": "résumé court des articles principaux",
  "payment_method": "carte|comptant|autre|null",
  "raw_text": "texte OCR brut du ticket",
  "confidence": 0.0
}
Règles : amount = total TTC payé ; category parmi materiaux|outils|transport|atelier|admin ; confidence entre 0 et 1.`;

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
  return 'materiaux';
}

function normalizeParsed(parsed) {
  return {
    vendor: parsed.vendor?.trim() || null,
    amount: parsed.amount != null ? Number(parsed.amount) : null,
    tax_tps: parsed.tax_tps != null ? Number(parsed.tax_tps) : null,
    tax_tvq: parsed.tax_tvq != null ? Number(parsed.tax_tvq) : null,
    date: parsed.date || null,
    category: normalizeCategory(parsed.category),
    description: parsed.description?.trim() || parsed.vendor || 'Ticket de caisse',
    payment_method: parsed.payment_method || null,
    raw_text: parsed.raw_text || '',
    confidence: parsed.confidence != null ? Number(parsed.confidence) : null,
    parsed_json: parsed,
  };
}

function extractJsonObject(text) {
  const raw = String(text || '').trim();
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : raw;
  const match = candidate.match(/\{[\s\S]*\}/);
  return JSON.parse(match ? match[0] : candidate);
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
  return normalizeParsed(JSON.parse(data.choices[0].message.content));
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
      max_tokens: 1200,
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
            { type: 'text', text: `${SCAN_PROMPT}\nRéponds uniquement avec le JSON, sans markdown.` },
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

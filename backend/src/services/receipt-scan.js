import fs from 'fs';
import path from 'path';
import { getOpenAIKey, getSetting } from './settings.js';

const CATEGORY_HINT = 'materiaux|outils|transport|atelier|admin';

function guessMime(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.pdf') return 'application/pdf';
  return 'image/jpeg';
}

function toDataUrl(filePath, mimeType) {
  const buf = fs.readFileSync(filePath);
  return `data:${mimeType};base64,${buf.toString('base64')}`;
}

function normalizeCategory(raw) {
  const c = String(raw || '').toLowerCase();
  if (['materiaux', 'matériaux', 'materials', 'bois', 'quincaillerie'].some(k => c.includes(k))) return 'materiaux';
  if (['outil', 'tools', 'equipment'].some(k => c.includes(k))) return 'outils';
  if (['transport', 'essence', 'gas', 'carburant', 'parking'].some(k => c.includes(k))) return 'transport';
  if (['atelier', 'shop', 'location'].some(k => c.includes(k))) return 'atelier';
  return 'materiaux';
}

/**
 * Scan ticket de caisse via OpenAI Vision (gpt-4o-mini).
 * Réutilise la clé OpenAI déjà configurée pour l'assistant NEYA.
 */
export async function scanReceiptImage(filePath, mimeType = null) {
  const apiKey = await getOpenAIKey();
  if (!apiKey) {
    throw new Error('Clé OpenAI requise — configurez-la dans Paramètres pour scanner les tickets');
  }

  const model = (await getSetting('openai_model')) || 'gpt-4o-mini';
  const type = mimeType || guessMime(filePath);
  if (!type.startsWith('image/')) {
    throw new Error('Pour l\'instant, scannez une photo du ticket (PDF bientôt disponible)');
  }

  const dataUrl = toDataUrl(filePath, type);
  const prompt = `Tu analyses un ticket de caisse / reçu d'achat (Québec, français ou anglais).
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
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: dataUrl } },
          ],
        },
      ],
      response_format: { type: 'json_object' },
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `Scan ticket échoué (${res.status})`);
  }

  const data = await res.json();
  const parsed = JSON.parse(data.choices[0].message.content);

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

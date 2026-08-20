import pool from '../db/pool.js';
import { callJsonLlm } from './llm-json.js';
import {
  flattenQuoteLines,
  normalizeQuoteDocument,
  serializeQuoteDocument,
} from './quote-document.js';
import { calcDocTotals } from './invoice-helpers.js';
import { PRODUCTS } from '../data/fiches-fabrication.js';

function normText(v) {
  return String(v ?? '').trim();
}

function textsDiffer(a, b) {
  return normText(a) !== normText(b);
}

export function catalogPriceHints() {
  return (PRODUCTS || []).map(p => ({
    sku: p.sku || p.meta?.sku || '',
    name: p.name || '',
    price: p.meta?.price || '',
  })).filter(p => p.name || p.sku);
}

export function applySpellcheckCorrections(quote, parsed) {
  const doc = normalizeQuoteDocument(quote.lines);
  const changes = [];
  const next = {
    title: quote.title || '',
    reference: quote.reference || '',
    notes: quote.notes || '',
    additional_notes: quote.additional_notes || '',
    document: serializeQuoteDocument(doc),
  };

  function take(field, incoming, label) {
    if (incoming == null) return;
    const value = String(incoming);
    if (textsDiffer(next[field], value)) {
      changes.push({ field: label, from: next[field], to: value });
      next[field] = value;
    }
  }

  take('title', parsed.title, 'titre');
  take('reference', parsed.reference, 'référence');
  take('notes', parsed.notes, 'portée');
  take('additional_notes', parsed.additional_notes, 'notes');

  const srcSections = parsed.sections;
  if (Array.isArray(srcSections)) {
    next.document.sections = doc.sections.map((section, si) => {
      const incoming = srcSections[si] || {};
      let title = section.title || '';
      if (incoming.title != null && textsDiffer(title, incoming.title)) {
        changes.push({ field: `tableau ${si + 1}`, from: title, to: String(incoming.title) });
        title = String(incoming.title);
      }
      const inLines = Array.isArray(incoming.lines) ? incoming.lines : [];
      const lines = (section.lines || []).map((line, li) => {
        const descIn = inLines[li]?.description;
        if (descIn == null) return line;
        const to = String(descIn);
        if (textsDiffer(line.description, to)) {
          changes.push({
            field: `ligne ${si + 1}.${li + 1}`,
            from: line.description,
            to,
          });
          return { ...line, description: to };
        }
        return line;
      });
      return { ...section, title, lines };
    });
    next.document = serializeQuoteDocument(next.document);
  }

  return { ...next, changes };
}

function snapshotQuote(quote) {
  const doc = normalizeQuoteDocument(quote.lines);
  return {
    title: quote.title || '',
    reference: quote.reference || '',
    notes: quote.notes || '',
    additional_notes: quote.additional_notes || quote.document?.additional_notes || '',
    sections: (doc.sections || []).map(s => ({
      title: s.title || '',
      lines: (s.lines || []).map(l => ({
        description: l.description || '',
        qty: l.qty,
        price: l.price,
      })),
    })),
  };
}

async function loadQuoteRow(id) {
  const { rows } = await pool.query(
    `SELECT q.*, c.name AS client_name
     FROM quotes q
     LEFT JOIN clients c ON c.id = q.client_id
     WHERE q.id = $1`,
    [id]
  );
  if (!rows[0]) throw new Error('Devis introuvable');
  return rows[0];
}

async function comparableQuoteLines(quoteId) {
  const { rows } = await pool.query(
    `SELECT quote_number, title, lines, subtotal, total, status
     FROM quotes
     WHERE id <> $1 AND status IN ('accepted', 'sent', 'draft')
     ORDER BY created_at DESC
     LIMIT 20`,
    [quoteId]
  );
  const out = [];
  for (const q of rows) {
    const lines = flattenQuoteLines(q.lines).slice(0, 8);
    for (const l of lines) {
      const price = Number(l.price) || 0;
      if (!normText(l.description) || price <= 0) continue;
      out.push({
        quote: q.quote_number,
        title: q.title || '',
        description: String(l.description).slice(0, 120),
        qty: l.qty,
        price,
        status: q.status,
      });
      if (out.length >= 40) return out;
    }
  }
  return out;
}

export async function spellcheckQuote(quoteId) {
  const quote = await loadQuoteRow(quoteId);
  const snap = snapshotQuote(quote);
  const parsed = await callJsonLlm(
    `Corrige UNIQUEMENT l'orthographe, la grammaire et la ponctuation (français du Québec) de ce devis NEYA Furniture.
Ne change pas le sens, le ton, les prix, les quantités, les SKU, les noms propres de clients, ni la structure.
Ne reformule pas. N'ajoute rien. N'enlève rien.
Si un champ est déjà correct, recopie-le identique.

Devis:
${JSON.stringify(snap)}

JSON attendu:
{
  "title": "...",
  "reference": "...",
  "notes": "...",
  "additional_notes": "...",
  "sections": [ { "title": "...", "lines": [ { "description": "..." } ] } ]
}`,
    {
      system: 'Correcteur de devis pour un atelier de meubles. Réponds UNIQUEMENT en JSON valide.',
      maxTokens: 4096,
    }
  );

  const applied = applySpellcheckCorrections(quote, parsed || {});
  if (!applied.changes.length) {
    return { unchanged: true, changes: [], quote };
  }

  const stored = serializeQuoteDocument({
    ...applied.document,
    additional_notes: applied.additional_notes,
  });
  const { subtotal, total } = calcDocTotals(stored);

  const { rows } = await pool.query(
    `UPDATE quotes SET
      title = $1,
      reference = $2,
      notes = $3,
      additional_notes = $4,
      lines = $5,
      subtotal = $6,
      total = $7
     WHERE id = $8
     RETURNING *`,
    [
      applied.title,
      applied.reference,
      applied.notes,
      applied.additional_notes,
      JSON.stringify(stored),
      subtotal,
      total,
      quoteId,
    ]
  );

  return {
    unchanged: false,
    changes: applied.changes,
    quote: rows[0],
  };
}

export async function reviewQuotePrices(quoteId) {
  const quote = await loadQuoteRow(quoteId);
  const doc = normalizeQuoteDocument(quote.lines);
  const lines = flattenQuoteLines(doc);
  const comparables = await comparableQuoteLines(quoteId);
  const catalog = catalogPriceHints();

  const payload = {
    quote_number: quote.quote_number,
    title: quote.title,
    client: quote.client_name,
    subtotal: Number(quote.subtotal) || 0,
    total: Number(quote.total) || 0,
    lines: lines.map((l, i) => ({
      index: i,
      description: l.description,
      qty: Number(l.qty) || 0,
      unit_price: Number(l.price) || 0,
      line_total: (Number(l.qty) || 0) * (Number(l.price) || 0),
    })),
    catalogue_neya: catalog,
    devis_precedents: comparables,
  };

  const parsed = await callJsonLlm(
    `Tu es un estimateur pour NEYA Furniture (atelier de meubles sur mesure, Québec).
Les prix du devis sont HORS TAXES. Le catalogue (planches, bancs) est du petit mobilier ; un projet sur mesure (table, cuisine, bibliothèque) est beaucoup plus cher.
Juge si chaque ligne et le total sont trop bas, cohérents, ou trop chers pour cet atelier.

Utilise le catalogue et les devis précédents comme indices, pas comme vérité absolue.
Ne propose un prix que si l'écart est clair. Ne change rien : avis seulement.

Devis à juger:
${JSON.stringify(payload)}

JSON attendu:
{
  "overall": "ok" | "low" | "high" | "mixed",
  "summary": "2 à 4 phrases en français",
  "total_comment": "phrase sur le total HT",
  "lines": [
    {
      "index": 0,
      "verdict": "ok" | "low" | "high",
      "suggested_price": null,
      "reason": "phrase courte",
      "comparable": "référence courte ou null"
    }
  ]
}`,
    {
      system: 'Estimateur de devis NEYA. Réponds UNIQUEMENT en JSON valide.',
      maxTokens: 2500,
    }
  );

  const byIndex = new Map();
  for (const row of parsed?.lines || []) {
    if (row && Number.isFinite(Number(row.index))) byIndex.set(Number(row.index), row);
  }

  const reviewedLines = payload.lines.map((l) => {
    const ai = byIndex.get(l.index) || {};
    const verdict = ['ok', 'low', 'high'].includes(ai.verdict) ? ai.verdict : 'ok';
    const suggested = ai.suggested_price == null || ai.suggested_price === ''
      ? null
      : Number(ai.suggested_price);
    return {
      ...l,
      verdict,
      suggested_price: Number.isFinite(suggested) ? suggested : null,
      reason: String(ai.reason || '').trim(),
      comparable: ai.comparable ? String(ai.comparable) : null,
    };
  });

  const overall = ['ok', 'low', 'high', 'mixed'].includes(parsed?.overall)
    ? parsed.overall
    : (reviewedLines.some(l => l.verdict === 'low') && reviewedLines.some(l => l.verdict === 'high')
      ? 'mixed'
      : reviewedLines.every(l => l.verdict === 'ok') ? 'ok'
        : reviewedLines.some(l => l.verdict === 'low') ? 'low' : 'high');

  return {
    overall,
    summary: String(parsed?.summary || '').trim() || 'Analyse terminée.',
    total_comment: String(parsed?.total_comment || '').trim(),
    subtotal: payload.subtotal,
    total: payload.total,
    lines: reviewedLines,
  };
}

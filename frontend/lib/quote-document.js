/** Miroir frontend de backend/src/services/quote-document.js */

function uid(prefix = 's') {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}

export function emptyLine() {
  return { description: '', qty: 1, price: 0 };
}

export function emptySection(title = 'Tableau') {
  return { id: uid('sec'), title, lines: [emptyLine()] };
}

export function parseRawLines(raw) {
  if (!raw) return [];
  if (typeof raw === 'string') {
    try { return JSON.parse(raw); } catch { return []; }
  }
  return raw;
}

export function normalizeQuoteDocument(raw) {
  const parsed = parseRawLines(raw);

  if (parsed && !Array.isArray(parsed) && Array.isArray(parsed.sections)) {
    return {
      version: 2,
      sections: parsed.sections.map((s, i) => ({
        id: s.id || uid('sec'),
        title: s.title || (i === 0 ? 'Travaux' : `Tableau ${i + 1}`),
        lines: Array.isArray(s.lines) && s.lines.length
          ? s.lines.map(l => ({
            description: l.description || '',
            qty: l.qty ?? 1,
            price: l.price ?? 0,
          }))
          : [emptyLine()],
      })),
      photos: Array.isArray(parsed.photos) ? parsed.photos : [],
      additional_notes: parsed.additional_notes || '',
      options: {
        show_signature: parsed.options?.show_signature !== false,
        show_payment: parsed.options?.show_payment !== false,
        show_acceptance_date: parsed.options?.show_acceptance_date !== false,
      },
    };
  }

  const flat = Array.isArray(parsed) ? parsed : [];
  return {
    version: 2,
    sections: [{
      id: uid('sec'),
      title: 'Travaux / produit',
      lines: flat.length
        ? flat.map(l => ({
          description: l.description || '',
          qty: l.qty ?? 1,
          price: l.price ?? 0,
        }))
        : [emptyLine()],
    }],
    photos: [],
    additional_notes: '',
    options: {
      show_signature: true,
      show_payment: true,
      show_acceptance_date: true,
    },
  };
}

export function flattenQuoteLines(raw) {
  const doc = normalizeQuoteDocument(raw);
  return doc.sections.flatMap(s => (s.lines || []).filter(l =>
    String(l.description || '').trim() || Number(l.qty) || Number(l.price)
  ));
}

export function serializeQuoteDocument(doc) {
  const normalized = normalizeQuoteDocument(doc);
  return {
    version: 2,
    sections: normalized.sections,
    photos: normalized.photos || [],
    additional_notes: normalized.additional_notes || '',
    options: normalized.options,
  };
}

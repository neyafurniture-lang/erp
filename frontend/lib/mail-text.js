/** Décode les entités HTML courantes (snippets Gmail, signatures, etc.). */
export function decodeHtmlEntities(raw) {
  const text = String(raw || '');
  if (!text) return '';
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;/gi, "'")
    .replace(/&#x0*27;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => {
      const code = Number(n);
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return _;
      try {
        return String.fromCodePoint(code);
      } catch {
        return _;
      }
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => {
      const code = parseInt(h, 16);
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return _;
      try {
        return String.fromCodePoint(code);
      } catch {
        return _;
      }
    });
}

/** Affiche un corps mail lisible même si Gmail renvoie du HTML brut. */
export function readableMailBody(raw) {
  const text = String(raw || '');
  if (!text) return '';
  if (!/<\/?[a-z][\s\S]*>/i.test(text)) return decodeHtmlEntities(text);
  return decodeHtmlEntities(
    text
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|tr|li|h[1-6])>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]{2,}/g, ' ')
      .trim()
  );
}

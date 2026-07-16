/**
 * Liens de comparaison de prix (Québec / Canada) pour la liste de courses.
 * Génère des recherches marchand à partir du titre produit — sans API payante.
 */

export const PRICE_COMPARE_STORES = [
  {
    id: 'google',
    label: 'Google Shopping',
    short: 'Google',
    buildUrl: (q) =>
      `https://www.google.com/search?tbm=shop&hl=fr-CA&gl=ca&q=${encodeURIComponent(q)}`,
  },
  {
    id: 'homedepot',
    label: 'Home Depot',
    short: 'Home Depot',
    buildUrl: (q) =>
      `https://www.homedepot.ca/fr/accueil/search.html?q=${encodeURIComponent(q)}`,
  },
  {
    id: 'rona',
    label: 'Rona',
    short: 'Rona',
    buildUrl: (q) =>
      `https://www.rona.ca/fr/search?query=${encodeURIComponent(q)}&searchType=product`,
  },
  {
    id: 'canac',
    label: 'Canac',
    short: 'Canac',
    buildUrl: (q) =>
      `https://www.canac.ca/fr/search?q=${encodeURIComponent(q)}`,
  },
  {
    id: 'canadiantire',
    label: 'Canadian Tire',
    short: 'C. Tire',
    buildUrl: (q) =>
      `https://www.canadiantire.ca/fr/search-results.html?q=${encodeURIComponent(q)}`,
  },
  {
    id: 'amazon',
    label: 'Amazon.ca',
    short: 'Amazon',
    buildUrl: (q) =>
      `https://www.amazon.ca/s?k=${encodeURIComponent(q)}`,
  },
];

/** Nettoie le titre pour une meilleure requête (enlève qté/stock parasites). */
export function buildPriceQuery(item) {
  const raw = String(item?.title || item?.name || '').trim();
  if (!raw) return '';
  let q = raw
    .replace(/\bStock\s*:\s*[\d./\s]+/gi, '')
    .replace(/\bmin\s*\d+/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  // Ajoute un peu de contexte atelier bois si catégorie matière / quincaillerie
  const cat = item?.category;
  if (cat === 'materiaux' && !/bois|contreplaqu|mdf|mélamin/i.test(q)) {
    // ne force pas — le titre suffit
  }
  return q;
}

export function getPriceCompareLinks(item) {
  const q = buildPriceQuery(item);
  if (!q) return [];
  return PRICE_COMPARE_STORES.map((store) => ({
    id: store.id,
    label: store.label,
    short: store.short,
    url: store.buildUrl(q),
    query: q,
  }));
}

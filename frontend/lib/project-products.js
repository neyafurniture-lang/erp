/** Catalogue produits d'un projet (stocké dans project.meta.products). */
export const SAUNA_CLOUD_PRODUCTS = [
  { sku: 'H2013', dimensions: '20" x 13"', model: 'Underbench', qty: 20 },
  { sku: 'H3313', dimensions: '33" x 13"', model: 'Underbench', qty: 10 },
  { sku: 'H2026', dimensions: '20" x 26"', model: 'Standard', qty: 20 },
  { sku: 'H3326', dimensions: '33" x 26"', model: 'Standard', qty: 10 },
  { sku: 'H2226', dimensions: '22" x 26"', model: 'Standard', qty: 10 },
  { sku: 'H3726', dimensions: '37" x 26"', model: 'Standard', qty: 10 },
  { sku: 'H2626', dimensions: '26" x 26"', model: 'Standard', qty: 10 },
  { sku: 'FS750', dimensions: '—', model: 'Full-spectrum', qty: 10 },
];

export function parseProjectMeta(meta) {
  if (!meta) return {};
  if (typeof meta === 'string') {
    try { return JSON.parse(meta || '{}'); } catch { return {}; }
  }
  return meta;
}

export function getProjectProducts(project) {
  const meta = parseProjectMeta(project?.meta);
  const rows = meta.products;
  return Array.isArray(rows) ? rows : [];
}

export function formatProductsForPrompt(products) {
  if (!products?.length) return '';
  return products.map(p =>
    `- ${p.sku} | ${p.dimensions || '—'} | ${p.model || '—'} | qté ${p.qty ?? 0}`
  ).join('\n');
}

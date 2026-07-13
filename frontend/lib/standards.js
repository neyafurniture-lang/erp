export const PHASE_LABELS = {
  debitage: 'Débitage',
  usinage: 'Usinage',
  assemblage: 'Assemblage',
  finition: 'Finition',
  admin: 'Atelier / Admin',
};

export const PHASE_COLORS = {
  debitage: 'bg-orange-100 text-orange-800 border-orange-200',
  usinage: 'bg-amber-100 text-amber-900 border-amber-200',
  assemblage: 'bg-yellow-100 text-yellow-900 border-yellow-200',
  finition: 'bg-neya-cream-dark text-neya-ink border-neya-border',
  admin: 'bg-stone-100 text-stone-700 border-stone-200',
};

export function parseMeta(meta) {
  if (!meta) return {};
  return typeof meta === 'string' ? JSON.parse(meta) : meta;
}

export function parseSteps(steps) {
  return typeof steps === 'string' ? JSON.parse(steps) : (steps || []);
}

export function isCatalogProduct(standard) {
  if (standard.product_type === 'guide') return false;
  const meta = parseMeta(standard.meta);
  return Boolean(meta.source || (meta.sku && meta.sku !== 'GUIDE'));
}

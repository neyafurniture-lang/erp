export const PRODUCTION_STAGES = {
  queued: { label: 'À démarrer', color: 'bg-gray-100 text-gray-700 border-gray-200' },
  debitage: { label: 'Débitage', color: 'bg-orange-100 text-orange-800 border-orange-200' },
  usinage: { label: 'Usinage', color: 'bg-amber-100 text-amber-900 border-amber-200' },
  assemblage: { label: 'Assemblage', color: 'bg-yellow-100 text-yellow-900 border-yellow-200' },
  finition: { label: 'Finition', color: 'bg-neya-cream-dark text-neya-ink border-neya-border' },
  atelier: { label: 'Atelier', color: 'bg-stone-100 text-stone-700 border-stone-200' },
  done: { label: 'Terminé', color: 'bg-green-100 text-green-800 border-green-200' },
};

export function productionProgress(tasks = []) {
  const total = tasks.length;
  const done = tasks.filter(t => t.status === 'done').length;
  return { done, total, pct: total ? Math.round((done / total) * 100) : 0 };
}

const STAGE_ORDER = ['queued', 'debitage', 'usinage', 'assemblage', 'finition', 'atelier', 'done'];

export function computeProductionStage(tasks = []) {
  if (!tasks.length) return 'queued';
  if (tasks.every(t => t.status === 'done')) return 'done';
  const doing = tasks.find(t => t.status === 'doing');
  if (doing) return doing.type === 'admin' ? 'atelier' : doing.type;
  const firstOpen = tasks.find(t => t.status !== 'done');
  if (!firstOpen) return 'done';
  if (!tasks.some(t => t.status === 'done')) return 'queued';
  return firstOpen.type === 'admin' ? 'atelier' : firstOpen.type;
}

export function resolveProject3dUrl(projectMeta = {}, standardMeta = null) {
  const std = standardMeta && typeof standardMeta === 'string' ? JSON.parse(standardMeta) : (standardMeta || {});
  return projectMeta.viewer_3d_url || projectMeta.glb_url || std.viewer_3d_url || std.glb_url || null;
}

export function displayKind(item) {
  if (item.kind === 'custom') return 'Sur mesure';
  if (item.catalog) return 'Banc / catalogue';
  return 'Fiche standard';
}

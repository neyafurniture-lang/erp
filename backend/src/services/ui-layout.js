import { getSetting, setSetting } from './settings.js';

export const DASHBOARD_SECTION_CATALOG = [
  { id: 'alerts', label: 'Alertes', type: 'builtin' },
  { id: 'supplier_invoices', label: 'Factures fournisseurs', type: 'builtin' },
  { id: 'projects_cards', label: 'Projets en cours (cartes)', type: 'builtin' },
  { id: 'quick_actions', label: 'Actions rapides', type: 'builtin' },
  { id: 'stats', label: 'Statistiques', type: 'builtin' },
  { id: 'today_week', label: 'Aujourd\'hui & semaine', type: 'builtin' },
  { id: 'admin_tasks', label: 'Tâches admin', type: 'builtin' },
  { id: 'todo:main', label: 'Ma todo', type: 'todo', list_key: 'main', title: 'Ma todo' },
  { id: 'sauna_cloud', label: 'Sauna Cloud — frames', type: 'builtin' },
  { id: 'finances', label: 'Finances', type: 'builtin' },
  { id: 'projects_deadlines', label: 'Projets & deadlines', type: 'builtin' },
  { id: 'invoices_web', label: 'Factures & site web', type: 'builtin' },
];

export function defaultDashboardLayout() {
  return {
    edit_mode: false,
    sections: DASHBOARD_SECTION_CATALOG.map((s, i) => ({
      ...s,
      visible: true,
      sort_order: i,
    })),
  };
}

export async function getDashboardLayout() {
  const stored = await getSetting('dashboard_layout');
  if (!stored || typeof stored !== 'object' || !Array.isArray(stored.sections)) {
    return defaultDashboardLayout();
  }
  // Fusionner avec le catalogue (nouvelles sections natives)
  const byId = new Map(stored.sections.map(s => [s.id, s]));
  const merged = [];
  for (const cat of DASHBOARD_SECTION_CATALOG) {
    const existing = byId.get(cat.id);
    if (existing) {
      merged.push({ ...cat, ...existing, id: cat.id });
      byId.delete(cat.id);
    } else {
      merged.push({ ...cat, visible: true, sort_order: merged.length });
    }
  }
  // Garder les todos custom ajoutées
  for (const [, s] of byId) {
    if (s.type === 'todo') merged.push(s);
  }
  merged.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  return {
    edit_mode: Boolean(stored.edit_mode),
    sections: merged.map((s, i) => ({ ...s, sort_order: i })),
  };
}

export async function saveDashboardLayout(layout) {
  const sections = (layout.sections || []).map((s, i) => ({
    id: s.id,
    label: s.label || s.title || s.id,
    type: s.type || 'builtin',
    list_key: s.list_key || null,
    title: s.title || s.label || null,
    visible: s.visible !== false,
    sort_order: i,
  }));
  const payload = {
    edit_mode: Boolean(layout.edit_mode),
    sections,
  };
  await setSetting('dashboard_layout', payload);
  return payload;
}

export async function setEditMode(enabled) {
  const layout = await getDashboardLayout();
  layout.edit_mode = Boolean(enabled);
  return saveDashboardLayout(layout);
}

export async function moveSection(sectionId, direction) {
  const layout = await getDashboardLayout();
  const idx = layout.sections.findIndex(s => s.id === sectionId);
  if (idx < 0) throw new Error(`Section introuvable: ${sectionId}`);
  const target = direction === 'up' ? idx - 1 : direction === 'down' ? idx + 1 : -1;
  if (target < 0 || target >= layout.sections.length) return layout;
  const copy = [...layout.sections];
  const [item] = copy.splice(idx, 1);
  copy.splice(target, 0, item);
  layout.sections = copy;
  return saveDashboardLayout(layout);
}

export async function reorderSections(orderedIds) {
  const layout = await getDashboardLayout();
  const byId = new Map(layout.sections.map(s => [s.id, s]));
  const next = [];
  for (const id of orderedIds) {
    if (byId.has(id)) {
      next.push(byId.get(id));
      byId.delete(id);
    }
  }
  for (const s of byId.values()) next.push(s);
  layout.sections = next;
  return saveDashboardLayout(layout);
}

export async function addTodoSection({ title, list_key, after_id } = {}) {
  const layout = await getDashboardLayout();
  const key = (list_key || title || `todo_${Date.now()}`)
    .toString()
    .toLowerCase()
    .normalize('NFD').replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 40) || `todo_${Date.now()}`;
  const id = `todo:${key}`;
  if (layout.sections.some(s => s.id === id)) {
    throw new Error(`Une liste « ${key} » existe déjà`);
  }
  const section = {
    id,
    type: 'todo',
    list_key: key,
    title: title || 'Nouvelle todo',
    label: title || 'Nouvelle todo',
    visible: true,
    sort_order: layout.sections.length,
  };
  if (after_id) {
    const idx = layout.sections.findIndex(s => s.id === after_id);
    if (idx >= 0) layout.sections.splice(idx + 1, 0, section);
    else layout.sections.push(section);
  } else {
    layout.sections.push(section);
  }
  layout.edit_mode = true;
  return saveDashboardLayout(layout);
}

export async function removeSection(sectionId) {
  const layout = await getDashboardLayout();
  if (!sectionId.startsWith('todo:')) {
    throw new Error('Seules les listes todo ajoutées peuvent être supprimées');
  }
  layout.sections = layout.sections.filter(s => s.id !== sectionId);
  return saveDashboardLayout(layout);
}

export async function setSectionVisible(sectionId, visible) {
  const layout = await getDashboardLayout();
  const s = layout.sections.find(x => x.id === sectionId);
  if (!s) throw new Error('Section introuvable');
  s.visible = Boolean(visible);
  return saveDashboardLayout(layout);
}

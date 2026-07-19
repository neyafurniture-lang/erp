/** Registre des modules ERP — activables indépendamment */
export const MODULES = {
  core: { id: 'core', label: 'Noyau ERP', enabled: true, phase: 'A' },
  inventory: { id: 'inventory', label: 'Stock & inventaire', enabled: true, phase: 'B' },
  purchases: { id: 'purchases', label: 'Achats', enabled: true, phase: 'B' },
  suppliers: { id: 'suppliers', label: 'Fournisseurs', enabled: true, phase: 'B' },
  team: { id: 'team', label: 'Équipe & shifts', enabled: true, phase: 'C' },
  production: { id: 'production', label: 'Production', enabled: true, phase: 'B' },
  ai_evolution: { id: 'ai_evolution', label: 'IA évolutive', enabled: true, phase: 'D' },
  google_drive: { id: 'google_drive', label: 'Google Drive', enabled: true, phase: 'E', oauth: true },
  gmail: { id: 'gmail', label: 'Gmail', enabled: true, phase: 'F', oauth: true },
  viewer_3d: { id: 'viewer_3d', label: 'Visualiseur 3D', enabled: true, phase: 'G' },
  marketing_meta: { id: 'marketing_meta', label: 'Réseaux sociaux (Meta / Pinterest)', enabled: true, phase: 'H', oauth: true },
  marketplace: { id: 'marketplace', label: 'Marketplace & ventes canaux', enabled: true, phase: 'H' },
  dev_studio: { id: 'dev_studio', label: 'Développement', enabled: false, phase: 'I' },
  agents: { id: 'agents', label: 'Agents IA', enabled: true, phase: 'J' },
};

export function listModules(dbOverrides = {}) {
  return Object.values(MODULES).map(m => ({
    ...m,
    enabled: dbOverrides[m.id]?.enabled ?? m.enabled,
    settings: dbOverrides[m.id]?.settings ?? {},
  }));
}

export function agentPermissions(agentId) {
  const map = {
    general: ['core', 'inventory', 'purchases', 'team', 'production', 'ai_evolution'],
    commercial: ['core', 'gmail', 'google_drive'],
    fabrication: ['core', 'production', 'inventory', 'purchases', 'team'],
    compta: ['core', 'purchases', 'suppliers'],
    marketing: ['marketing_meta', 'core'],
    dev: ['dev_studio', 'core'],
  };
  return map[agentId] || ['core'];
}

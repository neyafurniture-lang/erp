/** Zones d'accès ERP — une clé par section du système */
export const PERMISSION_AREAS = {
  dashboard: { label: 'Dashboard', group: 'Principal' },
  production: { label: 'Production', group: 'Principal' },
  projects: { label: 'Projets', group: 'Principal' },
  admin: { label: 'Session admin', group: 'Principal' },
  purchases: { label: 'Achats', group: 'Opérations' },
  inventory: { label: 'Stock', group: 'Opérations' },
  team: { label: 'Équipe', group: 'Opérations' },
  calendar: { label: 'Calendrier', group: 'Opérations' },
  drive: { label: 'Google Drive', group: 'Intégrations' },
  mail: { label: 'Gmail', group: 'Intégrations' },
  invoices: { label: 'Devis & factures', group: 'Finance' },
  finance: { label: 'Finance & bénéfices', group: 'Finance' },
  expenses: { label: 'Dépenses', group: 'Opérations' },
  clients: { label: 'Clients', group: 'Commercial' },
  standards: { label: 'Standards', group: 'Commercial' },
  web: { label: 'Site web', group: 'Commercial' },
  marketplace: { label: 'Marketplace', group: 'Commercial' },
  social: { label: 'Réseaux sociaux', group: 'Commercial' },
  settings: { label: 'Paramètres', group: 'Système' },
  users: { label: 'Gestion utilisateurs', group: 'Système', adminOnly: true },
};

export const ALL_PERMISSION_KEYS = Object.keys(PERMISSION_AREAS);

/** Correspondance chemin frontend → permission */
export const PATH_PERMISSION = [
  { prefix: '/production', permission: 'production' },
  { prefix: '/sauna-cloud', permission: 'production' },
  { prefix: '/admin', permission: 'admin' },
  { prefix: '/projects', permission: 'projects' },
  { prefix: '/liste-courses', permission: 'purchases' },
  { prefix: '/purchases', permission: 'purchases' },
  { prefix: '/inventory', permission: 'inventory' },
  { prefix: '/team', permission: 'team' },
  { prefix: '/calendar', permission: 'calendar' },
  { prefix: '/mes-heures', permission: 'hours' },
  { prefix: '/drive', permission: 'drive' },
  { prefix: '/mail', permission: 'mail' },
  { prefix: '/invoices', permission: 'invoices' },
  { prefix: '/finance', permission: 'finance' },
  { prefix: '/expenses', permission: 'expenses' },
  { prefix: '/clients', permission: 'clients' },
  { prefix: '/standards', permission: 'standards' },
  { prefix: '/web', permission: 'web' },
  { prefix: '/marketplace', permission: 'marketplace' },
  { prefix: '/social', permission: 'social' },
  { prefix: '/settings', permission: 'settings' },
];

export function parsePermissions(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  try { return JSON.parse(raw); } catch { return []; }
}

export function isAdmin(user) {
  return user?.role === 'admin' || parsePermissions(user?.permissions).includes('*');
}

export function hasPermission(user, key) {
  if (user?.active === false) return false;
  if (isAdmin(user)) return true;
  const perms = parsePermissions(user?.permissions);
  return perms.includes(key);
}

export function permissionForPath(pathname) {
  if (pathname === '/' || pathname === '') return 'dashboard';
  const match = PATH_PERMISSION.find(p => pathname.startsWith(p.prefix));
  return match?.permission || null;
}

export function canAccessPath(user, pathname) {
  if (!user) return false;
  if (user.active === false) return false;
  const key = permissionForPath(pathname);
  if (!key) return isAdmin(user);
  if (key === 'finance') {
    return hasPermission(user, 'finance')
      || hasPermission(user, 'invoices')
      || hasPermission(user, 'expenses');
  }
  if (key === 'hours') {
    if (isAdmin(user) || hasPermission(user, 'team') || hasPermission(user, 'calendar')) return true;
    return Boolean(user.employee_id);
  }
  return hasPermission(user, key);
}

export function parseDriveAccess(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  try { return JSON.parse(raw); } catch { return []; }
}

export function sanitizeUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role || 'member',
    permissions: parsePermissions(row.permissions),
    active: row.active !== false,
    drive_access: parseDriveAccess(row.drive_access),
    employee_id: row.employee_id ? Number(row.employee_id) : null,
    employee_name: row.employee_name || null,
    created_at: row.created_at,
  };
}

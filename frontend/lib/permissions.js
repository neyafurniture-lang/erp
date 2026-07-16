export const PERMISSION_AREAS = {
  dashboard: { label: 'Dashboard', group: 'Principal' },
  production: { label: 'Production', group: 'Principal' },
  projects: { label: 'Projets', group: 'Principal' },
  admin: { label: 'Session admin', group: 'Principal' },
  purchases: { label: 'Achats atelier', group: 'Opérations' },
  inventory: { label: 'Stock', group: 'Opérations' },
  team: { label: 'Équipe', group: 'Opérations' },
  calendar: { label: 'Calendrier', group: 'Opérations' },
  drive: { label: 'Google Drive', group: 'Intégrations' },
  mail: { label: 'Gmail', group: 'Intégrations' },
  invoices: { label: 'Devis & factures', group: 'Finance' },
  expenses: { label: 'Dépenses', group: 'Opérations' },
  clients: { label: 'Clients', group: 'Commercial' },
  standards: { label: 'Standards', group: 'Commercial' },
  web: { label: 'Site web', group: 'Commercial' },
  settings: { label: 'Paramètres', group: 'Système' },
  roadmap: { label: 'Roadmap', group: 'Système' },
  manual: { label: 'Manuel ERP', group: 'Système' },
};

export function parsePermissions(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  return [];
}

export function isAdmin(user) {
  return user?.role === 'admin' || parsePermissions(user?.permissions).includes('*');
}

export function hasPermission(user, key) {
  if (user?.active === false) return false;
  if (isAdmin(user)) return true;
  return parsePermissions(user?.permissions).includes(key);
}

const PATH_MAP = [
  ['/production', 'production'],
  ['/sauna-cloud', 'production'],
  ['/admin', 'admin'],
  ['/projects', 'projects'],
  ['/liste-courses', 'purchases'],
  ['/purchases', 'purchases'],
  ['/inventory', 'inventory'],
  ['/team', 'team'],
  ['/calendar', 'calendar'],
  ['/drive', 'drive'],
  ['/mail', 'mail'],
  ['/invoices', 'invoices'],
  ['/expenses', 'expenses'],
  ['/clients', 'clients'],
  ['/standards', 'standards'],
  ['/web', 'web'],
  ['/settings', 'settings'],
  ['/roadmap', 'settings'],
  ['/manual', 'dashboard'],
];

export function permissionForPath(pathname) {
  if (pathname === '/' || pathname === '') return 'dashboard';
  const hit = PATH_MAP.find(([prefix]) => pathname.startsWith(prefix));
  return hit ? hit[1] : null;
}

export function canAccessPath(user, pathname) {
  if (!user) return false;
  const key = permissionForPath(pathname);
  if (!key) return isAdmin(user);
  return hasPermission(user, key);
}

export function setStoredUser(user) {
  if (typeof window === 'undefined') return;
  if (user) localStorage.setItem('neya_user', JSON.stringify(user));
  else localStorage.removeItem('neya_user');
}

export function getStoredUser() {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem('neya_user');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

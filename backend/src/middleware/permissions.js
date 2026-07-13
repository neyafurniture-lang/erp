import { isAdmin, hasPermission } from '../config/permissions.js';

export function requireAdmin(req, res, next) {
  if (!isAdmin(req.user)) {
    return res.status(403).json({ error: 'Accès administrateur requis' });
  }
  next();
}

export function requirePermission(key) {
  return (req, res, next) => {
    if (!hasPermission(req.user, key)) {
      return res.status(403).json({ error: 'Permission insuffisante' });
    }
    next();
  };
}

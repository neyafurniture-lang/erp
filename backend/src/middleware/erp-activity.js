import { touchErpActivity } from '../services/erp-activity.js';

/**
 * Marque une activité ERP récente (requêtes API authentifiées).
 * Fire-and-forget + throttle côté service.
 */
export function erpActivityMiddleware(req, _res, next) {
  const path = `${req.baseUrl || ''}${req.path || ''}` || req.originalUrl || '';
  // Ne pas compter les sondes deploy/status trop fréquentes comme « usage atelier »
  const quiet = path.includes('/deploy/sync-status')
    || path.includes('/deploy/diagnostics')
    || path.includes('/deploy/git');
  if (!quiet) {
    touchErpActivity({
      userId: req.user?.id ?? null,
      path: path.slice(0, 200),
    }).catch(() => {});
  }
  next();
}

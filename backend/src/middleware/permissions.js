import pool from '../db/pool.js';
import { isAdmin, hasPermission } from '../config/permissions.js';

/**
 * Le JWT ne porte que { id, email } — rôle et permissions vivent en DB.
 * On recharge donc l'utilisateur à chaque requête (comme deploy.js / payroll.js).
 */
async function loadAccount(req) {
  if (req.account) return req.account;
  const { rows } = await pool.query(
    'SELECT id, email, role, permissions, active FROM users WHERE id = $1',
    [req.user?.id]
  );
  if (!rows[0] || rows[0].active === false) return null;
  req.account = rows[0];
  return rows[0];
}

export function requireAdmin(req, res, next) {
  loadAccount(req)
    .then((user) => {
      if (!user || !isAdmin(user)) {
        return res.status(403).json({ error: 'Accès administrateur requis' });
      }
      next();
    })
    .catch((err) => res.status(500).json({ error: err.message }));
}

export function requirePermission(key) {
  return (req, res, next) => {
    loadAccount(req)
      .then((user) => {
        if (!user || !hasPermission(user, key)) {
          return res.status(403).json({ error: 'Permission insuffisante' });
        }
        next();
      })
      .catch((err) => res.status(500).json({ error: err.message }));
  };
}

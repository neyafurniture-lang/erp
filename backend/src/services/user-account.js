import pool from '../db/pool.js';
import { isAdmin, hasPermission } from '../config/permissions.js';

export async function getUserAccount(req) {
  const { rows } = await pool.query(
    `SELECT u.*, e.name AS employee_name, e.color AS employee_color
     FROM users u
     LEFT JOIN employees e ON e.id = u.employee_id
     WHERE u.id = $1`,
    [req.user.id]
  );
  if (!rows[0]) throw new Error('Utilisateur introuvable');
  if (rows[0].active === false) throw new Error('Compte désactivé');
  return rows[0];
}

export function canManageTeamCalendar(user) {
  return isAdmin(user) || hasPermission(user, 'team');
}

export function canAccessCalendar(user) {
  return isAdmin(user) || hasPermission(user, 'calendar') || hasPermission(user, 'team');
}

/** Page Mes heures : profil employé lié, ou gestion équipe / calendrier. */
export function canAccessHours(user) {
  if (!user) return false;
  if (isAdmin(user) || hasPermission(user, 'team') || hasPermission(user, 'calendar')) return true;
  return Boolean(user.employee_id);
}

export function canEditTimeOff(user, record) {
  if (isAdmin(user) || hasPermission(user, 'team')) return true;
  return user.employee_id && Number(user.employee_id) === Number(record.employee_id);
}

export function canEditTimeEntry(user, record) {
  if (isAdmin(user) || hasPermission(user, 'team')) return true;
  return user.employee_id && Number(user.employee_id) === Number(record.employee_id);
}

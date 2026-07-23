/**
 * Bootstrap du premier administrateur — uniquement s’il n’existe aucun admin actif.
 * Évite le deadlock : « il faut un admin pour créer un admin ».
 */
import bcrypt from 'bcryptjs';
import pool from '../db/pool.js';

export async function countActiveAdmins() {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS n FROM users WHERE role = 'admin' AND COALESCE(active, true) = true`
  );
  return rows[0]?.n || 0;
}

export async function needsAdminSetup() {
  return (await countActiveAdmins()) === 0;
}

/**
 * Crée le premier admin. Refuse si un admin actif existe déjà.
 * Mot de passe court autorisé (ex. 31250) — uniquement pour ce bootstrap.
 */
export async function bootstrapFirstAdmin({
  name = 'Mehdi',
  email = 'mehdi@neya.local',
  password = '31250',
} = {}) {
  const cleanName = String(name || '').trim() || 'Mehdi';
  const cleanEmail = String(email || '').trim().toLowerCase();
  const cleanPassword = String(password || '');

  if (!cleanEmail || !cleanEmail.includes('@')) {
    const err = new Error('Email invalide');
    err.status = 400;
    throw err;
  }
  if (!cleanPassword || cleanPassword.length < 4) {
    const err = new Error('Mot de passe trop court (min. 4 caractères pour le premier admin)');
    err.status = 400;
    throw err;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Empêche deux setups simultanés
    await client.query('SELECT pg_advisory_xact_lock(872314)');

    const { rows: admins } = await client.query(
      `SELECT COUNT(*)::int AS n FROM users WHERE role = 'admin' AND COALESCE(active, true) = true`
    );
    if ((admins[0]?.n || 0) > 0) {
      const err = new Error('Un administrateur existe déjà — connexion requise');
      err.status = 403;
      throw err;
    }

    const hash = await bcrypt.hash(cleanPassword, 12);
    let employeeId = null;
    try {
      const { rows: emp } = await client.query(
        `SELECT id FROM employees WHERE name ILIKE $1 LIMIT 1`,
        [cleanName.split(/\s+/)[0]]
      );
      employeeId = emp[0]?.id || null;
    } catch { /* employees table optionnelle au tout premier boot */ }

    const { rows: existing } = await client.query(
      `SELECT id FROM users WHERE LOWER(TRIM(email)) = $1 LIMIT 1`,
      [cleanEmail]
    );

    let user;
    if (existing[0]) {
      const { rows } = await client.query(
        `UPDATE users
         SET name = $1,
             password_hash = $2,
             role = 'admin',
             permissions = '["*"]'::jsonb,
             active = true,
             employee_id = COALESCE(employee_id, $3)
         WHERE id = $4
         RETURNING id, name, email, role, permissions, active, drive_access, employee_id, created_at`,
        [cleanName, hash, employeeId, existing[0].id]
      );
      user = rows[0];
    } else {
      const { rows } = await client.query(
        `INSERT INTO users (name, email, password_hash, role, permissions, active, employee_id)
         VALUES ($1, $2, $3, 'admin', $4, true, $5)
         RETURNING id, name, email, role, permissions, active, drive_access, employee_id, created_at`,
        [cleanName, cleanEmail, hash, JSON.stringify(['*']), employeeId]
      );
      user = rows[0];
    }

    await client.query('COMMIT');
    return user;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* */ }
    throw err;
  } finally {
    client.release();
  }
}

#!/usr/bin/env node
/**
 * Crée / met à jour le compte administrateur Mehdi.
 * Usage :
 *   DATABASE_URL=postgres://… node scripts/ensure-mehdi-admin.mjs
 *   MEHDI_PASSWORD=31250 DATABASE_URL=… node scripts/ensure-mehdi-admin.mjs
 */
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import pg from 'pg';

dotenv.config();

const email = (process.env.MEHDI_EMAIL || 'mehdi@neya.local').trim().toLowerCase();
const password = process.env.MEHDI_PASSWORD || '31250';
const name = process.env.MEHDI_NAME || 'Mehdi';

async function main() {
  const connectionString = process.env.DATABASE_URL || 'postgresql://neya:neya@localhost:5432/neya_db';
  const pool = new pg.Pool({ connectionString });
  try {
    const hash = await bcrypt.hash(password, 12);
    const { rows: emp } = await pool.query(
      `SELECT id FROM employees WHERE name ILIKE $1 LIMIT 1`,
      [name]
    );
    const employeeId = emp[0]?.id || null;

    const { rows: existing } = await pool.query(
      `SELECT id, email, role FROM users WHERE LOWER(TRIM(email)) = $1 LIMIT 1`,
      [email]
    );

    if (!existing[0]) {
      const { rows } = await pool.query(
        `INSERT INTO users (name, email, password_hash, role, permissions, active, employee_id)
         VALUES ($1, $2, $3, 'admin', $4, true, $5)
         RETURNING id, name, email, role`,
        [name, email, hash, JSON.stringify(['*']), employeeId]
      );
      console.log('Créé:', rows[0]);
    } else {
      const { rows } = await pool.query(
        `UPDATE users
         SET name = $1,
             password_hash = $2,
             role = 'admin',
             permissions = '["*"]'::jsonb,
             active = true,
             employee_id = COALESCE(employee_id, $3)
         WHERE id = $4
         RETURNING id, name, email, role`,
        [name, hash, employeeId, existing[0].id]
      );
      console.log('Mis à jour:', rows[0]);
    }
    console.log(`Connexion : ${email} / (mot de passe fourni)`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Échec:', err.message);
  process.exit(1);
});

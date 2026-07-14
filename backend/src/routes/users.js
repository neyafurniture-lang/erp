import { Router } from 'express';
import bcrypt from 'bcryptjs';
import pool from '../db/pool.js';
import { validatePassword } from '../config.js';
import { requireAdmin } from '../middleware/permissions.js';
import { ALL_PERMISSION_KEYS, PERMISSION_AREAS, sanitizeUser } from '../config/permissions.js';
import { listDriveOptions, sanitizeDriveAccess } from '../services/drive-access.js';

const router = Router();

router.use(requireAdmin);

router.get('/permissions', (_req, res) => {
  res.json({
    areas: Object.entries(PERMISSION_AREAS).map(([id, meta]) => ({ id, ...meta })),
  });
});

router.get('/drive-options', async (_req, res) => {
  try {
    res.json(await listDriveOptions());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT u.id, u.name, u.email, u.role, u.permissions, u.active, u.drive_access, u.employee_id, e.name AS employee_name, u.created_at
       FROM users u LEFT JOIN employees e ON e.id = u.employee_id ORDER BY u.name`
    );
    res.json(rows.map(sanitizeUser));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const { name, email, password, role = 'member', permissions = [], active = true, drive_access = [], employee_id = null } = req.body;
    if (!name?.trim() || !email?.trim() || !password) {
      return res.status(400).json({ error: 'Nom, email et mot de passe requis' });
    }
    const pwErr = validatePassword(password);
    if (pwErr) return res.status(400).json({ error: pwErr });

    const perms = role === 'admin' ? ['*'] : permissions.filter(p => ALL_PERMISSION_KEYS.includes(p));
    const driveAccess = role === 'admin' ? [] : sanitizeDriveAccess(drive_access);
    const hash = await bcrypt.hash(password, 12);
    const { rows } = await pool.query(
      `INSERT INTO users (name, email, password_hash, role, permissions, active, drive_access, employee_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, name, email, role, permissions, active, drive_access, employee_id, created_at`,
      [name.trim(), email.trim().toLowerCase(), hash, role === 'admin' ? 'admin' : 'member', JSON.stringify(perms), active !== false, JSON.stringify(driveAccess), employee_id || null]
    );
    const { rows: full } = await pool.query(
      `SELECT u.id, u.name, u.email, u.role, u.permissions, u.active, u.drive_access, u.employee_id, e.name AS employee_name, u.created_at
       FROM users u LEFT JOIN employees e ON e.id = u.employee_id WHERE u.id = $1`,
      [rows[0].id]
    );
    res.status(201).json(sanitizeUser(full[0]));
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'Cet email est déjà utilisé' });
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const { name, email, password, role, permissions, active, drive_access, employee_id } = req.body;
    const { rows: existing } = await pool.query('SELECT * FROM users WHERE id = $1', [req.params.id]);
    if (!existing[0]) return res.status(404).json({ error: 'Utilisateur introuvable' });

    const u = existing[0];
    if (u.role === 'admin' && active === false) {
      const { rows: remaining } = await pool.query("SELECT COUNT(*)::int AS c FROM users WHERE role = 'admin' AND active = true AND id != $1", [u.id]);
      if (remaining[0].c < 1) {
        return res.status(400).json({ error: 'Impossible de désactiver le dernier administrateur' });
      }
    }

    const newRole = role ?? u.role;
    const perms = newRole === 'admin'
      ? ['*']
      : (permissions ?? JSON.parse(u.permissions || '[]')).filter(p => ALL_PERMISSION_KEYS.includes(p));
    const driveAccess = newRole === 'admin'
      ? []
      : sanitizeDriveAccess(drive_access ?? JSON.parse(u.drive_access || '[]'));

    let hash = u.password_hash;
    if (password) {
      const pwErr = validatePassword(password);
      if (pwErr) return res.status(400).json({ error: pwErr });
      hash = await bcrypt.hash(password, 12);
    }

    const { rows } = await pool.query(
      `UPDATE users SET name=$1, email=$2, password_hash=$3, role=$4, permissions=$5, active=$6, drive_access=$7, employee_id=$8
       WHERE id=$9 RETURNING id`,
      [
        (name ?? u.name).trim(),
        (email ?? u.email).trim().toLowerCase(),
        hash,
        newRole === 'admin' ? 'admin' : 'member',
        JSON.stringify(perms),
        active ?? u.active,
        JSON.stringify(driveAccess),
        employee_id !== undefined ? (employee_id || null) : u.employee_id,
        req.params.id,
      ]
    );
    const { rows: full } = await pool.query(
      `SELECT u.id, u.name, u.email, u.role, u.permissions, u.active, u.drive_access, u.employee_id, e.name AS employee_name, u.created_at
       FROM users u LEFT JOIN employees e ON e.id = u.employee_id WHERE u.id = $1`,
      [rows[0].id]
    );
    res.json(sanitizeUser(full[0]));
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'Cet email est déjà utilisé' });
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Utilisateur introuvable' });
    if (Number(req.params.id) === req.user.id) {
      return res.status(400).json({ error: 'Vous ne pouvez pas supprimer votre propre compte' });
    }
    if (rows[0].role === 'admin') {
      const { rows: c } = await pool.query("SELECT COUNT(*)::int AS n FROM users WHERE role = 'admin' AND active = true");
      if (c[0].n <= 1) return res.status(400).json({ error: 'Impossible de supprimer le dernier administrateur' });
    }
    await pool.query('DELETE FROM users WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;

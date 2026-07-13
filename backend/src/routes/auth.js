import { Router } from 'express';
import bcrypt from 'bcrypt';
import pool from '../db/pool.js';
import { signToken, authMiddleware } from '../middleware/auth.js';
import { rateLimit } from '../middleware/security.js';
import { validatePassword } from '../config.js';

import { sanitizeUser } from '../config/permissions.js';

const router = Router();

// Hash bcrypt fixe pour éviter les fuites de timing (utilisateur inconnu)
const DUMMY_HASH = '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgCfl7p92ldGxad68LJZdL17lhWy';

const loginLimiter = rateLimit({
  windowMs: 15 * 60_000,
  max: 8,
  keyFn: (req) => `${req.ip || 'ip'}:${String(req.body?.email || '').toLowerCase()}`,
});

router.post('/login', loginLimiter, async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');

    if (!email || !password) {
      return res.status(400).json({ error: 'Email et mot de passe requis' });
    }

    const { rows } = await pool.query(
      `SELECT u.*, e.name AS employee_name FROM users u
       LEFT JOIN employees e ON e.id = u.employee_id
       WHERE LOWER(u.email) = $1`,
      [email]
    );
    const user = rows[0];
    const hash = user?.password_hash || DUMMY_HASH;
    const valid = await bcrypt.compare(password, hash);

    if (!user || !valid) {
      return res.status(401).json({ error: 'Identifiants invalides' });
    }
    if (user.active === false) {
      return res.status(403).json({ error: 'Compte désactivé — contactez un administrateur' });
    }

    const token = signToken(user);
    res.json({ token, user: sanitizeUser(user) });
  } catch {
    res.status(500).json({ error: 'Erreur de connexion' });
  }
});

router.get('/me', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT u.id, u.name, u.email, u.role, u.permissions, u.active, u.drive_access, u.employee_id, e.name AS employee_name, u.created_at FROM users u LEFT JOIN employees e ON e.id = u.employee_id WHERE u.id = $1',
      [req.user.id]
    );
    if (!rows[0]) return res.status(401).json({ error: 'Utilisateur introuvable' });
    if (rows[0].active === false) return res.status(403).json({ error: 'Compte désactivé' });
    res.json(sanitizeUser(rows[0]));
  } catch {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.put('/password', authMiddleware, async (req, res) => {
  try {
    const { current_password, new_password } = req.body;
    const pwErr = validatePassword(new_password);
    if (pwErr) return res.status(400).json({ error: pwErr });

    const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [req.user.id]);
    if (!rows[0]) return res.status(401).json({ error: 'Utilisateur introuvable' });

    const valid = await bcrypt.compare(current_password || '', rows[0].password_hash);
    if (!valid) return res.status(401).json({ error: 'Mot de passe actuel incorrect' });

    const hash = await bcrypt.hash(new_password, 12);
    await pool.query('UPDATE users SET password_hash=$1 WHERE id=$2', [hash, req.user.id]);
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.post('/logout', authMiddleware, (_req, res) => {
  res.json({ ok: true });
});

router.get('/security', authMiddleware, async (req, res) => {
  res.json({
    session_days: 7,
    uploads_protected: true,
    login_rate_limited: true,
    user: { id: req.user.id, email: req.user.email },
    production: process.env.NODE_ENV === 'production',
  });
});

export default router;

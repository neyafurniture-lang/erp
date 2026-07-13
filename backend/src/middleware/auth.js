import jwt from 'jsonwebtoken';
import { getJwtSecret } from '../config.js';

const TOKEN_OPTS = { expiresIn: '7d', algorithm: 'HS256' };

export function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token requis' });
  }
  try {
    req.user = jwt.verify(header.slice(7), getJwtSecret(), { algorithms: ['HS256'] });
    next();
  } catch (err) {
    const msg = err.name === 'TokenExpiredError' ? 'Session expirée — reconnectez-vous' : 'Token invalide';
    res.status(401).json({ error: msg });
  }
}

export function signToken(user) {
  return jwt.sign({ id: user.id, email: user.email }, getJwtSecret(), TOKEN_OPTS);
}

export function verifyTokenString(token) {
  return jwt.verify(token, getJwtSecret(), { algorithms: ['HS256'] });
}

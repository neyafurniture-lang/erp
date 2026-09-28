import jwt from 'jsonwebtoken';
import { getJwtSecret } from '../config.js';

export const FINANCE_PURPOSE = 'finance_unlock';
export const FINANCE_TOKEN_TTL = '4h';

export function signFinanceUnlockToken(userId) {
  return jwt.sign(
    { purpose: FINANCE_PURPOSE, uid: userId },
    getJwtSecret(),
    { expiresIn: FINANCE_TOKEN_TTL, algorithm: 'HS256' }
  );
}

/** Exige le jeton émis par POST /analytics/unlock (pas seulement le JWT session). */
export function requireFinanceUnlock(req, res, next) {
  const raw = req.headers['x-finance-token']
    || (typeof req.query?.finance_token === 'string' ? req.query.finance_token : '');
  if (!raw) {
    return res.status(403).json({ error: 'Code Finance requis' });
  }
  try {
    const payload = jwt.verify(String(raw), getJwtSecret(), { algorithms: ['HS256'] });
    if (payload?.purpose !== FINANCE_PURPOSE || Number(payload.uid) !== Number(req.user?.id)) {
      return res.status(403).json({ error: 'Code Finance requis' });
    }
    next();
  } catch {
    return res.status(403).json({ error: 'Session Finance expirée — resaisissez le code' });
  }
}

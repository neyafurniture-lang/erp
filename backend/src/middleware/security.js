import path from 'path';
import jwt from 'jsonwebtoken';
import { getJwtSecret } from '../config.js';

const buckets = new Map();

/** Limiteur simple en mémoire */
export function rateLimit({ windowMs = 60_000, max = 60, keyFn = (req) => req.ip || 'unknown' }) {
  return (req, res, next) => {
    const key = keyFn(req);
    const now = Date.now();
    let bucket = buckets.get(key);
    if (!bucket || now - bucket.start > windowMs) {
      bucket = { start: now, count: 0 };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    if (bucket.count > max) {
      return res.status(429).json({ error: 'Trop de tentatives. Réessayez dans quelques minutes.' });
    }
    next();
  };
}

export function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('X-XSS-Protection', '0');
  // HSTS seulement si la requête arrive déjà en HTTPS (sinon Safari force https://IP et casse le site)
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol || '');
  if (process.env.NODE_ENV === 'production' && proto === 'https') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
}

/** Accès uploads : Authorization ou ?access_token= */
export function uploadAuth(req, res, next) {
  const header = req.headers.authorization;
  const q = req.query.access_token;
  try {
    if (header?.startsWith('Bearer ')) {
      jwt.verify(header.slice(7), getJwtSecret());
      return next();
    }
    if (q && typeof q === 'string') {
      jwt.verify(q, getJwtSecret());
      return next();
    }
  } catch {
    return res.status(401).json({ error: 'Accès fichier refusé' });
  }
  return res.status(401).json({ error: 'Authentification requise' });
}

export function safeResolve(baseDir, requested) {
  const resolved = path.resolve(baseDir, requested);
  const base = path.resolve(baseDir);
  if (!resolved.startsWith(base + path.sep) && resolved !== base) return null;
  return resolved;
}

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp']);

export function imageFileFilter(_req, file, cb) {
  const ext = path.extname(file.originalname || '').toLowerCase();
  const ok = file.mimetype?.startsWith('image/') && IMAGE_EXT.has(ext);
  cb(ok ? null : new Error('Type de fichier non autorisé (images uniquement)'), ok);
}

export function safeImageExt(originalname) {
  const ext = path.extname(originalname || '').toLowerCase();
  return IMAGE_EXT.has(ext) ? ext : '.jpg';
}

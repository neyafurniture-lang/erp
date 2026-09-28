import { Router } from 'express';
import { rateLimit } from '../middleware/security.js';
import { getPublicShopByToken } from '../services/client-shop-lists.js';

const router = Router();

/** Lecture seule — quota serré pour limiter le scraping de tokens. */
const publicShopLimit = rateLimit({
  windowMs: 60_000,
  max: 40,
  keyFn: (req) => `shop:${req.ip || 'unknown'}`,
});

/**
 * GET /api/public/shop/:token
 * Payload minimal (titre, prix, lien, urgence). Aucune donnée ERP sensible.
 */
router.get('/shop/:token', publicShopLimit, async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    const data = await getPublicShopByToken(req.params.token);
    // Message unique : pas de fuite « désactivé vs inexistant »
    if (!data) return res.status(404).json({ error: 'Liste introuvable' });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

export default router;

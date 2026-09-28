import { Router } from 'express';
import { rateLimit } from '../middleware/security.js';
import {
  addShopItem,
  assertPublicShopItem,
  deleteShopItem,
  getPublicShopByToken,
  publicItemPatchFromBody,
  resolvePublicShopList,
  updateShopItem,
} from '../services/client-shop-lists.js';

const router = Router();

/** Lecture — quota serré pour limiter le scraping de tokens. */
const publicShopReadLimit = rateLimit({
  windowMs: 60_000,
  max: 60,
  keyFn: (req) => `shop-read:${req.ip || 'unknown'}`,
});

/** Écriture — plus strict. */
const publicShopWriteLimit = rateLimit({
  windowMs: 60_000,
  max: 30,
  keyFn: (req) => `shop-write:${req.ip || 'unknown'}`,
});

function noStore(res) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
}

/**
 * GET /api/public/shop/:token
 * Payload minimal. Aucune donnée ERP sensible.
 */
router.get('/shop/:token', publicShopReadLimit, async (req, res) => {
  try {
    noStore(res);
    const data = await getPublicShopByToken(req.params.token);
    if (!data) return res.status(404).json({ error: 'Liste introuvable' });
    res.json(data);
  } catch {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

/** POST /api/public/shop/:token/items — ajouter une ligne */
router.post('/shop/:token/items', publicShopWriteLimit, async (req, res) => {
  try {
    noStore(res);
    const list = await resolvePublicShopList(req.params.token);
    if (!list) return res.status(404).json({ error: 'Liste introuvable' });
    const title = String(req.body?.title || '').trim();
    if (!title) return res.status(400).json({ error: 'Nom requis' });
    await addShopItem(list.id, {
      title,
      price: req.body?.price,
      url: req.body?.url,
      urgency: req.body?.urgency || 'normal',
      status: req.body?.status || 'todo',
      notes_public: req.body?.notes || req.body?.notes_public,
    });
    res.status(201).json(await getPublicShopByToken(req.params.token));
  } catch (err) {
    res.status(400).json({ error: err.message || 'Erreur' });
  }
});

/** PATCH /api/public/shop/:token/items/:id — modifier une ligne */
router.patch('/shop/:token/items/:id', publicShopWriteLimit, async (req, res) => {
  try {
    noStore(res);
    const scoped = await assertPublicShopItem(req.params.token, req.params.id);
    if (!scoped) return res.status(404).json({ error: 'Liste introuvable' });
    const patch = publicItemPatchFromBody(req.body || {});
    if (!Object.keys(patch).length) return res.status(400).json({ error: 'Aucune modification' });
    await updateShopItem(scoped.item.id, patch);
    res.json(await getPublicShopByToken(req.params.token));
  } catch (err) {
    res.status(400).json({ error: err.message || 'Erreur' });
  }
});

/** DELETE /api/public/shop/:token/items/:id — supprimer une ligne */
router.delete('/shop/:token/items/:id', publicShopWriteLimit, async (req, res) => {
  try {
    noStore(res);
    const scoped = await assertPublicShopItem(req.params.token, req.params.id);
    if (!scoped) return res.status(404).json({ error: 'Liste introuvable' });
    await deleteShopItem(scoped.item.id);
    res.json(await getPublicShopByToken(req.params.token));
  } catch {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

export default router;

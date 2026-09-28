import { Router } from 'express';
import pool from '../db/pool.js';
import {
  addShopItem,
  createShopList,
  deleteShopItem,
  deleteShopList,
  getShopListAdmin,
  listShopListsForClient,
  rotateShopListToken,
  seedSaunacloudShopList,
  updateShopItem,
  updateShopList,
} from '../services/client-shop-lists.js';

const router = Router();

async function assertClient(id) {
  const { rows } = await pool.query('SELECT id, name FROM clients WHERE id = $1', [id]);
  return rows[0] || null;
}

router.post('/seed-saunacloud', async (_req, res) => {
  try {
    const result = await seedSaunacloudShopList();
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Alias historique (faute d’orthographe) */
router.post('/seed-sonacloud', async (_req, res) => {
  try {
    const result = await seedSaunacloudShopList();
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/by-client/:clientId', async (req, res) => {
  try {
    const clientId = Number(req.params.clientId);
    if (!Number.isFinite(clientId)) return res.status(400).json({ error: 'Client invalide' });
    const client = await assertClient(clientId);
    if (!client) return res.status(404).json({ error: 'Client introuvable' });
    const lists = await listShopListsForClient(clientId);
    res.json({ client, lists });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const list = await getShopListAdmin(Number(req.params.id));
    if (!list) return res.status(404).json({ error: 'Liste introuvable' });
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const clientId = Number(req.body.client_id);
    if (!Number.isFinite(clientId)) return res.status(400).json({ error: 'client_id requis' });
    const client = await assertClient(clientId);
    if (!client) return res.status(404).json({ error: 'Client introuvable' });
    const list = await createShopList({
      client_id: clientId,
      title: req.body.title,
      subtitle: req.body.subtitle,
      show_client_name: req.body.show_client_name,
      expires_at: req.body.expires_at || null,
    });
    res.status(201).json(list);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.patch('/:id', async (req, res) => {
  try {
    const list = await updateShopList(Number(req.params.id), req.body || {});
    if (!list) return res.status(404).json({ error: 'Liste introuvable' });
    res.json(list);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/:id/rotate-token', async (req, res) => {
  try {
    const list = await rotateShopListToken(Number(req.params.id));
    if (!list) return res.status(404).json({ error: 'Liste introuvable' });
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const ok = await deleteShopList(Number(req.params.id));
    if (!ok) return res.status(404).json({ error: 'Liste introuvable' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/items', async (req, res) => {
  try {
    const listId = Number(req.params.id);
    const list = await getShopListAdmin(listId);
    if (!list) return res.status(404).json({ error: 'Liste introuvable' });
    const item = await addShopItem(listId, req.body || {});
    res.status(201).json(item);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.patch('/items/:itemId', async (req, res) => {
  try {
    const item = await updateShopItem(Number(req.params.itemId), req.body || {});
    if (!item) return res.status(404).json({ error: 'Article introuvable' });
    res.json(item);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/items/:itemId', async (req, res) => {
  try {
    const ok = await deleteShopItem(Number(req.params.itemId));
    if (!ok) return res.status(404).json({ error: 'Article introuvable' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;

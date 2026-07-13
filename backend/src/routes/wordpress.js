import { Router } from 'express';
import {
  syncWordPressProducts,
  syncWordPressOrders,
  syncWebPhotos,
  fullWebSync,
  testWordPressConnection,
  getWebStatus,
  listWebOrders,
  listLinkedProducts,
} from '../services/wordpress.js';

const router = Router();

router.get('/status', async (req, res) => {
  try {
    res.json(await getWebStatus());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/orders', async (req, res) => {
  try {
    res.json(await listWebOrders(Number(req.query.limit) || 30));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/products', async (req, res) => {
  try {
    res.json(await listLinkedProducts());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/test', async (req, res) => {
  try {
    res.json(await testWordPressConnection());
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/sync', async (req, res) => {
  try {
    res.json(await syncWordPressProducts());
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/sync-orders', async (req, res) => {
  try {
    res.json(await syncWordPressOrders());
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/sync-photos', async (req, res) => {
  try {
    res.json(await syncWebPhotos());
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/sync-all', async (req, res) => {
  try {
    res.json(await fullWebSync());
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

export default router;

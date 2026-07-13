import { Router } from 'express';
import { getManualForApi } from '../content/erp-manual.js';

const router = Router();

router.get('/', (_req, res) => {
  res.json(getManualForApi());
});

export default router;

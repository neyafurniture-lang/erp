import { Router } from 'express';
import fs from 'fs';
import {
  SKP_MIME,
  resolveSketchupDiskPath,
  verifySketchupEmbedToken,
} from '../services/project-sketchup.js';

const router = Router();

const INNERSCENE_ORIGINS = new Set([
  'https://www.innerscene.com',
  'https://innerscene.com',
]);

function setSketchupCors(req, res) {
  const origin = String(req.headers.origin || '');
  if (INNERSCENE_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  } else {
    // Fetch sans Origin (certains clients) ou outils de debug
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
}

router.options('/sketchup/:token', (req, res) => {
  setSketchupCors(req, res);
  res.status(204).end();
});

/** Fichier .skp public temporaire pour iframe InnerScene (?url=). */
router.get('/sketchup/:token', (req, res) => {
  try {
    setSketchupCors(req, res);
    const payload = verifySketchupEmbedToken(req.params.token);
    const disk = resolveSketchupDiskPath(`/uploads/${payload.rel}`);
    if (!disk || !fs.existsSync(disk)) {
      return res.status(404).json({ error: 'Fichier SketchUp introuvable' });
    }

    const safeName = String(payload.name || 'modele.skp').replace(/[\\"\r\n]/g, '_');
    res.setHeader('Content-Type', SKP_MIME);
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${safeName.replace(/[^\x20-\x7E]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(safeName)}`
    );
    res.setHeader('Cache-Control', 'private, max-age=120');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    fs.createReadStream(disk).pipe(res);
  } catch (err) {
    res.status(401).json({ error: err.message || 'Lien SketchUp expiré' });
  }
});

export default router;

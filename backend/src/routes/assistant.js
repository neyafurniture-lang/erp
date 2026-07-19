import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { processMessage, getSkills, createSkill, updateSkill, deleteSkill, getChatHistory } from '../services/assistant.js';
import { saveFeedback } from '../services/assistant-memory.js';
import { buildOperationPlan, executeOperationPlan } from '../services/assistant-plan.js';
import {
  buildAssistantProtocol,
  executeProtocolAction,
  continueFromChecks,
  runLiaActionLoop,
} from '../services/assistant-protocol.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadDir = path.join(__dirname, '../../uploads/chat');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: uploadDir,
  filename: (req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${Date.now()}-${safe}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024, files: 8 },
  fileFilter: (req, file, cb) => {
    const allowed = /\.(jpe?g|png|gif|webp|pdf|docx?|xlsx?|csv|txt|zip)$/i;
    if (allowed.test(file.originalname) || file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Type de fichier non supporté'));
    }
  },
});

const router = Router();

router.post('/chat', upload.array('files', 8), async (req, res) => {
  try {
    const message = (req.body.message || '').trim();
    const files = req.files || [];

    if (!message && files.length === 0) {
      return res.status(400).json({ error: 'Message ou pièce jointe requis' });
    }

    const attachments = files.map(f => ({
      name: f.originalname,
      url: `/uploads/chat/${f.filename}`,
      type: f.mimetype,
      size: f.size,
    }));

    let pageContext = null;
    if (req.body.context) {
      try {
        pageContext = JSON.parse(req.body.context);
      } catch {
        pageContext = null;
      }
    }

    const result = await processMessage(message || 'Pièces jointes envoyées', attachments, pageContext);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/plan', async (req, res) => {
  try {
    const transcript = String(req.body?.transcript || req.body?.message || '').trim();
    if (!transcript) return res.status(400).json({ error: 'transcript requis' });
    let pageContext = null;
    if (req.body?.context) {
      pageContext = typeof req.body.context === 'string'
        ? JSON.parse(req.body.context)
        : req.body.context;
    }
    res.json(await buildOperationPlan(transcript, pageContext));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Exécute un plan d'opérations confirmé (steps avec action_type). */
router.post('/execute-plan', async (req, res) => {
  try {
    const plan = req.body?.plan || req.body;
    if (!plan?.steps?.length && !plan?.transcript) {
      return res.status(400).json({ error: 'plan.steps requis' });
    }
    let pageContext = req.body?.context || null;
    if (typeof pageContext === 'string') {
      try { pageContext = JSON.parse(pageContext); } catch { pageContext = null; }
    }
    res.json(await executeOperationPlan(plan, pageContext));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/history', async (req, res) => {
  try {
    res.json(await getChatHistory());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Catalogue skills + protocole + schéma de réponse (pour LLM / MCP). */
router.get('/protocol', async (req, res) => {
  try {
    res.json(await buildAssistantProtocol());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Canal d’exécution d’action (même pipeline que la réponse JSON de l’IA).
 * Body: { type, params?, message?, context?, reinterpret? }
 * Retourne toujours un ACTION_CHECK. Si reinterpret=true, Lia enchaîne (autres actions ou finale).
 */
router.post('/action', async (req, res) => {
  try {
    const type = req.body?.type || req.body?.action?.type;
    const params = req.body?.params || req.body?.action?.params || {};
    const message = String(req.body?.message || '').trim();
    const reinterpret = Boolean(req.body?.reinterpret);
    let pageContext = req.body?.context || null;
    if (typeof pageContext === 'string') {
      try { pageContext = JSON.parse(pageContext); } catch { pageContext = null; }
    }
    if (!type) return res.status(400).json({ error: 'type (action) requis' });

    if (reinterpret) {
      const loop = await runLiaActionLoop({
        message: message || `Exécute ${type}`,
        history: [],
        pageContext,
        initialParsed: {
          reply: req.body?.reply || `Exécution de ${type}…`,
          action: { type, params },
          done: false,
        },
      });
      return res.json(loop || { error: 'Lia indisponible' });
    }

    const result = await executeProtocolAction({ type, params, message, pageContext });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Lia réinterprète un ACTION_CHECK puis optionnellement exécute la suite.
 * Body: { message, checks|check, context?, auto_execute? }
 */
router.post('/continue', async (req, res) => {
  try {
    const message = String(req.body?.message || req.body?.user_message || '').trim();
    const autoExecute = req.body?.auto_execute !== false;
    let pageContext = req.body?.context || null;
    if (typeof pageContext === 'string') {
      try { pageContext = JSON.parse(pageContext); } catch { pageContext = null; }
    }
    const checks = Array.isArray(req.body?.checks)
      ? req.body.checks
      : (req.body?.check ? [req.body.check] : []);
    if (!checks.length) return res.status(400).json({ error: 'check ou checks requis' });

    const decision = await continueFromChecks({
      userMessage: message,
      checks,
      history: [],
      pageContext,
    });

    if (!autoExecute || !decision.action?.type) {
      return res.json({
        ...decision,
        reply: decision.reply,
        actions: [],
        checks,
        done: true,
      });
    }

    const loop = await runLiaActionLoop({
      message: message || 'Suite après check',
      history: [],
      pageContext,
      initialParsed: {
        reply: decision.reply,
        action: decision.action,
        done: false,
      },
    });
    res.json(loop || decision);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/feedback', async (req, res) => {
  try {
    const { message_id, rating, correction } = req.body;
    if (!message_id || rating == null) return res.status(400).json({ error: 'message_id et rating requis' });
    await saveFeedback(message_id, rating, correction);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/skills', async (req, res) => {
  try {
    res.json(await getSkills());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/skills', async (req, res) => {
  try {
    const skill = await createSkill(req.body);
    res.status(201).json(skill);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/skills/:id', async (req, res) => {
  try {
    const skill = await updateSkill(Number(req.params.id), req.body);
    res.json(skill);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/skills/:id', async (req, res) => {
  try {
    await deleteSkill(Number(req.params.id));
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

export default router;

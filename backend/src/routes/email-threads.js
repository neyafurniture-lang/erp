import { Router } from 'express';
import pool from '../db/pool.js';
import {
  getThreadDetail,
  linkThread,
  listThreads,
  processGmailMessage,
  processRecentInbox,
  reviseDraft,
  syncGmailThread,
  synthesizeThread,
} from '../services/email-threads.js';

const router = Router();

router.get('/', async (req, res) => {
  try {
    res.json(await listThreads({
      client_id: req.query.client_id,
      project_id: req.query.project_id,
      status: req.query.status,
      unlinked: req.query.unlinked,
      limit: Number(req.query.limit) || 50,
    }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/process-inbox', async (req, res) => {
  try {
    res.json(await processRecentInbox(Number(req.body?.max) || 15));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/process-message', async (req, res) => {
  try {
    const { message_id } = req.body;
    if (!message_id) return res.status(400).json({ error: 'message_id requis' });
    res.json(await processGmailMessage(message_id));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** Réécriture brouillon sans id de fil (doit rester avant /:id). */
router.post('/revise-draft', async (req, res) => {
  try {
    const { draft, instruction, mode, thread_id } = req.body || {};
    res.json(await reviseDraft({
      draft,
      instruction,
      mode: mode === 'spellcheck' ? 'spellcheck' : 'revise',
      threadId: thread_id || null,
    }));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/sync/:gmailThreadId', async (req, res) => {
  try {
    res.json(await syncGmailThread(req.params.gmailThreadId, req.body || {}));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/by-gmail/:gmailThreadId', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id FROM email_threads WHERE gmail_thread_id = $1',
      [req.params.gmailThreadId]
    );
    if (!rows[0]) {
      const synced = await syncGmailThread(req.params.gmailThreadId);
      return res.json(synced);
    }
    res.json(await getThreadDetail(rows[0].id));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const thread = await getThreadDetail(Number(req.params.id));
    if (!thread) return res.status(404).json({ error: 'Fil introuvable' });
    res.json(thread);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/link', async (req, res) => {
  try {
    const { client_id, project_id } = req.body;
    res.json(await linkThread(Number(req.params.id), { client_id, project_id }));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/:id/synthesize', async (req, res) => {
  try {
    res.json(await synthesizeThread(Number(req.params.id)));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/:id/revise-draft', async (req, res) => {
  try {
    const { draft, instruction, mode } = req.body || {};
    res.json(await reviseDraft({
      draft,
      instruction,
      mode: mode === 'spellcheck' ? 'spellcheck' : 'revise',
      threadId: Number(req.params.id),
    }));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

export default router;

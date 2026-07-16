import { Router } from 'express';
import pool from '../db/pool.js';
import {
  buildAuthUrl,
  exchangeCode,
  saveGoogleTokens,
  disconnectGoogle,
  verifyOAuthState,
  getGoogleTokenRow,
  getGoogleConfig,
} from '../services/google-oauth.js';
import { logAgentAction } from '../services/assistant-memory.js';

const router = Router();

router.get('/status', async (_req, res) => {
  try {
    const row = await getGoogleTokenRow();
    const cfg = await getGoogleConfig();
    const connected = Boolean(row?.access_token);
    res.json({
      google: {
        configured: cfg.configured,
        redirect_uri: cfg.redirectUri,
        oauth_ip_blocked: cfg.oauthIpBlocked,
        suggested_redirect_uri: cfg.suggestedRedirectUri,
        connected,
        email: row?.account_email || null,
        expires_at: row?.expires_at || null,
        scopes: row?.scopes || [],
      },
      google_drive: { enabled: true, connected, email: row?.account_email },
      gmail: { enabled: true, connected, email: row?.account_email },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/google/authorize', async (req, res) => {
  try {
    const url = await buildAuthUrl(req.user.id);
    if (req.query.redirect === '1') return res.redirect(url);
    res.json({ url });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** Callback OAuth — monté en route publique dans index.js */
export async function handleGoogleCallback(req, res) {
  const frontend = (process.env.FRONTEND_URL || 'http://localhost:3000').split(',')[0];
  try {
    const { code, state, error } = req.query;
    if (error) return res.redirect(`${frontend}/settings?tab=integrations&google_error=${encodeURIComponent(error)}`);
    if (!code || !state) return res.redirect(`${frontend}/settings?tab=integrations&google_error=missing_code`);

    verifyOAuthState(state);
    const tokens = await exchangeCode(code);
    const email = await saveGoogleTokens(tokens);
    res.redirect(`${frontend}/settings?tab=integrations&google_connected=1&email=${encodeURIComponent(email || '')}`);
  } catch (err) {
    res.redirect(`${frontend}/settings?tab=integrations&google_error=${encodeURIComponent(err.message)}`);
  }
}

router.post('/google/disconnect', async (req, res) => {
  try {
    await disconnectGoogle();
    await logAgentAction({ agent: 'general', action: 'google_disconnect', resource: 'integration', userId: req.user?.id });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Créer / récupérer le dossier Drive d’un projet (sous Client dans NEYA ERP). */
router.post('/projects/:projectId/drive-folder', async (req, res) => {
  try {
    const { ensureProjectFolder } = await import('../services/drive-folders.js');
    const result = await ensureProjectFolder(Number(req.params.projectId));
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** Créer / récupérer le dossier Drive d’un client (NEYA ERP / Clients / …). */
router.post('/clients/:clientId/drive-folder', async (req, res) => {
  try {
    const { ensureClientFolder } = await import('../services/drive-folders.js');
    const result = await ensureClientFolder(Number(req.params.clientId));
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/projects/:projectId/emails', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM project_emails WHERE project_id = $1 ORDER BY linked_at DESC',
      [req.params.projectId]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/projects/:projectId/emails', async (req, res) => {
  try {
    const { gmail_message_id, thread_id, subject, from_email, snippet } = req.body;
    const { rows } = await pool.query(
      `INSERT INTO project_emails (project_id, gmail_message_id, thread_id, subject, from_email, snippet)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (gmail_message_id) DO UPDATE SET project_id = $1, subject = $4
       RETURNING *`,
      [req.params.projectId, gmail_message_id, thread_id, subject, from_email, snippet]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;

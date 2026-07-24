import { Router } from 'express';
import pool from '../db/pool.js';
import { isAdmin, parsePermissions } from '../config/permissions.js';

const router = Router();

function canAccessMeetings(user) {
  if (!user || user.active === false) return false;
  if (isAdmin(user)) return true;
  const perms = parsePermissions(user.permissions);
  return perms.includes('meetings')
    || perms.includes('calendar')
    || perms.includes('admin')
    || perms.includes('*');
}

async function loadUser(req) {
  if (req.account) return req.account;
  const { rows } = await pool.query(
    'SELECT id, email, role, permissions, active FROM users WHERE id = $1',
    [req.user?.id]
  );
  if (!rows[0] || rows[0].active === false) return null;
  req.account = rows[0];
  return rows[0];
}

function requireMeetingsAccess(req, res, next) {
  loadUser(req)
    .then((user) => {
      if (!user || !canAccessMeetings(user)) {
        return res.status(403).json({ error: 'Permission insuffisante (réunions)' });
      }
      next();
    })
    .catch((err) => res.status(500).json({ error: err.message }));
}

router.use(requireMeetingsAccess);

function mapRow(row) {
  if (!row) return null;
  return {
    id: row.client_key,
    serverId: row.id,
    title: row.title || '',
    transcript: row.transcript || '',
    startedAt: row.started_at || null,
    savedAt: row.saved_at || row.updated_at || null,
    hasAudio: Boolean(row.has_audio),
    userId: row.user_id || null,
  };
}

function normalizeIncoming(body = {}) {
  const clientKey = String(body.id || body.client_key || '').trim();
  const title = String(body.title || '').trim().slice(0, 240);
  const transcript = String(body.transcript || '');
  const startedAt = body.startedAt || body.started_at || null;
  const savedAt = body.savedAt || body.saved_at || new Date().toISOString();
  const hasAudio = Boolean(body.hasAudio ?? body.has_audio);
  return { clientKey, title, transcript, startedAt, savedAt, hasAudio };
}

router.get('/', async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 80, 1), 200);
    const { rows } = await pool.query(
      `SELECT * FROM meetings
       ORDER BY saved_at DESC NULLS LAST, id DESC
       LIMIT $1`,
      [limit]
    );
    res.json(rows.map(mapRow));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:key', async (req, res) => {
  try {
    const key = String(req.params.key || '').trim();
    const asId = Number(key);
    const { rows } = await pool.query(
      Number.isFinite(asId) && String(asId) === key
        ? 'SELECT * FROM meetings WHERE id = $1'
        : 'SELECT * FROM meetings WHERE client_key = $1',
      [Number.isFinite(asId) && String(asId) === key ? asId : key]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Réunion introuvable' });
    res.json(mapRow(rows[0]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Upsert par client_key (id local m_…) */
router.put('/:key', async (req, res) => {
  try {
    const key = String(req.params.key || req.body?.id || '').trim();
    if (!key) return res.status(400).json({ error: 'id requis' });
    const incoming = normalizeIncoming({ ...req.body, id: key });
    if (!incoming.transcript && !incoming.title) {
      return res.status(400).json({ error: 'Titre ou transcription requis' });
    }
    const { rows } = await pool.query(
      `INSERT INTO meetings (client_key, user_id, title, transcript, started_at, saved_at, has_audio, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
       ON CONFLICT (client_key) DO UPDATE SET
         title = EXCLUDED.title,
         transcript = EXCLUDED.transcript,
         started_at = COALESCE(EXCLUDED.started_at, meetings.started_at),
         saved_at = EXCLUDED.saved_at,
         has_audio = EXCLUDED.has_audio OR meetings.has_audio,
         user_id = COALESCE(meetings.user_id, EXCLUDED.user_id),
         updated_at = NOW()
       RETURNING *`,
      [
        key,
        req.user?.id || null,
        incoming.title || 'Réunion',
        incoming.transcript,
        incoming.startedAt,
        incoming.savedAt,
        incoming.hasAudio,
      ]
    );
    res.json(mapRow(rows[0]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const incoming = normalizeIncoming(req.body);
    const key = incoming.clientKey || `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    if (!incoming.transcript && !incoming.title) {
      return res.status(400).json({ error: 'Titre ou transcription requis' });
    }
    const { rows } = await pool.query(
      `INSERT INTO meetings (client_key, user_id, title, transcript, started_at, saved_at, has_audio, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
       ON CONFLICT (client_key) DO UPDATE SET
         title = EXCLUDED.title,
         transcript = EXCLUDED.transcript,
         started_at = COALESCE(EXCLUDED.started_at, meetings.started_at),
         saved_at = EXCLUDED.saved_at,
         has_audio = EXCLUDED.has_audio OR meetings.has_audio,
         user_id = COALESCE(meetings.user_id, EXCLUDED.user_id),
         updated_at = NOW()
       RETURNING *`,
      [
        key,
        req.user?.id || null,
        incoming.title || 'Réunion',
        incoming.transcript,
        incoming.startedAt,
        incoming.savedAt,
        incoming.hasAudio,
      ]
    );
    res.status(201).json(mapRow(rows[0]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Import / sync bulk depuis localStorage navigateur */
router.post('/sync', async (req, res) => {
  try {
    const list = Array.isArray(req.body?.meetings) ? req.body.meetings : [];
    let upserted = 0;
    const out = [];
    for (const item of list.slice(0, 100)) {
      const incoming = normalizeIncoming(item);
      if (!incoming.clientKey) continue;
      if (!incoming.transcript && !incoming.title) continue;
      const { rows } = await pool.query(
        `INSERT INTO meetings (client_key, user_id, title, transcript, started_at, saved_at, has_audio, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
         ON CONFLICT (client_key) DO UPDATE SET
           title = CASE
             WHEN length(EXCLUDED.transcript) >= length(meetings.transcript) THEN EXCLUDED.title
             ELSE meetings.title
           END,
           transcript = CASE
             WHEN length(EXCLUDED.transcript) >= length(meetings.transcript) THEN EXCLUDED.transcript
             ELSE meetings.transcript
           END,
           started_at = COALESCE(meetings.started_at, EXCLUDED.started_at),
           saved_at = GREATEST(COALESCE(meetings.saved_at, EXCLUDED.saved_at), EXCLUDED.saved_at),
           has_audio = EXCLUDED.has_audio OR meetings.has_audio,
           user_id = COALESCE(meetings.user_id, EXCLUDED.user_id),
           updated_at = NOW()
         RETURNING *`,
        [
          incoming.clientKey,
          req.user?.id || null,
          incoming.title || 'Réunion',
          incoming.transcript,
          incoming.startedAt,
          incoming.savedAt,
          incoming.hasAudio,
        ]
      );
      if (rows[0]) {
        upserted += 1;
        out.push(mapRow(rows[0]));
      }
    }
    const { rows: all } = await pool.query(
      `SELECT * FROM meetings ORDER BY saved_at DESC NULLS LAST, id DESC LIMIT 80`
    );
    res.json({ ok: true, upserted, meetings: all.map(mapRow) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:key', async (req, res) => {
  try {
    const key = String(req.params.key || '').trim();
    const asId = Number(key);
    const { rowCount } = await pool.query(
      Number.isFinite(asId) && String(asId) === key
        ? 'DELETE FROM meetings WHERE id = $1'
        : 'DELETE FROM meetings WHERE client_key = $1',
      [Number.isFinite(asId) && String(asId) === key ? asId : key]
    );
    if (!rowCount) return res.status(404).json({ error: 'Réunion introuvable' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;

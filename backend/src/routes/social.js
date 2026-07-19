import { Router } from 'express';
import pool from '../db/pool.js';
import { proposePostsFromDrive, listAnalyzedMedia, PLATFORMS } from '../services/social-propose.js';
import {
  getSocialStatusSummary,
  buildMetaAuthUrl,
  buildPinterestAuthUrl,
  disconnectSocial,
} from '../services/social-accounts.js';

const router = Router();

async function ensureTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS social_posts (
      id SERIAL PRIMARY KEY,
      title TEXT,
      caption TEXT NOT NULL DEFAULT '',
      platforms TEXT[] NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'draft',
      scheduled_at TIMESTAMPTZ,
      published_at TIMESTAMPTZ,
      media JSONB NOT NULL DEFAULT '[]',
      metrics JSONB NOT NULL DEFAULT '{}',
      source TEXT DEFAULT 'manual',
      external_ids JSONB NOT NULL DEFAULT '{}',
      notes TEXT,
      created_by INT REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_social_posts_status ON social_posts(status)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_social_posts_scheduled ON social_posts(scheduled_at)`);
}

let ready;
function readyTables() {
  if (!ready) ready = ensureTables();
  return ready;
}

function normalizePlatforms(raw) {
  if (Array.isArray(raw)) return raw.map(String).filter(Boolean);
  if (typeof raw === 'string' && raw.trim()) {
    return raw.split(',').map(s => s.trim()).filter(Boolean);
  }
  return ['instagram'];
}

/** Comptes connectés (Meta / Pinterest / …) */
router.get('/accounts', async (_req, res) => {
  try {
    res.json(await getSocialStatusSummary());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/accounts/:provider/authorize', async (req, res) => {
  try {
    const provider = String(req.params.provider || '').toLowerCase();
    let result;
    if (provider === 'instagram' || provider === 'facebook') {
      result = await buildMetaAuthUrl(provider, req.user?.id);
    } else if (provider === 'pinterest') {
      result = await buildPinterestAuthUrl(req.user?.id);
    } else {
      return res.status(400).json({ error: `Connexion ${provider} pas encore disponible` });
    }
    if (req.query.redirect === '1') return res.redirect(result.url);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/accounts/:provider/disconnect', async (req, res) => {
  try {
    await disconnectSocial(String(req.params.provider || '').toLowerCase());
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Médiathèque : photos produit analysées (factures exclues). */
router.get('/media', async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 24, 48);
    const data = await listAnalyzedMedia(req, { limit, query: req.query.q || null });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Semaine type planifiée (templates locaux, sans Drive). */
router.post('/seed-week', async (req, res) => {
  try {
    await readyTables();
    const { localWeekProposals } = await import('../services/social-propose.js');
    const proposals = localWeekProposals(Number(req.body.count) || 6);
    const created = [];
    for (const p of proposals) {
      const { rows } = await pool.query(
        `INSERT INTO social_posts (title, caption, platforms, status, scheduled_at, media, source, created_by)
         VALUES ($1,$2,$3,'scheduled',$4,$5,'local_template',$6)
         RETURNING *`,
        [
          p.title,
          p.caption,
          p.platforms,
          p.scheduled_at,
          JSON.stringify(p.media || []),
          req.user?.id || null,
        ]
      );
      created.push(rows[0]);
    }
    res.status(201).json({ created: created.length, posts: created });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/platforms', (_req, res) => {
  res.json(PLATFORMS.map(value => ({
    value,
    label: ({
      instagram: 'Instagram',
      facebook: 'Facebook',
      pinterest: 'Pinterest',
      tiktok: 'TikTok',
      linkedin: 'LinkedIn',
    })[value] || value,
  })));
});

/** Propositions auto depuis photos produit Drive (docs/factures exclus) */
router.get('/propose', async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 6, 12);
    const data = await proposePostsFromDrive(req, { limit, query: req.query.q || null });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Analytics agrégées (métriques saisies + compteurs locaux ; OAuth Meta à brancher ensuite) */
router.get('/analytics', async (req, res) => {
  try {
    await readyTables();
    const { rows: posts } = await pool.query(
      `SELECT id, title, platforms, status, published_at, scheduled_at, metrics, created_at
       FROM social_posts
       ORDER BY COALESCE(published_at, scheduled_at, created_at) DESC
       LIMIT 200`
    );

    const byPlatform = {};
    let likes = 0;
    let reach = 0;
    let comments = 0;
    let published = 0;
    let scheduled = 0;
    let drafts = 0;

    for (const p of posts) {
      if (p.status === 'published') published += 1;
      else if (p.status === 'scheduled') scheduled += 1;
      else drafts += 1;

      const m = p.metrics || {};
      likes += Number(m.likes || m.like_count || 0);
      reach += Number(m.reach || m.impressions || 0);
      comments += Number(m.comments || m.comment_count || 0);

      for (const plat of p.platforms || []) {
        if (!byPlatform[plat]) {
          byPlatform[plat] = { platform: plat, posts: 0, likes: 0, reach: 0, comments: 0 };
        }
        byPlatform[plat].posts += 1;
        byPlatform[plat].likes += Number(m.likes || m.like_count || 0);
        byPlatform[plat].reach += Number(m.reach || m.impressions || 0);
        byPlatform[plat].comments += Number(m.comments || m.comment_count || 0);
      }
    }

    const social = await getSocialStatusSummary().catch(() => ({ connected_count: 0 }));
    res.json({
      totals: { posts: posts.length, published, scheduled, drafts, likes, reach, comments },
      by_platform: Object.values(byPlatform),
      recent: posts.slice(0, 20),
      meta_connected: (social.connected_count || 0) > 0,
      note: social.connected_count
        ? 'Comptes connectés — la sync analytics Graph API arrive ensuite.'
        : 'Connectez Instagram / Facebook / Pinterest dans l’onglet Comptes. En attendant, saisissez les métriques manuellement.',
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/', async (req, res) => {
  try {
    await readyTables();
    const { status, platform } = req.query;
    const params = [];
    let where = 'WHERE 1=1';
    if (status) { params.push(status); where += ` AND status = $${params.length}`; }
    if (platform) { params.push(platform); where += ` AND $${params.length} = ANY(platforms)`; }

    const { rows } = await pool.query(
      `SELECT * FROM social_posts ${where}
       ORDER BY
         CASE status WHEN 'scheduled' THEN 0 WHEN 'draft' THEN 1 WHEN 'published' THEN 2 ELSE 3 END,
         COALESCE(scheduled_at, created_at) DESC
       LIMIT 300`,
      params
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    await readyTables();
    const { rows } = await pool.query('SELECT * FROM social_posts WHERE id = $1', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Post introuvable' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    await readyTables();
    const {
      title, caption, platforms, status, scheduled_at, media, metrics, source, notes,
    } = req.body || {};
    const plats = normalizePlatforms(platforms);
    const st = status || (scheduled_at ? 'scheduled' : 'draft');
    const { rows } = await pool.query(
      `INSERT INTO social_posts
        (title, caption, platforms, status, scheduled_at, media, metrics, source, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING *`,
      [
        title || null,
        caption || '',
        plats,
        st,
        scheduled_at || null,
        JSON.stringify(media || []),
        JSON.stringify(metrics || {}),
        source || 'manual',
        notes || null,
        req.user?.id || null,
      ]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Accepter une proposition Drive → créer un post planifié en 1 clic */
router.post('/from-proposal', async (req, res) => {
  try {
    await readyTables();
    const p = req.body || {};
    if (!p.caption && !p.media?.length) {
      return res.status(400).json({ error: 'Proposition invalide' });
    }
    const { rows } = await pool.query(
      `INSERT INTO social_posts
        (title, caption, platforms, status, scheduled_at, media, source, created_by)
       VALUES ($1,$2,$3,'scheduled',$4,$5,'drive_auto',$6)
       RETURNING *`,
      [
        p.title || null,
        p.caption || '',
        normalizePlatforms(p.platforms),
        p.scheduled_at || null,
        JSON.stringify(p.media || []),
        req.user?.id || null,
      ]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    await readyTables();
    const { rows: existing } = await pool.query('SELECT * FROM social_posts WHERE id = $1', [req.params.id]);
    if (!existing[0]) return res.status(404).json({ error: 'Post introuvable' });
    const t = { ...existing[0], ...req.body };
    if (req.body.platforms) t.platforms = normalizePlatforms(req.body.platforms);
    const { rows } = await pool.query(
      `UPDATE social_posts SET
         title=$1, caption=$2, platforms=$3, status=$4, scheduled_at=$5, published_at=$6,
         media=$7, metrics=$8, notes=$9, updated_at=NOW()
       WHERE id=$10 RETURNING *`,
      [
        t.title, t.caption || '', t.platforms, t.status,
        t.scheduled_at || null, t.published_at || null,
        JSON.stringify(t.media || []),
        JSON.stringify(t.metrics || {}),
        t.notes || null,
        req.params.id,
      ]
    );
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/:id/metrics', async (req, res) => {
  try {
    await readyTables();
    const { rows: existing } = await pool.query('SELECT metrics FROM social_posts WHERE id = $1', [req.params.id]);
    if (!existing[0]) return res.status(404).json({ error: 'Post introuvable' });
    const merged = { ...(existing[0].metrics || {}), ...(req.body || {}) };
    const { rows } = await pool.query(
      `UPDATE social_posts SET metrics=$1, updated_at=NOW() WHERE id=$2 RETURNING *`,
      [JSON.stringify(merged), req.params.id]
    );
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/:id/publish', async (req, res) => {
  try {
    await readyTables();
    const { rows } = await pool.query(
      `UPDATE social_posts SET status='published', published_at=COALESCE(published_at, NOW()), updated_at=NOW()
       WHERE id=$1 RETURNING *`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Post introuvable' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await readyTables();
    await pool.query('DELETE FROM social_posts WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;

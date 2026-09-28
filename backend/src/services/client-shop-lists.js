import pool from '../db/pool.js';
import {
  SHOP_ITEM_STATUSES,
  SHOP_URGENCIES,
  generatePublicToken,
  normalizeItemStatus,
  normalizeUrgency,
  sanitizeShopUrl,
  toPublicShopPayload,
} from './client-shop-lists-security.js';

export {
  SHOP_ITEM_STATUSES,
  SHOP_URGENCIES,
  generatePublicToken,
  normalizeItemStatus,
  normalizeUrgency,
  sanitizeShopUrl,
  toPublicShopPayload,
};

export async function ensureClientShopTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS client_shop_lists (
      id SERIAL PRIMARY KEY,
      client_id INT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      subtitle TEXT,
      public_token TEXT NOT NULL UNIQUE,
      public_enabled BOOLEAN NOT NULL DEFAULT true,
      show_client_name BOOLEAN NOT NULL DEFAULT true,
      expires_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS client_shop_items (
      id SERIAL PRIMARY KEY,
      list_id INT NOT NULL REFERENCES client_shop_lists(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      price NUMERIC(12,2),
      currency TEXT NOT NULL DEFAULT 'CAD',
      url TEXT,
      urgency TEXT NOT NULL DEFAULT 'normal',
      notes_public TEXT,
      status TEXT NOT NULL DEFAULT 'todo',
      sort_order INT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_client_shop_lists_client ON client_shop_lists(client_id)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_client_shop_lists_token ON client_shop_lists(public_token)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_client_shop_items_list ON client_shop_items(list_id)');
}

function touchList(listId, client = pool) {
  return client.query('UPDATE client_shop_lists SET updated_at = NOW() WHERE id = $1', [listId]);
}

export async function getPublicShopByToken(token) {
  const list = await resolvePublicShopList(token);
  if (!list) return null;

  const { rows: items } = await pool.query(
    `SELECT id, title, price, currency, url, urgency, notes_public, status, sort_order
     FROM client_shop_items
     WHERE list_id = $1
     ORDER BY
       CASE urgency WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
       sort_order ASC,
       id ASC`,
    [list.id]
  );
  return toPublicShopPayload(list, items);
}

/** Résout une liste publique active (interne). null si token invalide / désactivé / expiré. */
export async function resolvePublicShopList(token) {
  const t = String(token || '').trim();
  if (!t || t.length < 20 || t.length > 128) return null;

  const { rows } = await pool.query(
    `SELECT l.*, c.name AS client_name
     FROM client_shop_lists l
     JOIN clients c ON c.id = l.client_id
     WHERE l.public_token = $1
     LIMIT 1`,
    [t]
  );
  const list = rows[0];
  if (!list) return null;
  if (!list.public_enabled) return null;
  if (list.expires_at && new Date(list.expires_at).getTime() < Date.now()) return null;
  return list;
}

/** Vérifie qu’un item appartient à la liste du token public. */
export async function assertPublicShopItem(token, itemId) {
  const list = await resolvePublicShopList(token);
  if (!list) return null;
  const id = Number(itemId);
  if (!Number.isFinite(id)) return null;
  const { rows } = await pool.query(
    'SELECT * FROM client_shop_items WHERE id = $1 AND list_id = $2',
    [id, list.id]
  );
  if (!rows[0]) return null;
  return { list, item: rows[0] };
}

/** Champs autorisés pour l’édition publique (whitelist). */
export function publicItemPatchFromBody(body = {}) {
  const patch = {};
  if (body.title !== undefined) patch.title = body.title;
  if (body.price !== undefined) patch.price = body.price;
  if (body.url !== undefined) patch.url = body.url;
  if (body.urgency !== undefined) patch.urgency = body.urgency;
  if (body.status !== undefined) patch.status = body.status;
  if (body.notes_public !== undefined) patch.notes_public = body.notes_public;
  if (body.notes !== undefined) patch.notes_public = body.notes;
  return patch;
}

export async function listShopListsForClient(clientId) {
  const { rows } = await pool.query(
    `SELECT l.*,
       (SELECT COUNT(*)::int FROM client_shop_items i WHERE i.list_id = l.id) AS items_count,
       (SELECT COUNT(*)::int FROM client_shop_items i WHERE i.list_id = l.id AND i.status != 'done') AS open_count
     FROM client_shop_lists l
     WHERE l.client_id = $1
     ORDER BY l.updated_at DESC, l.id DESC`,
    [clientId]
  );
  return rows;
}

export async function getShopListAdmin(listId) {
  const { rows } = await pool.query(
    `SELECT l.*, c.name AS client_name
     FROM client_shop_lists l
     JOIN clients c ON c.id = l.client_id
     WHERE l.id = $1`,
    [listId]
  );
  if (!rows[0]) return null;
  const { rows: items } = await pool.query(
    `SELECT * FROM client_shop_items WHERE list_id = $1
     ORDER BY sort_order ASC, id ASC`,
    [listId]
  );
  return { ...rows[0], items };
}

export async function createShopList({ client_id, title, subtitle, show_client_name = true, expires_at = null }) {
  const token = generatePublicToken();
  const { rows } = await pool.query(
    `INSERT INTO client_shop_lists (client_id, title, subtitle, public_token, show_client_name, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      client_id,
      String(title || '').trim() || 'Liste d’achats',
      subtitle?.trim() || null,
      token,
      show_client_name !== false,
      expires_at || null,
    ]
  );
  return rows[0];
}

export async function updateShopList(listId, patch) {
  const cur = await getShopListAdmin(listId);
  if (!cur) return null;
  const title = patch.title !== undefined ? String(patch.title).trim() : cur.title;
  if (!title) throw new Error('Titre requis');
  const { rows } = await pool.query(
    `UPDATE client_shop_lists SET
       title = $1,
       subtitle = $2,
       public_enabled = $3,
       show_client_name = $4,
       expires_at = $5,
       updated_at = NOW()
     WHERE id = $6
     RETURNING *`,
    [
      title,
      patch.subtitle !== undefined ? (String(patch.subtitle || '').trim() || null) : cur.subtitle,
      patch.public_enabled !== undefined ? Boolean(patch.public_enabled) : cur.public_enabled,
      patch.show_client_name !== undefined ? Boolean(patch.show_client_name) : cur.show_client_name,
      patch.expires_at !== undefined ? (patch.expires_at || null) : cur.expires_at,
      listId,
    ]
  );
  return rows[0];
}

export async function rotateShopListToken(listId) {
  const token = generatePublicToken();
  const { rows } = await pool.query(
    `UPDATE client_shop_lists SET public_token = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
    [token, listId]
  );
  return rows[0] || null;
}

export async function deleteShopList(listId) {
  const { rowCount } = await pool.query('DELETE FROM client_shop_lists WHERE id = $1', [listId]);
  return rowCount > 0;
}

export async function addShopItem(listId, body) {
  const title = String(body.title || '').trim();
  if (!title) throw new Error('Titre requis');
  const url = sanitizeShopUrl(body.url);
  const { rows: ord } = await pool.query(
    'SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM client_shop_items WHERE list_id = $1',
    [listId]
  );
  const { rows } = await pool.query(
    `INSERT INTO client_shop_items
       (list_id, title, price, currency, url, urgency, notes_public, status, sort_order)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING *`,
    [
      listId,
      title,
      body.price === '' || body.price == null ? null : Number(body.price),
      String(body.currency || 'CAD').trim() || 'CAD',
      url,
      normalizeUrgency(body.urgency),
      body.notes_public != null ? (String(body.notes_public).trim() || null) : null,
      normalizeItemStatus(body.status),
      ord[0]?.next ?? 0,
    ]
  );
  await touchList(listId);
  return rows[0];
}

export async function updateShopItem(itemId, body) {
  const { rows: existing } = await pool.query('SELECT * FROM client_shop_items WHERE id = $1', [itemId]);
  if (!existing[0]) return null;
  const cur = existing[0];
  const title = body.title !== undefined ? String(body.title).trim() : cur.title;
  if (!title) throw new Error('Titre requis');
  let url = cur.url;
  if (body.url !== undefined) url = sanitizeShopUrl(body.url);
  const { rows } = await pool.query(
    `UPDATE client_shop_items SET
       title = $1,
       price = $2,
       currency = $3,
       url = $4,
       urgency = $5,
       notes_public = $6,
       status = $7,
       sort_order = $8,
       updated_at = NOW()
     WHERE id = $9
     RETURNING *`,
    [
      title,
      body.price !== undefined
        ? (body.price === '' || body.price == null ? null : Number(body.price))
        : cur.price,
      body.currency !== undefined ? (String(body.currency).trim() || 'CAD') : cur.currency,
      url,
      body.urgency !== undefined ? normalizeUrgency(body.urgency) : cur.urgency,
      body.notes_public !== undefined
        ? (String(body.notes_public || '').trim() || null)
        : cur.notes_public,
      body.status !== undefined ? normalizeItemStatus(body.status) : cur.status,
      body.sort_order !== undefined ? Number(body.sort_order) || 0 : cur.sort_order,
      itemId,
    ]
  );
  await touchList(cur.list_id);
  return rows[0];
}

export async function deleteShopItem(itemId) {
  const { rows } = await pool.query('DELETE FROM client_shop_items WHERE id = $1 RETURNING list_id', [itemId]);
  if (rows[0]?.list_id) await touchList(rows[0].list_id);
  return Boolean(rows[0]);
}

/** Seed idempotent : client Saunacloud + liste aménagement atelier. */
export async function seedSaunacloudShopList() {
  await ensureClientShopTables();

  let { rows: clients } = await pool.query(
    `SELECT id, name FROM clients
     WHERE LOWER(REPLACE(TRIM(name), ' ', '')) IN ('saunacloud', 'sonacloud')
     ORDER BY id ASC
     LIMIT 1`
  );
  if (!clients[0]) {
    const ins = await pool.query(
      `INSERT INTO clients (name, notes)
       VALUES ('Saunacloud', 'Client — aménagement atelier (liste d’achats partagée)')
       RETURNING id, name`
    );
    clients = ins.rows;
  } else if (clients[0].name !== 'Saunacloud') {
    // Canonicalise l’orthographe affichée
    await pool.query(`UPDATE clients SET name = 'Saunacloud' WHERE id = $1`, [clients[0].id]);
    clients[0].name = 'Saunacloud';
  }
  const clientId = clients[0].id;

  const { rows: existing } = await pool.query(
    `SELECT id FROM client_shop_lists WHERE client_id = $1 AND title ILIKE $2 LIMIT 1`,
    [clientId, '%aménagement%atelier%']
  );
  if (existing[0]) return { client_id: clientId, list_id: existing[0].id, created: false };

  const list = await createShopList({
    client_id: clientId,
    title: 'Aménagement atelier',
    subtitle: 'Achats à prévoir pour équiper l’atelier — Neya Furniture',
    show_client_name: true,
  });

  const samples = [
    {
      title: 'Établi solide / plan de travail',
      price: 450,
      urgency: 'high',
      url: 'https://www.google.com/search?q=%C3%A9tabli+atelier+bois',
      notes_public: 'Surface stable pour assemblage',
    },
    {
      title: 'Éclairage LED atelier (bande / plafonnier)',
      price: 180,
      urgency: 'high',
      url: 'https://www.google.com/search?q=%C3%A9clairage+LED+atelier',
    },
    {
      title: 'Rangement mural / rayonnage',
      price: 220,
      urgency: 'normal',
      url: 'https://www.google.com/search?q=rayonnage+atelier',
    },
    {
      title: 'Aspiration / dépoussiéreur portable',
      price: 350,
      urgency: 'normal',
      url: 'https://www.google.com/search?q=aspirateur+atelier+bois',
    },
    {
      title: 'Trousse sécurité (lunettes, gants, protecteurs)',
      price: 75,
      urgency: 'critical',
      url: 'https://www.google.com/search?q=%C3%A9quipement+s%C3%A9curit%C3%A9+atelier',
    },
  ];

  for (const s of samples) {
    await addShopItem(list.id, s);
  }

  return { client_id: clientId, list_id: list.id, created: true, public_token: list.public_token };
}

/** @deprecated alias — orthographe correcte : Saunacloud */
export const seedSonacloudShopList = seedSaunacloudShopList;

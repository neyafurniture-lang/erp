import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pool from '../db/pool.js';
import { getAllSettings, setSetting, getSetting } from './settings.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_IMG_DIR = path.join(__dirname, '../../uploads/web');

function ensureWebImgDir() {
  if (!fs.existsSync(WEB_IMG_DIR)) fs.mkdirSync(WEB_IMG_DIR, { recursive: true });
}

function stripAccents(s) {
  return String(s || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

function findProductForStandard(std, meta, products) {
  const sku = meta.sku || std.product_type;
  const norm = normSku(sku);
  const plain = stripAccents(sku);

  return products.find(p => normSku(p.sku) === norm)
    || products.find(p => normSku(p.slug) === norm)
    || products.find(p => stripAccents(p.slug) === plain)
    || products.find(p => normSku(std.product_type) === normSku(p.sku))
    || products.find(p => {
      const name = stripAccents(p.name || '');
      return plain.length >= 2 && name.includes(plain);
    })
    || products.find(p => p.name?.toLowerCase().includes(std.name.toLowerCase().slice(0, 12)));
}

async function downloadWebImage(url, baseName) {
  if (!url) return null;
  ensureWebImgDir();
  const res = await fetch(url, { headers: { Accept: 'image/*', 'User-Agent': 'NeyaERP/1.0' } });
  if (!res.ok) throw new Error(`Image ${res.status}`);
  const ct = res.headers.get('content-type') || '';
  let ext = '.jpg';
  if (ct.includes('png')) ext = '.png';
  else if (ct.includes('webp')) ext = '.webp';
  else if (ct.includes('jpeg') || ct.includes('jpg')) ext = '.jpg';
  else {
    const m = url.match(/\.(jpe?g|png|webp)(\?|$)/i);
    if (m) ext = `.${m[1].toLowerCase()}`;
  }
  const safeName = String(baseName).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 60);
  const fileName = `${safeName}${ext}`;
  const filePath = path.join(WEB_IMG_DIR, fileName);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(filePath, buf);
  return `/uploads/web/${fileName}`;
}

async function attachProductPhotos(product, meta, { force = true } = {}) {
  const images = (product.images || []).map(i => i.src).filter(Boolean);
  const primaryUrl = images[0] || meta.web_image_url;
  if (!primaryUrl) return { meta, photos_downloaded: 0 };

  const baseName = normSku(meta.sku || product.sku || product.slug || product.id);
  let photosDownloaded = 0;
  let localPath = !force && meta.image?.startsWith('/uploads/web/') ? meta.image : null;

  if (force || !localPath) {
    try {
      localPath = await downloadWebImage(primaryUrl, baseName);
      photosDownloaded++;
    } catch {
      localPath = force ? null : (meta.image || null);
    }
  }

  const gallery = [];
  if (localPath) gallery.push(localPath);
  for (let i = 1; i < images.length; i++) {
    const existing = !force && meta.image_gallery?.[i];
    if (!force && existing?.startsWith('/uploads/')) {
      gallery.push(existing);
      continue;
    }
    try {
      const p = await downloadWebImage(images[i], `${baseName}_${i + 1}`);
      gallery.push(p);
      photosDownloaded++;
    } catch {
      gallery.push(images[i]);
    }
  }

  const newMeta = {
    ...meta,
    web_image_url: primaryUrl,
    web_images: images,
    web_image_local: localPath || meta.web_image_local,
    image: localPath || meta.image,
    image_gallery: gallery.length ? gallery : meta.image_gallery,
    photos_synced_at: new Date().toISOString(),
  };

  return { meta: newMeta, photos_downloaded: photosDownloaded };
}

function wpAuthQuery(settings) {
  const key = settings.woocommerce_key || process.env.WOOCOMMERCE_KEY || '';
  const secret = settings.woocommerce_secret || process.env.WOOCOMMERCE_SECRET || '';
  if (!key || !secret) return null;
  return `consumer_key=${encodeURIComponent(key)}&consumer_secret=${encodeURIComponent(secret)}`;
}

export async function getWpBase() {
  const s = await getAllSettings();
  return (s.wordpress_url || process.env.WORDPRESS_URL || 'https://neyafurniture.ca').replace(/\/$/, '');
}

export async function getWordPressConfig() {
  const s = await getAllSettings();
  const base = await getWpBase();
  const auth = wpAuthQuery(s);
  return {
    base,
    configured: Boolean(auth),
    key_preview: s.woocommerce_key ? `••••${String(s.woocommerce_key).slice(-4)}` : '',
  };
}

async function wpFetch(path, settings) {
  const base = (settings.wordpress_url || process.env.WORDPRESS_URL || 'https://neyafurniture.ca').replace(/\/$/, '');
  const auth = wpAuthQuery(settings);
  if (!auth) throw new Error('Clés WooCommerce manquantes (Paramètres → Site web)');
  const sep = path.includes('?') ? '&' : '?';
  const res = await fetch(`${base}/wp-json/wc/v3${path}${sep}${auth}`, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`WooCommerce ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

async function fetchAllPages(settings, path) {
  const all = [];
  for (let page = 1; page <= 20; page++) {
    const sep = path.includes('?') ? '&' : '?';
    const batch = await wpFetch(`${path}${sep}per_page=100&page=${page}`, settings);
    if (!batch.length) break;
    all.push(...batch);
    if (batch.length < 100) break;
  }
  return all;
}

function normSku(s) {
  return String(s || '').trim().toLowerCase().replace(/\s+/g, '_');
}

export async function getWebStatus() {
  const cfg = await getWordPressConfig();
  const lastSync = await getSetting('wordpress_last_sync');
  const { rows: linkedProducts } = await pool.query(`
    SELECT COUNT(*)::int AS n FROM standards
    WHERE meta->>'wp_product_id' IS NOT NULL AND product_type != 'guide'
  `);
  const { rows: orderStats } = await pool.query(`
    SELECT COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE status IN ('processing','on-hold','pending'))::int AS active
    FROM web_orders
  `);
  const { rows: webProjects } = await pool.query(
    'SELECT COUNT(*)::int AS n FROM projects WHERE wp_order_id IS NOT NULL'
  );
  const { rows: photoStats } = await pool.query(`
    SELECT COUNT(*)::int AS n FROM standards
    WHERE product_type != 'guide'
    AND (meta->>'image' LIKE '/uploads/web/%' OR meta->>'web_image_local' IS NOT NULL)
  `);
  return {
    ...cfg,
    last_sync: lastSync,
    linked_products: linkedProducts[0]?.n ?? 0,
    photos_downloaded: photoStats[0]?.n ?? 0,
    web_orders_total: orderStats[0]?.total ?? 0,
    web_orders_active: orderStats[0]?.active ?? 0,
    web_projects: webProjects[0]?.n ?? 0,
  };
}

/** Synchronise images + liens web depuis WooCommerce vers standards (match SKU) */
export async function syncWordPressProducts({ downloadPhotos = true } = {}) {
  const s = await getAllSettings();
  const products = await fetchAllPages(s, '/products');
  const { rows: standards } = await pool.query('SELECT * FROM standards WHERE product_type != $1', ['guide']);

  let matched = 0;
  let updated = 0;
  let photosDownloaded = 0;
  const details = [];

  for (const std of standards) {
    const meta = typeof std.meta === 'string' ? JSON.parse(std.meta) : (std.meta || {});
    const sku = meta.sku || std.product_type;
    if (!sku || sku === 'GUIDE') continue;

    const product = findProductForStandard(std, meta, products);

    if (!product) {
      details.push({ standard: std.name, sku: meta.sku, status: 'no_match' });
      continue;
    }
    matched++;

    let newMeta = {
      ...meta,
      wp_product_id: product.id,
      web_permalink: product.permalink,
      web_image_url: product.images?.[0]?.src || meta.web_image_url,
      web_price: product.price,
      web_synced_at: new Date().toISOString(),
    };

    if (downloadPhotos && newMeta.web_image_url) {
      const photoResult = await attachProductPhotos(product, newMeta);
      newMeta = photoResult.meta;
      photosDownloaded += photoResult.photos_downloaded;
    }

    if (newMeta.web_image_url !== meta.web_image_url || newMeta.image !== meta.image) updated++;
    await pool.query('UPDATE standards SET meta = $1 WHERE id = $2', [JSON.stringify(newMeta), std.id]);
    details.push({
      standard: std.name,
      sku: meta.sku,
      status: 'linked',
      url: product.permalink,
      photo: newMeta.image || newMeta.web_image_url,
    });
  }

  await setSetting('wordpress_last_sync', new Date().toISOString());

  return {
    products_found: products.length,
    standards_checked: standards.length,
    matched,
    updated,
    photos_downloaded: photosDownloaded,
    details,
  };
}

/** Télécharge les photos du site pour les fiches déjà liées ou matchables */
export async function syncWebPhotos() {
  const result = await syncWordPressProducts({ downloadPhotos: true });
  return {
    matched: result.matched,
    photos_downloaded: result.photos_downloaded,
    updated: result.updated,
    products_found: result.products_found,
    details: result.details.filter(d => d.status === 'linked'),
  };
}

async function findOrCreateClient(order) {
  const email = order.billing?.email?.trim().toLowerCase();
  const name = [order.billing?.first_name, order.billing?.last_name].filter(Boolean).join(' ')
    || order.billing?.company
    || 'Client web';
  const phone = order.billing?.phone || null;
  const address = order.billing?.address_1 || null;
  const city = [order.billing?.city, order.billing?.state].filter(Boolean).join(', ') || null;

  if (email) {
    const { rows } = await pool.query('SELECT * FROM clients WHERE LOWER(email)=$1 LIMIT 1', [email]);
    if (rows[0]) {
      await pool.query(
        'UPDATE clients SET name=$1, phone=COALESCE($2,phone), address=COALESCE($3,address), city=COALESCE($4,city) WHERE id=$5',
        [name, phone, address, city, rows[0].id]
      );
      return rows[0].id;
    }
  }

  const { rows } = await pool.query(
    'INSERT INTO clients (name, email, phone, address, city, notes) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
    [name, email || null, phone, address, city, `Importé depuis commande web #${order.number}`]
  );
  return rows[0].id;
}

async function findOrCreateProject(order, clientId, base) {
  const { rows: existing } = await pool.query('SELECT id FROM projects WHERE wp_order_id=$1', [order.id]);
  if (existing[0]) return existing[0].id;

  const items = (order.line_items || []).map(li => li.name).join(', ');
  const projectName = `Commande web #${order.number}${items ? ` — ${items.slice(0, 80)}` : ''}`;
  const budget = Number(order.total) || 0;

  let standardId = null;
  for (const li of order.line_items || []) {
    const sku = normSku(li.sku);
    if (!sku) continue;
    const { rows } = await pool.query(
      `SELECT id FROM standards WHERE LOWER(meta->>'sku')=$1 OR meta->>'sku' ILIKE $2 LIMIT 1`,
      [sku, li.sku]
    );
    if (rows[0]) { standardId = rows[0].id; break; }
  }

  const { rows } = await pool.query(
    `INSERT INTO projects (name, client_id, status, budget_estimated, standard_id, wp_order_id, notes)
     VALUES ($1,$2,'active',$3,$4,$5,$6) RETURNING id`,
    [projectName, clientId, budget, standardId, order.id, `Commande WooCommerce #${order.number}\n${order.customer_note || ''}`.trim()]
  );
  return rows[0].id;
}

/** Importe commandes WooCommerce → clients + projets ERP */
export async function syncWordPressOrders() {
  const s = await getAllSettings();
  const base = await getWpBase();
  const orders = await fetchAllPages(s, '/orders?status=processing,on-hold,pending,completed');

  let imported = 0;
  let updated = 0;
  const details = [];

  for (const order of orders) {
    const clientId = await findOrCreateClient(order);
    const { rows: prev } = await pool.query('SELECT id FROM web_orders WHERE wp_order_id=$1', [order.id]);
    const projectId = await findOrCreateProject(order, clientId, base);

    const orderUrl = `${base}/wp-admin/post.php?post=${order.id}&action=edit`;
    const lineItems = (order.line_items || []).map(li => ({
      name: li.name, sku: li.sku, qty: li.quantity, total: li.total,
    }));

    if (prev[0]) {
      await pool.query(
        `UPDATE web_orders SET status=$1, total=$2, customer_name=$3, customer_email=$4,
         client_id=$5, project_id=$6, line_items=$7, order_url=$8, synced_at=NOW() WHERE wp_order_id=$9`,
        [
          order.status, order.total,
          `${order.billing?.first_name || ''} ${order.billing?.last_name || ''}`.trim(),
          order.billing?.email, clientId, projectId, JSON.stringify(lineItems), orderUrl, order.id,
        ]
      );
      updated++;
    } else {
      await pool.query(
        `INSERT INTO web_orders (wp_order_id, order_number, status, total, customer_name, customer_email, client_id, project_id, line_items, order_url)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          order.id, order.number, order.status, order.total,
          `${order.billing?.first_name || ''} ${order.billing?.last_name || ''}`.trim(),
          order.billing?.email, clientId, projectId, JSON.stringify(lineItems), orderUrl,
        ]
      );
      imported++;
    }
    details.push({
      order: order.number,
      status: order.status,
      total: order.total,
      client_id: clientId,
      project_id: projectId,
    });
  }

  await setSetting('wordpress_last_sync', new Date().toISOString());

  return { orders_found: orders.length, imported, updated, details: details.slice(0, 20) };
}

export async function listWebOrders(limit = 30) {
  const { rows } = await pool.query(`
    SELECT w.*, c.name AS client_name, p.name AS project_name
    FROM web_orders w
    LEFT JOIN clients c ON c.id = w.client_id
    LEFT JOIN projects p ON p.id = w.project_id
    ORDER BY w.synced_at DESC
    LIMIT $1
  `, [limit]);
  return rows;
}

export async function listLinkedProducts() {
  const { rows } = await pool.query(`
    SELECT id, name, meta FROM standards WHERE product_type != 'guide'
    AND meta->>'web_permalink' IS NOT NULL
    ORDER BY name
  `);
  return rows.map(r => {
    const meta = typeof r.meta === 'string' ? JSON.parse(r.meta) : r.meta;
    return {
      id: r.id,
      name: r.name,
      sku: meta.sku,
      web_permalink: meta.web_permalink,
      web_image_url: meta.web_image_url,
      image: meta.image || meta.web_image_local,
      web_price: meta.web_price,
    };
  });
}

export async function fullWebSync() {
  const products = await syncWordPressProducts();
  const orders = await syncWordPressOrders();
  return { products, orders };
}

/** Rafraîchit la photo d'une fiche depuis WooCommerce */
export async function syncStandardPhoto(standardId) {
  const { rows } = await pool.query('SELECT * FROM standards WHERE id=$1', [standardId]);
  if (!rows[0]) throw new Error('Fiche introuvable');
  const std = rows[0];
  if (std.product_type === 'guide') throw new Error('Les guides n\'ont pas de photo produit');

  const s = await getAllSettings();
  const products = await fetchAllPages(s, '/products');
  const meta = typeof std.meta === 'string' ? JSON.parse(std.meta) : (std.meta || {});
  const product = findProductForStandard(std, meta, products);
  if (!product) {
    throw new Error(`Produit non trouvé sur neyafurniture.ca pour « ${meta.sku || std.name} » — vérifiez le SKU WooCommerce`);
  }

  let newMeta = {
    ...meta,
    wp_product_id: product.id,
    web_permalink: product.permalink,
    web_price: product.price,
    web_synced_at: new Date().toISOString(),
  };
  const photoResult = await attachProductPhotos(product, newMeta, { force: true });
  newMeta = photoResult.meta;

  const { rows: updated } = await pool.query(
    'UPDATE standards SET meta=$1 WHERE id=$2 RETURNING *',
    [JSON.stringify(newMeta), standardId]
  );
  return {
    standard: updated[0],
    photos_downloaded: photoResult.photos_downloaded,
    image: newMeta.image,
  };
}

export async function testWordPressConnection() {
  const cfg = await getWordPressConfig();
  if (!cfg.configured) throw new Error('Clés WooCommerce non configurées');
  const s = await getAllSettings();
  const data = await wpFetch('/products?per_page=1', s);
  return { ok: true, base: cfg.base, sample: data[0]?.name || 'OK', shop_url: cfg.base };
}

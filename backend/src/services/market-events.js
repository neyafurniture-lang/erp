import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pool from '../db/pool.js';
import {
  DEFAULT_MARKET_STEPS,
  MARKET_STATUSES,
  parseMarketContractPdf,
  parseMarketContractText,
} from './market-contract-parse.js';

export { MARKET_STATUSES, DEFAULT_MARKET_STEPS };

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const MARKETS_UPLOAD_DIR = path.join(__dirname, '../../uploads/markets');

let schemaReady;
export async function ensureMarketEventsSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS market_events (
          id SERIAL PRIMARY KEY,
          name TEXT NOT NULL,
          organizer TEXT,
          venue TEXT,
          address TEXT,
          city TEXT DEFAULT 'Montréal',
          start_date DATE,
          end_date DATE,
          event_hours TEXT,
          setup_start TEXT,
          presence_deadline TEXT,
          fee_amount NUMERIC(12,2),
          fee_notes TEXT,
          fee_paid BOOLEAN NOT NULL DEFAULT false,
          invoice_amount NUMERIC(12,2),
          status TEXT NOT NULL DEFAULT 'not_started',
          sort_order INT NOT NULL DEFAULT 0,
          description TEXT,
          mail_reply TEXT,
          notes TEXT,
          contract_url TEXT,
          contract_filename TEXT,
          contract_text TEXT,
          logistics JSONB NOT NULL DEFAULT '{}',
          materials JSONB NOT NULL DEFAULT '[]',
          steps JSONB NOT NULL DEFAULT '[]',
          sales_total NUMERIC(12,2) NOT NULL DEFAULT 0,
          sales_notes TEXT,
          gmail_message_id TEXT,
          task_id INT REFERENCES tasks(id) ON DELETE SET NULL,
          expense_id INT REFERENCES expenses(id) ON DELETE SET NULL,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_market_events_start ON market_events(start_date)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_market_events_status ON market_events(status)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_market_events_sort ON market_events(sort_order)`);
    })().catch((err) => {
      schemaReady = null;
      throw err;
    });
  }
  return schemaReady;
}

function cloneSteps(steps) {
  if (Array.isArray(steps) && steps.length) return steps.map(s => ({ ...s }));
  return DEFAULT_MARKET_STEPS.map(s => ({ ...s }));
}

function rowToEvent(row) {
  if (!row) return null;
  return {
    ...row,
    fee_amount: row.fee_amount != null ? Number(row.fee_amount) : null,
    invoice_amount: row.invoice_amount != null ? Number(row.invoice_amount) : null,
    sales_total: row.sales_total != null ? Number(row.sales_total) : 0,
    logistics: row.logistics || {},
    materials: row.materials || [],
    steps: row.steps || [],
  };
}

/** Fiche événements importée depuis le Drive (PDF Events Sheet). */
export const SEED_MARKET_EVENTS = [
  {
    name: 'Puces POP — septembre 2026',
    start_date: '2026-09-01',
    end_date: '2026-09-30',
    status: 'in_progress',
    fee_notes: 'Inscriptions complètes',
    description: 'Marché d\'artisans locaux — vêtements, bijoux, céramiques, etc.',
    mail_reply: 'Septembre complet — candidatures décembre début octobre.',
    notes: 'Newsletter + RS — ouverture inscriptions début octobre.',
    sort_order: 10,
  },
  {
    name: 'Marianefest',
    status: 'not_started',
    description: 'Artisans locaux, bijoux, décorations, vêtements, aliments faits main.',
    notes: 'En attente de date 2026.',
    sort_order: 20,
  },
  {
    name: 'Collectif Créatif MTL — Locoshop Angus (automne)',
    start_date: '2026-09-26',
    end_date: '2026-10-04',
    status: 'applied',
    fee_notes: '300 $ + tx / fin de semaine + frais stand ?',
    organizer: 'Collectif Créatif MTL',
    description: 'Marchés artisanaux Etsy Montreal depuis 2014.',
    mail_reply: 'Candidature automne Locoshop Angus ouverte — candidature envoyée.',
    notes: '26-27 sept + 3-4 oct 2026. En attente de retour.',
    sort_order: 30,
  },
  {
    name: 'Collectif Créatif MTL — Gare Windsor (nov.)',
    start_date: '2026-11-26',
    end_date: '2026-11-28',
    status: 'applied',
    fee_amount: 575,
    fee_notes: '575 $ + tx — table 4 pi',
    organizer: 'Collectif Créatif MTL',
    venue: 'Gare Windsor',
    description: 'Marché éphémère jeudi-vendredi-samedi.',
    mail_reply: 'Candidature envoyée — en attente de retour.',
    sort_order: 40,
  },
  {
    name: 'Grand Marché de Noël de Verdun 2026',
    start_date: '2026-11-28',
    end_date: '2026-11-29',
    status: 'accepted',
    fee_amount: 260,
    fee_notes: '260 $ + tx — table 8 pi + 2 chaises',
    organizer: 'Bazar Verdunois & L\'Élan Verdunois',
    venue: 'Sous-sol église Notre-Dame-de-Lourdes',
    address: '630, 4e Avenue (coin rue de Verdun), Verdun',
    event_hours: '10 h – 17 h',
    setup_start: '8 h 00',
    presence_deadline: '9 h 30',
    description: '5e édition Grand Marché de Noël — thème Noël, convivial et inclusif.',
    mail_reply: 'Candidature envoyée — contrat reçu (nov. 2026).',
    notes: 'Contrat PDF importé — payer sous 3 j ouvrables.',
    sort_order: 50,
  },
  {
    name: 'Marché de l\'Automne et de l\'Étrange — Verdun',
    start_date: '2026-10-24',
    end_date: '2026-10-25',
    status: 'accepted',
    fee_amount: 218,
    fee_notes: '218 $ + TX — table 4 pieds + 1 chaise',
    organizer: 'Bazar Verdunois & L\'Élan Verdunois',
    venue: 'Auditorium de Verdun',
    address: '4110, boul. LaSalle, Verdun H4G 2A5',
    event_hours: '10 h – 17 h',
    setup_start: '8 h 30',
    description: '60 artisans locaux — ambiance automne / Halloween.',
    mail_reply: 'Contrat d\'engagement reçu.',
    logistics: {
      wifi: 'oui',
      parking: 'Stationnement municipal à proximité',
      night_repack: true,
      table_size: '4 pieds',
      contact_email: 'bazarverdunois@gmail.com',
      contact_phone: '438-491-9079',
      materials_checklist: ['Terminal paiement + monnaie', 'Table 4 pieds', 'Inventaire produits NEYA', 'Kit promo organisateur (RS)'],
      notes: ['Remballage complet samedi soir — réinstaller dimanche matin', 'Kiosque tenu en permanence'],
    },
    sort_order: 60,
  },
  {
    name: 'Pop-up Lab',
    status: 'not_started',
    description: 'Marchés pour artisans émergents — Plateau-Mont-Royal.',
    notes: 'En attente de date 2026.',
    sort_order: 70,
  },
  {
    name: '2026 Montreal Handmade & Artisan Expo',
    start_date: '2026-05-01',
    end_date: '2026-05-03',
    status: 'cancelled',
    fee_amount: 90,
    fee_notes: '90 $ / jour — 180 $ deux jours',
    description: 'Expo indoor artisans locaux.',
    mail_reply: 'Demande acceptée — virement Interac en attente.',
    notes: 'Annulé côté NEYA — confirmation 2-3 mai seulement.',
    sort_order: 80,
  },
  {
    name: 'Semaine Design de Montréal',
    start_date: '2026-04-28',
    end_date: '2026-05-07',
    status: 'done',
    description: 'Design local — architecture, intérieur, fabricants, créateurs.',
    notes: 'Contact IG Claire — démarche à suivre.',
    sort_order: 90,
  },
  {
    name: 'Design Expo',
    start_date: '2026-10-07',
    end_date: '2026-10-08',
    status: 'not_started',
    description: 'Expo Design DSR — leaders industrie.',
    notes: 'Newsletter — inscriptions pas encore ouvertes.',
    sort_order: 100,
  },
  {
    name: 'SOUK',
    status: 'not_started',
    description: 'Marché d\'idées design — créateurs Montréal.',
    notes: 'En attente date 2026.',
    sort_order: 110,
  },
  {
    name: 'Livart — Marché Items',
    start_date: '2026-05-16',
    end_date: '2026-05-17',
    status: 'done',
    fee_paid: true,
    description: '9e édition — artistes et designers montréalais.',
    mail_reply: 'Participation confirmée — 3 visuels envoyés.',
    notes: 'Support mural — info demandée.',
    sales_total: 0,
    sort_order: 120,
  },
  {
    name: 'Grande Fabrique 2026',
    start_date: '2026-08-08',
    end_date: '2026-08-09',
    status: 'confirmed',
    fee_amount: 172.46,
    fee_paid: true,
    fee_notes: '172,46 $ payé',
    venue: 'Sainte-Catherine Est — Rue des Créateurs',
    description: 'Artisanat local — weekend thématique.',
    mail_reply: 'Candidature acceptée — dossier envoyé 09/04.',
    sort_order: 130,
  },
];

export async function seedMarketEventsIfEmpty() {
  await ensureMarketEventsSchema();
  const { rows } = await pool.query('SELECT COUNT(*)::int AS c FROM market_events');
  if (rows[0]?.c > 0) return { seeded: 0, reason: 'already_populated' };

  let n = 0;
  for (const ev of SEED_MARKET_EVENTS) {
    const steps = cloneSteps(ev.steps);
    await pool.query(
      `INSERT INTO market_events (
        name, organizer, venue, address, start_date, end_date, event_hours,
        setup_start, presence_deadline, fee_amount, fee_notes, fee_paid,
        invoice_amount, status, sort_order, description, mail_reply, notes,
        logistics, materials, steps, sales_total
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)`,
      [
        ev.name,
        ev.organizer || null,
        ev.venue || null,
        ev.address || null,
        ev.start_date || null,
        ev.end_date || null,
        ev.event_hours || null,
        ev.setup_start || null,
        ev.presence_deadline || null,
        ev.fee_amount ?? null,
        ev.fee_notes || null,
        ev.fee_paid || false,
        ev.invoice_amount ?? ev.fee_amount ?? null,
        ev.status || 'not_started',
        ev.sort_order ?? n * 10,
        ev.description || null,
        ev.mail_reply || null,
        ev.notes || null,
        JSON.stringify(ev.logistics || {}),
        JSON.stringify(ev.materials || ev.logistics?.materials_checklist || []),
        JSON.stringify(steps),
        ev.sales_total ?? 0,
      ]
    );
    n += 1;
  }
  return { seeded: n };
}

function toDateOnly(val) {
  if (!val) return null;
  if (val instanceof Date) return val.toISOString().slice(0, 10);
  const s = String(val);
  return s.length >= 10 ? s.slice(0, 10) : s;
}

/** Crée ou met à jour une tâche calendrier quand le marché est accepté/confirmé. */
export async function syncMarketCalendarTask(eventId) {
  const { rows } = await pool.query('SELECT * FROM market_events WHERE id = $1', [eventId]);
  const ev = rows[0];
  if (!ev) return null;

  const calStatuses = new Set(['accepted', 'confirmed', 'done']);
  const startDate = toDateOnly(ev.start_date);
  if (!calStatuses.has(ev.status) || !startDate) {
    if (ev.task_id) {
      await pool.query('DELETE FROM tasks WHERE id = $1', [ev.task_id]);
      await pool.query('UPDATE market_events SET task_id = NULL WHERE id = $1', [eventId]);
    }
    return null;
  }

  const start = new Date(`${startDate}T08:00:00`);
  const endDate = toDateOnly(ev.end_date) || startDate;
  const end = new Date(`${endDate}T17:00:00`);
  const title = `Marché — ${ev.name}`;

  if (ev.task_id) {
    const { rows: updated } = await pool.query(
      `UPDATE tasks SET title = $1, start_time = $2, end_time = $3, type = 'admin', status = 'todo'
       WHERE id = $4 RETURNING id`,
      [title, start.toISOString(), end.toISOString(), ev.task_id]
    );
    if (updated[0]) return updated[0].id;
  }

  const { rows: created } = await pool.query(
    `INSERT INTO tasks (title, type, status, start_time, end_time, estimated_minutes)
     VALUES ($1, 'admin', 'todo', $2, $3, 480) RETURNING id`,
    [title, start.toISOString(), end.toISOString()]
  );
  await pool.query('UPDATE market_events SET task_id = $1 WHERE id = $2', [created[0].id, eventId]);
  return created[0].id;
}

export async function listMarketEvents({ status, year } = {}) {
  await ensureMarketEventsSchema();
  await seedMarketEventsIfEmpty();

  let q = 'SELECT * FROM market_events WHERE 1=1';
  const params = [];
  if (status) {
    params.push(status);
    q += ` AND status = $${params.length}`;
  }
  if (year) {
    params.push(Number(year));
    q += ` AND EXTRACT(YEAR FROM COALESCE(start_date, created_at)) = $${params.length}`;
  }
  q += ' ORDER BY sort_order ASC, start_date ASC NULLS LAST, id ASC';
  const { rows } = await pool.query(q, params);
  return rows.map(rowToEvent);
}

export async function getMarketEvent(id) {
  await ensureMarketEventsSchema();
  const { rows } = await pool.query('SELECT * FROM market_events WHERE id = $1', [id]);
  return rowToEvent(rows[0]);
}

export async function createMarketEvent(body = {}) {
  await ensureMarketEventsSchema();
  const { rows: ord } = await pool.query('SELECT COALESCE(MAX(sort_order), 0) + 10 AS next FROM market_events');
  const sortOrder = body.sort_order ?? ord[0]?.next ?? 0;
  const steps = cloneSteps(body.steps);

  const { rows } = await pool.query(
    `INSERT INTO market_events (
      name, organizer, venue, address, city, start_date, end_date, event_hours,
      setup_start, presence_deadline, fee_amount, fee_notes, fee_paid, invoice_amount,
      status, sort_order, description, mail_reply, notes, contract_url, contract_filename,
      contract_text, logistics, materials, steps, sales_total, sales_notes, gmail_message_id
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28
    ) RETURNING *`,
    [
      body.name || 'Nouveau marché',
      body.organizer || null,
      body.venue || null,
      body.address || null,
      body.city || 'Montréal',
      body.start_date || null,
      body.end_date || null,
      body.event_hours || null,
      body.setup_start || null,
      body.presence_deadline || null,
      body.fee_amount ?? null,
      body.fee_notes || null,
      Boolean(body.fee_paid),
      body.invoice_amount ?? body.fee_amount ?? null,
      MARKET_STATUSES.includes(body.status) ? body.status : 'not_started',
      sortOrder,
      body.description || null,
      body.mail_reply || null,
      body.notes || null,
      body.contract_url || null,
      body.contract_filename || null,
      body.contract_text || null,
      JSON.stringify(body.logistics || {}),
      JSON.stringify(body.materials || []),
      JSON.stringify(steps),
      body.sales_total ?? 0,
      body.sales_notes || null,
      body.gmail_message_id || null,
    ]
  );
  const ev = rowToEvent(rows[0]);
  await syncMarketCalendarTask(ev.id);
  return ev;
}

export async function updateMarketEvent(id, body = {}) {
  await ensureMarketEventsSchema();
  const existing = await getMarketEvent(id);
  if (!existing) throw new Error('Marché introuvable');

  const fields = [];
  const params = [];
  const set = (col, val) => {
    params.push(val);
    fields.push(`${col} = $${params.length}`);
  };

  const scalarCols = [
    'name', 'organizer', 'venue', 'address', 'city', 'start_date', 'end_date',
    'event_hours', 'setup_start', 'presence_deadline', 'fee_amount', 'fee_notes',
    'fee_paid', 'invoice_amount', 'status', 'sort_order', 'description', 'mail_reply',
    'notes', 'contract_url', 'contract_filename', 'contract_text', 'sales_total',
    'sales_notes', 'gmail_message_id',
  ];
  for (const col of scalarCols) {
    if (body[col] !== undefined) set(col, body[col]);
  }
  if (body.logistics !== undefined) set('logistics', JSON.stringify(body.logistics));
  if (body.materials !== undefined) set('materials', JSON.stringify(body.materials));
  if (body.steps !== undefined) set('steps', JSON.stringify(body.steps));

  if (!fields.length) return existing;

  params.push(id);
  const { rows } = await pool.query(
    `UPDATE market_events SET ${fields.join(', ')}, updated_at = NOW() WHERE id = $${params.length} RETURNING *`,
    params
  );
  const ev = rowToEvent(rows[0]);
  await syncMarketCalendarTask(ev.id);
  return ev;
}

export async function deleteMarketEvent(id) {
  await ensureMarketEventsSchema();
  const { rows } = await pool.query('SELECT task_id FROM market_events WHERE id = $1', [id]);
  if (rows[0]?.task_id) {
    await pool.query('DELETE FROM tasks WHERE id = $1', [rows[0].task_id]);
  }
  await pool.query('DELETE FROM market_events WHERE id = $1', [id]);
  return { ok: true };
}

export async function importMarketContractFile({ buffer, filename }) {
  fs.mkdirSync(MARKETS_UPLOAD_DIR, { recursive: true });
  const safeName = `${Date.now()}-${String(filename || 'contrat.pdf').replace(/[^\w.\-]+/g, '_')}`;
  const fullPath = path.join(MARKETS_UPLOAD_DIR, safeName);
  fs.writeFileSync(fullPath, buffer);

  const parsed = parseMarketContractPdf(buffer, { filename });
  parsed.contract_url = `/uploads/markets/${safeName}`;
  parsed.contract_filename = filename || safeName;

  // Fusionner avec un marché existant (même nom / dates)
  const { rows: candidates } = await pool.query(
    `SELECT id FROM market_events
     WHERE ($1::date IS NOT NULL AND start_date = $1)
        OR lower(name) = lower($2)
     ORDER BY id DESC LIMIT 1`,
    [parsed.start_date, parsed.name]
  );

  if (candidates[0]) {
    const existing = await getMarketEvent(candidates[0].id);
    const merged = { ...parsed, status: parsed.status || existing.status || 'accepted' };
    const keepExistingName = /^\d+\.|informations logistiques|contrat marche/i.test(String(parsed.name || ''));
    for (const key of ['name', 'organizer', 'venue', 'address', 'start_date', 'end_date', 'event_hours', 'setup_start', 'presence_deadline', 'fee_amount', 'fee_notes', 'description']) {
      if (key === 'name' && keepExistingName) {
        merged.name = existing.name;
        continue;
      }
      if (merged[key] == null || merged[key] === '') merged[key] = existing[key];
    }
    if (!merged.logistics || !Object.keys(merged.logistics).length) merged.logistics = existing.logistics;
    return updateMarketEvent(candidates[0].id, merged);
  }
  return createMarketEvent(parsed);
}

export async function importSeedContractsFromDisk() {
  const uploads = [
    '/home/ubuntu/.cursor/projects/workspace/uploads/Contrat_Marche_de_l_Etrange_Final_V2-2_166f.pdf',
    '/home/ubuntu/.cursor/projects/workspace/uploads/Contrat_Marche_de_l_Etrange_Final_V2_974e.pdf',
    '/home/ubuntu/.cursor/projects/workspace/uploads/contrat_marche_noel_2026_c506.pdf',
  ];
  const imported = [];
  for (const p of uploads) {
    if (!fs.existsSync(p)) continue;
    const buf = fs.readFileSync(p);
    imported.push(await importMarketContractFile({ buffer: buf, filename: path.basename(p) }));
  }
  return imported;
}

/** Scan Gmail pour courriels marchés récents (bazar, collectif, puces pop…). */
export async function scanMarketEmails({ max = 25 } = {}) {
  const gmail = await import('./google-gmail.js');
  const q = [
    'newer_than:120d',
    '(marché OR marche OR bazar OR "collectif créatif" OR "puces pop" OR exposant OR candidature OR contrat)',
  ].join(' ');
  let messages = [];
  try {
    ({ messages } = await gmail.searchMessages(q, max));
  } catch (err) {
    throw new Error(`Gmail indisponible : ${err.message}`);
  }

  const hits = [];
  for (const m of messages || []) {
    try {
      const full = m.body ? m : await gmail.getMessage(m.id);
      const hay = `${full.subject} ${full.snippet} ${full.from}`.toLowerCase();
      if (!/(march|bazar|exposant|collectif|puces pop|artisan|contrat|candidature)/i.test(hay)) continue;

      hits.push({
        gmail_message_id: full.id,
        subject: full.subject,
        from: full.from,
        snippet: full.snippet,
        date: full.date,
        mail_href: `/mail?message=${encodeURIComponent(full.id)}`,
      });

      // Lier à un marché existant par nom approximatif
      const nameHint = full.subject || '';
      const { rows } = await pool.query(
        `SELECT id, name FROM market_events
         WHERE lower(name) LIKE '%' || lower($1) || '%'
            OR lower($1) LIKE '%' || lower(split_part(name, '—', 1)) || '%'
         LIMIT 1`,
        [nameHint.slice(0, 40)]
      );
      if (rows[0]) {
        await pool.query(
          `UPDATE market_events SET gmail_message_id = COALESCE(gmail_message_id, $1),
             mail_reply = COALESCE(NULLIF(mail_reply, ''), $2), updated_at = NOW()
           WHERE id = $3`,
          [full.id, full.snippet?.slice(0, 500) || full.subject, rows[0].id]
        );
      }
    } catch { /* optional */ }
  }
  return { scanned: messages?.length || 0, hits };
}

export async function getMarketsSummary() {
  await ensureMarketEventsSchema();
  await seedMarketEventsIfEmpty();
  const { rows } = await pool.query(`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE status IN ('accepted','confirmed'))::int AS confirmed,
      COUNT(*) FILTER (WHERE status = 'in_progress' OR status = 'applied')::int AS pipeline,
      COUNT(*) FILTER (WHERE status = 'done')::int AS done,
      COALESCE(SUM(sales_total),0)::float AS sales_total,
      COALESCE(SUM(fee_amount) FILTER (WHERE fee_paid = false AND fee_amount IS NOT NULL),0)::float AS fees_due
    FROM market_events
  `);
  return rows[0];
}

/**
 * Tri mail en 3 couches (inspiré inbox-zero / inbox-shepherd) :
 * 1. Cache expéditeur (DB + épinglage manuel)
 * 2. Signaux d’en-têtes bulk + règles statiques domaine/expéditeur
 * 3. Heuristiques NEYA (classifyMailMessage)
 */
import pool from '../db/pool.js';
import { parseFromEmail, isValidMailCategory } from './mail-sort.js';

export const DECISION_SOURCE = {
  MANUAL: 'manual',
  CACHE_SENDER: 'cache_sender',
  CACHE_DOMAIN: 'cache_domain',
  STATIC_RULE: 'static_rule',
  HEADER_BULK: 'header_bulk',
  HEURISTIC: 'heuristic',
};

const CACHE_CONFIDENCE_THRESHOLD = 0.85;
const CACHE_MIN_HITS = 3;
const HEADER_BASELINE = 0.5;
const HEADER_ARCHIVE_THRESHOLD = 0.32;

const ESP_RE = /mailchimp|klaviyo|hubspot|marketo|constant\s*contact/i;

/** Règles statiques tier-2 (promotion du cache après N hits manuels). */
const STATIC_DOMAIN_RULES = [
  { pattern: /(^|\.)leevalleynews\.com$/i, category: 'promotions' },
  { pattern: /(^|\.)mailchimp\.com$/i, category: 'promotions' },
  { pattern: /(^|\.)klaviyo\.com$/i, category: 'promotions' },
  { pattern: /(^|\.)sendgrid\.net$/i, category: 'promotions' },
  { pattern: /(^|\.)hubspotemail\.net$/i, category: 'promotions' },
  { pattern: /(^|\.)beehiiv\.com$/i, category: 'promotions' },
  { pattern: /(^|\.)createsend\.com$/i, category: 'promotions' },
  { pattern: /(^|\.)list-manage\.com$/i, category: 'promotions' },
];

const STATIC_LOCAL_RULES = [
  { pattern: /^(newsletter|deals|offres|promo|marketing|updates)@/i, category: 'promotions' },
];

let senderTableReady = false;

export async function ensureMailSenderProfilesTable() {
  if (senderTableReady) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS mail_sender_profiles (
      id SERIAL PRIMARY KEY,
      sender_email TEXT NOT NULL UNIQUE,
      domain TEXT NOT NULL,
      mail_category TEXT NOT NULL,
      hit_count INT NOT NULL DEFAULT 1,
      user_pinned BOOLEAN NOT NULL DEFAULT false,
      confidence NUMERIC(5,3) NOT NULL DEFAULT 0.850,
      last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_mail_sender_profiles_domain
    ON mail_sender_profiles(domain)
  `);
  senderTableReady = true;
}

/** Normalise les en-têtes Gmail (tableau { name, value }) ou objet plat. */
export function normalizeHeaderMap(headers) {
  if (!headers) return {};
  if (Array.isArray(headers)) {
    const map = {};
    for (const h of headers) {
      if (h?.name) map[String(h.name).toLowerCase()] = String(h.value ?? '');
    }
    return map;
  }
  if (typeof headers === 'object') {
    const map = {};
    for (const [k, v] of Object.entries(headers)) {
      map[String(k).toLowerCase()] = String(v ?? '');
    }
    return map;
  }
  return {};
}

function headerGet(map, name) {
  return map[String(name).toLowerCase()] || '';
}

function hasHeaderPrefix(map, prefix) {
  const p = prefix.toLowerCase();
  return Object.keys(map).some(k => k.startsWith(p));
}

/**
 * Score bulk vs inbox (inbox-zero heuristics.py, sans LLM).
 * Score bas → newsletter / promo probable.
 */
export function computeHeaderBulkScore(headerMap = {}) {
  const signals = [];
  let score = HEADER_BASELINE;

  const bump = (delta, label) => {
    score += delta;
    signals.push({ delta, label });
  };

  if (headerGet(headerMap, 'List-Unsubscribe')) bump(-0.30, 'List-Unsubscribe');
  const precedence = headerGet(headerMap, 'Precedence').toLowerCase();
  if (precedence === 'bulk' || precedence === 'list') bump(-0.25, 'Precedence bulk/list');
  const autoSub = headerGet(headerMap, 'Auto-Submitted').toLowerCase();
  if (autoSub === 'auto-generated' || autoSub === 'auto-replied') {
    bump(-0.35, 'Auto-Submitted auto');
  }
  if (headerGet(headerMap, 'Return-Path') === '<>') bump(-0.30, 'Null Return-Path');
  const xMailer = headerGet(headerMap, 'X-Mailer');
  if (ESP_RE.test(xMailer)) bump(-0.25, 'ESP X-Mailer');
  if (headerGet(headerMap, 'X-Campaign-ID')) bump(-0.20, 'X-Campaign-ID');
  if (hasHeaderPrefix(headerMap, 'X-Mailgun-')) bump(-0.15, 'X-Mailgun');
  if (hasHeaderPrefix(headerMap, 'X-SendGrid-')) bump(-0.15, 'X-SendGrid');
  if (headerGet(headerMap, 'X-Auto-Response-Suppress')) bump(-0.30, 'X-Auto-Response-Suppress');

  return { score, signals, isStrongBulk: score <= HEADER_ARCHIVE_THRESHOLD };
}

export function staticRuleCategory(fromEmail = '') {
  const email = String(fromEmail || '').toLowerCase().trim();
  if (!email.includes('@')) return null;
  const [local, domain] = email.split('@');
  for (const rule of STATIC_LOCAL_RULES) {
    if (rule.pattern.test(`${local}@`)) return rule.category;
  }
  for (const rule of STATIC_DOMAIN_RULES) {
    if (rule.pattern.test(domain)) return rule.category;
  }
  return null;
}

export function senderDomain(from = '') {
  const email = parseFromEmail(from);
  const domain = email.includes('@') ? email.split('@')[1] : '';
  return { email, domain };
}

export async function lookupSenderCache(from = '') {
  const { email, domain } = senderDomain(from);
  if (!email) return null;

  try {
    await ensureMailSenderProfilesTable();
  } catch {
    return null;
  }

  let senderRows;
  try {
    ({ rows: senderRows } = await pool.query(
    `SELECT mail_category, hit_count, user_pinned, confidence
     FROM mail_sender_profiles WHERE sender_email = $1 LIMIT 1`,
    [email]
    ));
  } catch {
    return null;
  }
  const sender = senderRows[0];
  if (sender) {
    const pinned = Boolean(sender.user_pinned);
    const hits = Number(sender.hit_count) || 0;
    const conf = Number(sender.confidence) || CACHE_CONFIDENCE_THRESHOLD;
    if (pinned || (hits >= CACHE_MIN_HITS && conf >= CACHE_CONFIDENCE_THRESHOLD)) {
      if (isValidMailCategory(sender.mail_category)) {
        return {
          category: sender.mail_category,
          source: DECISION_SOURCE.CACHE_SENDER,
          confidence: pinned ? 1 : conf,
        };
      }
    }
  }

  if (domain) {
    let domainRows;
    try {
      ({ rows: domainRows } = await pool.query(
      `SELECT mail_category,
              SUM(hit_count)::int AS total_hits,
              BOOL_OR(user_pinned) AS any_pinned,
              MAX(confidence)::float AS max_conf
       FROM mail_sender_profiles
       WHERE domain = $1
       GROUP BY mail_category
       ORDER BY BOOL_OR(user_pinned) DESC, SUM(hit_count) DESC
       LIMIT 1`,
      [domain]
      ));
    } catch {
      return null;
    }
    const dom = domainRows[0];
    if (dom && isValidMailCategory(dom.mail_category)) {
      const pinned = Boolean(dom.any_pinned);
      const hits = Number(dom.total_hits) || 0;
      const conf = Number(dom.max_conf) || CACHE_CONFIDENCE_THRESHOLD;
      if (pinned || hits >= CACHE_MIN_HITS * 2) {
        return {
          category: dom.mail_category,
          source: DECISION_SOURCE.CACHE_DOMAIN,
          confidence: pinned ? 1 : Math.min(conf, 0.92),
        };
      }
    }
  }

  return null;
}

export async function recordSenderObservation(from = '', category, { pinned = false } = {}) {
  if (!isValidMailCategory(category)) return;
  const { email, domain } = senderDomain(from);
  if (!email || !domain) return;
  await ensureMailSenderProfilesTable();

  if (pinned) {
    await pool.query(
      `INSERT INTO mail_sender_profiles (sender_email, domain, mail_category, hit_count, user_pinned, confidence, last_seen, updated_at)
       VALUES ($1, $2, $3, GREATEST(1, $4::int), true, 1.0, NOW(), NOW())
       ON CONFLICT (sender_email) DO UPDATE SET
         mail_category = EXCLUDED.mail_category,
         user_pinned = true,
         hit_count = mail_sender_profiles.hit_count + 1,
         confidence = 1.0,
         last_seen = NOW(),
         updated_at = NOW()`,
      [email, domain, category, 1]
    );
    return;
  }

  await pool.query(
    `INSERT INTO mail_sender_profiles (sender_email, domain, mail_category, hit_count, user_pinned, confidence, last_seen, updated_at)
     VALUES ($1, $2, $3, 1, false, 0.85, NOW(), NOW())
     ON CONFLICT (sender_email) DO UPDATE SET
       mail_category = CASE
         WHEN mail_sender_profiles.mail_category = EXCLUDED.mail_category THEN mail_sender_profiles.mail_category
         ELSE EXCLUDED.mail_category
       END,
       hit_count = CASE
         WHEN mail_sender_profiles.mail_category = EXCLUDED.mail_category THEN mail_sender_profiles.hit_count + 1
         ELSE 1
       END,
       confidence = LEAST(0.98, 0.75 + (CASE
         WHEN mail_sender_profiles.mail_category = EXCLUDED.mail_category THEN mail_sender_profiles.hit_count + 1
         ELSE 1
       END) * 0.04),
       last_seen = NOW(),
       updated_at = NOW()`,
    [email, domain, category]
  );
}

/**
 * Pipeline complet : cache → headers / static → heuristique tier-3.
 * @param {Function} classifyHeuristic — classifyMailMessage (injecté pour éviter cycle d’import)
 */
export async function resolveMailCategory(ctx, classifyHeuristic) {
  const thread = ctx.thread || null;
  if (thread?.mail_category_manual && isValidMailCategory(thread?.mail_category)) {
    return { category: thread.mail_category, source: DECISION_SOURCE.MANUAL };
  }

  const from = ctx.from || '';
  const headerMap = normalizeHeaderMap(ctx.headers || ctx.headerMap);

  const cacheHit = await lookupSenderCache(from);
  if (cacheHit) {
    return { category: cacheHit.category, source: cacheHit.source, confidence: cacheHit.confidence };
  }

  const staticCat = staticRuleCategory(parseFromEmail(from));
  if (staticCat && isValidMailCategory(staticCat)) {
    const escape = ctx.manuallyStarred || ctx.matchedClientEmail || ctx.mustPassHuman;
    if (!escape) {
      return { category: staticCat, source: DECISION_SOURCE.STATIC_RULE };
    }
  }

  const { isStrongBulk } = computeHeaderBulkScore(headerMap);
  if (isStrongBulk) {
    const escape = ctx.manuallyStarred
      || ctx.matchedClientEmail
      || ctx.mustPassHuman
      || ctx.hardInvoice;
    if (!escape && !ctx.isOutbound) {
      return { category: 'promotions', source: DECISION_SOURCE.HEADER_BULK };
    }
  }

  const category = classifyHeuristic(ctx);
  return { category, source: DECISION_SOURCE.HEURISTIC };
}

/** Pré-calcule les flags partagés pour le pipeline + heuristique. */
export function buildClassificationContext(base) {
  return { ...base };
}

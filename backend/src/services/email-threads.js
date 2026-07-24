import pool from '../db/pool.js';
import * as gmail from './google-gmail.js';
import { extractKeywords, matchProjectFromRules } from './invoice-email-router.js';
import { getOpenAIKey, getAnthropicKey, getAnthropicModel, getSetting, isAssistantAiEnabled } from './settings.js';
import { isPromotion } from './mail-sort.js';
import { parseLlmJson } from './llm-json.js';

function parseEmailAddress(raw) {
  if (!raw) return null;
  const m = String(raw).match(/<([^>]+)>/);
  const email = (m ? m[1] : raw).trim().toLowerCase();
  return email.includes('@') ? email : null;
}

function parseParticipants(msg) {
  const emails = new Set();
  for (const field of [msg.from, msg.to, msg.cc]) {
    const matches = String(field || '').match(/[\w.+-]+@[\w.-]+\.\w+/gi) || [];
    matches.forEach(e => emails.add(e.toLowerCase()));
  }
  return [...emails];
}

async function getOwnEmailsForMatch() {
  const set = new Set();
  try {
    const { getGoogleTokenRow } = await import('./google-oauth.js');
    const row = await getGoogleTokenRow();
    if (row?.account_email) set.add(String(row.account_email).toLowerCase());
  } catch { /* optional */ }
  try {
    const { getCompanyConfig } = await import('./company-config.js');
    const company = await getCompanyConfig();
    if (company?.email) set.add(String(company.email).toLowerCase());
  } catch { /* optional */ }
  return set;
}

function parseMessageDate(msg) {
  const d = msg.date ? new Date(msg.date) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toISOString() : new Date().toISOString();
}

function parseDisplayName(raw) {
  if (!raw) return null;
  const m = String(raw).match(/^"?([^"<]+)"?\s*</);
  const name = (m ? m[1] : '').trim();
  return name.length >= 2 ? name : null;
}

/** Mots trop courts / courants — ne jamais matcher comme nom client. */
const CLIENT_NAME_STOP = new Set([
  'son', 'ses', 'les', 'des', 'une', 'des', 'pour', 'avec', 'dans', 'sur', 'par',
  'the', 'and', 'for', 'from', 'your', 'our', 'new', 'all', 'any', 'you', 'are',
  'mail', 'email', 'info', 'news', 'team', 'atelier', 'neya',
]);

/**
 * Match un nom client dans un texte (limites de mot, ignore stop-words).
 * Exporte pour tests.
 */
export function clientNameAppearsInText(clientName, haystack) {
  const n = String(clientName || '').trim().toLowerCase();
  const hay = String(haystack || '').toLowerCase();
  if (!n || !hay || CLIENT_NAME_STOP.has(n)) return false;
  if (n.length < 4) return false;

  const escaped = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const whole = new RegExp(`(?:^|[^\\p{L}\\p{N}])${escaped}(?:[^\\p{L}\\p{N}]|$)`, 'iu');
  if (whole.test(hay)) return true;

  const parts = n.split(/\s+/).filter(p => p.length >= 4 && !CLIENT_NAME_STOP.has(p));
  if (parts.length >= 2) {
    return parts.every((p) => {
      const re = new RegExp(`(?:^|[^\\p{L}\\p{N}])${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:[^\\p{L}\\p{N}]|$)`, 'iu');
      return re.test(hay);
    });
  }
  return false;
}

export async function guessClientAndProject({
  subject,
  snippet,
  body,
  participants = [],
  fromRaw = null,
  toRaw = null,
  allowNameMatch = true,
}) {
  const keywords = extractKeywords(subject, snippet, body);
  let client_id = null;
  let client_name = null;
  let project_id = null;
  let project_name = null;
  let link_source = null;
  let link_confidence = 0;

  const ownEmails = await getOwnEmailsForMatch();
  const externalParticipants = (participants || [])
    .map(e => String(e || '').toLowerCase())
    .filter(e => e.includes('@') && !ownEmails.has(e));

  // Newsletters / promos : jamais de lien par nom (seulement email client exact)
  const promo = isPromotion(fromRaw || '', subject || '', snippet || '');

  // 1) Match exact email client (From OU To — crucial pour les mails envoyés)
  for (const email of externalParticipants) {
    const { rows } = await pool.query(
      `SELECT id, name FROM clients
       WHERE email IS NOT NULL AND LOWER(TRIM(email)) = $1
       LIMIT 1`,
      [email]
    );
    if (rows[0]) {
      client_id = rows[0].id;
      client_name = rows[0].name;
      link_source = 'client_email';
      link_confidence = 0.95;
      break;
    }
  }

  // 2) Match nom client — sujet + noms d’affichage seulement (PAS le corps : faux positifs « Son »)
  if (!client_id && allowNameMatch && !promo) {
    const fromDisplay = parseDisplayName(fromRaw);
    const toDisplay = parseDisplayName(toRaw);
    const hay = `${subject || ''} ${fromDisplay || ''} ${toDisplay || ''}`;
    const { rows: allClients } = await pool.query(
      `SELECT id, name, email FROM clients WHERE LENGTH(TRIM(name)) >= 4 ORDER BY LENGTH(name) DESC LIMIT 200`
    );
    for (const c of allClients) {
      const n = String(c.name).trim();
      if (!clientNameAppearsInText(n, hay)) continue;
      const escaped = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const fullName = new RegExp(`(?:^|[^\\p{L}\\p{N}])${escaped}(?:[^\\p{L}\\p{N}]|$)`, 'iu').test(hay);
      client_id = c.id;
      client_name = c.name;
      link_source = fullName ? 'client_name' : 'client_name_parts';
      link_confidence = fullName ? 0.75 : 0.7;
      break;
    }
  }

  // Sur promo : pas de matching projet par mots-clés (évite liens absurdes)
  if (promo && !client_id) {
    return { client_id: null, client_name: null, project_id: null, project_name: null, link_source: null, link_confidence: 0, keywords };
  }

  // 3) Projet via règles / nom
  const projectMatch = await matchProjectFromRules('any', keywords);
  if (projectMatch) {
    project_id = projectMatch.project_id;
    project_name = projectMatch.project_name;
    link_source = link_source || (projectMatch.confidence === 'rule' ? 'project_rule' : 'project_name');
    link_confidence = Math.max(link_confidence, projectMatch.confidence === 'rule' ? 0.85 : 0.65);
  }

  // 4) Si client connu → dernier projet actif de ce client
  if (client_id && !project_id) {
    const { rows } = await pool.query(
      `SELECT id, name FROM projects
       WHERE client_id = $1 AND status = 'active'
       ORDER BY created_at DESC
       LIMIT 1`,
      [client_id]
    );
    if (rows[0]) {
      project_id = rows[0].id;
      project_name = rows[0].name;
      if (!link_source || link_source.startsWith('client_')) {
        link_source = `${link_source || 'client'}_recent_project`;
      }
      link_confidence = Math.max(link_confidence, 0.55);
    }
  }

  // 5) Si projet connu sans client → hériter le client du projet
  if (project_id && !client_id) {
    const { rows } = await pool.query(
      `SELECT c.id, c.name FROM projects p JOIN clients c ON c.id = p.client_id WHERE p.id = $1`,
      [project_id]
    );
    if (rows[0]) {
      client_id = rows[0].id;
      client_name = rows[0].name;
      link_confidence = Math.max(link_confidence, 0.8);
    }
  }

  return { client_id, client_name, project_id, project_name, link_source, link_confidence, keywords };
}

async function upsertMessage(threadDbId, msg, accountEmail = null) {
  const from_email = parseEmailAddress(msg.from);
  const participants = parseParticipants(msg);
  const is_outbound = accountEmail && from_email === accountEmail.toLowerCase();

  await pool.query(
    `INSERT INTO email_messages (
      thread_id, gmail_message_id, from_email, to_emails, subject, snippet,
      body_text, sent_at, is_outbound, labels
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
    ON CONFLICT (gmail_message_id) DO UPDATE SET
      snippet = EXCLUDED.snippet,
      body_text = COALESCE(EXCLUDED.body_text, email_messages.body_text),
      synced_at = NOW()`,
    [
      threadDbId,
      msg.id,
      from_email,
      participants,
      msg.subject,
      msg.snippet,
      msg.body?.slice(0, 12000) || null,
      parseMessageDate(msg),
      is_outbound,
      JSON.stringify(msg.labelIds || []),
    ]
  );
}

export async function syncGmailThread(gmailThreadId, hints = {}) {
  const thread = await gmail.getThread(gmailThreadId);
  if (!thread.messages?.length) throw new Error('Fil Gmail vide');

  const first = thread.messages[0];
  const last = thread.messages[thread.messages.length - 1];
  const participants = [...new Set(thread.messages.flatMap(parseParticipants))];

  let guess = {};
  if (!hints.client_id && !hints.project_id) {
    guess = await guessClientAndProject({
      subject: first.subject,
      snippet: last.snippet,
      body: last.body,
      participants,
      fromRaw: last.from || first.from,
      toRaw: last.to || first.to,
    });
  }

  const { rows: existing } = await pool.query(
    'SELECT * FROM email_threads WHERE gmail_thread_id = $1',
    [gmailThreadId]
  );

  const client_id = hints.client_id ?? existing[0]?.client_id ?? guess.client_id ?? null;
  const project_id = hints.project_id ?? existing[0]?.project_id ?? guess.project_id ?? null;
  const link_source = hints.link_source ?? existing[0]?.link_source ?? guess.link_source ?? 'sync';
  const link_confidence = hints.link_confidence ?? existing[0]?.link_confidence ?? guess.link_confidence ?? null;

  let threadRow;
  if (existing[0]) {
    const { rows } = await pool.query(
      `UPDATE email_threads SET
        subject = $1, participant_emails = $2, last_message_at = $3, message_count = $4,
        client_id = COALESCE($5, client_id), project_id = COALESCE($6, project_id),
        link_source = COALESCE($7, link_source), link_confidence = COALESCE($8, link_confidence),
        updated_at = NOW()
       WHERE id = $9 RETURNING *`,
      [
        first.subject,
        participants,
        parseMessageDate(last),
        thread.messages.length,
        client_id,
        project_id,
        link_source,
        link_confidence,
        existing[0].id,
      ]
    );
    threadRow = rows[0];
  } else {
    const { rows } = await pool.query(
      `INSERT INTO email_threads (
        gmail_thread_id, subject, participant_emails, client_id, project_id,
        link_source, link_confidence, last_message_at, message_count, status
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'open') RETURNING *`,
      [
        gmailThreadId,
        first.subject,
        participants,
        client_id,
        project_id,
        link_source,
        link_confidence,
        parseMessageDate(last),
        thread.messages.length,
      ]
    );
    threadRow = rows[0];
  }

  let accountEmail = null;
  try {
    const { getGoogleTokenRow } = await import('./google-oauth.js');
    const row = await getGoogleTokenRow();
    accountEmail = row?.account_email || null;
  } catch { /* optional */ }

  for (const msg of thread.messages) {
    await upsertMessage(threadRow.id, msg, accountEmail);
    if (project_id) {
      try {
        await pool.query(
          `INSERT INTO project_emails (project_id, gmail_message_id, thread_id, subject, from_email, snippet)
           VALUES ($1,$2,$3,$4,$5,$6)
           ON CONFLICT (gmail_message_id) DO UPDATE SET project_id = COALESCE(EXCLUDED.project_id, project_emails.project_id)`,
          [project_id, msg.id, gmailThreadId, msg.subject, msg.from, msg.snippet]
        );
      } catch { /* ignore */ }
    }
  }

  try {
    const { classifyAndStoreThread } = await import('./mail-sort.js');
    await classifyAndStoreThread(threadRow.id);
  } catch { /* optional */ }

  return getThreadDetail(threadRow.id);
}

export async function processGmailMessage(messageId, { synthesize = true } = {}) {
  const msg = await gmail.getMessage(messageId);
  let thread = await syncGmailThread(msg.threadId);

  // Promo mal liée → détacher sans effacer les synthèses déjà en DB
  if (isPromotion(msg.from || '', msg.subject || '', msg.snippet || '') && thread?.client_id) {
    const cleared = await clearWeakAutoLink(thread.id);
    if (cleared) thread = await getThreadDetail(thread.id);
  }

  if (synthesize) {
    const latest = thread.latest_synthesis;
    const summaryOk = latest && String(latest.summary || '').trim();
    const msgCount = Number(thread.message_count) || (thread.messages?.length || 0);
    const stale = summaryOk
      && msgCount > (Number(latest.message_count_at_synthesis) || 0);
    if (!summaryOk || stale) {
      try {
        const result = await synthesizeThread(thread.id);
        return {
          ...result.thread,
          synthesis: result.synthesis,
          suggested_client_name: result.thread.suggested_client_name || null,
        };
      } catch (err) {
        // Conserver latest_synthesis éventuelle + messages déjà chargés
        const kept = await getThreadDetail(thread.id);
        return { ...(kept || thread), synthesis_error: err.message };
      }
    }
  }
  return thread;
}

export async function getThreadDetail(threadId) {
  const { rows } = await pool.query(`
    SELECT t.*, c.name AS client_name, p.name AS project_name
    FROM email_threads t
    LEFT JOIN clients c ON c.id = t.client_id
    LEFT JOIN projects p ON p.id = t.project_id
    WHERE t.id = $1
  `, [threadId]);
  if (!rows[0]) return null;

  const { rows: messages } = await pool.query(
    'SELECT * FROM email_messages WHERE thread_id = $1 ORDER BY sent_at ASC',
    [threadId]
  );
  const { rows: syntheses } = await pool.query(
    'SELECT * FROM email_thread_syntheses WHERE thread_id = $1 ORDER BY created_at DESC LIMIT 3',
    [threadId]
  );

  return { ...rows[0], messages, syntheses, latest_synthesis: syntheses[0] || null };
}

export async function listThreads({ client_id, project_id, status, unlinked, limit = 50 } = {}) {
  let q = `
    SELECT t.*, c.name AS client_name, p.name AS project_name,
      s.summary AS latest_summary, s.suggested_reply AS latest_suggested_reply
    FROM email_threads t
    LEFT JOIN clients c ON c.id = t.client_id
    LEFT JOIN projects p ON p.id = t.project_id
    LEFT JOIN LATERAL (
      SELECT summary, suggested_reply FROM email_thread_syntheses
      WHERE thread_id = t.id ORDER BY created_at DESC LIMIT 1
    ) s ON true
    WHERE 1=1
  `;
  const params = [];
  if (client_id) { params.push(client_id); q += ` AND t.client_id = $${params.length}`; }
  if (project_id) { params.push(project_id); q += ` AND t.project_id = $${params.length}`; }
  if (status) { params.push(status); q += ` AND t.status = $${params.length}`; }
  if (unlinked === '1' || unlinked === true) q += ' AND t.client_id IS NULL AND t.project_id IS NULL';
  params.push(limit);
  q += ` ORDER BY t.last_message_at DESC NULLS LAST LIMIT $${params.length}`;

  const { rows } = await pool.query(q, params);
  return rows;
}

export async function linkThread(threadId, { client_id, project_id, link_source = 'manual', link_confidence = 1, updateClientEmail = null }) {
  let resolvedClient = client_id != null && client_id !== '' ? Number(client_id) : null;
  let resolvedProject = project_id != null && project_id !== '' ? Number(project_id) : null;

  // Projet choisi → hériter le client si absent
  if (resolvedProject && !resolvedClient) {
    const { rows } = await pool.query('SELECT client_id FROM projects WHERE id = $1', [resolvedProject]);
    if (rows[0]?.client_id) resolvedClient = rows[0].client_id;
  }

  const conf = link_confidence == null ? (link_source === 'manual' ? 1 : null) : Number(link_confidence);

  const { rows } = await pool.query(
    `UPDATE email_threads SET
      client_id = $1,
      project_id = $2,
      link_source = $3,
      link_confidence = $4,
      updated_at = NOW()
     WHERE id = $5 RETURNING *`,
    [resolvedClient, resolvedProject, link_source, conf, threadId]
  );
  if (!rows[0]) throw new Error('Fil introuvable');

  // Ne jamais coller l’email d’une newsletter / lien auto faible sur la fiche client
  const mayUpdateEmail = updateClientEmail === true
    || (updateClientEmail !== false && link_source === 'manual' && resolvedClient);
  if (mayUpdateEmail && resolvedClient) {
    const { rows: msgs } = await pool.query(
      `SELECT from_email FROM email_messages
       WHERE thread_id = $1 AND is_outbound = false AND from_email IS NOT NULL
       ORDER BY sent_at DESC LIMIT 1`,
      [threadId]
    );
    const email = msgs[0]?.from_email;
    if (email && !isPromotion(email, '', '')) {
      await pool.query(
        `UPDATE clients SET email = COALESCE(NULLIF(TRIM(email), ''), $1)
         WHERE id = $2 AND (email IS NULL OR TRIM(email) = '')`,
        [email, resolvedClient]
      );
    }
    // Remplir aussi tél. / adresse / contact manquants depuis le fil
    try {
      const { enrichClientFromMail } = await import('./client-contact-enrich.js');
      await enrichClientFromMail(resolvedClient, { useAi: false });
    } catch { /* enrichissement optionnel */ }
  }

  if (resolvedProject) {
    const { rows: msgs } = await pool.query(
      'SELECT gmail_message_id, subject, from_email, snippet FROM email_messages WHERE thread_id = $1',
      [threadId]
    );
    const { rows: thread } = await pool.query('SELECT gmail_thread_id FROM email_threads WHERE id = $1', [threadId]);
    for (const m of msgs) {
      await pool.query(
        `INSERT INTO project_emails (project_id, gmail_message_id, thread_id, subject, from_email, snippet)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (gmail_message_id) DO UPDATE SET project_id = $1`,
        [resolvedProject, m.gmail_message_id, thread[0]?.gmail_thread_id, m.subject, m.from_email, m.snippet]
      );
    }
  }

  return getThreadDetail(threadId);
}

/** Retire un lien auto faible (ex. faux positif « Son ») sans toucher aux liens manuels / bons liens synth. */
export async function clearWeakAutoLink(threadId) {
  const { rows } = await pool.query(
    `UPDATE email_threads SET
       client_id = NULL,
       project_id = NULL,
       link_source = NULL,
       link_confidence = NULL,
       updated_at = NOW()
     WHERE id = $1
       AND COALESCE(link_source, '') IS DISTINCT FROM 'manual'
       AND (
         link_source ILIKE 'client_name%'
         OR link_source IN ('synth_relink', 'project_name', 'sync')
         OR (
           link_confidence IS NOT NULL AND link_confidence < 0.9
           AND COALESCE(link_source, '') NOT IN ('synth_client_suggest', 'client_email', 'client_email_auto', 'mail_import')
         )
       )
     RETURNING *`,
    [threadId]
  );
  return rows[0] || null;
}

async function callSynthesisLLM(prompt, { maxTokens = 4096 } = {}) {
  if (!(await isAssistantAiEnabled())) {
    throw new Error('Assistant IA désactivé — activez-le dans Paramètres → Assistant IA');
  }

  const system = 'Tu synthétises des fils de courriel pour un atelier de meubles (NEYA). Réponds UNIQUEMENT en JSON valide compact (pas de markdown). Pour une newsletter/promo : needs_response=false, suggested_reply=null, suggested_client_name=null.';
  const preferred = (await getSetting('ai_provider')) || 'anthropic';
  const errors = [];

  async function tryOpenAI(userPrompt) {
    const key = await getOpenAIKey();
    if (!key) return null;
    const model = (await getSetting('openai_model')) || 'gpt-4o-mini';
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        messages: [{ role: 'system', content: system }, { role: 'user', content: userPrompt }],
        response_format: { type: 'json_object' },
      }),
    });
    const raw = await res.text();
    if (!res.ok) throw new Error(`OpenAI ${res.status}: ${raw.slice(0, 180)}`);
    const data = JSON.parse(raw);
    return parseLlmJson(data.choices[0].message.content);
  }

  async function tryClaude(userPrompt) {
    const key = await getAnthropicKey();
    if (!key) return null;
    const model = await getAnthropicModel();
    // Pas de prefill assistant `{` : plusieurs modèles Claude le refusent (400 invalid_request).
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        system,
        messages: [
          { role: 'user', content: userPrompt },
        ],
      }),
    });
    const raw = await res.text();
    if (!res.ok) throw new Error(`Claude ${res.status}: ${raw.slice(0, 180)}`);
    const data = JSON.parse(raw);
    const text = data.content?.find(b => b.type === 'text')?.text || data.content?.[0]?.text || '';
    return parseLlmJson(text);
  }

  async function runProvider(fn, label) {
    try {
      const first = await fn(prompt);
      if (first == null) return null;
      return first;
    } catch (e) {
      if (/JSON|parse|illisible|Expected/i.test(e.message)) {
        try {
          const second = await fn(`${prompt}\n\nIMPORTANT: JSON invalide précédent (${e.message}). Renvoie UNIQUEMENT un objet JSON valide.`);
          if (second == null) {
            errors.push(`${label}: ${e.message}`);
            return null;
          }
          return second;
        } catch (e2) {
          errors.push(`${label}: ${e2.message}`);
          return null;
        }
      }
      errors.push(`${label}: ${e.message}`);
      return null;
    }
  }

  const order = preferred === 'openai'
    ? [['OpenAI', tryOpenAI], ['Claude', tryClaude]]
    : [['Claude', tryClaude], ['OpenAI', tryOpenAI]];

  for (const [label, fn] of order) {
    const result = await runProvider(fn, label);
    if (result) return result;
  }

  if (!errors.length) {
    throw new Error('Synthèse IA impossible — aucune clé API configurée (Claude / OpenAI)');
  }
  throw new Error(`Synthèse IA impossible — ${errors.join(' | ')}`);
}

/**
 * Reformule ou corrige un brouillon de réponse (instruction libre ou orthographe).
 * mode: 'revise' | 'spellcheck'
 */
export async function reviseDraft({ draft, instruction = '', mode = 'revise', threadId = null } = {}) {
  const text = String(draft || '').trim();
  if (!text) throw new Error('Brouillon vide');

  let contextBlock = '';
  if (threadId) {
    try {
      const detail = await getThreadDetail(Number(threadId));
      if (detail) {
        const last = (detail.messages || []).slice(-3).map(m =>
          `${m.is_outbound ? 'NEYA' : (m.from_email || 'Client')}: ${(m.body_text || m.snippet || '').slice(0, 400)}`
        ).join('\n---\n');
        contextBlock = `\nContexte fil (sujet: ${detail.subject || '—'}):\n${last}\n`;
      }
    } catch { /* optionnel */ }
  }

  let signature = '';
  try {
    const { getCompanyConfig, getEmailSignatureText } = await import('./company-config.js');
    signature = getEmailSignatureText(await getCompanyConfig());
  } catch { /* optional */ }

  const isSpell = mode === 'spellcheck';
  const userInstr = String(instruction || '').trim();
  const prompt = isSpell
    ? `Corrige uniquement l'orthographe, la grammaire et la ponctuation de ce brouillon de courriel en français.
Ne change pas le sens, le ton ni la structure. Conserve la signature telle quelle.
${contextBlock}
Brouillon:
"""
${text}
"""

JSON attendu: { "draft": "texte corrigé complet" }`
    : `Tu es l'assistant rédaction NEYA Furniture. Reformule ce brouillon de réponse courriel selon la demande.
Garde un ton professionnel, clair, en français. Termine par la signature si elle était présente, sinon ajoute :
---
${signature || 'Mehdi\nDesigner / Producteur\nNeya Furniture'}
---
${contextBlock}
Demande utilisateur: ${userInstr || 'Améliore le ton et la clarté sans allonger inutilement.'}

Brouillon actuel:
"""
${text}
"""

JSON attendu: { "draft": "nouveau brouillon complet prêt à envoyer" }`;

  const parsed = await callSynthesisLLM(prompt);
  const next = String(parsed?.draft || parsed?.suggested_reply || '').trim();
  if (!next) throw new Error('L\'IA n\'a pas renvoyé de brouillon');
  return { draft: next, mode: isSpell ? 'spellcheck' : 'revise' };
}

export async function synthesizeThread(threadId) {
  const detail = await getThreadDetail(threadId);
  if (!detail) throw new Error('Fil introuvable');

  const participants = detail.participant_emails
    || [...new Set((detail.messages || []).flatMap(m => {
      const emails = [];
      if (m.from_email) emails.push(String(m.from_email).toLowerCase());
      if (Array.isArray(m.to_emails)) emails.push(...m.to_emails.map(e => String(e).toLowerCase()));
      return emails;
    }))];
  const lastMsg = (detail.messages || [])[(detail.messages || []).length - 1];
  const lastInbound = [...(detail.messages || [])].reverse().find(m => !m.is_outbound);
  const fromHint = lastInbound?.from_email || lastMsg?.from_email || '';
  const promo = isPromotion(fromHint, detail.subject || '', lastMsg?.snippet || '');

  // Relancer matching client si pas encore lié — email exact seulement (pas le corps)
  if (!detail.client_id && !promo) {
    try {
      const lastOutbound = [...(detail.messages || [])].reverse().find(m => m.is_outbound);
      const guess = await guessClientAndProject({
        subject: detail.subject,
        snippet: lastMsg?.snippet || '',
        body: '',
        participants,
        fromRaw: fromHint,
        toRaw: Array.isArray(lastOutbound?.to_emails)
          ? lastOutbound.to_emails.join(', ')
          : (Array.isArray(lastMsg?.to_emails) ? lastMsg.to_emails.join(', ') : null),
        allowNameMatch: true,
      });
      // Auto-lier seulement si email exact (haute confiance)
      if (guess.client_id && guess.link_confidence >= 0.9) {
        await linkThread(threadId, {
          client_id: guess.client_id,
          project_id: guess.project_id || detail.project_id,
          link_source: guess.link_source || 'synth_relink',
          link_confidence: guess.link_confidence,
          updateClientEmail: false,
        });
      }
    } catch { /* best effort */ }
  }

  // Promo déjà mal liée → détacher le faux positif avant synthèse
  if (promo && detail.client_id) {
    await clearWeakAutoLink(threadId);
  }

  const fresh = await getThreadDetail(threadId);
  const allMessages = fresh.messages || [];
  const bodyLimit = allMessages.length > 8 ? 600 : 1000;
  const recent = allMessages.length > 12 ? allMessages.slice(-12) : allMessages;
  const transcript = recent.map(m => ({
    from: m.from_email,
    date: m.sent_at,
    outbound: !!m.is_outbound,
    body: String(m.body_text || m.snippet || '')
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ' ')
      .slice(0, bodyLimit),
  }));

  if (!transcript.length) {
    throw new Error('Aucun message dans le fil — resynchronisez d\'abord');
  }

  let signature = '';
  try {
    const { getCompanyConfig, getEmailSignatureText } = await import('./company-config.js');
    signature = getEmailSignatureText(await getCompanyConfig());
  } catch { /* optional */ }

  const prompt = `Analyse ce fil de courriel et produis une synthèse pour l'équipe NEYA.

Client lié: ${fresh.client_name || 'non lié'} (id: ${fresh.client_id || 'null'})
Projet lié: ${fresh.project_name || 'non lié'} (id: ${fresh.project_id || 'null'})
Sujet: ${fresh.subject}
${promo ? 'Indice: ce message ressemble à une newsletter / promotion fournisseur.\n' : ''}
Messages (${transcript.length}${allMessages.length > transcript.length ? ` / ${allMessages.length}` : ''}):
${JSON.stringify(transcript)}

Signature à utiliser à la fin de suggested_reply (si réponse utile) :
---
${signature || 'Mehdi\nDesigner / Producteur\nNeya Furniture'}
---

Réponds avec un objet JSON compact:
{
  "summary": "résumé en 3-5 phrases",
  "key_points": [{"type":"demande|info|délai|prix|problème", "text":"..."}],
  "action_items": [{"text":"...", "due":null, "priority":"normale"}],
  "sentiment": "neutre",
  "suggested_reply": null,
  "client_intent": "autre",
  "needs_response": false,
  "suggested_client_name": null,
  "is_promotion": ${promo ? 'true' : 'false'}
}`;

  const parsed = await callSynthesisLLM(prompt, { maxTokens: 4096 });
  const model = (await getSetting('ai_provider')) || 'anthropic';

  const looksPromo = promo
    || parsed.is_promotion === true
    || /newsletter|infolettre|promotion|publicitaire|marketing/i.test(String(parsed.summary || ''));

  if (looksPromo) {
    parsed.needs_response = false;
    if (!parsed.suggested_reply) parsed.suggested_reply = null;
    await clearWeakAutoLink(threadId);
  }

  // Suggestion client : match exact du nom seulement (pas LIKE %x%), min 4 chars
  if (!fresh.client_id && !looksPromo && parsed.suggested_client_name) {
    const needle = String(parsed.suggested_client_name).trim().toLowerCase();
    if (needle.length >= 4) {
      const { rows: hit } = await pool.query(
        `SELECT id FROM clients WHERE LOWER(TRIM(name)) = $1 LIMIT 1`,
        [needle]
      );
      if (hit[0]) {
        await linkThread(threadId, {
          client_id: hit[0].id,
          project_id: fresh.project_id,
          link_source: 'synth_client_suggest',
          link_confidence: 0.92,
          updateClientEmail: false,
        });
      }
    }
  }

  const summary = String(parsed.summary || '').trim();
  if (!summary) {
    const prior = await getThreadDetail(threadId);
    if (prior?.latest_synthesis && String(prior.latest_synthesis.summary || '').trim()) {
      return { thread: prior, synthesis: prior.latest_synthesis, kept_previous: true };
    }
    throw new Error('Synthèse vide — réessayez dans un instant');
  }

  const suggestName = (!fresh.client_id && !looksPromo && parsed.suggested_client_name)
    ? String(parsed.suggested_client_name).trim().slice(0, 200)
    : null;

  const { rows } = await pool.query(
    `INSERT INTO email_thread_syntheses (
      thread_id, summary, key_points, action_items, sentiment,
      suggested_reply, client_intent, needs_response, model, message_count_at_synthesis
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [
      threadId,
      summary,
      JSON.stringify(parsed.key_points || []),
      JSON.stringify(parsed.action_items || []),
      parsed.sentiment || 'neutre',
      parsed.suggested_reply || null,
      parsed.client_intent || null,
      parsed.needs_response === true,
      model,
      fresh.messages?.length || 0,
    ]
  );

  await pool.query(
    `UPDATE email_threads SET
       updated_at = NOW(),
       suggested_client_name = CASE
         WHEN client_id IS NOT NULL THEN NULL
         WHEN $2::text IS NOT NULL THEN $2
         ELSE suggested_client_name
       END
     WHERE id = $1`,
    [threadId, suggestName]
  );

  try {
    const { classifyAndStoreThread } = await import('./mail-sort.js');
    await classifyAndStoreThread(threadId);
  } catch { /* optional */ }

  const threadOut = await getThreadDetail(threadId);
  if (!threadOut.client_id && (suggestName || threadOut.suggested_client_name) && !looksPromo) {
    threadOut.suggested_client_name = suggestName || threadOut.suggested_client_name;
  }
  return { thread: threadOut, synthesis: rows[0] };
}

export async function processRecentInbox(max = 15) {
  const { messages } = await gmail.listMessages({ label: 'INBOX', max });
  const seen = new Set();
  const results = [];
  const errors = [];

  for (const m of messages || []) {
    if (!m.threadId || seen.has(m.threadId)) continue;
    seen.add(m.threadId);
    try {
      const thread = await syncGmailThread(m.threadId);
      results.push(thread);
    } catch (err) {
      errors.push({ thread_id: m.threadId, error: err.message });
    }
  }

  return {
    processed: results.length,
    scanned: seen.size,
    threads: results,
    errors,
  };
}

import pool from '../db/pool.js';
import * as gmail from './google-gmail.js';
import { extractKeywords, matchProjectFromRules } from './invoice-email-router.js';
import { getOpenAIKey, getAnthropicKey, getAnthropicModel, getSetting, isAssistantAiEnabled } from './settings.js';

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

export async function guessClientAndProject({
  subject,
  snippet,
  body,
  participants = [],
  fromRaw = null,
  toRaw = null,
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

  // 2) Match nom client dans sujet / expéditeur / destinataire
  if (!client_id) {
    const fromDisplay = parseDisplayName(fromRaw);
    const toDisplay = parseDisplayName(toRaw);
    const hay = `${subject || ''} ${fromDisplay || ''} ${toDisplay || ''} ${snippet || ''} ${toRaw || ''}`.toLowerCase();
    const { rows: allClients } = await pool.query(
      `SELECT id, name, email FROM clients WHERE LENGTH(TRIM(name)) >= 3 ORDER BY LENGTH(name) DESC LIMIT 200`
    );
    for (const c of allClients) {
      const n = String(c.name).trim().toLowerCase();
      if (n.length >= 3 && hay.includes(n)) {
        client_id = c.id;
        client_name = c.name;
        link_source = 'client_name';
        link_confidence = 0.75;
        break;
      }
      const parts = n.split(/\s+/).filter(p => p.length >= 3);
      if (parts.length >= 2 && parts.every(p => hay.includes(p))) {
        client_id = c.id;
        client_name = c.name;
        link_source = 'client_name_parts';
        link_confidence = 0.7;
        break;
      }
    }
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
       WHERE client_id = $1 AND status IN ('active', 'paused')
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
  if (synthesize && !thread.latest_synthesis) {
    try {
      const result = await synthesizeThread(thread.id);
      return {
        ...result.thread,
        synthesis: result.synthesis,
        suggested_client_name: result.thread.suggested_client_name || null,
      };
    } catch (err) {
      return { ...thread, synthesis_error: err.message };
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

export async function linkThread(threadId, { client_id, project_id, link_source = 'manual' }) {
  let resolvedClient = client_id != null && client_id !== '' ? Number(client_id) : null;
  let resolvedProject = project_id != null && project_id !== '' ? Number(project_id) : null;

  // Projet choisi → hériter le client si absent
  if (resolvedProject && !resolvedClient) {
    const { rows } = await pool.query('SELECT client_id FROM projects WHERE id = $1', [resolvedProject]);
    if (rows[0]?.client_id) resolvedClient = rows[0].client_id;
  }

  const { rows } = await pool.query(
    `UPDATE email_threads SET
      client_id = $1,
      project_id = $2,
      link_source = $3,
      link_confidence = 1,
      updated_at = NOW()
     WHERE id = $4 RETURNING *`,
    [resolvedClient, resolvedProject, link_source, threadId]
  );
  if (!rows[0]) throw new Error('Fil introuvable');

  // Si client lié mais sans email ERP : proposer l'email du fil
  if (resolvedClient) {
    const { rows: msgs } = await pool.query(
      `SELECT from_email FROM email_messages
       WHERE thread_id = $1 AND is_outbound = false AND from_email IS NOT NULL
       ORDER BY sent_at DESC LIMIT 1`,
      [threadId]
    );
    const email = msgs[0]?.from_email;
    if (email) {
      await pool.query(
        `UPDATE clients SET email = COALESCE(NULLIF(TRIM(email), ''), $1)
         WHERE id = $2 AND (email IS NULL OR TRIM(email) = '')`,
        [email, resolvedClient]
      );
    }
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

async function callSynthesisLLM(prompt) {
  if (!(await isAssistantAiEnabled())) {
    throw new Error('Assistant IA désactivé — activez-le dans Paramètres → Assistant IA');
  }

  const system = 'Tu synthétises des fils de courriel pour un atelier de meubles (NEYA). Réponds UNIQUEMENT en JSON valide.';
  const preferred = (await getSetting('ai_provider')) || 'anthropic';
  const errors = [];

  async function tryOpenAI() {
    const key = await getOpenAIKey();
    if (!key) throw new Error('Clé OpenAI absente');
    const model = (await getSetting('openai_model')) || 'gpt-4o-mini';
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
      }),
    });
    const raw = await res.text();
    if (!res.ok) throw new Error(`OpenAI ${res.status}: ${raw.slice(0, 180)}`);
    const data = JSON.parse(raw);
    return JSON.parse(data.choices[0].message.content);
  }

  async function tryClaude() {
    const key = await getAnthropicKey();
    if (!key) throw new Error('Clé Claude absente');
    const model = await getAnthropicModel();
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 1200,
        system,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    const raw = await res.text();
    if (!res.ok) throw new Error(`Claude ${res.status}: ${raw.slice(0, 180)}`);
    const data = JSON.parse(raw);
    const text = data.content?.find(b => b.type === 'text')?.text || data.content?.[0]?.text || '{}';
    const fenced = String(text).match(/```(?:json)?\s*([\s\S]*?)```/i);
    const candidate = fenced ? fenced[1].trim() : String(text).trim();
    const match = candidate.match(/\{[\s\S]*\}/);
    return JSON.parse(match ? match[0] : candidate);
  }

  const order = preferred === 'openai' ? [tryOpenAI, tryClaude] : [tryClaude, tryOpenAI];
  for (const fn of order) {
    try {
      return await fn();
    } catch (e) {
      errors.push(e.message);
    }
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

  // Relancer matching client si pas encore lié
  if (!detail.client_id) {
    try {
      const participants = detail.participant_emails
        || [...new Set((detail.messages || []).flatMap(m => {
          const emails = [];
          if (m.from_email) emails.push(String(m.from_email).toLowerCase());
          if (Array.isArray(m.to_emails)) emails.push(...m.to_emails.map(e => String(e).toLowerCase()));
          return emails;
        }))];
      const lastMsg = (detail.messages || [])[(detail.messages || []).length - 1];
      const allText = (detail.messages || [])
        .map(m => `${m.snippet || ''} ${m.body_text || ''}`)
        .join(' ')
        .slice(0, 4000);
      const lastOutbound = [...(detail.messages || [])].reverse().find(m => m.is_outbound);
      const lastInbound = [...(detail.messages || [])].reverse().find(m => !m.is_outbound);
      const guess = await guessClientAndProject({
        subject: detail.subject,
        snippet: allText || lastMsg?.snippet,
        body: lastMsg?.body_text,
        participants,
        fromRaw: lastInbound?.from_email || lastMsg?.from_email,
        toRaw: Array.isArray(lastOutbound?.to_emails)
          ? lastOutbound.to_emails.join(', ')
          : (Array.isArray(lastMsg?.to_emails) ? lastMsg.to_emails.join(', ') : null),
      });
      if (guess.client_id || guess.project_id) {
        await linkThread(threadId, {
          client_id: guess.client_id,
          project_id: guess.project_id || detail.project_id,
          link_source: guess.link_source || 'synth_relink',
        });
      }
    } catch { /* best effort */ }
  }

  const fresh = await getThreadDetail(threadId);
  const transcript = (fresh.messages || []).map(m => ({
    from: m.from_email,
    date: m.sent_at,
    outbound: m.is_outbound,
    body: (m.body_text || m.snippet || '').slice(0, 1500),
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

Messages (${transcript.length}):
${JSON.stringify(transcript, null, 2)}

Signature à utiliser à la fin de suggested_reply (obligatoire si tu proposes une réponse) :
---
${signature || 'Mehdi\nDesigner / Producteur\nNeya Furniture'}
---

JSON attendu:
{
  "summary": "résumé en 3-5 phrases de la conversation et où on en est",
  "key_points": [{"type":"demande|info|délai|prix|problème", "text":"..."}],
  "action_items": [{"text":"...", "due":"YYYY-MM-DD ou null", "priority":"haute|normale|basse"}],
  "sentiment": "urgent|positif|neutre|tendu",
  "suggested_reply": "brouillon de réponse professionnelle en français, terminé par la signature ci-dessus (ou null si rien à répondre)",
  "client_intent": "devis|suivi|plainte|confirmation|autre",
  "needs_response": true,
  "suggested_client_name": "nom client ERP si identifiable sinon null"
}`;

  const parsed = await callSynthesisLLM(prompt);
  const model = (await getSetting('ai_provider')) || 'anthropic';

  if (!fresh.client_id && parsed.suggested_client_name) {
    const needle = String(parsed.suggested_client_name).trim().toLowerCase();
    if (needle.length >= 2) {
      const { rows: hit } = await pool.query(
        `SELECT id FROM clients WHERE LOWER(name) = $1 OR LOWER(name) LIKE $2 LIMIT 1`,
        [needle, `%${needle}%`]
      );
      if (hit[0]) {
        await linkThread(threadId, {
          client_id: hit[0].id,
          project_id: fresh.project_id,
          link_source: 'synth_client_suggest',
        });
      }
    }
  }

  const { rows } = await pool.query(
    `INSERT INTO email_thread_syntheses (
      thread_id, summary, key_points, action_items, sentiment,
      suggested_reply, client_intent, needs_response, model, message_count_at_synthesis
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [
      threadId,
      parsed.summary || '',
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

  await pool.query('UPDATE email_threads SET updated_at = NOW() WHERE id = $1', [threadId]);

  try {
    const { classifyAndStoreThread } = await import('./mail-sort.js');
    await classifyAndStoreThread(threadId);
  } catch { /* optional */ }

  const threadOut = await getThreadDetail(threadId);
  if (!threadOut.client_id && parsed.suggested_client_name) {
    threadOut.suggested_client_name = parsed.suggested_client_name;
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

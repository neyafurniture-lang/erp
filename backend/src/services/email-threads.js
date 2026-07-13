import pool from '../db/pool.js';
import * as gmail from './google-gmail.js';
import { extractKeywords, matchProjectFromRules } from './invoice-email-router.js';
import { getOpenAIKey, getAnthropicKey, getSetting, isAssistantAiEnabled } from './settings.js';

function parseEmailAddress(raw) {
  if (!raw) return null;
  const m = String(raw).match(/<([^>]+)>/);
  const email = (m ? m[1] : raw).trim().toLowerCase();
  return email.includes('@') ? email : null;
}

function parseParticipants(msg) {
  const emails = new Set();
  for (const field of [msg.from, msg.to]) {
    const matches = String(field || '').match(/[\w.+-]+@[\w.-]+\.\w+/gi) || [];
    matches.forEach(e => emails.add(e.toLowerCase()));
  }
  return [...emails];
}

function parseMessageDate(msg) {
  const d = msg.date ? new Date(msg.date) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toISOString() : new Date().toISOString();
}

export async function guessClientAndProject({ subject, snippet, body, participants = [] }) {
  const keywords = extractKeywords(subject, snippet, body);
  let client_id = null;
  let client_name = null;
  let project_id = null;
  let project_name = null;
  let link_source = null;
  let link_confidence = 0;

  for (const email of participants) {
    const { rows } = await pool.query(
      'SELECT id, name FROM clients WHERE LOWER(email) = $1 LIMIT 1',
      [email]
    );
    if (rows[0]) {
      client_id = rows[0].id;
      client_name = rows[0].name;
      link_source = 'client_match';
      link_confidence = 0.95;
      break;
    }
  }

  const projectMatch = await matchProjectFromRules('any', keywords);
  if (projectMatch) {
    project_id = projectMatch.project_id;
    project_name = projectMatch.project_name;
    link_source = link_source || projectMatch.confidence || 'project_name';
    link_confidence = Math.max(link_confidence, projectMatch.confidence === 'rule' ? 0.85 : 0.65);
  }

  if (client_id && !project_id) {
    const { rows } = await pool.query(
      `SELECT id, name FROM projects WHERE client_id = $1 AND status = 'active'
       ORDER BY updated_at DESC NULLS LAST, created_at DESC LIMIT 1`,
      [client_id]
    );
    if (rows[0]) {
      project_id = rows[0].id;
      project_name = rows[0].name;
      if (!link_source) link_source = 'client_recent_project';
      link_confidence = Math.max(link_confidence, 0.55);
    }
  }

  if (project_id && !client_id) {
    const { rows } = await pool.query(
      `SELECT c.id, c.name FROM projects p JOIN clients c ON c.id = p.client_id WHERE p.id = $1`,
      [project_id]
    );
    if (rows[0]) {
      client_id = rows[0].id;
      client_name = rows[0].name;
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

export async function processGmailMessage(messageId) {
  const msg = await gmail.getMessage(messageId);
  return syncGmailThread(msg.threadId);
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
  const { rows } = await pool.query(
    `UPDATE email_threads SET
      client_id = COALESCE($1, client_id),
      project_id = COALESCE($2, project_id),
      link_source = $3,
      link_confidence = 1,
      updated_at = NOW()
     WHERE id = $4 RETURNING *`,
    [client_id || null, project_id || null, link_source, threadId]
  );
  if (!rows[0]) throw new Error('Fil introuvable');

  if (project_id) {
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
        [project_id, m.gmail_message_id, thread[0]?.gmail_thread_id, m.subject, m.from_email, m.snippet]
      );
    }
  }

  return getThreadDetail(threadId);
}

async function callSynthesisLLM(prompt) {
  if (!(await isAssistantAiEnabled())) {
    throw new Error('Assistant IA désactivé — activez-le dans Paramètres');
  }

  const provider = (await getSetting('ai_provider')) || 'anthropic';
  const system = 'Tu synthétises des fils de courriel pour un atelier de meubles (NEYA). Réponds UNIQUEMENT en JSON valide.';

  if (provider === 'openai' && await getOpenAIKey()) {
    const model = (await getSetting('openai_model')) || 'gpt-4o-mini';
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await getOpenAIKey()}` },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
      }),
    });
    if (!res.ok) throw new Error('Synthèse IA échouée (OpenAI)');
    const data = await res.json();
    return JSON.parse(data.choices[0].message.content);
  }

  if (await getAnthropicKey()) {
    const model = (await getSetting('anthropic_model')) || 'claude-sonnet-5';
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': await getAnthropicKey(),
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 1200,
        system,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!res.ok) throw new Error('Synthèse IA échouée (Claude)');
    const data = await res.json();
    const text = data.content?.[0]?.text || '{}';
    const match = text.match(/\{[\s\S]*\}/);
    return JSON.parse(match ? match[0] : text);
  }

  throw new Error('Aucune clé IA configurée pour la synthèse');
}

export async function synthesizeThread(threadId) {
  const detail = await getThreadDetail(threadId);
  if (!detail) throw new Error('Fil introuvable');

  const transcript = (detail.messages || []).map(m => ({
    from: m.from_email,
    date: m.sent_at,
    outbound: m.is_outbound,
    body: (m.body_text || m.snippet || '').slice(0, 1500),
  }));

  const prompt = `Analyse ce fil de courriel et produis une synthèse pour l'équipe NEYA.

Client lié: ${detail.client_name || 'non lié'}
Projet lié: ${detail.project_name || 'non lié'}
Sujet: ${detail.subject}

Messages (${transcript.length}):
${JSON.stringify(transcript, null, 2)}

JSON attendu:
{
  "summary": "résumé en 3-5 phrases de la conversation et où on en est",
  "key_points": [{"type":"demande|info|délai|prix|problème", "text":"..."}],
  "action_items": [{"text":"...", "due":"YYYY-MM-DD ou null", "priority":"haute|normale|basse"}],
  "sentiment": "urgent|positif|neutre|tendu",
  "suggested_reply": "brouillon de réponse professionnelle en français (ou null si rien à répondre)",
  "client_intent": "devis|suivi|plainte|confirmation|autre",
  "needs_response": true
}`;

  const parsed = await callSynthesisLLM(prompt);
  const model = (await getSetting('ai_provider')) || 'anthropic';

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
      detail.messages?.length || 0,
    ]
  );

  await pool.query('UPDATE email_threads SET updated_at = NOW() WHERE id = $1', [threadId]);

  try {
    const { classifyAndStoreThread } = await import('./mail-sort.js');
    await classifyAndStoreThread(threadId);
  } catch { /* optional */ }

  return { thread: await getThreadDetail(threadId), synthesis: rows[0] };
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

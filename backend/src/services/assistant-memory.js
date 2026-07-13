import pool from '../db/pool.js';

const REMEMBER_RE = /^(?:retiens?|mémorise|memorise|note)\s+(?:que\s+)?(.+)/i;
const FORGET_RE = /^(?:oublie|supprime\s+la\s+mémoire)\s+(.+)/i;

export async function getMemories({
  projectId = null,
  clientId = null,
  quoteId = null,
  limit = 20,
} = {}) {
  const { rows } = await pool.query(
    `SELECT * FROM assistant_memories
     WHERE active = true
       AND (
         (project_id IS NULL AND client_id IS NULL AND quote_id IS NULL)
         OR ($1::int IS NOT NULL AND project_id = $1)
         OR ($2::int IS NOT NULL AND client_id = $2)
         OR ($3::int IS NOT NULL AND quote_id = $3)
       )
     ORDER BY
       CASE
         WHEN quote_id IS NOT NULL THEN 0
         WHEN project_id IS NOT NULL THEN 1
         WHEN client_id IS NOT NULL THEN 2
         ELSE 3
       END,
       confidence DESC,
       updated_at DESC
     LIMIT $4`,
    [projectId, clientId, quoteId, limit]
  );
  return rows;
}

export async function formatMemoriesForPrompt({
  projectId = null,
  clientId = null,
  quoteId = null,
} = {}) {
  const memories = await getMemories({ projectId, clientId, quoteId, limit: 20 });
  if (!memories.length) return '';
  const lines = memories.map(m => {
    const scope = m.quote_id ? 'devis' : m.project_id ? 'projet' : m.client_id ? 'client' : m.category;
    return `- [${scope}] ${m.content}`;
  });
  return `\nMémoire atelier NEYA (utilisée pour devis / préférences) :\n${lines.join('\n')}`;
}

export async function saveMemory({
  content,
  category = 'preference',
  projectId = null,
  clientId = null,
  quoteId = null,
  source = 'user',
  confidence = 0.9,
}) {
  const text = String(content || '').trim();
  if (!text) return null;
  const { rows } = await pool.query(
    `INSERT INTO assistant_memories (category, content, source, project_id, client_id, quote_id, confidence)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [category, text.slice(0, 2000), source, projectId, clientId, quoteId, confidence]
  );
  return rows[0];
}

export async function tryMemoryCommand(message, scope = {}) {
  const projectId = scope?.projectId ?? (typeof scope === 'number' ? scope : null);
  const clientId = scope?.clientId ?? null;
  const quoteId = scope?.quoteId ?? null;

  const forget = message.match(FORGET_RE);
  if (forget) {
    const needle = forget[1].trim().toLowerCase();
    const { rowCount } = await pool.query(
      `UPDATE assistant_memories SET active = false
       WHERE LOWER(content) LIKE $1
         AND (
           ($2::int IS NULL AND $3::int IS NULL AND $4::int IS NULL)
           OR project_id IS NULL OR project_id = $2
           OR client_id IS NULL OR client_id = $3
           OR quote_id IS NULL OR quote_id = $4
         )`,
      [`%${needle}%`, projectId, clientId, quoteId]
    );
    return rowCount > 0
      ? { handled: true, reply: `Mémoire effacée (${rowCount} entrée(s)).`, actions: [] }
      : { handled: true, reply: 'Aucune mémoire correspondante trouvée.', actions: [] };
  }

  const remember = message.match(REMEMBER_RE);
  if (remember) {
    const content = remember[1].trim();
    let category = 'preference';
    if (quoteId) category = 'quote';
    else if (projectId) category = 'project';
    else if (clientId) category = 'client';

    const saved = await saveMemory({
      content,
      category,
      projectId,
      clientId,
      quoteId,
      source: 'user',
    });
    return {
      handled: true,
      reply: `Noté — je retiendrai : « ${content} »`,
      actions: [{ type: 'memory_saved', data: saved }],
    };
  }

  return { handled: false };
}

export async function saveFeedback(messageId, rating, correction = null) {
  await pool.query(
    'INSERT INTO assistant_feedback (message_id, rating, correction) VALUES ($1, $2, $3)',
    [messageId, rating, correction]
  );
}

export async function logAgentAction({ agent = 'general', action, resource, details, userId, requiresConfirm = false }) {
  await pool.query(
    `INSERT INTO agent_audit_log (agent_id, action, resource, details, user_id, requires_confirm)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [agent, action, resource, JSON.stringify(details || {}), userId, requiresConfirm]
  );
}

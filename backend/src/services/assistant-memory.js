import pool from '../db/pool.js';

const REMEMBER_RE = /^(?:retiens?|mémorise|note)\s+(?:que\s+)?(.+)/i;
const FORGET_RE = /^(?:oublie|supprime\s+la\s+mémoire)\s+(.+)/i;

export async function getMemories({ projectId = null, limit = 20 } = {}) {
  const { rows } = await pool.query(
    `SELECT * FROM assistant_memories
     WHERE active = true AND (project_id IS NULL OR project_id = $1)
     ORDER BY confidence DESC, updated_at DESC LIMIT $2`,
    [projectId, limit]
  );
  return rows;
}

export async function formatMemoriesForPrompt(projectId = null) {
  const memories = await getMemories({ projectId, limit: 15 });
  if (!memories.length) return '';
  const lines = memories.map(m => `- [${m.category}] ${m.content}`);
  return `\nMémoire atelier NEYA :\n${lines.join('\n')}`;
}

export async function tryMemoryCommand(message, projectId = null) {
  const forget = message.match(FORGET_RE);
  if (forget) {
    const needle = forget[1].trim().toLowerCase();
    const { rowCount } = await pool.query(
      `UPDATE assistant_memories SET active = false
       WHERE LOWER(content) LIKE $1 AND ($2::int IS NULL OR project_id IS NULL OR project_id = $2)`,
      [`%${needle}%`, projectId]
    );
    return rowCount > 0
      ? { handled: true, reply: `Mémoire effacée (${rowCount} entrée(s)).`, actions: [] }
      : { handled: true, reply: 'Aucune mémoire correspondante trouvée.', actions: [] };
  }

  const remember = message.match(REMEMBER_RE);
  if (remember) {
    const content = remember[1].trim();
    const category = projectId ? 'project' : 'preference';
    await pool.query(
      `INSERT INTO assistant_memories (category, content, source, project_id, confidence)
       VALUES ($1, $2, 'user', $3, 0.9)`,
      [category, content, projectId]
    );
    return { handled: true, reply: `Noté — je retiendrai : « ${content} »`, actions: [{ type: 'memory_saved', data: { content } }] };
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

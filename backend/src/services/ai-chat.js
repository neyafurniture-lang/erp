import {
  getAnthropicKey,
  getOpenAIKey,
  getSetting,
  isAssistantAiEnabled,
} from './settings.js';

function parseJsonReply(text) {
  const raw = String(text || '').trim();
  if (!raw) return { reply: '', action: { type: null, params: {} } };

  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced ? fenced[1].trim() : raw);

  try {
    const parsed = JSON.parse(candidate);
    if (typeof parsed === 'string') {
      return { reply: parsed, action: { type: null, params: {} } };
    }
    return {
      reply: parsed.reply || parsed.message || raw,
      action: parsed.action || { type: null, params: {} },
    };
  } catch {
    const embedded = candidate.match(/\{[\s\S]*"reply"[\s\S]*\}/);
    if (embedded) {
      try {
        const parsed = JSON.parse(embedded[0]);
        return {
          reply: parsed.reply || raw,
          action: parsed.action || { type: null, params: {} },
        };
      } catch { /* fallthrough */ }
    }
    // Claude a répondu en texte libre — on l'utilise quand même
    return { reply: raw, action: { type: null, params: {} } };
  }
}

const HISTORY_LIMIT = 12;

async function buildErpContextSnapshot(pageContext) {
  const pool = (await import('../db/pool.js')).default;

  const [{ rows: projects }, { rows: clients }] = await Promise.all([
    pool.query(`
      SELECT p.id, p.name, p.status, c.name AS client_name
      FROM projects p
      LEFT JOIN clients c ON c.id = p.client_id
      ORDER BY p.created_at DESC
      LIMIT 15
    `),
    pool.query('SELECT id, name, email FROM clients ORDER BY name LIMIT 20'),
  ]);

  const lines = [];
  if (projects.length) {
    lines.push('Projets récents :');
    for (const p of projects) {
      lines.push(`- #${p.id} « ${p.name} » [${p.status}]${p.client_name ? ` — client: ${p.client_name}` : ''}`);
    }
  }
  if (clients.length) {
    lines.push('Clients :');
    for (const c of clients) {
      lines.push(`- #${c.id} « ${c.name} »${c.email ? ` (${c.email})` : ''}`);
    }
  }
  if (pageContext?.type === 'project' && pageContext.tasks?.length) {
    const pending = pageContext.tasks.filter(t => t.status !== 'done');
    lines.push(`Tâches du projet courant « ${pageContext.label} » :`);
    for (const t of pending.slice(0, 12)) {
      lines.push(`- [${t.status}] ${t.title}`);
    }
  }
  return lines.length ? `\nDonnées ERP actuelles (requête base) :\n${lines.join('\n')}` : '';
}

async function buildSystemPrompt(pageContext) {
  const pool = (await import('../db/pool.js')).default;
  const { formatMemoriesForPrompt } = await import('./assistant-memory.js');
  const { ACTION_TYPES } = await import('./skill-actions.js');
  const { getManualPromptBlock } = await import('../content/erp-manual.js');

  const { rows: skills } = await pool.query(
    'SELECT name, description, action_type FROM assistant_skills WHERE enabled = true'
  );
  const ctxNote = pageContext
    ? `\nContexte page : ${JSON.stringify({ type: pageContext.type, id: pageContext.id, label: pageContext.label, isCustom: pageContext.isCustom })}.`
    : '';
  const memoryBlock = await formatMemoriesForPrompt(pageContext?.id || null);
  const manualBlock = `\n${getManualPromptBlock()}`;
  const erpBlock = await buildErpContextSnapshot(pageContext);
  let driveBlock = '';
  try {
    const { getGoogleTokenRow } = await import('./google-oauth.js');
    const { getFolderTree } = await import('./google-drive.js');
    const row = await getGoogleTokenRow();
    if (row?.access_token) {
      const tree = await getFolderTree('root', 2);
      driveBlock = `\nArborescence Drive (racine, profondeur 2): ${JSON.stringify(tree).slice(0, 4000)}`;
    }
  } catch { /* Drive optionnel */ }

  return `Tu es Lia, l'assistant NEYA ERP (atelier meubles Neya Furniture).
IMPORTANT: ta réponse doit être UNIQUEMENT un objet JSON valide, sans markdown, sans texte avant/après.
Skills: ${JSON.stringify(skills)}
Actions: ${ACTION_TYPES.join('|')}
Format exact: {"reply":"texte pour l'utilisateur","action":{"type":null,"params":{}}}
Si tu dois exécuter une action ERP, mets le type dans action.type (ex. list_projects, create_task, complete_task).
Sinon action.type = null.
Mémoire conversation : utilise l'historique des messages pour les suites (« oui », « le premier », « ce projet », « celui-là »). Ne redemande pas ce qui vient d'être dit.
Données ERP : utilise le bloc ci-dessous pour les noms/id. Si une info manque, appelle list_projects, list_clients ou list_project_tasks plutôt que d'inventer.
Lie tâches/dépenses au contexte page quand pertinent. Si l'utilisateur mentionne un fichier sans pièce jointe, demande-lui de joindre le fichier via le bouton 📎.
Pour toute question « comment faire », renvoie vers /manual et cite la section pertinente.${memoryBlock}${manualBlock}${erpBlock}${driveBlock}${ctxNote}`;
}

async function callOpenAI({ systemPrompt, history, message }) {
  const apiKey = await getOpenAIKey();
  if (!apiKey) return null;

  const model = (await getSetting('openai_model')) || 'gpt-4o-mini';
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        ...history.slice(-HISTORY_LIMIT).map(h => ({ role: h.role, content: h.content })),
        { role: 'user', content: message },
      ],
      response_format: { type: 'json_object' },
    }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  return parseJsonReply(data.choices[0].message.content);
}

function buildClaudeMessages(history, message) {
  const messages = [];
  for (const h of history.slice(-HISTORY_LIMIT)) {
    const role = h.role === 'assistant' ? 'assistant' : 'user';
    const content = String(h.content || '').trim();
    if (!content) continue;
    if (messages.length && messages[messages.length - 1].role === role) {
      messages[messages.length - 1].content += `\n${content}`;
    } else {
      messages.push({ role, content });
    }
  }
  if (messages.length && messages[messages.length - 1].role === 'user') {
    messages[messages.length - 1].content += `\n${message}`;
  } else {
    messages.push({ role: 'user', content: message });
  }
  if (messages[0]?.role === 'assistant') messages.shift();
  return messages;
}

async function callClaude({ systemPrompt, history, message }) {
  const apiKey = await getAnthropicKey();
  if (!apiKey) return null;

  const model = (await getSetting('anthropic_model')) || 'claude-sonnet-5';
  const messages = buildClaudeMessages(history, message);

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 2048,
      system: systemPrompt,
      messages,
    }),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => '');
    console.warn('Claude API:', res.status, err.slice(0, 300));
    return null;
  }
  const data = await res.json();
  const text = data.content?.find(b => b.type === 'text')?.text;
  if (!text) return null;
  return parseJsonReply(text);
}

export async function getActiveAiProvider() {
  const preferred = (await getSetting('ai_provider')) || 'anthropic';
  const hasClaude = Boolean(await getAnthropicKey());
  const hasOpenai = Boolean(await getOpenAIKey());

  if (preferred === 'anthropic' && hasClaude) return 'anthropic';
  if (preferred === 'openai' && hasOpenai) return 'openai';
  if (hasClaude) return 'anthropic';
  if (hasOpenai) return 'openai';
  return null;
}

export async function callAssistantLLM(message, history, pageContext) {
  if (!(await isAssistantAiEnabled())) return null;

  const provider = await getActiveAiProvider();
  if (!provider) return null;

  try {
    const systemPrompt = await buildSystemPrompt(pageContext);
    if (provider === 'anthropic') {
      return await callClaude({ systemPrompt, history, message });
    }
    return await callOpenAI({ systemPrompt, history, message });
  } catch (err) {
    console.warn('Assistant LLM:', err.message);
    return null;
  }
}

/** Appel LLM générique — retourne l'objet JSON brut (planification). */
export async function callRawLLM({ systemPrompt, message, history = [] }) {
  if (!(await isAssistantAiEnabled())) return null;
  const provider = await getActiveAiProvider();
  if (!provider) return null;
  try {
    let text = null;
    if (provider === 'anthropic') {
      const apiKey = await getAnthropicKey();
      if (!apiKey) return null;
      const model = (await getSetting('anthropic_model')) || 'claude-sonnet-5';
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model,
          max_tokens: 2048,
          system: systemPrompt,
          messages: buildClaudeMessages(history, message),
        }),
      });
      if (!res.ok) {
        console.warn('Claude API (raw):', res.status, (await res.text()).slice(0, 200));
        return null;
      }
      const data = await res.json();
      text = data.content?.find(b => b.type === 'text')?.text;
    } else {
      const apiKey = await getOpenAIKey();
      if (!apiKey) return null;
      const model = (await getSetting('openai_model')) || 'gpt-4o-mini';
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            ...history.slice(-HISTORY_LIMIT).map(h => ({ role: h.role, content: h.content })),
            { role: 'user', content: message },
          ],
          response_format: { type: 'json_object' },
        }),
      });
      if (!res.ok) return null;
      const data = await res.json();
      text = data.choices[0].message.content;
    }
    if (!text) return null;
    const fenced = String(text).match(/```(?:json)?\s*([\s\S]*?)```/i);
    const candidate = fenced ? fenced[1].trim() : String(text).trim();
    return JSON.parse(candidate);
  } catch (err) {
    console.warn('Raw LLM:', err.message);
    return null;
  }
}

import {
  getAnthropicKey,
  getAnthropicModel,
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

  const [{ rows: projects }, { rows: clients }, { rows: memories }] = await Promise.all([
    pool.query(`
      SELECT p.id, p.name, p.status, p.notes, p.deadline, c.name AS client_name,
        (SELECT COUNT(*)::int FROM tasks t WHERE t.project_id = p.id AND t.status != 'done') AS tasks_open,
        (SELECT COUNT(*)::int FROM tasks t WHERE t.project_id = p.id AND t.status = 'done') AS tasks_done
      FROM projects p
      LEFT JOIN clients c ON c.id = p.client_id
      ORDER BY CASE WHEN p.status = 'active' THEN 0 ELSE 1 END, p.created_at DESC
      LIMIT 30
    `),
    pool.query('SELECT id, name, email FROM clients ORDER BY name LIMIT 25'),
    pool.query(`
      SELECT category, content, project_id FROM assistant_memories
      WHERE active = true
      ORDER BY confidence DESC, updated_at DESC
      LIMIT 25
    `).catch(() => ({ rows: [] })),
  ]);

  const lines = [];
  const active = projects.filter(p => p.status === 'active');
  const done = projects.filter(p => p.status === 'done');
  if (active.length) {
    lines.push('Projets EN COURS (cherche ici d\'abord) :');
    for (const p of active) {
      const notes = p.notes ? ` | notes: ${String(p.notes).slice(0, 100)}` : '';
      lines.push(`- #${p.id} « ${p.name} »${p.client_name ? ` — ${p.client_name}` : ''} (${p.tasks_done || 0}✓/${(p.tasks_done || 0) + (p.tasks_open || 0)})${notes}`);
    }
  }
  if (done.length) {
    lines.push('Projets TERMINÉS (anciens, toujours accessibles) :');
    for (const p of done.slice(0, 12)) {
      lines.push(`- #${p.id} « ${p.name} » [${p.status}]${p.client_name ? ` — ${p.client_name}` : ''}`);
    }
  }
  if (clients.length) {
    lines.push('Clients :');
    for (const c of clients) {
      lines.push(`- #${c.id} « ${c.name} »${c.email ? ` (${c.email})` : ''}`);
    }
  }
  if (memories.length) {
    lines.push('Mémoire atelier (faits retenus) :');
    for (const m of memories.slice(0, 15)) {
      lines.push(`- [${m.category}] ${m.content}${m.project_id ? ` (projet #${m.project_id})` : ''}`);
    }
  }
  if (pageContext?.type === 'project') {
    const allTasks = pageContext.tasks || [];
    lines.push(`Projet OUVERT maintenant : #${pageContext.id} « ${pageContext.label} »`);
    if (pageContext.client_id || pageContext.client_name) {
      lines.push(`Client du projet : #${pageContext.client_id || '?'} « ${pageContext.client_name || ''} »`);
    }
    lines.push('CONTEXTE ERP : tu gardes TOUJOURS l\'historique client / projets / mémoire ci-dessus pour répondre.');
    lines.push('HINT page : utilise ce projet pour les tâches ATELIER (finition, débitage, assemblage…).');
    lines.push('Admin / transfert / paiement / remboursement → create_task {"project_id":null,"client_id":…,"related_project_id":…} (hors checklist, contexte client/historique conservé).');
    lines.push('Si l\'utilisateur dit que ce n\'est pas lié au projet ouvert → unlink_task (ne PAS recréer ; conserver client_id / related_project_id).');
    if (pageContext.project?.notes) {
      lines.push(`Descriptif/notes : ${String(pageContext.project.notes).slice(0, 300)}`);
    }
    const hist = pageContext.clientProjects || [];
    if (hist.length) {
      lines.push('Historique projets du même client :');
      for (const p of hist.slice(0, 10)) {
        lines.push(`- #${p.id} « ${p.name} » [${p.status}]${p.deadline ? ` deadline ${p.deadline}` : ''}${p.id === pageContext.id ? ' ← ouvert' : ''}`);
      }
    }
    if (allTasks.length) {
      lines.push('Toutes les tâches (cocher / modifier avec complete_task ou update_task) :');
      for (const t of allTasks.slice(0, 20)) {
        lines.push(`- #${t.id} [${t.status}] ${t.title}`);
      }
    }
  }
  if (pageContext?.type === 'client') {
    lines.push(`Client OUVERT maintenant : #${pageContext.id} « ${pageContext.label} »`);
    lines.push('CONTEXTE ERP : utilise l\'historique projets / mémoire de ce client pour répondre.');
    const projects = pageContext.projects || [];
    if (projects.length) {
      lines.push('Historique projets de ce client :');
      for (const p of projects.slice(0, 12)) {
        lines.push(`- #${p.id} « ${p.name} » [${p.status}]${p.deadline ? ` deadline ${p.deadline}` : ''}`);
      }
    } else {
      lines.push('Aucun projet encore pour ce client.');
    }
  }
  if (pageContext?.type === 'quote' && pageContext.quote) {
    const q = pageContext.quote;
    lines.push(`DEVIS OUVERT : #${q.id} ${q.quote_number} « ${q.title || ''} » [${q.status}]`);
    lines.push(`Client : ${q.client_name || '—'} | Projet : ${q.project_name || '—'} | Total : ${Number(q.total || 0).toFixed(2)} $`);
    if (q.notes) lines.push(`Notes devis : ${String(q.notes).slice(0, 300)}`);
    const ql = Array.isArray(q.lines) ? q.lines : [];
    if (ql.length) {
      lines.push('Lignes du devis (modifiables via update_quote) :');
      ql.slice(0, 25).forEach((l, i) => {
        lines.push(`- ${i + 1}. ${l.description || '—'} | qty ${l.qty || 0} | ${Number(l.price || 0).toFixed(2)} $`);
      });
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
  const memoryBlock = await formatMemoriesForPrompt({
    projectId: pageContext?.type === 'project' ? pageContext.id : pageContext?.project_id || null,
    clientId: pageContext?.type === 'client' ? pageContext.id : pageContext?.client_id || null,
    quoteId: pageContext?.type === 'quote' ? pageContext.id : null,
  });
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

  let mailBlock = '';
  try {
    const { getGoogleTokenRow } = await import('./google-oauth.js');
    const row = await getGoogleTokenRow();
    if (row?.access_token) {
      const gmail = await import('./google-gmail.js');
      const { enrichInboxMessages } = await import('./mail-sort.js');
      const { messages: raw } = await gmail.listMessages({ label: 'INBOX', max: 8 });
      const { messages } = await enrichInboxMessages(raw || []);
      if (messages.length) {
        const lines = messages.map(m => {
          const unread = m.isUnread ? '[non lu] ' : '';
          return `- ${unread}${m.from || '?'} | ${m.subject || '(sans objet)'} [${m.mailCategory || '?'}] id=${m.id}`;
        });
        mailBlock = `\nCourriels INBOX récents (Gmail connecté — utilise list_emails / search_emails / get_email pour plus) :\n${lines.join('\n')}`;
      } else {
        mailBlock = '\nGmail connecté — boîte vide. Actions : list_emails, search_emails, get_email, list_mail_threads.';
      }
    } else {
      mailBlock = '\nGmail NON connecté — si l\'utilisateur demande des mails, indique Paramètres → Intégrations.';
    }
  } catch {
    mailBlock = '\nGmail indisponible pour le moment. Actions mail : list_emails, search_emails, get_email.';
  }

  return `Tu es Lia, l'assistant NEYA ERP (atelier meubles Neya Furniture).
IMPORTANT: ta réponse doit être UNIQUEMENT un objet JSON valide, sans markdown, sans texte avant/après.
Skills: ${JSON.stringify(skills)}
Actions: ${ACTION_TYPES.join('|')}
Format exact: {"reply":"texte court pour l'utilisateur","action":{"type":"nom_action_ou_null","params":{}}}

AUTONOMIE — tu DOIS agir seule sans demander de cliquer dans l'ERP :
1. Cherche d'abord dans le bloc Données ERP / Mémoire ci-dessous.
2. Si le projet n'y est pas, utilise search_projects ou get_project avec params {"query":"nom"} ou {"project_id":123}.
3. Pour cocher : complete_task avec {"project_name":"…","task_title":"finition"} ou {"project_id":1,"task_title":"…"}.
4. Pour modifier une tâche : update_task avec {"task_title":"…","new_title":"…"} ou {"status":"done"|"todo"}.
5. Pour le descriptif / notes du projet : update_project avec {"project_name":"…","notes":"texte"} ou {"append_notes":true,"notes":"ajout"}.
6. Pour le statut projet : update_project {"status":"done"|"active","project_id":…}.
7. Mémoire atelier : search_memory {"query":"…"}. L'utilisateur peut aussi dire « retiens que … ».
8. list_project_tasks {"project_name":"Olive"} pour lister les tâches d'un projet non ouvert.
8b. TÂCHES ADMIN / HORS CHECKLIST — si le message contient « admin », transfert, paiement, remboursement, ou « sans projet »,
    crée avec create_task {"title":"…","type":"admin","project_id":null,"client_id":<client du contexte>,"related_project_id":<projet ouvert si pertinent>}.
    project_id:null = hors checklist atelier, PAS « oublier le client ». Garde toujours l'historique client / projets pour dialoguer.
8c. CORRECTION PROJET — si l'utilisateur dit « ce n'est pas en rapport / pas lié / pas pour ce projet »,
    appelle unlink_task (retire de la checklist, conserve client_id / related_project_id). Ne recrée JAMAIS la même tâche dans le projet ouvert.
9. COURRIEL — tu as accès à Gmail. Ne dis JAMAIS que tu n'as pas accès au mail.
   - list_emails {"max":15} ou {"category":"clients"|"fournisseurs"|"a_repondre"|"projets"}
   - search_emails {"query":"from:client@… OR facture"}
   - get_email {"message_id":"…"} ou {"index":1} pour le 1er de la boîte
   - import_email_attachment {"query":"olive facturation"} — cherche le mail, lit la PJ, enregistre dépense/facture (NE PAS demander de joindre le fichier)
   - scan_mail_invoice_todos {"days":30} — scanne les dernières factures Gmail + ERP et crée des todos admin « À payer — Olive », « À recevoir — … »
   - list_mail_threads pour les fils déjà liés ERP
9a. CONTACT DEPUIS MAIL / PDF — si l'utilisateur demande un nouveau contact/client après un mail :
   - Utilise create_client avec name + email (et phone/address/city si connus).
   - Ex. {"type":"create_client","params":{"name":"Olive Richardson","email":"olive_richardson@yahoo.com","from":"Olive Richardson <olive_richardson@yahoo.com>"}}
   - Si le PDF est illisible / corrompu, crée quand même le contact depuis l'expéditeur (From) du mail — ne bloque PAS sur le PDF.
   - Prefère import_email_attachment {"query":"…"} quand la consigne combine chercher mail + analyser PJ + créer contact (le backend crée le client si demandé).
9b. FACTURES ADMIN — si l'utilisateur parle de classer / à payer / à recevoir / Olive a envoyé sa facture,
    utilise scan_mail_invoice_todos (pas seulement import). Les todos vont dans /admin (catégories a_payer / a_recevoir).
10. FICHIERS / PIÈCES JOINTES — dès qu'un fichier est joint AU CHAT, le système le LIT, CLASSE et RANGE.
   - Si l'utilisateur parle d'un mail Gmail (« facture du mail de Olive », « cherche dans les mails »), utilise import_email_attachment — PAS request_attachment.
   - Ne réponds PAS seulement « j'ai reçu le fichier ».
   - create_fabrication_plan pour un plan / brief client → étapes atelier
   - create_expense pour un reçu/facture avec montant
   - update_project {"append_notes":true,"notes":"…"} pour ranger le résumé dans le projet
   - Si l'utilisateur dit « classer / ranger / étudie / lis ce fichier », priorise ces actions.
11. DEVIS — si la page est un devis (contexte quote), tu PEUX le modifier :
   - get_quote {} pour relire le devis ouvert
   - update_quote {"add_line":"Caissons","qty":1,"price":2400}
   - update_quote {"line_match":"table","price":1800}
   - update_quote {"title":"Devis ENNS v2","notes":"…"}
   - update_quote {"status":"sent"|"draft"|"accepted"}
   - send_quote {} pour envoyer le devis ouvert
   - Utilise la mémoire devis/client. « Retiens que… » sauvegarde une préférence.

Exemples params :
- {"type":"complete_task","params":{"project_name":"Banc Olive","task_title":"finition"}}
- {"type":"create_task","params":{"title":"Admin – Transfert bancaire remboursement + paiement","type":"admin","project_id":null,"client_id":3,"related_project_id":6}}
- {"type":"unlink_task","params":{}}
- {"type":"update_project","params":{"project_id":12,"notes":"Livraison semaine prochaine"}}
- {"type":"search_projects","params":{"query":"olive"}}
- {"type":"get_project","params":{"project_id":12}}
- {"type":"list_emails","params":{"max":10}}
- {"type":"search_emails","params":{"query":"facture Home Depot"}}
- {"type":"get_email","params":{"index":1}}
- {"type":"create_client","params":{"name":"Olive Richardson","email":"olive_richardson@yahoo.com","from":"Olive Richardson <olive_richardson@yahoo.com>"}}
- {"type":"import_email_attachment","params":{"query":"iaem"}}
- {"type":"create_fabrication_plan","params":{"project_name":"Banc Olive","steps":[{"title":"Débitage","type":"debitage"},{"title":"Assemblage","type":"assemblage"},{"title":"Finition","type":"finition"}],"notes":"Infos du mail client"}}
- {"type":"update_quote","params":{"add_line":"Caissons chêne","qty":1,"price":2400}}
- {"type":"update_quote","params":{"line_match":"table","price":1800}}
- {"type":"get_quote","params":{}}

Mémoire conversation : utilise l'historique (« oui », « celui-là », « ce projet »). Ne redemande pas ce qui est déjà dit.
Ne dis JAMAIS « ouvrez le projet » si tu peux le trouver par nom. Exécute l'action.
Si l'utilisateur mentionne un fichier sans pièce jointe, demande le bouton 📎.
Pour « comment faire », renvoie vers /manual.${memoryBlock}${manualBlock}${erpBlock}${driveBlock}${mailBlock}${ctxNote}`;
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

  const model = await getAnthropicModel();
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
      const model = await getAnthropicModel();
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

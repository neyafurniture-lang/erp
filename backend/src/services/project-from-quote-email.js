import pool from '../db/pool.js';
import * as gmail from './google-gmail.js';
import { extractAllAttachments, formatExtractsForPrompt } from './attachment-extract.js';
import { createQuoteRecord } from './invoice-helpers.js';
import { linkThread, syncGmailThread } from './email-threads.js';

function inferTaskType(title = '') {
  const t = String(title).toLowerCase();
  if (/débit|debit|coupe|matériau|materiau|approv/i.test(t)) return 'debitage';
  if (/cnc|usinage|découp|decoup|perç|perc/i.test(t)) return 'usinage';
  if (/assembl|monte|montage|install|charni/i.test(t)) return 'assemblage';
  if (/finit|peinture|vernis|sable|sablage/i.test(t)) return 'finition';
  return 'admin';
}

function defaultMinutes(type) {
  return ({ debitage: 120, usinage: 180, assemblage: 240, finition: 180, admin: 45 })[type] || 60;
}

async function ensureClient(parsedClient = {}) {
  const email = String(parsedClient.email || '').trim().toLowerCase() || null;
  const name = String(parsedClient.name || '').trim() || null;
  if (email) {
    const { rows } = await pool.query(
      `SELECT id FROM clients WHERE LOWER(TRIM(email)) = $1 LIMIT 1`,
      [email]
    );
    if (rows[0]) return rows[0].id;
  }
  if (name && name.length >= 2) {
    const { rows } = await pool.query(
      `SELECT id FROM clients WHERE LOWER(name) = $1 OR LOWER(name) LIKE $2 ORDER BY LENGTH(name) ASC LIMIT 1`,
      [name.toLowerCase(), `%${name.toLowerCase()}%`]
    );
    if (rows[0]) {
      if (email) {
        await pool.query(
          `UPDATE clients SET email = COALESCE(NULLIF(TRIM(email), ''), $1),
            phone = COALESCE(NULLIF(TRIM(phone), ''), $2),
            contact = COALESCE(NULLIF(TRIM(contact), ''), $3),
            address = COALESCE(NULLIF(TRIM(address), ''), $4),
            city = COALESCE(NULLIF(TRIM(city), ''), $5)
           WHERE id = $6`,
          [
            email,
            parsedClient.phone || null,
            parsedClient.contact || null,
            parsedClient.address || null,
            parsedClient.city || null,
            rows[0].id,
          ]
        );
      }
      return rows[0].id;
    }
  }
  if (!name) throw new Error('Impossible d’identifier le client dans le devis');
  const { rows } = await pool.query(
    `INSERT INTO clients (name, contact, email, phone, address, city, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [
      name.slice(0, 200),
      parsedClient.contact || null,
      email,
      parsedClient.phone || null,
      parsedClient.address || null,
      parsedClient.city || null,
      parsedClient.notes || 'Créé via devis Gmail (assistant)',
    ]
  );
  return rows[0].id;
}

async function insertTasks(projectId, steps = []) {
  const created = [];
  let sort = 0;
  for (const s of steps.slice(0, 20)) {
    const title = String(s.title || '').trim().slice(0, 200);
    if (!title) continue;
    const type = ['debitage', 'usinage', 'assemblage', 'finition', 'admin'].includes(s.type)
      ? s.type
      : inferTaskType(title);
    const minutes = Number(s.estimated_minutes) > 0 ? Number(s.estimated_minutes) : defaultMinutes(type);
    const { rows } = await pool.query(
      `INSERT INTO tasks (project_id, title, type, status, estimated_minutes, sort_order)
       VALUES ($1,$2,$3,'todo',$4,$5) RETURNING *`,
      [projectId, title, type, minutes, sort++]
    );
    created.push(rows[0]);
  }
  return created;
}

async function analyzeDocuments({ query, messageBodies, extracts }) {
  const { callRawLLM } = await import('./ai-chat.js');
  const systemPrompt = `Tu analyses des devis PDF / mails NEYA Furniture pour créer des projets ERP.
Réponds UNIQUEMENT en JSON valide :
{
  "client": {
    "name": "The NNS",
    "contact": "Alexandra Vonin",
    "email": "alexandra@thenns.com",
    "phone": "+1 …",
    "address": "…",
    "city": "Montréal…",
    "notes": "optionnel"
  },
  "projects": [
    {
      "name": "Nom projet court",
      "deadline": "YYYY-MM-DD ou null",
      "budget_estimated": 15147,
      "notes": "résumé devis (lots, options, modalités, exclusions)",
      "quote_title": "titre devis ERP",
      "quote_status": "sent",
      "quote_notes": "source fichier + option retenue si claire",
      "lines": [
        { "description": "LOT 1 — …", "qty": 1, "price": 7409 }
      ],
      "steps": [
        { "title": "…", "type": "debitage|usinage|assemblage|finition|admin", "estimated_minutes": 120 }
      ]
    }
  ]
}
Règles :
- Un projet par devis distinct (ex. table casino ET portes = 2 projets).
- budget_estimated = total AVANT taxes si possible.
- lines : totaliser les grands postes (pas chaque clou) ; somme ≈ budget_estimated.
- 5 à 10 étapes atelier concrètes par projet.
- Si plusieurs options (A/B), privilégie l'option A / moins chère dans budget + lines, et note l'option B dans notes.
- Email client depuis le mail si présent.`;

  const userMsg = `Demande utilisateur : """${query}"""

Corps des courriels :
${messageBodies.slice(0, 8000)}

${formatExtractsForPrompt(extracts)}

Produis le JSON ERP.`;

  const parsed = await callRawLLM({ systemPrompt, message: userMsg });
  if (!parsed?.projects?.length) {
    throw new Error('Analyse IA incomplete — aucun projet détecté dans les devis');
  }
  return parsed;
}

/**
 * Cherche les derniers devis mail (+ PDF) pour un client/sujet et crée projets + devis + tâches.
 */
export async function createProjectsFromQuoteEmails({
  query,
  maxEmails = 4,
  messageId = null,
} = {}) {
  const q = String(query || '').trim();
  if (!messageId && q.length < 2) {
    throw new Error('Précisez le client ou le sujet (ex. « Alexandra », « The NNS », « Sephora »)');
  }

  let messages = [];
  if (messageId) {
    const one = await gmail.getMessage(messageId);
    messages = [one];
  } else {
    const searches = [
      `filename:pdf (devis OR quote OR soumission) (${q}) newer_than:400d`,
      `subject:(devis OR quote) (${q}) newer_than:400d`,
      `(from:me OR in:sent) devis (${q}) newer_than:400d`,
      `${q} (devis OR quote OR soumission) has:attachment newer_than:400d`,
    ];
    const seen = new Set();
    for (const s of searches) {
      try {
        const { messages: found } = await gmail.searchMessages(s, 12);
        for (const m of found || []) {
          if (m?.id && !seen.has(m.id)) {
            seen.add(m.id);
            messages.push(m);
          }
        }
      } catch { /* try next */ }
      if (messages.length >= maxEmails) break;
    }
    messages = messages.slice(0, maxEmails);
  }

  if (!messages.length) {
    throw new Error(`Aucun devis trouvé dans Gmail pour « ${q} »`);
  }

  // Charger corps + PJ des mails les plus récents avec docs
  const packs = [];
  for (const m of messages) {
    const full = m.body ? m : await gmail.getMessage(m.id);
    let saved = [];
    try {
      saved = await gmail.saveMessageAttachments(full.id, { max: 5, preferDocs: true });
    } catch { /* continue even without atts */ }
    const extracts = saved.length ? await extractAllAttachments(saved) : [];
    packs.push({ full, saved, extracts });
  }

  const withDocs = packs.filter(p => p.extracts.some(e => (e.text || '').length > 80));
  const usePacks = withDocs.length ? withDocs : packs.slice(0, 2);

  const messageBodies = usePacks.map(p => {
    const f = p.full;
    return `--- ${f.date || ''} | ${f.from} → ${f.to || ''}\nObjet: ${f.subject}\n${String(f.body || f.snippet || '').slice(0, 1800)}`;
  }).join('\n\n');

  const extracts = usePacks.flatMap(p => p.extracts);
  if (!extracts.some(e => (e.text || '').length > 40) && messageBodies.length < 80) {
    throw new Error('Devis trouvés mais PDF illisible — joignez le PDF à Lia (📎) ou précisez le message_id');
  }

  const parsed = await analyzeDocuments({ query: q || usePacks[0]?.full?.subject, messageBodies, extracts });
  const clientId = await ensureClient(parsed.client || {});

  const created = [];
  const actions = [];

  for (const proj of parsed.projects.slice(0, 4)) {
    const name = String(proj.name || 'Projet devis').trim().slice(0, 200);
    const deadline = proj.deadline && !Number.isNaN(Date.parse(proj.deadline))
      ? new Date(proj.deadline).toISOString().slice(0, 10)
      : null;
    const budget = Number(proj.budget_estimated) || 0;
    const sourceFiles = [...new Set(usePacks.flatMap(p => p.saved.map(a => a.name)))].join(', ');
    const notes = [proj.notes, sourceFiles ? `Fichiers source : ${sourceFiles}` : null]
      .filter(Boolean)
      .join('\n\n')
      .slice(0, 4000);

    const { rows: pRows } = await pool.query(
      `INSERT INTO projects (name, client_id, status, deadline, budget_estimated, notes)
       VALUES ($1,$2,'active',$3,$4,$5) RETURNING *`,
      [name, clientId, deadline, budget, notes || null]
    );
    const project = pRows[0];
    actions.push({ type: 'create_project', data: project });

    let lines = Array.isArray(proj.lines) ? proj.lines : [];
    lines = lines
      .map(l => ({
        description: String(l.description || '').trim().slice(0, 300),
        qty: Number(l.qty) || 1,
        price: Number(l.price) || 0,
      }))
      .filter(l => l.description);
    if (!lines.length && budget > 0) {
      lines = [{ description: name, qty: 1, price: budget }];
    }

    const quote = await createQuoteRecord({
      client_id: clientId,
      project_id: project.id,
      title: String(proj.quote_title || name).slice(0, 200),
      lines,
      notes: proj.quote_notes || `Import Gmail/PDF — requête « ${q} »`,
    });
    if (proj.quote_status === 'sent') {
      await pool.query(`UPDATE quotes SET status = 'sent' WHERE id = $1`, [quote.id]);
      quote.status = 'sent';
    }
    actions.push({ type: 'create_quote', data: quote });

    const tasks = await insertTasks(project.id, proj.steps || []);
    for (const t of tasks) actions.push({ type: 'create_task', data: t });

    // Lier le fil Gmail du premier mail utilisé
    try {
      const main = usePacks[0]?.full;
      if (main?.threadId) {
        const thread = await syncGmailThread(main.threadId, {
          client_id: clientId,
          project_id: project.id,
          link_source: 'assistant_quote_import',
        });
        if (thread?.id) {
          await linkThread(thread.id, {
            client_id: clientId,
            project_id: project.id,
            link_source: 'assistant_quote_import',
          });
          actions.push({ type: 'link_email_thread', data: { thread_id: thread.id, subject: thread.subject } });
        }
      }
    } catch { /* optional */ }

    created.push({
      project,
      quote,
      tasks_count: tasks.length,
    });
  }

  const { rows: clientRows } = await pool.query('SELECT * FROM clients WHERE id = $1', [clientId]);
  return { client: clientRows[0], created, actions, emails_used: usePacks.map(p => ({
    id: p.full.id,
    subject: p.full.subject,
    date: p.full.date,
    files: p.saved.map(a => a.name),
  })) };
}

export function detectCreateProjectFromQuoteEmailIntent(message = '') {
  const m = String(message || '');
  const wantsProject = /\b(projets?|page\s+projets?|créer?e?\s+projets?|cree\s+projets?|crée\s+projets?)\b/i.test(m);
  const fromQuoteish = /\b(devis|soumission|pdf|mail|courriel|gmail)\b/i.test(m);
  const importish = /\b(depuis|à partir|a partir|gr[aâ]ce|analyse|analyser|importe?r?|récup[eè]re|cherche.{0,40}devis)\b/i.test(m);
  if (wantsProject && fromQuoteish) return 'create_project_from_quote_email';
  if (importish && /\bdevis\b/i.test(m) && /\b(projet|client|alexandra|nns|the nns)\b/i.test(m)) {
    return 'create_project_from_quote_email';
  }
  if (/crée?r?\s+(une?\s+)?page\s+projets?/i.test(m) && fromQuoteish) {
    return 'create_project_from_quote_email';
  }
  // « cherche les devis … alexandra … analyse … » même sans le mot projet
  if (/\b(cherche|trouve|analyse).{0,60}\bdevis\b/i.test(m)
    && /\b(pdf|mail|courriel|alexandra|nns|client)\b/i.test(m)
    && /\b(crée|cree|créer|projet|page)\b/i.test(m)) {
    return 'create_project_from_quote_email';
  }
  return null;
}

export function extractQuoteImportQuery(message = '') {
  const m = String(message || '');
  const quoted = m.match(/[«"]([^»"]{2,80})[»"]/);
  if (quoted?.[1]) return quoted[1].trim();
  const known = m.match(/\b(the\s+nns|alexandra|sephora|l['']or[eé]al|nns)\b/i);
  if (known?.[1]) return known[1];
  const a = m.match(
    /(?:devis|mails?|courriels?|pdf).{0,40}(?:à|a|pour|de|d[''])\s+([A-Za-zÀ-ÿ][\wÀ-ÿ'’. -]{1,40}?)(?:\s+(?:analyse|analys|et|puis|crée|cree|créer|projet|page|gr[aâ]ce)|$)/i
  );
  if (a?.[1]) return a[1].trim();
  return null;
}

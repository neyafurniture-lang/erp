import pool from '../db/pool.js';
import { callJsonLlm } from './llm-json.js';
import { catalogPriceHints } from './quote-ai.js';
import { serializeQuoteDocument, emptyLine } from './quote-document.js';
import { calcDocTotals, nextQuoteNumber } from './invoice-helpers.js';
import { syncMaterialsFromQuote } from './project-materials.js';

const TASK_TYPES = ['debitage', 'usinage', 'assemblage', 'finition', 'admin'];

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function inferTaskType(title) {
  const t = String(title || '').toLowerCase();
  if (/débit|debit|coupe|sciage/.test(t)) return 'debitage';
  if (/usinage|toupie|cnc|domino/.test(t)) return 'usinage';
  if (/assembl|collage|serre/.test(t)) return 'assemblage';
  if (/finition|huile|vernis|sablage/.test(t)) return 'finition';
  return 'admin';
}

export function buildQuoteDocumentFromAi(parsed, { photos = [], additionalNotes = '' } = {}) {
  const sectionsIn = Array.isArray(parsed?.sections) && parsed.sections.length
    ? parsed.sections
    : [{ title: 'Travaux / produit', lines: parsed?.lines || [] }];

  const sections = sectionsIn.map((s, i) => {
    const lines = (Array.isArray(s.lines) ? s.lines : [])
      .map(l => ({
        description: String(l.description || '').trim(),
        qty: num(l.qty, 1) || 1,
        price: Math.max(0, num(l.price, 0)),
      }))
      .filter(l => l.description);
    return {
      title: String(s.title || (i === 0 ? 'Travaux / produit' : `Tableau ${i + 1}`)).trim(),
      lines: lines.length ? lines : [emptyLine()],
    };
  });

  return serializeQuoteDocument({
    version: 2,
    sections: sections.length ? sections : [{ title: 'Travaux / produit', lines: [emptyLine()] }],
    photos: photos.map(p => ({ url: p.url, caption: p.caption || '' })),
    additional_notes: additionalNotes || parsed?.additional_notes || '',
    options: { show_signature: true, show_payment: true, show_acceptance_date: true },
  });
}

export function normalizeTasksFromAi(parsed) {
  const raw = Array.isArray(parsed?.tasks) ? parsed.tasks : [];
  return raw
    .map((t) => {
      const title = String(t.title || t.description || '').trim().slice(0, 200);
      if (title.length < 2) return null;
      const type = TASK_TYPES.includes(t.type) ? t.type : inferTaskType(title);
      const minutes = num(t.estimated_minutes, 60);
      return { title, type, estimated_minutes: minutes > 0 ? minutes : 60 };
    })
    .filter(Boolean)
    .slice(0, 16);
}

async function insertProjectTask(projectId, clientId, step, sortOrder) {
  const { rows } = await pool.query(
    `INSERT INTO tasks (project_id, client_id, related_project_id, title, description, type, status, estimated_minutes, sort_order)
     VALUES ($1,$2,NULL,$3,$4,$5,'todo',$6,$7) RETURNING *`,
    [projectId, clientId, step.title, null, step.type, step.estimated_minutes, sortOrder]
  );
  return rows[0];
}

export async function createQuoteFromBrief({
  clientId,
  title,
  notes,
  wood,
  dimensions,
  finish,
  deadline,
  extra,
  photos = [],
  createProject = true,
  photoExtracts = [],
} = {}) {
  const clientIdNum = Number(clientId);
  if (!Number.isFinite(clientIdNum)) throw new Error('Client requis');
  const { rows: clients } = await pool.query('SELECT id, name FROM clients WHERE id = $1', [clientIdNum]);
  if (!clients[0]) throw new Error('Client introuvable');

  const briefTitle = String(title || '').trim() || `Projet — ${clients[0].name}`;
  const briefNotes = [
    String(notes || '').trim(),
    wood ? `Matériaux / bois : ${wood}` : '',
    dimensions ? `Dimensions : ${dimensions}` : '',
    finish ? `Finition : ${finish}` : '',
    deadline ? `Échéance souhaitée : ${deadline}` : '',
    extra ? `Autres infos : ${extra}` : '',
  ].filter(Boolean).join('\n');

  const catalog = catalogPriceHints();
  const vision = (photoExtracts || [])
    .map(e => `${e.name || 'photo'}: ${(e.text || e.note || '').slice(0, 800)}`)
    .filter(Boolean)
    .join('\n---\n');

  let parsed = {};
  try {
    parsed = await callJsonLlm(
      `Tu es l'estimateur NEYA Furniture (atelier Québec, meubles sur mesure).
À partir du brief + photos, produis un devis HT (lignes avec prix réalistes) ET un plan d'atelier (tâches).
Les prix sont HORS TAXES. Un projet sur mesure (table, cuisine, bibliothèque) n'est pas au tarif catalogue planches/bancs.
Découpe en tableaux si utile (ex. fabrication / quincaillerie / livraison).

Brief:
${JSON.stringify({
        client: clients[0].name,
        title: briefTitle,
        notes: briefNotes,
        photos: photos.map(p => p.caption || p.name || p.url),
      })}

Catalogue (indices petit mobilier):
${JSON.stringify(catalog)}

Lecture photos:
${vision || '(aucune extraction)'}

JSON attendu:
{
  "title": "titre devis",
  "notes": "portée des travaux, 2-8 phrases",
  "additional_notes": "exclusions / hypothèses courtes",
  "sections": [
    { "title": "Fabrication", "lines": [ { "description": "…", "qty": 1, "price": 2400 } ] }
  ],
  "tasks": [
    { "title": "Débitage plateaux", "type": "debitage", "estimated_minutes": 120 }
  ]
}`,
      {
        system: 'Estimateur NEYA. Réponds UNIQUEMENT en JSON valide.',
        maxTokens: 4096,
      }
    ) || {};
  } catch (err) {
    parsed = {
      title: briefTitle,
      notes: briefNotes || 'Devis généré — à compléter.',
      sections: [{ title: 'Travaux / produit', lines: [{ description: briefTitle, qty: 1, price: 0 }] }],
      tasks: [
        { title: 'Débitage', type: 'debitage' },
        { title: 'Assemblage', type: 'assemblage' },
        { title: 'Finition', type: 'finition' },
      ],
      _fallback: err.message,
    };
  }

  const quoteTitle = String(parsed.title || briefTitle).trim().slice(0, 200);
  const quoteNotes = String(parsed.notes || briefNotes || '').trim();
  const extraNotes = String(parsed.additional_notes || '').trim();
  const document = buildQuoteDocumentFromAi(parsed, { photos, additionalNotes: extraNotes });
  const { subtotal, total, tax_rate } = calcDocTotals(document);
  const quoteNumber = await nextQuoteNumber();

  let project = null;
  const tasks = [];
  if (createProject) {
    const deadlineVal = deadline ? String(deadline).slice(0, 10) : null;
    const { rows: projRows } = await pool.query(
      `INSERT INTO projects (name, client_id, status, notes, deadline, budget_estimated)
       VALUES ($1,$2,'active',$3,$4,$5) RETURNING *`,
      [
        quoteTitle.slice(0, 200),
        clientIdNum,
        briefNotes.slice(0, 4000) || null,
        deadlineVal || null,
        subtotal || 0,
      ]
    );
    project = projRows[0];
    const steps = normalizeTasksFromAi(parsed);
    const fallback = steps.length ? steps : [
      { title: 'Débitage', type: 'debitage', estimated_minutes: 90 },
      { title: 'Assemblage', type: 'assemblage', estimated_minutes: 120 },
      { title: 'Finition', type: 'finition', estimated_minutes: 90 },
    ];
    for (let i = 0; i < fallback.length; i++) {
      tasks.push(await insertProjectTask(project.id, clientIdNum, fallback[i], i));
    }
  }

  const { rows } = await pool.query(
    `INSERT INTO quotes (
       project_id, client_id, quote_number, status, lines, subtotal, tax_rate, total,
       notes, title, additional_notes
     )
     VALUES ($1,$2,$3,'draft',$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [
      project?.id || null,
      clientIdNum,
      quoteNumber,
      JSON.stringify(document),
      subtotal,
      tax_rate || 14.975,
      total,
      quoteNotes,
      quoteTitle,
      extraNotes || null,
    ]
  );
  const quote = rows[0];
  if (project?.id) await syncMaterialsFromQuote(project.id).catch(() => {});

  try {
    await pool.query(
      'INSERT INTO assistant_messages (role, content, attachments) VALUES ($1,$2,$3)',
      [
        'user',
        `Brief devis « ${quoteTitle} » (${clients[0].name})\n${briefNotes}`.slice(0, 4000),
        JSON.stringify(photos.map(p => ({ name: p.name || 'photo', url: p.url, type: 'image' }))),
      ]
    );
    await pool.query(
      'INSERT INTO assistant_messages (role, content, actions_taken, attachments) VALUES ($1,$2,$3,$4)',
      [
        'assistant',
        `Devis ${quote.quote_number} créé${project ? ` + projet « ${project.name} » (${tasks.length} tâches atelier)` : ''}.\n`
          + 'Dis-moi ce qui ne va pas : prix, lignes, descriptions, photos. J’ajuste le devis ouvert.',
        JSON.stringify([{ type: 'create_quote', data: { id: quote.id, quote_number: quote.quote_number } }]),
        JSON.stringify(photos),
      ]
    );
  } catch { /* historique optionnel */ }

  return {
    quote,
    project,
    tasks,
    fallback: Boolean(parsed._fallback),
    warning: parsed._fallback || null,
  };
}

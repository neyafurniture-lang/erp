import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getOpenAIKey, getSetting, isAssistantAiEnabled } from './settings.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS_ROOT = path.join(__dirname, '../../uploads');

export function attachmentLocalPath(att) {
  if (!att?.url) return null;
  const rel = String(att.url).replace(/^\/uploads\//, '').replace(/^uploads\//, '');
  const full = path.join(UPLOADS_ROOT, rel);
  return fs.existsSync(full) ? full : null;
}

function extractPdfStrings(buf) {
  const raw = buf.toString('latin1');
  const chunks = [];
  const re = /\((?:\\.|[^\\)]){2,}\)/g;
  let m;
  while ((m = re.exec(raw)) !== null) {
    let s = m[0].slice(1, -1)
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '')
      .replace(/\\t/g, ' ')
      .replace(/\\\(/g, '(')
      .replace(/\\\)/g, ')')
      .replace(/\\\\/g, '\\');
    if (/[A-Za-zÀ-ÿ]{3,}/.test(s)) chunks.push(s);
  }
  // Streams with Tj / TJ operators often have readable fragments
  const tj = raw.match(/BT[\s\S]{0,8000}?ET/g) || [];
  for (const block of tj.slice(0, 40)) {
    const parts = block.match(/\((?:\\.|[^\\)])+\)/g) || [];
    for (const p of parts) {
      const s = p.slice(1, -1).replace(/\\n/g, '\n').replace(/\\\(/g, '(').replace(/\\\)/g, ')');
      if (/[A-Za-zÀ-ÿ0-9]{2,}/.test(s)) chunks.push(s);
    }
  }
  return [...new Set(chunks)].join('\n').slice(0, 12000);
}

async function extractImageViaVision(filePath, mimeType) {
  if (!(await isAssistantAiEnabled())) return null;
  const apiKey = await getOpenAIKey();
  if (!apiKey) return null;
  const buf = fs.readFileSync(filePath);
  const dataUrl = `data:${mimeType || 'image/jpeg'};base64,${buf.toString('base64')}`;
  const model = (await getSetting('openai_model')) || 'gpt-4o-mini';
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      temperature: 0.1,
      max_tokens: 2000,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'text',
            text: `Extrais tout le texte utile de ce document (courriel, plan, devis, notes atelier).
Réponds en texte brut, français, structuré. Inclus destinataire, sujet, dates, dimensions, étapes, matériaux si visibles.`,
          },
          { type: 'image_url', image_url: { url: dataUrl } },
        ],
      }],
    }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.choices?.[0]?.message?.content?.trim() || null;
}

export async function extractAttachmentText(att) {
  const filePath = attachmentLocalPath(att);
  if (!filePath) return { name: att?.name, text: '', error: 'fichier introuvable' };

  const name = att.name || path.basename(filePath);
  const type = (att.type || '').toLowerCase();
  const ext = path.extname(name).toLowerCase();

  try {
    if (type.startsWith('text/') || ['.txt', '.csv', '.md', '.json', '.eml', '.html', '.htm'].includes(ext)) {
      const text = fs.readFileSync(filePath, 'utf8').slice(0, 15000);
      return { name, text, source: 'text' };
    }

    if (type.includes('pdf') || ext === '.pdf') {
      const buf = fs.readFileSync(filePath);
      const text = extractPdfStrings(buf);
      if (text.length > 80) return { name, text, source: 'pdf' };
      return { name, text: text || '', source: 'pdf', note: 'PDF peu extractible — décrivez le contenu ou joignez une capture.' };
    }

    if (type.startsWith('image/') || ['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(ext)) {
      const text = await extractImageViaVision(filePath, type || 'image/jpeg');
      return { name, text: text || '', source: 'vision', note: text ? null : 'OCR image indisponible (clé OpenAI?).' };
    }

    if (['.doc', '.docx'].includes(ext)) {
      const buf = fs.readFileSync(filePath);
      // DOCX = zip XML — extract readable UTF-8 runs
      const asLatin = buf.toString('utf8');
      const xmlBits = asLatin.match(/<w:t[^>]*>([^<]+)<\/w:t>/g) || [];
      if (xmlBits.length) {
        const text = xmlBits.map(t => t.replace(/<[^>]+>/g, '')).join(' ').slice(0, 12000);
        return { name, text, source: 'docx' };
      }
      return { name, text: '', source: 'docx', note: 'Word non lisible ici — exportez en PDF ou TXT.' };
    }

    return { name, text: '', note: `Type non supporté pour lecture auto (${type || ext})` };
  } catch (err) {
    return { name, text: '', error: err.message };
  }
}

export async function extractAllAttachments(attachments = []) {
  const results = [];
  for (const att of attachments) {
    results.push(await extractAttachmentText(att));
  }
  return results;
}

export function formatExtractsForPrompt(extracts = []) {
  if (!extracts.length) return '';
  const blocks = extracts.map((e, i) => {
    const head = `--- Fichier ${i + 1}: ${e.name}${e.source ? ` (${e.source})` : ''} ---`;
    const body = e.text?.trim()
      || e.note
      || e.error
      || '(contenu vide)';
    return `${head}\n${body.slice(0, 6000)}`;
  });
  return `\nContenu des pièces jointes (à utiliser pour lier / planifier) :\n${blocks.join('\n\n')}`;
}

/**
 * À partir du texte extrait, classe le document et propose un rangement ERP.
 * Fallback heuristique si pas de clé IA.
 */
export async function classifyAndStudyAttachments({ message = '', extracts = [], projectHint = null } = {}) {
  const joined = extracts.map(e => e.text || '').join('\n').trim();
  const names = extracts.map(e => e.name).filter(Boolean);

  const heuristic = heuristicClassify({ message, extracts, projectHint });
  if (joined.length < 30 && !names.length) {
    return heuristic;
  }

  try {
    const { callRawLLM } = await import('./ai-chat.js');
    const fileBlock = formatExtractsForPrompt(extracts);
    const systemPrompt = `Tu es l'assistant documentaire NEYA Furniture (atelier meubles, Québec).
Lis le(s) fichier(s) et classe-les pour l'ERP.

Réponds UNIQUEMENT en JSON :
{
  "doc_type": "receipt|supplier_invoice|client_plan|quote|contract|photo_atelier|email|other",
  "label_fr": "étiquette courte FR (ex. Facture Rona, Plan banc olive)",
  "summary": "résumé utile 2-4 phrases",
  "key_facts": ["fait 1", "fait 2"],
  "suggested_project_query": "mots pour retrouver un projet ERP ou null",
  "suggested_actions": ["fabrication_plan"|"expense"|"project_notes"|"drive"|"none"],
  "confidence": 0.0,
  "amount": null,
  "vendor": null,
  "client_name": null
}

Règles :
- receipt = ticket de caisse / petit reçu
- supplier_invoice = facture fournisseur
- client_plan = plan, cote, brief client, dimensions
- quote = devis
- photo_atelier = photo chantier/atelier sans doc texte
- suggested_actions : 1 à 3 actions pertinentes
- amount en nombre CAD si visible, sinon null
- summary en français, concret (pas de blabla)`;

    const userMsg = `Message utilisateur : """${message || '(fichier seul)'}"""
Projet page ouverte : ${projectHint || 'aucun'}
Noms fichiers : ${names.join(', ') || '—'}
${fileBlock}

Classe et étudie ce document.`;

    const ai = await callRawLLM({ systemPrompt, message: userMsg });
    if (!ai || typeof ai !== 'object') return heuristic;

    const allowedTypes = new Set([
      'receipt', 'supplier_invoice', 'client_plan', 'quote', 'contract', 'photo_atelier', 'email', 'other',
    ]);
    const allowedActions = new Set(['fabrication_plan', 'expense', 'project_notes', 'drive', 'none']);
    const docType = allowedTypes.has(ai.doc_type) ? ai.doc_type : heuristic.doc_type;
    let actions = Array.isArray(ai.suggested_actions)
      ? ai.suggested_actions.filter(a => allowedActions.has(a))
      : heuristic.suggested_actions;
    if (!actions.length) actions = ['none'];

    return {
      doc_type: docType,
      label_fr: String(ai.label_fr || heuristic.label_fr || 'Document').slice(0, 120),
      summary: String(ai.summary || heuristic.summary || '').slice(0, 1200),
      key_facts: Array.isArray(ai.key_facts)
        ? ai.key_facts.map(f => String(f).slice(0, 200)).filter(Boolean).slice(0, 8)
        : heuristic.key_facts,
      suggested_project_query: ai.suggested_project_query
        ? String(ai.suggested_project_query).slice(0, 120)
        : heuristic.suggested_project_query,
      suggested_actions: actions,
      confidence: Number(ai.confidence) > 0 ? Math.min(1, Number(ai.confidence)) : heuristic.confidence,
      amount: ai.amount != null && Number(ai.amount) > 0 ? Number(ai.amount) : heuristic.amount,
      vendor: ai.vendor ? String(ai.vendor).slice(0, 120) : heuristic.vendor,
      client_name: ai.client_name ? String(ai.client_name).slice(0, 120) : heuristic.client_name,
      source: 'ai',
    };
  } catch (err) {
    console.warn('classifyAndStudyAttachments:', err.message);
    return heuristic;
  }
}

function heuristicClassify({ message = '', extracts = [], projectHint = null }) {
  const blob = `${message}\n${extracts.map(e => `${e.name || ''}\n${e.text || ''}`).join('\n')}`.toLowerCase();
  const names = extracts.map(e => e.name).filter(Boolean);
  const excerpt = extracts.map(e => (e.text || '').trim()).join('\n').slice(0, 500);

  let doc_type = 'other';
  let suggested_actions = ['none'];
  let label_fr = names[0] || 'Document';
  let amount = null;
  let vendor = null;

  const amountMatch = blob.match(/(?:\$|cad|total)[^\d]{0,8}(\d+[.,]\d{2})|(\d+[.,]\d{2})\s*(?:\$|cad)/i)
    || message.match(/(\d+[.,]\d{2}|\d+)\s*\$/);
  if (amountMatch) {
    amount = Number(String(amountMatch[1] || amountMatch[2]).replace(',', '.'));
  }

  if (/re[cç]u|ticket|caisse|receipt|pos\b/.test(blob)) {
    doc_type = 'receipt';
    suggested_actions = ['expense'];
    label_fr = 'Ticket / reçu';
  } else if (/facture|invoice|tps|tvq|gst|qst|fournisseur/.test(blob)) {
    doc_type = 'supplier_invoice';
    suggested_actions = ['expense', 'project_notes'];
    label_fr = 'Facture fournisseur';
  } else if (/devis|quote|soumission/.test(blob)) {
    doc_type = 'quote';
    suggested_actions = ['project_notes'];
    label_fr = 'Devis';
  } else if (/plan|cote|dimension|mm\b|pouce|"|banc|meuble|assemblage|d[eé]bitage|client/.test(blob)
    || /\.(dwg|dxf|pdf)$/i.test(names.join(' '))) {
    doc_type = 'client_plan';
    suggested_actions = ['fabrication_plan', 'project_notes'];
    label_fr = 'Plan / brief client';
  } else if (/contrat|agreement|entente/.test(blob)) {
    doc_type = 'contract';
    suggested_actions = ['project_notes'];
    label_fr = 'Contrat';
  } else if (extracts.some(e => e.source === 'vision') && excerpt.length < 40) {
    doc_type = 'photo_atelier';
    suggested_actions = ['project_notes'];
    label_fr = 'Photo';
  }

  const vendorMatch = blob.match(/\b((?:home\s*depot|rona|canac|amazon|ups|fedex|canadian\s*tire|bmr)[\wÀ-ÿ&' -]*)/i);
  if (vendorMatch && (doc_type === 'receipt' || doc_type === 'supplier_invoice')) {
    vendor = vendorMatch[0].slice(0, 80);
  }

  const summary = excerpt
    ? `Lu automatiquement (${doc_type}). Extrait : ${excerpt.slice(0, 280)}${excerpt.length > 280 ? '…' : ''}`
    : `Fichier reçu (${names.join(', ') || 'sans nom'}) — peu de texte extractible.`;

  const key_facts = [];
  if (amount) key_facts.push(`Montant ≈ ${amount} $`);
  if (vendor) key_facts.push(`Fournisseur : ${vendor}`);
  if (projectHint) key_facts.push(`Contexte page : ${projectHint}`);

  return {
    doc_type,
    label_fr,
    summary,
    key_facts,
    suggested_project_query: projectHint || null,
    suggested_actions,
    confidence: excerpt.length > 80 ? 0.55 : 0.35,
    amount,
    vendor,
    client_name: null,
    source: 'heuristic',
  };
}

export function formatStudyReply(study, { fileNames = [], extras = '' } = {}) {
  if (!study) return 'Fichier reçu.';
  const facts = (study.key_facts || []).map(f => `• ${f}`).join('\n');
  const actionsHint = (study.suggested_actions || [])
    .filter(a => a !== 'none')
    .map(a => ({
      fabrication_plan: 'plan de fabrication',
      expense: 'dépense / reçu',
      project_notes: 'notes projet',
      drive: 'Drive',
    }[a] || a))
    .join(', ');

  let reply = `📎 ${study.label_fr || 'Document'} (${study.doc_type})`
    + (fileNames.length ? `\nFichier(s) : ${fileNames.join(', ')}` : '')
    + `\n\n${study.summary || ''}`;
  if (facts) reply += `\n\nPoints clés :\n${facts}`;
  if (actionsHint) reply += `\n\nRangé / proposé : ${actionsHint}.`;
  if (extras) reply += `\n\n${extras}`;
  return reply.trim();
}

/**
 * À partir d'un texte (mail, PDF, notes), produit un plan d'étapes atelier.
 */
export async function proposeFabricationPlanFromText({ message, extracts, projectHint }) {
  const { callRawLLM } = await import('./ai-chat.js');
  const fileBlock = formatExtractsForPrompt(extracts);
  const systemPrompt = `Tu es le planificateur atelier NEYA (meubles).
À partir du message utilisateur et des fichiers, produis un PLAN DE FABRICATION concret.

Réponds UNIQUEMENT en JSON :
{
  "project_name": "nom projet ou null",
  "project_query": "mots pour retrouver le projet existant",
  "summary": "résumé 1-2 phrases du besoin",
  "notes": "notes à ajouter au projet (infos du mail/fichier)",
  "steps": [
    { "title": "Débitage panneaux", "type": "debitage|usinage|assemblage|finition|admin", "estimated_minutes": 90 }
  ],
  "link_email": true
}
Règles :
- 4 à 12 étapes atelier réalistes (pas trop vagues)
- type parmi debitage, usinage, assemblage, finition, admin
- Si un projet est mentionné (ex. banc olive), mets-le dans project_query
- notes = infos utiles du fichier (client, dimensions, délais)`;

  const userMsg = `Message : """${message}"""
Projet contexte page : ${projectHint || 'aucun'}
${fileBlock}

Produis le plan JSON.`;

  const plan = await callRawLLM({ systemPrompt, message: userMsg });
  if (!plan?.steps?.length) return null;

  const steps = plan.steps
    .map(s => ({
      title: String(s.title || s.description || '').trim().slice(0, 200),
      type: ['debitage', 'usinage', 'assemblage', 'finition', 'admin'].includes(s.type) ? s.type : 'admin',
      estimated_minutes: Number(s.estimated_minutes) > 0 ? Number(s.estimated_minutes) : 60,
    }))
    .filter(s => s.title.length > 1);

  if (!steps.length) return null;
  return {
    project_name: plan.project_name || null,
    project_query: plan.project_query || plan.project_name || null,
    summary: plan.summary || '',
    notes: plan.notes || '',
    steps,
    link_email: plan.link_email !== false,
  };
}

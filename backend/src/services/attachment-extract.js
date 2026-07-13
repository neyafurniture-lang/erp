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

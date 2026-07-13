import { ACTION_TYPES } from './skill-actions.js';
import { callRawLLM, getActiveAiProvider } from './ai-chat.js';

export async function buildOperationPlan(rawTranscript, pageContext = null) {
  const raw = String(rawTranscript || '').trim();
  const fallback = {
    transcript: raw,
    summary: 'Exécution directe de la demande',
    steps: [
      {
        id: 1,
        title: 'Traiter la demande',
        description: raw,
        action_type: null,
        params: {},
      },
    ],
    needs_confirmation: true,
  };

  const provider = await getActiveAiProvider();
  if (!provider || !raw) return fallback;

  const ctxNote = pageContext
    ? `\nContexte page : ${JSON.stringify({
        type: pageContext.type,
        id: pageContext.id,
        label: pageContext.label,
      })}`
    : '';

  const systemPrompt = `Tu es le planificateur d'opérations de NEYA ERP (atelier meubles).
L'utilisateur a dicté une demande vocale (transcription parfois imparfaite).

Mission :
1. Clarifier la transcription en français
2. Construire un PLAN d'opérations AVANT exécution

Actions possibles : ${ACTION_TYPES.join('|')}

Réponds UNIQUEMENT en JSON :
{
  "transcript": "demande clarifiée",
  "summary": "résumé 1 phrase",
  "steps": [
    { "id": 1, "title": "...", "description": "...", "action_type": "action_ou_null", "params": {} }
  ],
  "needs_confirmation": true
}
${ctxNote}`;

  const plan = await callRawLLM({
    systemPrompt,
    message: `Transcription brute : """${raw}"""\n\nProduis le plan JSON.`,
  });

  if (!plan?.steps) {
    return {
      ...fallback,
      transcript: plan?.transcript || raw,
      summary: plan?.summary || fallback.summary,
    };
  }

  const steps = plan.steps.map((s, i) => ({
    id: s.id || i + 1,
    title: s.title || `Étape ${i + 1}`,
    description: s.description || '',
    action_type: ACTION_TYPES.includes(s.action_type) ? s.action_type : null,
    params: s.params && typeof s.params === 'object' ? s.params : {},
  }));

  return {
    transcript: plan.transcript || raw,
    summary: plan.summary || `${steps.length} étape(s)`,
    steps: steps.length ? steps : fallback.steps,
    needs_confirmation: plan.needs_confirmation !== false,
  };
}

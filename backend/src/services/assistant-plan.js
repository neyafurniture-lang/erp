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
        client_id: pageContext.client_id || null,
      })}`
    : '';

  const systemPrompt = `Tu es le planificateur d'opérations de NEYA ERP (atelier meubles).
L'utilisateur a dicté OU collé une demande (texte parfois imparfait).

Mission :
1. Clarifier le texte en français
2. Extraire des ACTIONS ATOMIQUES (verbe + objet + qui/quand) — JAMAIS coller la phrase entière comme titre
3. Choisir la DESTINATION de chaque action AVANT de créer
4. Construire un PLAN — une étape = une action ERP

Actions possibles : ${ACTION_TYPES.join('|')}

DESTINATIONS (obligatoire de choisir) :
- CALENDRIER (jour/heure, atelier, « mardi », « demain », « planifier »)
  → create_task avec params { title, type, project_name?, day:"mardi"|date, start_hour?:9, calendar:true, project_id:null si hors projet }
  → ou create_task puis schedule_task { task_title, day, start_hour }
- TODO ADMIN (/admin — paiement, à payer, à recevoir, transfert, facture, gestion)
  → create_admin_task { title, category:"a_payer"|"a_recevoir"|"facturation"|"gestion"|"marche"|"site_web"|"marketing", notes? }
- TODO DASHBOARD (tableau de bord, « todo live », « à faire »)
  → create_dashboard_todo { title }
- CHECKLIST PROJET (finition/débitage/assemblage sur un projet nommé ou ouvert)
  → create_task { title, type:"finition"|"debitage"|"assemblage"|"usinage", project_name }
- CLIENT / DEVIS / PROJET
  → create_client, create_quote, create_project (séparés)

Règles STRICTES :
- Titre = action courte impérative (« Appeler James », « Débitage cadres iCloud », « À payer — facture Olive ») — max ~80 caractères
- Une demande avec PLUSIEURS intentions = PLUSIEURS steps
- NE JAMAIS utiliser plan_day pour découper une prose narrative en créneaux de 30 minutes
- plan_day UNIQUEMENT pour une vraie liste atelier courte du type « Demain finition X, mail Y, débitage Z »
- « Créer des tâches pour mardi, mercredi, jeudi » = plusieurs create_task (un par jour/sujet) avec day=…, PAS un seul plan_day
- « Nouveau client James » + « nouveau devis » = create_client puis create_quote
- Ignore le texte flou sans action (« à vérifier », « semaine prochaine » seul) — note-le dans summary
- Si destination ambiguë mais « admin/paiement » → create_admin_task ; si « calendrier/jour » → create_task+calendar ; si atelier projet → create_task projet

Réponds UNIQUEMENT en JSON :
{
  "transcript": "demande clarifiée",
  "summary": "résumé 1 phrase",
  "steps": [
    { "id": 1, "title": "Titre court action", "description": "détail", "action_type": "action_ou_null", "params": {} }
  ],
  "needs_confirmation": true
}
${ctxNote}`;

  const plan = await callRawLLM({
    systemPrompt,
    message: `Texte utilisateur : """${raw}"""\n\nProduis le plan JSON (actions atomiques + destinations).`,
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

  // Propager un titre court dans params.title si manquant (évite dump du transcript)
  for (const step of steps) {
    if (!step.action_type) continue;
    if (['create_task', 'create_admin_task', 'create_dashboard_todo'].includes(step.action_type)) {
      if (!step.params.title && step.title) step.params.title = step.title;
      if (step.action_type === 'create_task' && step.params.calendar == null) {
        const blob = `${step.title} ${step.description} ${JSON.stringify(step.params)}`;
        if (/calendrier|mardi|mercredi|jeudi|vendredi|lundi|demain|planif/i.test(blob)) {
          step.params.calendar = true;
        }
      }
    }
  }

  return {
    transcript: plan.transcript || raw,
    summary: plan.summary || `${steps.length} étape(s)`,
    steps: steps.length ? steps : fallback.steps,
    needs_confirmation: plan.needs_confirmation !== false,
  };
}

/**
 * Exécute les steps d'un plan d'opérations (après confirmation utilisateur).
 * Enchaîne client_id / project_id créés vers les étapes suivantes.
 */
export async function executeOperationPlan(plan, pageContext = null) {
  const { executeProtocolAction } = await import('./assistant-protocol.js');
  const steps = (plan?.steps || []).filter(s => s?.action_type && ACTION_TYPES.includes(s.action_type));

  if (!steps.length) {
    return {
      reply: 'Aucune action ERP dans le plan. Reformulez (ex. « créer client James » puis « créer devis ») ou renvoyez via le chat.',
      actions: [],
    };
  }

  const allActions = [];
  const replies = [];
  let ctx = pageContext ? { ...pageContext } : null;
  const carried = {};

  for (const step of steps) {
    const params = { ...carried, ...(step.params || {}) };
    if (carried.client_id && !params.client_id) params.client_id = carried.client_id;
    if (carried.project_id && !params.project_id) params.project_id = carried.project_id;
    if (!params.title && step.title && ['create_task', 'create_admin_task', 'create_dashboard_todo'].includes(step.action_type)) {
      params.title = step.title;
    }

    let stepCtx = ctx;
    if (params.client_id && stepCtx?.type !== 'client') {
      stepCtx = {
        type: 'client',
        id: params.client_id,
        label: params.client_name || carried.client_name || 'Client',
      };
    } else if (params.project_id && stepCtx?.type !== 'project') {
      stepCtx = {
        type: 'project',
        id: params.project_id,
        label: params.project_name || carried.project_name || 'Projet',
        client_id: params.client_id || carried.client_id || null,
      };
    }

    const message = step.description || step.title || plan.transcript || '';
    const result = await executeProtocolAction({
      type: step.action_type,
      params,
      message,
      pageContext: stepCtx,
    });

    if (result.actions?.length) allActions.push(...result.actions);
    if (result.reply) {
      const prefix = step.id != null ? `${step.id}. ` : '';
      replies.push(`${prefix}${result.reply}`);
    }

    for (const a of result.actions || []) {
      if (a.type === 'create_client' && a.data?.id) {
        carried.client_id = a.data.id;
        carried.client_name = a.data.name;
        ctx = { type: 'client', id: a.data.id, label: a.data.name };
      }
      if (a.type === 'create_project' && a.data?.id) {
        carried.project_id = a.data.id;
        carried.project_name = a.data.name;
        ctx = {
          type: 'project',
          id: a.data.id,
          label: a.data.name,
          client_id: a.data.client_id || carried.client_id || null,
        };
      }
      if ((a.type === 'create_task' || a.type === 'plan_day' || a.type === 'schedule_task') && a.data?.project_id) {
        carried.project_id = a.data.project_id;
      }
      if (a.type === 'create_task' && a.data?.id) {
        carried.last_task_id = a.data.id;
        carried.last_task_title = a.data.title;
      }
    }
  }

  return {
    reply: `${plan.summary || 'Plan exécuté'}\n\n${replies.join('\n')}`,
    actions: allActions,
  };
}

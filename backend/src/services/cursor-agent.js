import fs from 'fs';
import path from 'path';
import { getSetting, setSetting } from './settings.js';

const runs = new Map();
let seq = 1;
let jsonlStore = null;

export const ROADMAP_ACTIONS = [
  {
    id: 'drive-ai-sort',
    label: 'IA + tri Google Drive',
    prompt:
      'Dans le repo NEYA ERP, implémente le module IA de tri Google Drive : session guidée pour décrire photos/3D/plans, tags, dossier cible, liaison projet, renommage NEYA, déplacement Drive avec confirmation. Suit le style du projet (Express backend + Next.js frontend). Commence par un plan court puis les fichiers concrets.',
  },
  {
    id: 'social-posts',
    label: 'Posts réseaux sociaux',
    prompt:
      'Dans le repo NEYA ERP, ajoute un module Posts réseaux (calendrier éditorial FB/IG, brouillons, planification, statut publié). Backend Express + UI Next.js, cohérent avec AdminTasks / roadmap existante.',
  },
  {
    id: 'dev-space',
    label: 'Espace Dev + tâches dev',
    prompt:
      'Dans le repo NEYA ERP, crée un espace Développement : liste de tâches/bugs/features ERP (CRUD), priorités, statut, puis structure prête pour IDE/Git intégré. Frontend Next.js + API Express.',
  },
  {
    id: 'viewer-3d',
    label: 'Visualiseur 3D',
    prompt:
      'Dans le repo NEYA ERP, ajoute un visualiseur 3D (GLB depuis Google Drive) dans le workspace projet. Preview basique plutôt qu\'un CAD complet. Next.js + API Drive existante.',
  },
  {
    id: 'https-domain',
    label: 'HTTPS production',
    prompt:
      'Finalise la config HTTPS production NEYA ERP (Caddy + erp.neyafurniture.ca + .env). Vérifie deploy/enable-https.sh et documente les étapes DNS restantes clairement.',
  },
  {
    id: 'agents-specialized',
    label: 'Agents spécialisés',
    prompt:
      'Dans NEYA ERP, esquisse l\'architecture des agents spécialisés (compta, fab, marketing, commercial) branchés sur les skills/actions existantes, avec permissions et confirmations.',
  },
];

export async function getCursorConfig() {
  const apiKey = (await getSetting('cursor_api_key')) || process.env.CURSOR_API_KEY || '';
  const runtime = (await getSetting('cursor_runtime')) || process.env.CURSOR_RUNTIME || 'local';
  const repoUrl = (await getSetting('cursor_repo_url')) || process.env.CURSOR_REPO_URL || '';
  const cwd = (await getSetting('cursor_cwd')) || process.env.CURSOR_AGENT_CWD || process.cwd().replace(/[\\/]backend$/, '') || '/opt/neya-erp';
  const model = (await getSetting('cursor_model')) || 'composer-2.5';
  return {
    configured: Boolean(apiKey && String(apiKey).trim()),
    runtime: runtime === 'cloud' ? 'cloud' : 'local',
    repo_url: repoUrl,
    cwd,
    model,
    api_key_preview: apiKey ? `••••${String(apiKey).slice(-4)}` : '',
  };
}

export async function saveCursorConfig(patch = {}) {
  if (patch.cursor_api_key !== undefined && patch.cursor_api_key && !String(patch.cursor_api_key).startsWith('••••')) {
    await setSetting('cursor_api_key', String(patch.cursor_api_key).trim());
  }
  if (patch.cursor_runtime !== undefined) await setSetting('cursor_runtime', patch.cursor_runtime === 'cloud' ? 'cloud' : 'local');
  if (patch.cursor_repo_url !== undefined) await setSetting('cursor_repo_url', String(patch.cursor_repo_url || '').trim());
  if (patch.cursor_cwd !== undefined) await setSetting('cursor_cwd', String(patch.cursor_cwd || '').trim());
  if (patch.cursor_model !== undefined) await setSetting('cursor_model', String(patch.cursor_model || 'composer-2.5').trim());
  return getCursorConfig();
}

function listRuns() {
  return [...runs.values()].sort((a, b) => b.id - a.id).slice(0, 30);
}

export function getRun(id) {
  return runs.get(Number(id)) || null;
}

export function getRuns() {
  return listRuns();
}

async function loadSdk() {
  try {
    return await import('@cursor/sdk');
  } catch {
    throw new Error(
      'Package @cursor/sdk absent. Sur le serveur : cd backend && npm install @cursor/sdk — et définissez CURSOR_API_KEY.'
    );
  }
}

function getJsonlStore(sdk, rootHint) {
  if (jsonlStore) return jsonlStore;
  const { JsonlLocalAgentStore, Cursor } = sdk;
  const root = path.join(
    rootHint || process.env.CURSOR_AGENT_CWD || '/opt/neya-erp',
    '.cursor-agent-store'
  );
  fs.mkdirSync(root, { recursive: true });
  jsonlStore = new JsonlLocalAgentStore(root);
  // Évite node:sqlite (Node 20 Docker) — store portable JSONL
  if (Cursor?.configure) {
    Cursor.configure({ local: { store: jsonlStore } });
  }
  return jsonlStore;
}

async function executeRun(run) {
  run.status = 'running';
  run.started_at = new Date().toISOString();
  try {
    const cfg = await getCursorConfig();
    if (!cfg.configured) throw new Error('Clé Cursor API manquante (Paramètres → Agent Cursor)');

    const sdk = await loadSdk();
    const { Agent } = sdk;
    const apiKey = (await getSetting('cursor_api_key')) || process.env.CURSOR_API_KEY;
    const options = {
      apiKey,
      model: { id: cfg.model || 'composer-2.5' },
    };

    if (cfg.runtime === 'cloud') {
      if (!cfg.repo_url) throw new Error('URL GitHub requise pour le mode cloud (ex. https://github.com/org/neya-erp)');
      options.cloud = {
        repos: [{ url: cfg.repo_url }],
      };
    } else {
      const cwd = cfg.cwd || '/opt/neya-erp';
      const store = getJsonlStore(sdk, cwd);
      options.local = { cwd, store };
    }

    const result = await Agent.prompt(run.prompt, options);
    run.status = result.status === 'error' ? 'error' : 'done';
    run.result = result.result || result.status || '';
    run.agent_run_id = result.id || null;
    run.finished_at = new Date().toISOString();
  } catch (err) {
    run.status = 'error';
    run.error = err.message || String(err);
    run.finished_at = new Date().toISOString();
  }
}

export async function startAgentRun({ prompt, label = null, source = 'manual', roadmap_id = null }) {
  const text = String(prompt || '').trim();
  if (!text) throw new Error('Prompt requis');

  const run = {
    id: seq++,
    label: label || text.slice(0, 80),
    prompt: text,
    source,
    roadmap_id,
    status: 'queued',
    result: null,
    error: null,
    agent_run_id: null,
    created_at: new Date().toISOString(),
    started_at: null,
    finished_at: null,
  };
  runs.set(run.id, run);

  // Lancer en arrière-plan (ne bloque pas l'UI ERP)
  setImmediate(() => {
    executeRun(run).catch((e) => {
      run.status = 'error';
      run.error = e.message;
      run.finished_at = new Date().toISOString();
    });
  });

  return run;
}

export async function startRoadmapAction(roadmapId) {
  const action = ROADMAP_ACTIONS.find(a => a.id === roadmapId);
  if (!action) throw new Error('Action roadmap inconnue');
  return startAgentRun({
    prompt: action.prompt,
    label: action.label,
    source: 'roadmap',
    roadmap_id: action.id,
  });
}

import fs from 'fs';
import http from 'http';
import path from 'path';
import { getSetting, setSetting } from './settings.js';
import {
  createPreAgentBackup,
  getWorkspaceGitStatus,
  gitCommitWorkspace,
  gitPushWorkspace,
  listCursorBackups,
  restoreGitBackup,
} from './cursor-git-gateway.js';

const runs = new Map();
let seq = 1;
let jsonlStore = null;

export const ROADMAP_ACTIONS = [
  {
    id: 'drive-ai-sort',
    label: 'IA + tri Google Drive',
    prompt:
      'Dans le repo NEYA ERP, implémente le module IA de tri Google Drive : session guidée pour décrire photos/3D/plans, tags, dossier cible, liaison projet, renommage NEYA, déplacement Drive avec confirmation. Suit le style du projet (Express backend + Next.js frontend). Commence par un plan court puis les fichiers concrets. Priorité atelier : ne pas casser DriveExplorer existant.',
  },
  {
    id: 'viewer-3d',
    label: 'Visualiseur 3D',
    prompt:
      'Dans le repo NEYA ERP, ajoute un visualiseur 3D (GLB depuis Google Drive) dans le workspace projet (/projects/[id]). Preview basique (pas un CAD). Réutilise les APIs Drive existantes. Mobile + desktop. Plan court puis code.',
  },
  {
    id: 'social-posts',
    label: 'Posts réseaux sociaux',
    prompt:
      'Dans le repo NEYA ERP, ajoute un module Posts réseaux (calendrier éditorial FB/IG, brouillons, planification, statut publié). Backend Express + UI Next.js, cohérent avec AdminTasks / roadmap. Brancher si possible sur photos Drive / projets.',
  },
  {
    id: 'dev-space',
    label: 'Espace Dev + tâches dev',
    prompt:
      'Dans le repo NEYA ERP, crée un espace Développement : liste de tâches/bugs/features ERP (CRUD), priorités, statut, puis structure prête pour IDE/Git intégré. Frontend Next.js + API Express. Peut s’appuyer sur /roadmap existante.',
  },
  {
    id: 'agents-specialized',
    label: 'Agents spécialisés',
    prompt:
      'Dans NEYA ERP, esquisse l’architecture des agents spécialisés (compta, fab, marketing, commercial) branchés sur les skills/actions existantes, avec permissions et confirmations. Livrer un plan + premiers hooks UI/API sans tout réécrire.',
  },
  {
    id: 'https-domain',
    label: 'HTTPS / backups production',
    prompt:
      'Finalise / vérifie la config HTTPS production NEYA ERP (Caddy + erp.neyafurniture.ca + backups). Vérifie deploy/ et documente DNS + restore clairement. Ne casse pas le deploy one-click existant.',
  },
];

function hostSocketPath() {
  return (
    process.env.CURSOR_HOST_AGENT_SOCK ||
    '/host-run/cursor-agent.sock'
  );
}

function hostToken() {
  return process.env.CURSOR_HOST_TOKEN || '';
}

function useHostRunner() {
  return process.env.CURSOR_USE_HOST_RUNNER !== '0';
}

function resolveAgentCwd(configured) {
  const candidates = [
    configured,
    process.env.CURSOR_AGENT_CWD,
    '/opt/neya-erp',
    '/workspace',
    process.cwd().replace(/[\\/]backend$/, ''),
  ].filter(Boolean);

  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return configured || '/opt/neya-erp';
}

function requestHost(method, urlPath, body = null, timeoutMs = 600000) {
  const socketPath = hostSocketPath();
  if (!fs.existsSync(socketPath)) {
    return Promise.reject(
      new Error(
        `Runner hôte VPS introuvable (${socketPath}). Installez le service : deploy/vps-install-cursor-host.ps1`
      )
    );
  }

  const payload = body ? JSON.stringify(body) : null;
  const headers = {
    Accept: 'application/json',
    ...(hostToken() ? { 'X-Cursor-Host-Token': hostToken() } : {}),
  };
  if (payload) {
    headers['Content-Type'] = 'application/json';
    headers['Content-Length'] = Buffer.byteLength(payload);
  }

  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        socketPath,
        path: urlPath,
        method,
        headers,
        timeout: timeoutMs,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          let data = {};
          try {
            data = raw ? JSON.parse(raw) : {};
          } catch {
            data = { raw };
          }
          if (res.statusCode >= 400) {
            reject(new Error(data.error || `Host runner HTTP ${res.statusCode}`));
            return;
          }
          resolve(data);
        });
      }
    );
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Délai dépassé — runner hôte VPS'));
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

export async function getHostRunnerInfo() {
  try {
    const info = await requestHost('GET', '/info', null, 8000);
    return { available: true, ...info };
  } catch (err) {
    return {
      available: false,
      error: err.message || String(err),
      socket: hostSocketPath(),
    };
  }
}

export async function getCursorConfig() {
  const apiKey = (await getSetting('cursor_api_key')) || process.env.CURSOR_API_KEY || '';
  const runtime = (await getSetting('cursor_runtime')) || process.env.CURSOR_RUNTIME || 'local';
  const repoUrl = (await getSetting('cursor_repo_url')) || process.env.CURSOR_REPO_URL || '';
  const cwdRaw = (await getSetting('cursor_cwd')) || process.env.CURSOR_AGENT_CWD || '/opt/neya-erp';
  const cwd = resolveAgentCwd(cwdRaw);
  const model = (await getSetting('cursor_model')) || 'composer-2.5';
  const autoBackup = (await getSetting('cursor_auto_backup')) !== false;
  const git = getWorkspaceGitStatus(cwd === '/opt/neya-erp' && fs.existsSync('/workspace') ? '/workspace' : cwd);
  const host = runtime === 'cloud' ? null : await getHostRunnerInfo();

  return {
    configured: Boolean(apiKey && String(apiKey).trim()),
    runtime: runtime === 'cloud' ? 'cloud' : 'local',
    repo_url: repoUrl,
    cwd: host?.available ? host.cwd || '/opt/neya-erp' : cwd,
    model,
    auto_backup: autoBackup !== false,
    api_key_preview: apiKey ? `••••${String(apiKey).slice(-4)}` : '',
    git,
    host,
    gateway: {
      mode: host?.available ? 'vps-host-runner' : 'erp-docker-fallback',
      note: host?.available
        ? `Agent sur l'hôte VPS ${host.hostname} (${host.platform}) — cwd ${host.cwd}`
        : 'Runner hôte indisponible — corrigez le service systemd neya-cursor-agent',
    },
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
  if (patch.cursor_auto_backup !== undefined) await setSetting('cursor_auto_backup', Boolean(patch.cursor_auto_backup));
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
      'Package @cursor/sdk absent. Sur le serveur : npm install @cursor/sdk dans backend, rebuild Docker.'
    );
  }
}

function getJsonlStore(sdk, rootHint) {
  if (jsonlStore) return jsonlStore;
  const { JsonlLocalAgentStore, Cursor } = sdk;
  const root = path.join(
    rootHint || process.env.CURSOR_AGENT_CWD || '/workspace',
    '.cursor-agent-store'
  );
  fs.mkdirSync(root, { recursive: true });
  jsonlStore = new JsonlLocalAgentStore(root);
  if (Cursor?.configure) {
    Cursor.configure({ local: { store: jsonlStore } });
  }
  return jsonlStore;
}

function gitCwdForBackup(cfg) {
  if (fs.existsSync('/workspace/.git')) return '/workspace';
  if (cfg?.cwd && fs.existsSync(path.join(cfg.cwd, '.git'))) return cfg.cwd;
  return cfg?.cwd || '/workspace';
}

async function executeRun(run) {
  run.status = 'running';
  run.started_at = new Date().toISOString();
  try {
    const cfg = await getCursorConfig();
    if (!cfg.configured) throw new Error('Clé Cursor API manquante (Paramètres → Agent Cursor)');

    const backupCwd = gitCwdForBackup(cfg);
    if (cfg.runtime !== 'cloud' && cfg.auto_backup !== false) {
      try {
        run.backup = createPreAgentBackup(backupCwd, { label: run.label || `run-${run.id}` });
      } catch (backupErr) {
        throw new Error(`Backup Git requis avant Cursor : ${backupErr.message}`);
      }
    }

    const apiKey = (await getSetting('cursor_api_key')) || process.env.CURSOR_API_KEY;

    if (cfg.runtime === 'cloud') {
      if (!cfg.repo_url) throw new Error('URL GitHub requise pour le mode cloud (ex. https://github.com/org/neya-erp)');
      const sdk = await loadSdk();
      const { Agent } = sdk;
      const result = await Agent.prompt(run.prompt, {
        apiKey,
        model: { id: cfg.model || 'composer-2.5' },
        cloud: { repos: [{ url: cfg.repo_url }] },
      });
      run.status = result.status === 'error' ? 'error' : 'done';
      run.result = result.result || result.status || '';
      run.agent_run_id = result.id || null;
    } else if (useHostRunner()) {
      const host = await getHostRunnerInfo();
      if (!host.available) {
        throw new Error(
          `Agent doit tourner sur l'hôte VPS, pas dans Docker. ${host.error || ''}`.trim()
        );
      }
      run.host = {
        hostname: host.hostname,
        platform: host.platform,
        cwd: host.cwd,
        mode: host.mode,
      };
      const out = await requestHost(
        'POST',
        '/run',
        {
          prompt: run.prompt,
          apiKey,
          model: cfg.model || 'composer-2.5',
        },
        900000
      );
      run.status = out.status === 'error' ? 'error' : 'done';
      run.result = out.result || out.status || '';
      run.agent_run_id = out.id || null;
      if (out.host) run.host = out.host;
    } else {
      // Fallback legacy (conteneur) — désactivé par défaut
      const cwd = fs.existsSync('/workspace') ? '/workspace' : cfg.cwd;
      const sdk = await loadSdk();
      const { Agent } = sdk;
      const store = getJsonlStore(sdk, cwd);
      const result = await Agent.prompt(run.prompt, {
        apiKey,
        model: { id: cfg.model || 'composer-2.5' },
        local: { cwd, store },
      });
      run.status = result.status === 'error' ? 'error' : 'done';
      run.result = result.result || result.status || '';
      run.agent_run_id = result.id || null;
    }

    run.finished_at = new Date().toISOString();
    run.git_after = getWorkspaceGitStatus(backupCwd);
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
    backup: null,
    host: null,
    git_after: null,
    agent_run_id: null,
    created_at: new Date().toISOString(),
    started_at: null,
    finished_at: null,
  };
  runs.set(run.id, run);

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

export async function gatewayGitStatus() {
  const cfg = await getCursorConfig();
  const cwd = gitCwdForBackup(cfg);
  return {
    cwd,
    git: getWorkspaceGitStatus(cwd),
    backups: listCursorBackups(cwd),
    host: cfg.host,
  };
}

export async function gatewayCreateBackup(label) {
  const cfg = await getCursorConfig();
  return createPreAgentBackup(gitCwdForBackup(cfg), { label: label || 'manual' });
}

export async function gatewayRestoreBackup(payload) {
  const cfg = await getCursorConfig();
  return restoreGitBackup(gitCwdForBackup(cfg), payload || {});
}

export async function gatewayCommit(message) {
  const cfg = await getCursorConfig();
  return gitCommitWorkspace(gitCwdForBackup(cfg), message);
}

export async function gatewayPush(payload) {
  const cfg = await getCursorConfig();
  return gitPushWorkspace(gitCwdForBackup(cfg), payload || {});
}

export async function gatewayListBackups() {
  const cfg = await getCursorConfig();
  return listCursorBackups(gitCwdForBackup(cfg));
}

import { execFileSync, spawn } from 'child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';
import { getSetting, setSetting } from './settings.js';

const backendRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');
const repoRoot = join(backendRoot, '..');
const home = homedir();

/** IP / host VPS NEYA (même défaut que les scripts deploy/*.ps1). */
export const DEFAULT_VPS_HOST = '51.222.31.75';
const DEFAULT_REPO_PATH = '/opt/neya-erp';

function resolveVpsHost(override = null) {
  const raw = override
    || process.env.NEYA_VPS_HOST
    || process.env.DEPLOY_HOST
    || process.env.NEYA_DEPLOY_SSH_HOST
    || DEFAULT_VPS_HOST;
  return String(raw || '').trim();
}

function resolveRepoPath() {
  return process.env.NEYA_REPO_DIR || process.env.DEPLOY_PATH || DEFAULT_REPO_PATH;
}

function resolvePassword() {
  if (process.env.NEYA_VPS_PASSWORD?.trim()) return process.env.NEYA_VPS_PASSWORD.trim();
  const secretFile = join(repoRoot, 'deploy', '.vps-secret');
  if (existsSync(secretFile)) {
    const line = readFileSync(secretFile, 'utf8').split('\n').map(l => l.trim()).find(l => l && !l.startsWith('#'));
    if (line) return line;
  }
  return null;
}

/**
 * Résout une clé SSH utilisable :
 * 1. chemin NEYA_VPS_SSH_KEY / DEPLOY_SSH_KEY_PATH
 * 2. contenu NEYA_VPS_SSH_PRIVATE_KEY / DEPLOY_SSH_KEY → écrit dans ~/.ssh/neya_vps_deploy
 * 3. deploy/.vps-key (chemin) ou ~/.ssh/id_ed25519 / id_rsa
 */
export function resolveSshKeyPath() {
  const fromEnv = process.env.NEYA_VPS_SSH_KEY || process.env.DEPLOY_SSH_KEY_PATH || process.env.NEYA_VPS_KEY;
  if (fromEnv && existsSync(fromEnv)) return fromEnv;

  const inline = process.env.NEYA_VPS_SSH_PRIVATE_KEY || process.env.DEPLOY_SSH_KEY;
  if (inline && inline.includes('BEGIN') && inline.includes('PRIVATE KEY')) {
    const dir = join(home, '.ssh');
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const keyPath = join(dir, 'neya_vps_deploy');
    const normalized = inline.replace(/\\n/g, '\n').trim() + '\n';
    writeFileSync(keyPath, normalized, { mode: 0o600 });
    try { chmodSync(keyPath, 0o600); } catch { /* ignore */ }
    return keyPath;
  }

  const keyFile = join(repoRoot, 'deploy', '.vps-key');
  if (existsSync(keyFile)) {
    const p = readFileSync(keyFile, 'utf8').trim();
    if (p && existsSync(p)) return p;
  }

  for (const name of ['id_ed25519', 'id_rsa']) {
    const p = join(home, '.ssh', name);
    if (existsSync(p)) return p;
  }
  return null;
}

/** True si on tourne déjà sur le VPS (déploiement local sans SSH). */
export function canDeployLocally(repoPath = resolveRepoPath()) {
  if (process.env.NEYA_DEPLOY_MODE === 'local') return true;
  if (process.env.NEYA_DEPLOY_MODE === 'ssh') return false;
  return existsSync(join(repoPath, 'deploy', 'deploy.sh'))
    && existsSync(join(repoPath, '.env.production'));
}

function runGit(args, { cwd = repoRoot, timeout = 20000 } = {}) {
  try {
    const out = execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      timeout,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { ok: true, stdout: String(out || '').trim() };
  } catch (err) {
    return {
      ok: false,
      stdout: String(err.stdout || '').trim(),
      stderr: String(err.stderr || err.message || '').trim(),
      code: err.status ?? 1,
    };
  }
}

export function isGitRepo(dir = repoRoot) {
  return existsSync(join(dir, '.git'));
}

export function getLocalGitStatus() {
  if (!isGitRepo()) {
    return {
      isRepo: false,
      repoRoot,
      message: 'Ce dossier n’est pas encore un dépôt Git.',
    };
  }

  const branch = runGit(['rev-parse', '--abbrev-ref', 'HEAD']);
  const commit = runGit(['rev-parse', '--short', 'HEAD']);
  const full = runGit(['rev-parse', 'HEAD']);
  const remote = runGit(['remote', 'get-url', 'origin']);
  const dirty = runGit(['status', '--porcelain']);
  const versionPath = join(repoRoot, 'VERSION');
  const version = existsSync(versionPath) ? readFileSync(versionPath, 'utf8').trim() : null;

  let ahead = 0;
  let behind = 0;
  let remoteCommit = null;
  if (remote.ok && branch.ok) {
    runGit(['fetch', 'origin', branch.stdout, '--quiet'], { timeout: 60000 });
    const counts = runGit(['rev-list', '--left-right', '--count', `HEAD...origin/${branch.stdout}`]);
    if (counts.ok) {
      const [a, b] = counts.stdout.split(/\s+/).map(n => Number(n) || 0);
      ahead = a;
      behind = b;
    }
    const rc = runGit(['rev-parse', '--short', `origin/${branch.stdout}`]);
    if (rc.ok) remoteCommit = rc.stdout;
  }

  return {
    isRepo: true,
    repoRoot,
    version,
    branch: branch.ok ? branch.stdout : null,
    commit: commit.ok ? commit.stdout : null,
    fullCommit: full.ok ? full.stdout : null,
    remoteUrl: remote.ok ? remote.stdout : null,
    dirty: dirty.ok ? dirty.stdout.length > 0 : false,
    dirtyFiles: dirty.ok && dirty.stdout
      ? dirty.stdout.split('\n').filter(Boolean).slice(0, 20)
      : [],
    ahead,
    behind,
    remoteCommit,
    updateAvailable: behind > 0,
    pushPending: ahead > 0,
  };
}

function normalizeSetting(value) {
  if (value == null) return null;
  if (typeof value === 'string') {
    const t = value.trim();
    if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
      try { return JSON.parse(t); } catch { return t.slice(1, -1); }
    }
    return t || null;
  }
  return String(value);
}

export async function getGitDeployConfig() {
  const fromDb = normalizeSetting(await getSetting('git_deploy_repo_url').catch(() => null));
  const fromEnv = process.env.NEYA_GIT_REPO_URL || null;
  const vpsHost = resolveVpsHost();
  const sshKey = resolveSshKeyPath();
  const password = Boolean(resolvePassword());
  const local = canDeployLocally();
  return {
    repoUrl: fromDb || fromEnv || null,
    branch: process.env.NEYA_DEPLOY_BRANCH || 'main',
    vpsPath: resolveRepoPath(),
    vpsHost,
    sshKeyConfigured: Boolean(sshKey),
    passwordConfigured: password,
    localDeployAvailable: local,
    oneClickReady: local || Boolean(sshKey) || password,
    autoDeployConfigured: local || Boolean(sshKey) || password || Boolean(
      process.env.NEYA_VPS_HOST || process.env.DEPLOY_HOST || process.env.NEYA_DEPLOY_SSH_HOST
    ),
  };
}

export async function saveGitDeployConfig({ repoUrl }) {
  if (repoUrl != null) {
    await setSetting('git_deploy_repo_url', String(repoUrl).trim());
  }
  return getGitDeployConfig();
}

function runLocalDeploy({ force = false, path } = {}) {
  const repoPath = path || resolveRepoPath();
  const script = join(repoPath, 'deploy', 'deploy.sh');
  if (!existsSync(script)) {
    throw new Error(`Script introuvable : ${script}`);
  }
  const env = { ...process.env, FORCE: force ? '1' : '0' };
  return new Promise((resolve, reject) => {
    const child = spawn('bash', [script], { cwd: repoPath, env });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => { stdout += d.toString(); });
    child.stderr.on('data', d => { stderr += d.toString(); });
    child.on('error', reject);
    child.on('close', code => {
      if (code === 0) resolve({ ok: true, mode: 'local', stdout, stderr, host: 'localhost', path: repoPath });
      else reject(new Error((stderr || stdout || `deploy.sh exit ${code}`).trim().slice(-2000)));
    });
  });
}

function runSsh(args, { password = null } = {}) {
  return new Promise((resolve, reject) => {
    let cmd = 'ssh';
    let finalArgs = args;
    const env = { ...process.env };
    if (password) {
      if (!existsSync('/usr/bin/sshpass')) {
        reject(new Error('sshpass manquant — installez-le ou utilisez NEYA_VPS_SSH_PRIVATE_KEY'));
        return;
      }
      cmd = 'sshpass';
      finalArgs = ['-e', 'ssh', ...args];
      env.SSHPASS = password;
    }
    const child = spawn(cmd, finalArgs, { env });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => { stdout += d.toString(); });
    child.stderr.on('data', d => { stderr += d.toString(); });
    child.on('error', reject);
    child.on('close', code => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error((stderr || stdout || `ssh exit ${code}`).trim()));
    });
  });
}

/**
 * Déclenche deploy.sh — local si on est sur le VPS, sinon SSH.
 * Auth SSH : clé (fichier ou NEYA_VPS_SSH_PRIVATE_KEY) ou NEYA_VPS_PASSWORD (+ sshpass).
 */
export async function triggerVpsGitDeploy({ force = false, host: hostOverride = null } = {}) {
  const path = resolveRepoPath();

  if (canDeployLocally(path)) {
    return runLocalDeploy({ force, path });
  }

  const host = resolveVpsHost(hostOverride);
  const user = process.env.NEYA_VPS_USER || process.env.DEPLOY_USER || 'ubuntu';
  const key = resolveSshKeyPath();
  const password = resolvePassword();

  if (!host) {
    throw new Error(
      `NEYA_VPS_HOST non configuré — ajoutez NEYA_VPS_HOST=${DEFAULT_VPS_HOST} dans backend/.env`
    );
  }
  if (!key && !password) {
    throw new Error(
      'Aucun accès SSH : définissez NEYA_VPS_PASSWORD (mot de passe OVH) ou NEYA_VPS_SSH_PRIVATE_KEY dans backend/.env'
    );
  }

  // Lancer en arrière-plan sur l'hôte : sinon le rebuild Docker tue le backend
  // au milieu de la requête HTTP (502).
  const logFile = `${path}/deploy/logs/one-click-latest.log`;
  // Script multi-lignes : évite les erreurs bash « &; » / « & && »
  const remoteScript = [
    `mkdir -p ${path}/deploy/logs`,
    `echo "[one-click] start force=${force ? '1' : '0'}" > ${logFile}`,
    `nohup env FORCE=${force ? '1' : '0'} /bin/bash ${path}/deploy/deploy.sh >>${logFile} 2>&1 </dev/null &`,
    `echo DEPLOY_STARTED pid=$! log=${logFile}`,
  ].join('\n');
  const remoteCmd = `bash -lc ${JSON.stringify(remoteScript)}`;

  const args = [
    '-o', 'StrictHostKeyChecking=accept-new',
    '-o', 'ConnectTimeout=20',
    '-o', password && !key ? 'PreferredAuthentications=password' : 'BatchMode=yes',
  ];
  if (key) args.push('-i', key);
  args.push(`${user}@${host}`, remoteCmd);

  try {
    const { stdout, stderr } = await runSsh(args, { password: key ? null : password });
    return {
      ok: true,
      mode: 'ssh-async',
      started: true,
      stdout,
      stderr,
      host,
      path,
      logFile,
      message: 'Mise à jour lancée sur le VPS (1–3 min). Rechargez la page après.',
    };
  } catch (err) {
    const detail = String(err.message || err).trim();
    const hint = !key && password
      ? ` — Vérifiez NEYA_VPS_PASSWORD pour ${user}@${host}.`
      : !key
        ? ` — Ajoutez NEYA_VPS_PASSWORD ou NEYA_VPS_SSH_PRIVATE_KEY (hôte ${host}).`
        : '';
    throw new Error(`${detail}${hint}`);
  }
}

/** Test rapide SSH / local (echo ok). */
export async function testVpsConnection({ host: hostOverride = null } = {}) {
  const path = resolveRepoPath();
  if (canDeployLocally(path)) {
    return { ok: true, mode: 'local', host: 'localhost', path, message: 'Déploiement local disponible (sur le VPS).' };
  }
  const host = resolveVpsHost(hostOverride);
  const user = process.env.NEYA_VPS_USER || process.env.DEPLOY_USER || 'ubuntu';
  const key = resolveSshKeyPath();
  const password = resolvePassword();
  if (!key && !password) {
    return { ok: false, host, message: 'Pas de clé ni mot de passe SSH configuré.' };
  }
  const args = [
    '-o', 'StrictHostKeyChecking=accept-new',
    '-o', 'ConnectTimeout=15',
    '-o', password && !key ? 'PreferredAuthentications=password' : 'BatchMode=yes',
  ];
  if (key) args.push('-i', key);
  args.push(`${user}@${host}`, 'echo NEYA_SSH_OK && hostname && test -d ' + path + ' && echo REPO_OK');
  try {
    const { stdout } = await runSsh(args, { password: key ? null : password });
    return { ok: true, mode: 'ssh', host, path, message: stdout.trim() };
  } catch (err) {
    return { ok: false, mode: 'ssh', host, path, message: String(err.message || err) };
  }
}

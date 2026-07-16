import { execFileSync, spawn } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getSetting, setSetting } from './settings.js';

const backendRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');
const repoRoot = join(backendRoot, '..');

/** IP / host VPS NEYA (même défaut que les scripts deploy/*.ps1). */
export const DEFAULT_VPS_HOST = '51.222.31.75';

function resolveVpsHost(override = null) {
  return String(
    override
    || process.env.NEYA_VPS_HOST
    || process.env.DEPLOY_HOST
    || process.env.NEYA_DEPLOY_SSH_HOST
    || DEFAULT_VPS_HOST
  ).trim();
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
  const sshKey = process.env.NEYA_VPS_SSH_KEY || process.env.DEPLOY_SSH_KEY_PATH || null;
  return {
    repoUrl: fromDb || fromEnv || null,
    branch: process.env.NEYA_DEPLOY_BRANCH || 'main',
    vpsPath: process.env.NEYA_REPO_DIR || '/opt/neya-erp',
    vpsHost,
    sshKeyConfigured: Boolean(sshKey && existsSync(sshKey)),
    autoDeployConfigured: Boolean(
      process.env.NEYA_VPS_HOST
      || process.env.DEPLOY_HOST
      || process.env.NEYA_DEPLOY_SSH_HOST
      || sshKey
      || process.env.NEYA_VPS_PASSWORD
    ),
  };
}

export async function saveGitDeployConfig({ repoUrl }) {
  if (repoUrl != null) {
    await setSetting('git_deploy_repo_url', String(repoUrl).trim());
  }
  return getGitDeployConfig();
}

/**
 * Déclenche deploy.sh sur le VPS via SSH (clé ou password env).
 * Variables : NEYA_VPS_HOST (défaut 51.222.31.75), NEYA_VPS_USER, NEYA_VPS_SSH_KEY ou NEYA_VPS_PASSWORD
 * @param {{ force?: boolean, host?: string }} opts
 */
export function triggerVpsGitDeploy({ force = false, host: hostOverride = null } = {}) {
  const host = resolveVpsHost(hostOverride);
  const user = process.env.NEYA_VPS_USER || process.env.DEPLOY_USER || 'ubuntu';
  const path = process.env.NEYA_REPO_DIR || process.env.DEPLOY_PATH || '/opt/neya-erp';
  const key = process.env.NEYA_VPS_SSH_KEY || process.env.DEPLOY_SSH_KEY_PATH;
  const password = process.env.NEYA_VPS_PASSWORD;

  if (!host) {
    throw new Error(
      `NEYA_VPS_HOST (ou DEPLOY_HOST) non configuré — ajoutez NEYA_VPS_HOST=${DEFAULT_VPS_HOST} dans backend/.env`
    );
  }

  const remoteCmd = `cd ${path} && ${force ? 'FORCE=1 ' : ''}./deploy/deploy.sh`;
  const args = ['-o', 'StrictHostKeyChecking=accept-new', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15'];
  if (key) {
    if (!existsSync(key)) {
      throw new Error(`Clé SSH introuvable : ${key} (NEYA_VPS_SSH_KEY)`);
    }
    args.push('-i', key);
  }
  args.push(`${user}@${host}`, remoteCmd);

  if (password && !key) {
    if (!existsSync('/usr/bin/sshpass') && process.platform !== 'win32') {
      throw new Error('Configurez NEYA_VPS_SSH_KEY (chemin clé privée) pour déployer sans mot de passe interactif.');
    }
  }

  return new Promise((resolve, reject) => {
    const child = spawn('ssh', args, { env: process.env });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => { stdout += d.toString(); });
    child.stderr.on('data', d => { stderr += d.toString(); });
    child.on('error', reject);
    child.on('close', code => {
      if (code === 0) resolve({ ok: true, stdout, stderr, host, path });
      else {
        const detail = (stderr || stdout || `ssh exit ${code}`).trim();
        const hint = !key
          ? ` — Ajoutez NEYA_VPS_SSH_KEY=/chemin/vers/id_ed25519 dans backend/.env (hôte ${host}).`
          : '';
        reject(new Error(`${detail}${hint}`));
      }
    });
  });
}

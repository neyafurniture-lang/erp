import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';

/** Évite « fatal: detected dubious ownership » (volume Docker monté). */
const ensuredSafeDirs = new Set();

function ensureSafeDirectory(cwd) {
  if (!cwd || ensuredSafeDirs.has(cwd)) return;
  try {
    execFileSync('git', ['config', '--global', '--add', 'safe.directory', cwd], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch {
    /* ignore */
  }
  try {
    execFileSync('git', ['config', '--global', '--add', 'safe.directory', '*'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch {
    /* ignore */
  }
  ensuredSafeDirs.add(cwd);
}

function run(cwd, args, timeout = 120000) {
  ensureSafeDirectory(cwd);
  try {
    const stdout = execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      timeout,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { ok: true, stdout: String(stdout || '').trim() };
  } catch (err) {
    return {
      ok: false,
      stdout: String(err.stdout || '').trim(),
      stderr: String(err.stderr || err.message || '').trim(),
      code: err.status ?? 1,
    };
  }
}

export function isGitRepo(cwd) {
  return fs.existsSync(path.join(cwd, '.git'));
}

export function getWorkspaceGitStatus(cwd) {
  if (!cwd || !fs.existsSync(cwd)) {
    return { ok: false, error: `Répertoire introuvable: ${cwd}` };
  }
  if (!isGitRepo(cwd)) {
    return { ok: false, isRepo: false, cwd, error: 'Pas un dépôt Git — initialisez le workspace VPS.' };
  }

  const branch = run(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const commit = run(cwd, ['rev-parse', '--short', 'HEAD']);
  const full = run(cwd, ['rev-parse', 'HEAD']);
  const dirty = run(cwd, ['status', '--porcelain']);
  const remote = run(cwd, ['remote', 'get-url', 'origin']);
  const log = run(cwd, ['log', '-5', '--oneline']);

  return {
    ok: true,
    isRepo: true,
    cwd,
    branch: branch.ok ? branch.stdout : null,
    commit: commit.ok ? commit.stdout : null,
    fullCommit: full.ok ? full.stdout : null,
    dirty: dirty.ok ? dirty.stdout.length > 0 : false,
    dirtyFiles: dirty.ok && dirty.stdout
      ? dirty.stdout.split('\n').filter(Boolean).slice(0, 40)
      : [],
    remoteUrl: remote.ok ? remote.stdout : null,
    recentCommits: log.ok ? log.stdout.split('\n').filter(Boolean) : [],
  };
}

/**
 * Snapshot Git avant modification Cursor : commit éventuel + tag + branche backup.
 * Ne pousse pas sur origin (sécurité).
 */
export function createPreAgentBackup(cwd, { label = 'cursor' } = {}) {
  if (!isGitRepo(cwd)) {
    throw new Error('Impossible de backup : workspace non Git. Lancez deploy/vps-init-git.ps1 ou git init.');
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const safeLabel = String(label || 'cursor')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .slice(0, 40) || 'cursor';
  const tag = `backup/${safeLabel}-${stamp}`;
  const branch = `backup/${safeLabel}-${stamp}`;

  // Config minimale pour commits non-interactifs dans Docker
  run(cwd, ['config', 'user.email', 'cursor-agent@neya.local']);
  run(cwd, ['config', 'user.name', 'NEYA Cursor Agent']);

  const status = run(cwd, ['status', '--porcelain']);
  let snapshotCommit = run(cwd, ['rev-parse', 'HEAD']);
  if (!snapshotCommit.ok) throw new Error(snapshotCommit.stderr || 'HEAD introuvable');

  if (status.ok && status.stdout) {
    run(cwd, ['add', '-A']);
    const commit = run(cwd, [
      'commit',
      '-m',
      `chore(backup): snapshot avant agent Cursor (${safeLabel})`,
      '--allow-empty',
    ]);
    if (!commit.ok && !/nothing to commit/i.test(commit.stderr + commit.stdout)) {
      // continue with current HEAD
    }
    snapshotCommit = run(cwd, ['rev-parse', 'HEAD']);
  }

  const full = snapshotCommit.stdout;
  const short = run(cwd, ['rev-parse', '--short', 'HEAD']).stdout || full.slice(0, 7);

  const branchRes = run(cwd, ['branch', branch, full]);
  const tagRes = run(cwd, ['tag', '-a', tag, '-m', `Backup avant Cursor: ${safeLabel}`, full]);

  // Archive gzip optionnelle (hors .git) pour rollback fichier
  const backupDir = path.join(cwd, 'deploy', 'backups', 'cursor');
  fs.mkdirSync(backupDir, { recursive: true });
  const archiveName = `${safeLabel}-${stamp}.txt`;
  const metaPath = path.join(backupDir, archiveName);
  fs.writeFileSync(
    metaPath,
    JSON.stringify(
      {
        created_at: new Date().toISOString(),
        label: safeLabel,
        tag,
        branch,
        commit: short,
        full_commit: full,
        dirty_before: Boolean(status.stdout),
      },
      null,
      2
    ),
    'utf8'
  );

  return {
    ok: true,
    tag,
    branch,
    commit: short,
    full_commit: full,
    meta_file: `deploy/backups/cursor/${archiveName}`,
    branch_created: branchRes.ok,
    tag_created: tagRes.ok,
  };
}

export function listCursorBackups(cwd, limit = 20) {
  const dir = path.join(cwd, 'deploy', 'backups', 'cursor');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter(f => f.endsWith('.txt'))
    .map(f => {
      try {
        return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      } catch {
        return { file: f };
      }
    })
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
    .slice(0, limit);
}

export function restoreGitBackup(cwd, { tag = null, commit = null } = {}) {
  if (!isGitRepo(cwd)) throw new Error('Workspace non Git');
  const target = tag || commit;
  if (!target) throw new Error('tag ou commit requis');

  // Sécurité : snapshot courant avant restore
  const safety = createPreAgentBackup(cwd, { label: 'pre-restore' });
  const checkout = run(cwd, ['checkout', '-f', target]);
  if (!checkout.ok) {
    throw new Error(checkout.stderr || `Impossible de restaurer ${target}`);
  }
  return { ok: true, restored: target, safety };
}

export function gitCommitWorkspace(cwd, message) {
  if (!isGitRepo(cwd)) throw new Error('Workspace non Git');
  run(cwd, ['config', 'user.email', 'cursor-agent@neya.local']);
  run(cwd, ['config', 'user.name', 'NEYA Cursor Agent']);
  run(cwd, ['add', '-A']);
  const msg = String(message || 'chore: modifications agent Cursor').trim();
  const res = run(cwd, ['commit', '-m', msg]);
  if (!res.ok && !/nothing to commit/i.test(res.stderr + res.stdout)) {
    throw new Error(res.stderr || res.stdout || 'Commit échoué');
  }
  const commit = run(cwd, ['rev-parse', '--short', 'HEAD']);
  return { ok: true, commit: commit.stdout, message: msg, empty: /nothing to commit/i.test(res.stderr + res.stdout) };
}

export function gitPushWorkspace(cwd, { remote = 'origin', branch = null } = {}) {
  if (!isGitRepo(cwd)) throw new Error('Workspace non Git');
  const b = branch || run(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']).stdout || 'main';
  const res = run(cwd, ['push', '-u', remote, b], 180000);
  if (!res.ok) throw new Error(res.stderr || res.stdout || 'Push échoué');
  return { ok: true, remote, branch: b, stdout: res.stdout };
}

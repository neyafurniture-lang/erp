import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const backendRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');
const repoRoot = join(backendRoot, '..');

function readVersionFile() {
  for (const base of [repoRoot, backendRoot]) {
    const path = join(base, 'VERSION');
    if (existsSync(path)) return readFileSync(path, 'utf8').trim();
  }
  return null;
}

function gitCommit() {
  if (process.env.GIT_COMMIT) return process.env.GIT_COMMIT;
  try {
    return execSync('git rev-parse --short HEAD', { cwd: repoRoot, encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

export function getVersionInfo() {
  return {
    version: process.env.APP_VERSION || readVersionFile() || 'dev',
    commit: gitCommit(),
    branch: process.env.GIT_BRANCH || process.env.NEYA_DEPLOY_BRANCH || null,
    builtAt: process.env.BUILT_AT || null,
    environment: process.env.NODE_ENV || 'development',
  };
}

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { getSetting, setSetting } from './settings.js';

const backendRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');
const defaultRepoRoot = join(backendRoot, '..');

/** Minutes sans activité API authentifiée avant d’autoriser la MAJ auto de minuit. */
export const DEFAULT_IDLE_MINUTES = Number(process.env.NEYA_AUTO_UPDATE_IDLE_MINUTES || 120);

const ACTIVITY_SETTING_KEY = 'erp_last_activity_at';
const TOUCH_MIN_INTERVAL_MS = 60_000;

let lastTouchMs = 0;

export function resolveActivityRepoRoot() {
  const candidates = [
    process.env.NEYA_REPO_DIR,
    process.env.CURSOR_AGENT_CWD,
    '/workspace',
    '/opt/neya-erp',
    defaultRepoRoot,
  ].filter(Boolean);

  for (const dir of candidates) {
    if (existsSync(join(dir, 'deploy')) || existsSync(join(dir, '.git'))) return dir;
  }
  return defaultRepoRoot;
}

export function activityFilePath(repoRoot = resolveActivityRepoRoot()) {
  return join(repoRoot, 'deploy', '.last-activity');
}

function parseIso(value) {
  if (!value) return null;
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function readActivityFile(repoRoot = resolveActivityRepoRoot()) {
  const file = activityFilePath(repoRoot);
  if (!existsSync(file)) return null;
  try {
    const raw = readFileSync(file, 'utf8').trim();
    if (!raw) return null;
    if (raw.startsWith('{')) {
      const parsed = JSON.parse(raw);
      return parseIso(parsed.at || parsed.timestamp || parsed.last_activity_at);
    }
    return parseIso(raw.split(/\s/)[0]);
  } catch {
    return null;
  }
}

export function writeActivityFile(iso, { userId = null, path = null } = {}) {
  const repoRoot = resolveActivityRepoRoot();
  const file = activityFilePath(repoRoot);
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(
      file,
      `${JSON.stringify({
        at: iso,
        user_id: userId,
        path: path || null,
      })}\n`,
      'utf8'
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Enregistre une activité ERP (throttle 60s).
 * Fichier sur le volume hôte + setting DB (secours).
 */
export async function touchErpActivity({ userId = null, path = null, force = false } = {}) {
  const now = Date.now();
  if (!force && now - lastTouchMs < TOUCH_MIN_INTERVAL_MS) {
    return { skipped: true, at: new Date(lastTouchMs).toISOString() };
  }
  lastTouchMs = now;
  const iso = new Date(now).toISOString();
  writeActivityFile(iso, { userId, path });
  try {
    await setSetting(ACTIVITY_SETTING_KEY, iso);
  } catch {
    /* ignore DB write failures — fichier suffit pour le cron hôte */
  }
  return { skipped: false, at: iso };
}

export async function getErpLastActivityAt() {
  const fromFile = readActivityFile();
  let fromDb = null;
  try {
    fromDb = parseIso(await getSetting(ACTIVITY_SETTING_KEY));
  } catch {
    fromDb = null;
  }
  if (fromFile && fromDb) {
    return new Date(fromFile) >= new Date(fromDb) ? fromFile : fromDb;
  }
  return fromFile || fromDb;
}

export async function getErpActivityStatus({ idleMinutes = DEFAULT_IDLE_MINUTES } = {}) {
  const lastAt = await getErpLastActivityAt();
  const idleMs = Math.max(1, Number(idleMinutes) || DEFAULT_IDLE_MINUTES) * 60_000;
  const ageMs = lastAt ? Date.now() - new Date(lastAt).getTime() : null;
  const isIdle = lastAt == null || (ageMs != null && ageMs >= idleMs);
  return {
    lastActivityAt: lastAt,
    ageMinutes: ageMs == null ? null : Math.floor(ageMs / 60_000),
    idleMinutesRequired: Number(idleMinutes) || DEFAULT_IDLE_MINUTES,
    isIdle,
    activityFile: activityFilePath(),
  };
}

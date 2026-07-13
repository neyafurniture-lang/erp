import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { getVersionInfo } from '../version.js';
import { buildVpsInstructions, getDeployCapabilities } from './deploy-diagnostics.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '../../..');
const exportDir = path.join(repoRoot, 'deploy', 'exports');

const PACK_ITEMS = ['backend', 'frontend', 'deploy', 'docker-compose.prod.yml', 'VERSION'];

const EXCLUDE_DIRS = new Set([
  'node_modules', '.next', '.git', 'uploads', 'exports',
]);

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function copyRecursive(src, dest) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    if (EXCLUDE_DIRS.has(path.basename(src))) return;
    ensureDir(dest);
    for (const entry of fs.readdirSync(src)) {
      if (EXCLUDE_DIRS.has(entry)) continue;
      copyRecursive(path.join(src, entry), path.join(dest, entry));
    }
    return;
  }
  ensureDir(path.dirname(dest));
  fs.copyFileSync(src, dest);
}

function createZipFromDir(stageDir, zipPath) {
  if (process.platform === 'win32') {
    const ps = `Compress-Archive -Path '${stageDir.replace(/'/g, "''")}\\*' -DestinationPath '${zipPath.replace(/'/g, "''")}' -Force`;
    execSync(`powershell -NoProfile -Command "${ps}"`, { stdio: 'pipe' });
  } else {
    execSync(`cd "${stageDir}" && zip -rq "${zipPath}" .`, { stdio: 'pipe' });
  }
}

export async function exportDatabaseSql() {
  const backendDir = path.join(repoRoot, 'backend');
  execSync('npm run db:migrate-export', { cwd: backendDir, stdio: 'pipe' });
  const sqlPath = path.join(backendDir, 'scripts', 'migration-export.sql');
  if (!fs.existsSync(sqlPath)) {
    throw new Error('Export SQL échoué');
  }
  const dest = path.join(exportDir, 'migration-export.sql');
  ensureDir(exportDir);
  fs.copyFileSync(sqlPath, dest);
  return dest;
}

export async function prepareVpsPackage({ includeDb = true, vpsHost = '', vpsPath = '/opt/neya-erp' } = {}) {
  ensureDir(exportDir);
  const version = getVersionInfo();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const stageDir = path.join(exportDir, `stage-${stamp}`);
  const zipName = `neya-erp-deploy-${version.version}-${version.commit}.zip`;
  const zipPath = path.join(exportDir, zipName);
  const manifestName = `deploy-manifest-${stamp}.json`;
  const manifestPath = path.join(exportDir, manifestName);

  if (fs.existsSync(stageDir)) fs.rmSync(stageDir, { recursive: true, force: true });
  ensureDir(stageDir);

  for (const item of PACK_ITEMS) {
    const src = path.join(repoRoot, item);
    if (!fs.existsSync(src)) continue;
    copyRecursive(src, path.join(stageDir, item));
  }

  for (const rel of ['backend/node_modules', 'frontend/node_modules', 'frontend/.next', 'backend/uploads']) {
    const p = path.join(stageDir, rel);
    if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
  }

  if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
  createZipFromDir(stageDir, zipPath);
  fs.rmSync(stageDir, { recursive: true, force: true });

  let sqlFile = null;
  if (includeDb) {
    try {
      sqlFile = await exportDatabaseSql();
    } catch {
      sqlFile = null;
    }
  }

  const instructions = buildVpsInstructions({
    version: version.version,
    commit: version.commit,
    vpsHost: vpsHost || 'VOTRE_VPS',
    vpsPath,
  });

  const manifest = {
    generatedAt: new Date().toISOString(),
    version: version.version,
    commit: version.commit,
    environment: version.environment,
    capabilities: getDeployCapabilities(),
    files: {
      zip: zipName,
      zipSizeBytes: fs.statSync(zipPath).size,
      sql: sqlFile ? path.basename(sqlFile) : null,
    },
    instructions,
    notes: [
      'Le zip ne contient pas node_modules ni .next — le VPS rebuild via Docker.',
      'migration-export.sql = données métier locales (clients, projets, tâches…) — optionnel.',
      'Ne commitez jamais .env.production ni les clés API dans Git.',
    ],
  };

  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

  const scriptLines = [
    '#!/usr/bin/env bash',
    '# NEYA ERP — commandes générées automatiquement',
    `set -euo pipefail`,
    `cd ${vpsPath}`,
    ...instructions.steps.slice(2).map(s => s.replace(/^\d+\.\s*/, '# ') || `# ${s}`),
    '',
    instructions.oneLiner,
  ];
  const scriptName = `vps-deploy-${stamp}.sh`;
  const scriptPath = path.join(exportDir, scriptName);
  fs.writeFileSync(scriptPath, scriptLines.join('\n'), 'utf8');

  return {
    manifest,
    files: {
      zip: zipName,
      manifest: manifestName,
      script: scriptName,
      sql: sqlFile ? path.basename(sqlFile) : null,
    },
    downloadBase: '/api/deploy/download',
  };
}

export function listExportFiles() {
  if (!fs.existsSync(exportDir)) return [];
  return fs.readdirSync(exportDir)
    .filter(f => !f.startsWith('stage-'))
    .map(f => {
      const full = path.join(exportDir, f);
      return { name: f, size: fs.statSync(full).size, mtime: fs.statSync(full).mtime };
    })
    .sort((a, b) => b.mtime - a.mtime);
}

export function resolveExportFile(name) {
  const safe = path.basename(name);
  const full = path.join(exportDir, safe);
  if (!full.startsWith(exportDir) || !fs.existsSync(full)) return null;
  return full;
}

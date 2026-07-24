import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import pool from '../db/pool.js';
import {
  getLocalDiagnostics,
  probeRemoteHealth,
} from '../services/deploy-diagnostics.js';
import {
  listExportFiles,
  prepareVpsPackage,
  resolveExportFile,
} from '../services/deploy-pack.js';
import {
  getDeployProgress,
  getDeploySyncStatus,
  getGitDeployConfig,
  getLocalGitStatus,
  saveGitDeployConfig,
  triggerVpsGitDeploy,
  testVpsConnection,
} from '../services/deploy-git.js';

const router = Router();

async function requireAdmin(req, res) {
  const { rows } = await pool.query('SELECT role FROM users WHERE id = $1', [req.user.id]);
  if (rows[0]?.role !== 'admin') {
    res.status(403).json({ error: 'Réservé aux administrateurs' });
    return false;
  }
  return true;
}

router.get('/diagnostics', async (req, res) => {
  try {
    if (!(await requireAdmin(req, res))) return;
    const [local, git, gitConfig, sync] = await Promise.all([
      getLocalDiagnostics(),
      Promise.resolve(getLocalGitStatus()),
      getGitDeployConfig(),
      getDeploySyncStatus().catch(() => null),
    ]);
    let remote = null;
    if (req.query.remote) {
      remote = await probeRemoteHealth(req.query.remote);
    }
    res.json({ local, remote, git, gitConfig, sync });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/git', async (req, res) => {
  try {
    if (!(await requireAdmin(req, res))) return;
    const git = getLocalGitStatus();
    const gitConfig = await getGitDeployConfig();
    res.json({ git, gitConfig });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Vérifie si le dépôt serveur est à jour vs GitHub + état auto-update / idle. */
router.get('/sync-status', async (req, res) => {
  try {
    if (!(await requireAdmin(req, res))) return;
    const status = await getDeploySyncStatus();
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Progression du déploiement Git one-click (barre de chargement UI). */
router.get('/git/progress', async (req, res) => {
  try {
    if (!(await requireAdmin(req, res))) return;
    res.json(getDeployProgress());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/git/config', async (req, res) => {
  try {
    if (!(await requireAdmin(req, res))) return;
    const gitConfig = await saveGitDeployConfig({ repoUrl: req.body?.repoUrl });
    res.json({ ok: true, gitConfig });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/git/deploy', async (req, res) => {
  try {
    if (!(await requireAdmin(req, res))) return;
    const result = await triggerVpsGitDeploy({
      force: Boolean(req.body?.force),
      host: req.body?.vpsHost || req.body?.host || null,
    });
    res.json({
      ok: true,
      message: result.message || 'Mise à jour en cours…',
      ...result,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/git/test-ssh', async (req, res) => {
  try {
    if (!(await requireAdmin(req, res))) return;
    const result = await testVpsConnection({
      host: req.body?.vpsHost || req.body?.host || null,
    });
    res.status(result.ok ? 200 : 400).json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/prepare', async (req, res) => {
  try {
    if (!(await requireAdmin(req, res))) return;
    const result = await prepareVpsPackage({
      includeDb: req.body?.includeDb !== false,
      vpsHost: req.body?.vpsHost || '',
      vpsPath: req.body?.vpsPath || '/opt/neya-erp',
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/exports', async (req, res) => {
  try {
    if (!(await requireAdmin(req, res))) return;
    res.json(listExportFiles());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/download/:filename', async (req, res) => {
  try {
    if (!(await requireAdmin(req, res))) return;
    const file = resolveExportFile(req.params.filename);
    if (!file) return res.status(404).json({ error: 'Fichier introuvable' });

    const ext = path.extname(file).toLowerCase();
    const types = {
      '.zip': 'application/zip',
      '.sql': 'application/sql',
      '.json': 'application/json',
      '.sh': 'text/plain',
    };
    res.setHeader('Content-Type', types[ext] || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${path.basename(file)}"`);
    fs.createReadStream(file).pipe(res);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;

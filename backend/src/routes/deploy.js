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
  getGitDeployConfig,
  getLocalGitStatus,
  saveGitDeployConfig,
  triggerVpsGitDeploy,
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
    const [local, git, gitConfig] = await Promise.all([
      getLocalDiagnostics(),
      Promise.resolve(getLocalGitStatus()),
      getGitDeployConfig(),
    ]);
    let remote = null;
    if (req.query.remote) {
      remote = await probeRemoteHealth(req.query.remote);
    }
    res.json({ local, remote, git, gitConfig });
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
      message: 'Déploiement Git lancé sur le VPS (pull + build Docker).',
      ...result,
    });
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

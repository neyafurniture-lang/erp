import pool from '../db/pool.js';
import { getVersionInfo } from '../version.js';

/** Fonctionnalités critiques — si absentes sur le VPS → erreurs 404 côté UI */
export const CAPABILITIES = [
  { id: 'gmail', label: 'Gmail (lecture / envoi)', routes: ['/api/gmail/messages', '/api/gmail/search'] },
  { id: 'gmail_threads', label: 'Fils courriel + synthèse IA', routes: ['/api/gmail/threads/process-message', '/api/gmail/threads/by-gmail/:id'] },
  { id: 'email_threads', label: 'Fils courriel (alias)', routes: ['/api/email-threads/process-message'] },
  { id: 'supplier_invoices', label: 'Scan factures fournisseurs', routes: ['/api/supplier-invoices/scan', '/api/supplier-invoices/pending'] },
  { id: 'receipts', label: 'Scan tickets de caisse', routes: ['/api/receipts'] },
  { id: 'drive', label: 'Google Drive', routes: ['/api/drive/tree'] },
  { id: 'assistant', label: 'Assistant IA', routes: ['/api/assistant/chat', '/api/assistant/plan'] },
  { id: 'time_off', label: 'Congés équipe', routes: ['/api/time-off'] },
];

export function getDeployCapabilities() {
  return CAPABILITIES.map(c => ({
    id: c.id,
    label: c.label,
    routes: c.routes,
    minVersion: '0.1.0',
  }));
}

async function tableExists(name) {
  const { rows } = await pool.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1`,
    [name]
  );
  return rows.length > 0;
}

export async function getLocalDiagnostics() {
  const version = getVersionInfo();
  const tables = {
    email_threads: await tableExists('email_threads'),
    email_messages: await tableExists('email_messages'),
    supplier_invoice_emails: await tableExists('supplier_invoice_emails'),
    receipt_scans: await tableExists('receipt_scans'),
    integration_tokens: await tableExists('integration_tokens'),
  };

  let counts = {};
  try {
    const { rows } = await pool.query(`
      SELECT
        (SELECT COUNT(*)::int FROM clients) AS clients,
        (SELECT COUNT(*)::int FROM projects) AS projects,
        (SELECT COUNT(*)::int FROM email_threads) AS email_threads
    `);
    counts = rows[0] || {};
  } catch {
    const { rows } = await pool.query(`
      SELECT
        (SELECT COUNT(*)::int FROM clients) AS clients,
        (SELECT COUNT(*)::int FROM projects) AS projects
    `);
    counts = rows[0] || {};
  }

  return {
    environment: version.environment,
    version: version.version,
    commit: version.commit,
    builtAt: version.builtAt,
    capabilities: getDeployCapabilities(),
    tables,
    counts: counts || {},
    ready: tables.email_threads && tables.supplier_invoice_emails,
  };
}

/** Sonde une API distante via /health (public) */
export async function probeRemoteHealth(remoteBaseUrl) {
  const base = String(remoteBaseUrl || '').replace(/\/$/, '').replace(/\/api\/?$/, '');
  if (!base) throw new Error('URL VPS requise');

  const url = `${base}/health`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);

  try {
    const res = await fetch(url, { signal: controller.signal });
    const text = await res.text();
    let data = {};
    try { data = JSON.parse(text); } catch { /* ignore */ }

    if (!res.ok) {
      return { ok: false, url, status: res.status, error: data.error || text.slice(0, 200) };
    }

    const remoteCaps = new Set((data.capabilities || []).map(c => c.id || c));
    const missing = CAPABILITIES
      .filter(c => !remoteCaps.has(c.id) && c.id !== 'email_threads')
      .map(c => ({ id: c.id, label: c.label, reason: 'Absente du VPS — redéployer le backend' }));

    if (!remoteCaps.has('gmail_threads') && !remoteCaps.has('email_threads')) {
      const mail = CAPABILITIES.find(c => c.id === 'gmail_threads');
      if (mail && !missing.some(m => m.id === 'gmail_threads')) {
        missing.unshift({
          id: 'gmail_threads',
          label: mail.label,
          reason: 'Cause probable des erreurs 404 sur Courriel — backend VPS obsolète',
        });
      }
    }

    return {
      ok: true,
      url,
      status: res.status,
      health: data,
      version: data.version,
      commit: data.commit,
      builtAt: data.builtAt,
      remoteCapabilities: data.capabilities || [],
      missing,
      mailOk: remoteCaps.has('gmail_threads') || remoteCaps.has('email_threads'),
    };
  } catch (err) {
    return {
      ok: false,
      url,
      error: err.name === 'AbortError' ? 'Délai dépassé' : err.message,
    };
  } finally {
    clearTimeout(timer);
  }
}

export function buildVpsInstructions({ version, commit, vpsPath = '/opt/neya-erp', vpsHost = 'VOTRE_VPS' }) {
  return {
    summary: `Déployer NEYA ERP v${version} (${commit}) sur le VPS`,
    steps: [
      `1. Copier neya-erp-deploy.zip et migration-export.sql sur le VPS (${vpsHost}:${vpsPath}/)`,
      `2. ssh ubuntu@${vpsHost}`,
      `3. cd ${vpsPath} && unzip -o neya-erp-deploy.zip`,
      `4. docker compose -f docker-compose.prod.yml --env-file .env.production build --pull backend frontend`,
      `5. docker compose -f docker-compose.prod.yml --env-file .env.production up -d`,
      `6. (Optionnel données) cat migration-export.sql | docker compose -f docker-compose.prod.yml --env-file .env.production exec -T db psql -U neya -d neya_db`,
      `7. Vérifier : curl -s https://erp.neyafurniture.ca/health | head`,
      `8. Rollback urgence : ssh ubuntu@${vpsHost || '51.222.31.75'} back.sh`,
    ],
    oneLiner: `cd ${vpsPath} && unzip -o neya-erp-deploy.zip && FORCE=1 ./deploy/deploy.sh`,
    powershellLocal: '.\\deploy\\pack-for-vps.ps1',
    powershellMigrate: '.\\deploy\\vps-migrate-local.ps1',
  };
}

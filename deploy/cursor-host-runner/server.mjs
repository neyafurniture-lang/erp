#!/usr/bin/env node
/**
 * Runner Cursor Agent sur l'hôte VPS (Ubuntu), pas dans le conteneur Docker.
 * Écoute un socket Unix monté dans le backend ERP.
 */
import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CWD = process.env.CURSOR_AGENT_CWD || '/opt/neya-erp';
const SOCKET =
  process.env.CURSOR_HOST_SOCKET ||
  path.join(CWD, 'deploy', 'run', 'cursor-agent.sock');
const TOKEN = process.env.CURSOR_HOST_TOKEN || '';

function hostInfo() {
  return {
    ok: true,
    mode: 'vps-host',
    hostname: os.hostname(),
    platform: `${os.type()} ${os.release()}`,
    arch: os.arch(),
    cwd: CWD,
    node: process.version,
    user: os.userInfo().username,
    containerized: Boolean(fs.existsSync('/.dockerenv')),
    cursor_agent_env: process.env.CURSOR_AGENT || null,
  };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(new Error('JSON invalide'));
      }
    });
    req.on('error', reject);
  });
}

function send(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function authorized(req) {
  if (!TOKEN) return true;
  return req.headers['x-cursor-host-token'] === TOKEN;
}

async function loadSdk() {
  try {
    return await import('@cursor/sdk');
  } catch {
    throw new Error('@cursor/sdk manquant — lancez npm install dans deploy/cursor-host-runner');
  }
}

async function runAgent({ prompt, apiKey, model }) {
  if (!apiKey) throw new Error('apiKey requise');
  if (!prompt) throw new Error('prompt requis');
  if (!fs.existsSync(CWD)) throw new Error(`CWD introuvable: ${CWD}`);

  const sdk = await loadSdk();
  const { Agent, JsonlLocalAgentStore, Cursor } = sdk;
  const storeRoot = path.join(CWD, '.cursor-agent-store');
  fs.mkdirSync(storeRoot, { recursive: true });
  const store = new JsonlLocalAgentStore(storeRoot);
  if (Cursor?.configure) {
    Cursor.configure({ local: { store } });
  }

  const result = await Agent.prompt(String(prompt), {
    apiKey,
    model: { id: model || 'composer-2.5' },
    local: { cwd: CWD, store },
  });

  return {
    status: result.status,
    result: result.result || result.status || '',
    id: result.id || null,
    host: hostInfo(),
  };
}

const server = http.createServer(async (req, res) => {
  try {
    if (!authorized(req)) {
      return send(res, 401, { error: 'Non autorisé' });
    }

    const url = new URL(req.url || '/', 'http://cursor-host.local');

    if (req.method === 'GET' && (url.pathname === '/health' || url.pathname === '/info')) {
      return send(res, 200, hostInfo());
    }

    if (req.method === 'POST' && url.pathname === '/run') {
      const body = await readBody(req);
      const out = await runAgent(body);
      return send(res, 200, out);
    }

    return send(res, 404, { error: 'Not found' });
  } catch (err) {
    return send(res, 500, { error: err.message || String(err) });
  }
});

fs.mkdirSync(path.dirname(SOCKET), { recursive: true });
try {
  if (fs.existsSync(SOCKET)) fs.unlinkSync(SOCKET);
} catch {
  /* ignore */
}

server.listen(SOCKET, () => {
  try {
    fs.chmodSync(SOCKET, 0o666);
  } catch {
    /* ignore */
  }
  const info = hostInfo();
  console.log(
    `[neya-cursor-host] prêt sur ${SOCKET} · ${info.hostname} · ${info.platform} · cwd=${info.cwd}`
  );
});

process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));

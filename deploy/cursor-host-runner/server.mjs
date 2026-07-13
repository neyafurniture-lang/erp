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
const STORE_ROOT =
  process.env.CURSOR_AGENT_STORE ||
  path.join(os.homedir(), '.neya-cursor-agent-store');
const EVENTS_FILE = path.join(STORE_ROOT, 'run_events.ndjson');

/** Un seul agent à la fois — évite 3 runs parallèles qui bloquent le VPS. */
let runBusy = false;

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

function formatEventRecord(rec) {
  const msg = rec?.payload?.message;
  if (!msg?.type) return null;
  const at = rec.createdAt || new Date().toISOString();
  switch (msg.type) {
    case 'thinking':
      return { at, kind: 'thinking', text: String(msg.text || '').trim() };
    case 'tool_call':
      return {
        at,
        kind: 'tool',
        name: msg.name || 'outil',
        status: msg.status || 'running',
      };
    case 'assistant': {
      const text = (msg.message?.content || [])
        .filter((c) => c.type === 'text')
        .map((c) => c.text)
        .join('\n')
        .trim();
      return text ? { at, kind: 'assistant', text } : null;
    }
    case 'status':
      return { at, kind: 'status', text: msg.message || msg.status || 'status' };
    case 'task':
      return msg.text ? { at, kind: 'task', text: msg.text } : null;
    default:
      return null;
  }
}

function tailRunEvents(afterLine = 0) {
  if (!fs.existsSync(EVENTS_FILE)) {
    return { cursor: 0, items: [] };
  }
  const lines = fs.readFileSync(EVENTS_FILE, 'utf8').split('\n').filter(Boolean);
  const items = [];
  for (const line of lines.slice(Math.max(0, afterLine))) {
    try {
      const item = formatEventRecord(JSON.parse(line));
      if (item) items.push(item);
    } catch {
      /* ignore malformed line */
    }
  }
  return { cursor: lines.length, items };
}

async function runAgent({ prompt, apiKey, model }) {
  if (!apiKey) throw new Error('apiKey requise');
  if (!prompt) throw new Error('prompt requis');
  if (!fs.existsSync(CWD)) throw new Error(`CWD introuvable: ${CWD}`);
  if (runBusy) {
    throw new Error('Un agent Cursor est déjà en cours sur le VPS — attendez la fin du run actuel.');
  }

  runBusy = true;

  try {
    const sdk = await loadSdk();
    const { Agent, JsonlLocalAgentStore, Cursor } = sdk;
    fs.mkdirSync(STORE_ROOT, { recursive: true });
    const store = new JsonlLocalAgentStore(STORE_ROOT);
    if (Cursor?.configure) {
      Cursor.configure({ local: { store } });
    }

    const agent = await Agent.create({
      apiKey,
      model: { id: model || 'composer-2.5' },
      local: { cwd: CWD, store },
    });

    try {
      const run = await agent.send(String(prompt));
      const result = await run.wait();
      return {
        status: result.status,
        result: result.result || result.status || '',
        id: result.id || run.id || null,
        host: hostInfo(),
      };
    } finally {
      agent.close();
    }
  } finally {
    runBusy = false;
  }
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

    if (req.method === 'GET' && url.pathname === '/status') {
      return send(res, 200, { busy: runBusy, ...hostInfo() });
    }

    if (req.method === 'GET' && url.pathname === '/events/tail') {
      const after = Math.max(0, Number(url.searchParams.get('after') || 0) || 0);
      return send(res, 200, tailRunEvents(after));
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

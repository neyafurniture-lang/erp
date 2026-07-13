#!/usr/bin/env node
/**
 * NEYA ERP — Serveur MCP (stdio)
 * Expose projets, admin, achats, factures fournisseurs, assistant.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { neyaFetch, getApiUrl } from './api.js';

const TOOLS = [
  {
    name: 'neya_health',
    description: 'Vérifie que l\'API NEYA ERP répond',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'neya_dashboard',
    description: 'Résumé dashboard : projets actifs, alertes, finances, tâches',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'neya_list_projects',
    description: 'Liste les projets ERP (option: status active|paused|done)',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', description: 'Filtre statut' },
      },
    },
  },
  {
    name: 'neya_get_project',
    description: 'Détail d\'un projet par ID',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'number', description: 'ID projet' } },
      required: ['id'],
    },
  },
  {
    name: 'neya_list_admin_tasks',
    description: 'Tâches gestion admin (marchés, factures, site, priorités P1/P2/P3)',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['todo', 'doing', 'done'] },
        category: { type: 'string' },
      },
    },
  },
  {
    name: 'neya_update_admin_task',
    description: 'Met à jour une tâche admin (statut, titre, notes)',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number' },
        status: { type: 'string', enum: ['todo', 'doing', 'done'] },
        title: { type: 'string' },
        notes: { type: 'string' },
      },
      required: ['id'],
    },
  },
  {
    name: 'neya_list_purchase_needs',
    description: 'Consommables manquants atelier à acheter',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['needed', 'ordered', 'received'] },
      },
    },
  },
  {
    name: 'neya_list_supplier_invoices_pending',
    description: 'Factures fournisseurs (Home Depot, etc.) en attente de classement projet',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'neya_assign_supplier_invoice',
    description: 'Classe une facture fournisseur vers un projet (+ règle mémorisée)',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'ID supplier_invoice_emails' },
        project_id: { type: 'number' },
        amount: { type: 'number', description: 'Montant dépense optionnel' },
        remember_rule: { type: 'boolean', description: 'Mémoriser mot-clé → projet' },
        keyword_pattern: { type: 'string', description: 'ex. cedre, sauna' },
      },
      required: ['id', 'project_id'],
    },
  },
  {
    name: 'neya_list_clients',
    description: 'Liste des clients',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'neya_list_expenses',
    description: 'Dépenses récentes',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'number' },
      },
    },
  },
  {
    name: 'neya_assistant_message',
    description: 'Envoie un message à l\'assistant IA intégré NEYA (skills + contexte ERP)',
    inputSchema: {
      type: 'object',
      properties: {
        message: { type: 'string' },
        project_id: { type: 'number' },
      },
      required: ['message'],
    },
  },
  {
    name: 'neya_scan_gmail_invoices',
    description: 'Scanne Gmail pour nouvelles factures fournisseurs à classer',
    inputSchema: { type: 'object', properties: {} },
  },
];

function textResult(data) {
  return {
    content: [{ type: 'text', text: typeof data === 'string' ? data : JSON.stringify(data, null, 2) }],
  };
}

async function handleTool(name, args) {
  switch (name) {
    case 'neya_health': {
      const base = getApiUrl().replace(/\/api$/, '');
      const res = await fetch(`${base}/health`);
      const data = await res.json();
      return textResult({ ok: res.ok, ...data, api: getApiUrl() });
    }
    case 'neya_dashboard':
      return textResult(await neyaFetch('/dashboard'));
    case 'neya_list_projects': {
      const q = args.status ? `?status=${encodeURIComponent(args.status)}` : '';
      return textResult(await neyaFetch(`/projects${q}`));
    }
    case 'neya_get_project':
      return textResult(await neyaFetch(`/projects/${args.id}`));
    case 'neya_list_admin_tasks': {
      const params = new URLSearchParams();
      if (args.status) params.set('status', args.status);
      if (args.category) params.set('category', args.category);
      const q = params.toString() ? `?${params}` : '';
      return textResult(await neyaFetch(`/admin-tasks${q}`));
    }
    case 'neya_update_admin_task': {
      const { id, ...body } = args;
      return textResult(await neyaFetch(`/admin-tasks/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }));
    }
    case 'neya_list_purchase_needs': {
      const q = args.status ? `?status=${args.status}` : '';
      return textResult(await neyaFetch(`/purchases/needs${q}`));
    }
    case 'neya_list_supplier_invoices_pending':
      return textResult(await neyaFetch('/supplier-invoices/pending'));
    case 'neya_assign_supplier_invoice':
      return textResult(await neyaFetch(`/supplier-invoices/${args.id}/assign`, {
        method: 'POST',
        body: JSON.stringify(args),
      }));
    case 'neya_list_clients':
      return textResult(await neyaFetch('/clients'));
    case 'neya_list_expenses': {
      const q = args.project_id ? `?project_id=${args.project_id}` : '';
      return textResult(await neyaFetch(`/expenses${q}`));
    }
    case 'neya_assistant_message': {
      const { login: getToken, getApiUrl: apiUrl } = await import('./api.js');
      const form = new FormData();
      form.append('message', args.message);
      if (args.project_id) {
        form.append('context', JSON.stringify({ projectId: args.project_id }));
      }
      const token = await getToken();
      const res = await fetch(`${apiUrl()}/assistant/chat`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Assistant (${res.status})`);
      return textResult(data);
    }
    case 'neya_scan_gmail_invoices':
      return textResult(await neyaFetch('/supplier-invoices/scan', { method: 'POST' }));
    default:
      throw new Error(`Outil inconnu: ${name}`);
  }
}

const server = new Server(
  { name: 'neya-erp', version: '1.0.0' },
  { capabilities: { tools: {}, resources: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  try {
    return await handleTool(req.params.name, req.params.arguments || {});
  } catch (err) {
    return {
      content: [{ type: 'text', text: `Erreur: ${err.message}` }],
      isError: true,
    };
  }
});

server.setRequestHandler(ListResourcesRequestSchema, async () => ({
  resources: [
    {
      uri: 'neya://roadmap',
      name: 'Roadmap ERP',
      description: 'Phases et backlog NEYA (cahier des charges)',
      mimeType: 'text/markdown',
    },
  ],
}));

server.setRequestHandler(ReadResourceRequestSchema, async (req) => {
  if (req.params.uri === 'neya://roadmap') {
    const { readFile } = await import('fs/promises');
    const { fileURLToPath } = await import('url');
    const { dirname, join } = await import('path');
    const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
    const md = await readFile(join(root, 'docs/CAHIER_DES_CHARGES.md'), 'utf8').catch(() => 'Cahier des charges introuvable');
    return { contents: [{ uri: req.params.uri, mimeType: 'text/markdown', text: md }] };
  }
  throw new Error(`Ressource inconnue: ${req.params.uri}`);
});

const transport = new StdioServerTransport();
await server.connect(transport);

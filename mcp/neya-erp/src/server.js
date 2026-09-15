/**
 * Serveur MCP NEYA ERP — outils alignés sur le protocole Lia
 * (voir GET /api/assistant/protocol → channel.mcp).
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { erpFetch, erpBaseUrl } from './client.js';

function asText(payload) {
  const text = typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2);
  return { content: [{ type: 'text', text }] };
}

function asError(err) {
  const detail = err?.data ? `\n${JSON.stringify(err.data, null, 2)}` : '';
  return {
    content: [{ type: 'text', text: `Erreur ERP : ${err.message || err}${detail}` }],
    isError: true,
  };
}

export function createNeyaMcpServer() {
  const server = new McpServer({
    name: 'neya-erp',
    version: '1.0.0',
  });

  server.resource(
    'protocol',
    'neya://assistant/protocol',
    {
      description: 'Protocole Lia : catalogue actions, skills, schéma de réponse',
      mimeType: 'application/json',
    },
    async () => {
      const protocol = await erpFetch('/assistant/protocol');
      return {
        contents: [
          {
            uri: 'neya://assistant/protocol',
            mimeType: 'application/json',
            text: JSON.stringify(protocol, null, 2),
          },
        ],
      };
    }
  );

  server.tool(
    'neya_list_skills',
    'Liste les skills Lia activées + résumé du protocole (actions disponibles).',
    {},
    async () => {
      try {
        const [skills, protocol] = await Promise.all([
          erpFetch('/assistant/skills'),
          erpFetch('/assistant/protocol'),
        ]);
        return asText({
          erp: erpBaseUrl(),
          skills,
          actions: (protocol.actions || []).map((a) => ({
            type: a.type,
            usage: a.usage,
            params: a.params,
          })),
          max_action_steps: protocol.max_action_steps,
        });
      } catch (err) {
        return asError(err);
      }
    }
  );

  server.tool(
    'neya_run_action',
    'Exécute une action ERP Lia (create_client, search_emails, list_projects, etc.) et renvoie un ACTION_CHECK. Voir neya_list_skills / ressource neya://assistant/protocol pour le catalogue.',
    {
      type: z.string().describe('Type d’action (ex. create_client, list_projects, search_emails)'),
      params: z
        .record(z.any())
        .optional()
        .describe('Paramètres de l’action (objet JSON)'),
      message: z.string().optional().describe('Contexte utilisateur optionnel'),
      reinterpret: z
        .boolean()
        .optional()
        .describe('Si true, Lia enchaîne d’autres actions après le CHECK'),
    },
    async ({ type, params, message, reinterpret }) => {
      try {
        const result = await erpFetch('/assistant/action', {
          method: 'POST',
          body: {
            type,
            params: params || {},
            message: message || '',
            reinterpret: Boolean(reinterpret),
          },
        });
        return asText(result);
      } catch (err) {
        return asError(err);
      }
    }
  );

  server.tool(
    'neya_continue_from_check',
    'Après un ACTION_CHECK : Lia réinterprète et peut enchaîner (auto_execute par défaut).',
    {
      message: z.string().optional().describe('Message utilisateur d’origine'),
      check: z
        .record(z.any())
        .optional()
        .describe('Un seul ACTION_CHECK'),
      checks: z
        .array(z.record(z.any()))
        .optional()
        .describe('Liste d’ACTION_CHECK'),
      auto_execute: z
        .boolean()
        .optional()
        .describe('Exécuter la suite si Lia propose une action (défaut true)'),
    },
    async ({ message, check, checks, auto_execute }) => {
      try {
        const result = await erpFetch('/assistant/continue', {
          method: 'POST',
          body: {
            message: message || '',
            check,
            checks,
            auto_execute: auto_execute !== false,
          },
        });
        return asText(result);
      } catch (err) {
        return asError(err);
      }
    }
  );

  server.tool(
    'neya_assistant_message',
    'Envoie un message à Lia (boucle complète chat ERP : actions + réponses). Préférer pour une demande métier libre.',
    {
      message: z.string().describe('Message utilisateur en français'),
      context: z
        .record(z.any())
        .optional()
        .describe('Contexte page optionnel (route, project_id, client_id…)'),
    },
    async ({ message, context }) => {
      try {
        // multipart non requis pour texte seul — JSON via FormData-like fallback
        // L’endpoint accepte multipart ; on envoie du JSON si le backend le parse,
        // sinon FormData text fields.
        const form = new FormData();
        form.append('message', message);
        if (context) form.append('context', JSON.stringify(context));

        const token = await (await import('./client.js')).getToken();
        const base = erpBaseUrl().replace(/\/$/, '');
        const url = `${base.endsWith('/api') ? base : `${base}/api`}/assistant/chat`;
        const res = await fetch(url, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
          body: form,
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          return asError(new Error(data.error || `chat ${res.status}`));
        }
        return asText(data);
      } catch (err) {
        return asError(err);
      }
    }
  );

  server.tool(
    'neya_erp_health',
    'Vérifie que l’ERP répond (commit / version) — utile après « Mettre à jour la prod ».',
    {},
    async () => {
      try {
        const base = erpBaseUrl().replace(/\/$/, '');
        const res = await fetch(`${base}/health`, { headers: { Accept: 'application/json' } });
        const data = await res.json().catch(() => ({}));
        return asText({ ok: res.ok, status: res.status, ...data, erp: base });
      } catch (err) {
        return asError(err);
      }
    }
  );

  return server;
}

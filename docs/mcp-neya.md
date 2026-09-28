# MCP NEYA ERP — brancher Cursor sur l’atelier

Le package `mcp/neya-erp` expose Lia (assistant ERP) en outils MCP.

## Pourquoi

Le backend documente déjà un canal MCP dans `GET /api/assistant/protocol` :

- `neya_list_skills`
- `neya_run_action`
- `neya_continue_from_check`
- `neya_assistant_message`
- ressource `neya://assistant/protocol`

Ce dépôt fournit le **processus stdio** que Cursor lance.

## Activation Cursor

1. `cd mcp/neya-erp && npm install`
2. Ouvrir **Cursor Settings → MCP** et vérifier le serveur `neya-erp`
3. Renseigner l’env (dans `.cursor/mcp.json` ou secrets Cursor) :

| Variable | Description |
|----------|-------------|
| `NEYA_ERP_URL` | Défaut `https://erp.neyafurniture.ca` |
| `NEYA_ERP_EMAIL` + `NEYA_ERP_PASSWORD` | Login |
| `NEYA_ERP_TOKEN` | JWT (prioritaire si présent) |

4. Redémarrer le serveur MCP / Cursor

## Usage typique

- « Via MCP, cherche le mail Olive Richardson »
  → `neya_run_action` type `search_emails`
- « Crée un client … »
  → `neya_run_action` type `create_client`
- Demande libre
  → `neya_assistant_message`

Après chaque action, Lia renvoie un `ACTION_CHECK` ; enchaîner avec `neya_continue_from_check` si besoin.

## Fichiers

- `mcp/neya-erp/src/index.js` — entrée stdio
- `mcp/neya-erp/src/server.js` — tools / resource
- `mcp/neya-erp/src/client.js` — HTTP + auth
- `.cursor/mcp.json` — config Cursor du repo

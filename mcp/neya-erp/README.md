# MCP NEYA ERP

Serveur **Model Context Protocol** pour brancher Cursor (ou Claude) sur l’ERP NEYA via Lia.

## Outils

| Outil | Rôle |
|--------|------|
| `neya_list_skills` | Skills + catalogue d’actions |
| `neya_run_action` | Exécute une action (`create_client`, `search_emails`, …) → `ACTION_CHECK` |
| `neya_continue_from_check` | Suite après un CHECK |
| `neya_assistant_message` | Message libre à Lia (boucle chat complète) |
| `neya_erp_health` | `/health` (commit déployé) |

Ressource : `neya://assistant/protocol`

## Config Cursor

Fichier projet déjà fourni : `.cursor/mcp.json`.

Variables d’environnement (Cursor → MCP → env) :

```bash
NEYA_ERP_URL=https://erp.neyafurniture.ca
NEYA_ERP_EMAIL=admin@neya.local
NEYA_ERP_PASSWORD=…
# ou :
# NEYA_ERP_TOKEN=<jwt>
```

## Install local

```bash
cd mcp/neya-erp && npm install
node src/index.js   # attend du JSON-RPC sur stdin
```

## Exemple

Demander à l’agent Cursor : « liste les projets actifs via neya_run_action ».

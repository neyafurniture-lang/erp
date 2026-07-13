# NEYA ERP — Serveur MCP

Expose l'API NEYA aux assistants IA (Cursor, Claude Desktop, etc.) via le [Model Context Protocol](https://modelcontextprotocol.io).

## Installation

```bash
cd mcp/neya-erp
npm install
```

Le backend NEYA doit tourner (`cd backend && npm run dev`).

## Configuration Cursor

Le fichier `.cursor/mcp.json` à la racine du projet est déjà configuré.

Variables d'environnement :

| Variable | Description |
|----------|-------------|
| `NEYA_API_URL` | URL API (défaut `http://localhost:4001/api`) |
| `NEYA_TOKEN` | JWT (optionnel, évite login) |
| `NEYA_EMAIL` | Email admin si pas de token |
| `NEYA_PASSWORD` | Mot de passe |

Redémarrez Cursor ou rechargez les serveurs MCP après modification.

## Outils disponibles

| Outil | Description |
|-------|-------------|
| `neya_health` | Santé API |
| `neya_dashboard` | Résumé dashboard |
| `neya_list_projects` | Projets |
| `neya_get_project` | Détail projet |
| `neya_list_admin_tasks` | Tâches admin / priorités |
| `neya_update_admin_task` | Cocher / modifier tâche |
| `neya_list_purchase_needs` | Achats atelier |
| `neya_list_supplier_invoices_pending` | Factures fournisseur à classer |
| `neya_assign_supplier_invoice` | Classer facture → projet |
| `neya_list_clients` | Clients |
| `neya_list_expenses` | Dépenses |
| `neya_assistant_message` | Assistant IA NEYA |
| `neya_scan_gmail_invoices` | Scan Gmail factures |

## Ressource

- `neya://roadmap` — contenu du cahier des charges

## Test manuel

```bash
NEYA_EMAIL=admin@neya.local NEYA_PASSWORD=neya2024 node mcp/neya-erp/src/index.js
```

(Mode stdio — utilisé automatiquement par Cursor.)

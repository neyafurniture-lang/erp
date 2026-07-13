---
name: neya-erp-manual
description: >-
  Guide NEYA ERP — modules, subtilités, dépannage, liens /manual. À appliquer
  lors de l'onboarding, création de features, questions « comment faire »,
  ou débogage Gmail/VPS/assistant.
---

# Manuel NEYA ERP

Source de vérité : `backend/src/content/erp-manual.js` (API `GET /api/manual`, page `/manual`).

## Quand utiliser ce skill

- L'utilisateur demande comment faire fonctionner l'ERP
- Création d'une nouvelle feature → documenter dans `erp-manual.js` + section `/manual`
- Débogage courriel (404, OAuth), déploiement VPS, scan factures, assistant vocal
- Création d'une skill assistant → inclure `action_config.instruction` claire

## Skill assistant `erp_manual`

Déjà seedé au démarrage (`seedDefaultSkills`). Déclencheurs : « manuel », « aide erp », « comment faire », etc.
Action : `erp_manual` → réponse contextuelle + navigation `/manual#section`.

Instruction IA injectée dans chaque chat via `getManualPromptBlock()` (`ai-chat.js`).

## Modules et chemins

| Module | Route | Subtilités |
|--------|-------|------------|
| Dashboard | `/` | Assistant orbe, mode édition layout |
| Production | `/production` | Catalogue vs sur mesure |
| Projets | `/projects` | Tâches, client, budget |
| Courriel | `/mail` | OAuth Google, Analyser (20), scan factures |
| Drive | `/drive` | Permissions par utilisateur |
| Dépenses | `/expenses` | Scan ticket IA |
| Paramètres | `/settings` | IA, intégrations, deploy VPS |
| Manuel | `/manual` | Ce guide utilisateur |

## Déploiement & rollback

- Local OK → Paramètres → Déploiement VPS → package ZIP
- VPS : `deploy/vps-sync-local.ps1` (garde `.env.production`)
- Urgence : `ssh ubuntu@51.222.31.75 back.sh` ou `deploy/vps-back.ps1`

## Mise à jour du manuel

1. Éditer `ERP_MANUAL_SECTIONS` dans `backend/src/content/erp-manual.js`
2. Ajuster `ERP_MANUAL_SKILL_INSTRUCTION` si le comportement assistant change
3. Redémarrer le backend (re-seed `erp_manual` via upsert au boot)

Ne pas dupliquer le contenu long ailleurs — la page frontend charge l'API `/manual`.

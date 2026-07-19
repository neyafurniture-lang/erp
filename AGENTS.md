# NEYA ERP — notes agents

## Cursor Cloud specific instructions

- **Design reference :** https://github.com/neyafurniture-lang/neya-craft-flow (public) + preview https://neya-craft-flow.lovable.app — tokens/shell déjà portés dans `frontend/` (voir `docs/design-craft-flow.md`).
- **Ne pas** démarrer les services dans le script d’update : seulement `npm install` frontend + backend.
- Frontend : `cd frontend && npm run dev` · Backend : `cd backend && npm run dev` (ou scripts documentés dans le README / docker-compose).
- Auth locale typique : `admin@neya.local` / voir secrets ou seed DB.
- **Finance P&L** : page `/finance` · API `GET /analytics/monthly-pnl?year=YYYY&me=Mehdi` — agrège factures (créées), dépenses (date), paiements, carnet d’heures projets (`meta.hours_logbook`) + `time_entries` × taux employés. Accès : permission `finance` **ou** `invoices`/`expenses`.
- **Photos Standards** : bouton « Photos depuis le site » sur `/standards` (et par fiche). Sans clés Woo REST, utilise le Store API public `neyafurniture.ca` ; match SKU/slug/nom → `/uploads/web/` + galerie sur la fiche.
- Porter les écrans Craft Flow **un par un** en gardant les APIs Express existantes (pas de remplacement TanStack Start).
- **Lia / tâches admin** : le badge projet ouvert dans le chat est un *hint* atelier seulement. `create_task` avec admin / transfert / paiement / « sans projet » → `project_id: null` (ne pas forcer le projet page). Correction « pas en rapport avec le projet » → skill `unlink_task` (avant le LLM). Voir `backend/src/services/skill-actions.js`.

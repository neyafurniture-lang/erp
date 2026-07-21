# NEYA ERP — notes agents

## Cursor Cloud specific instructions

- **Design reference :** https://github.com/neyafurniture-lang/neya-craft-flow (public) + preview https://neya-craft-flow.lovable.app — tokens/shell déjà portés dans `frontend/` (voir `docs/design-craft-flow.md`).
- **Ne pas** démarrer les services dans le script d’update : seulement `npm install` frontend + backend.
- Frontend : `cd frontend && npm run dev` · Backend : `cd backend && npm run dev` (ou scripts documentés dans le README / docker-compose).
- Auth locale typique : `admin@neya.local` / voir secrets ou seed DB.
- **Finance P&L** : page `/finance` (code PIN requis — gestionnaire total) · API `GET /analytics/monthly-pnl?year=YYYY&me=Mehdi` — agrège factures (créées), dépenses (date), paiements, carnet d’heures projets (`meta.hours_logbook`) + `time_entries` × taux employés. Accès : permission `finance` **ou** `invoices`/`expenses`, puis code (`POST /analytics/unlock`). Les **tâches admin** (`/admin`) n’ont **pas** de code.
- **Photos Standards** : bouton « Photos depuis le site » sur `/standards` (et par fiche). Sans clés Woo REST, utilise le Store API public `neyafurniture.ca` ; match SKU/slug/nom → `/uploads/web/` + galerie sur la fiche.
- Porter les écrans Craft Flow **un par un** en gardant les APIs Express existantes (pas de remplacement TanStack Start).
- **Lia / tâches admin** : le badge projet ouvert est un *hint* checklist atelier. Admin / transfert / paiement → `project_id: null` **mais** `client_id` + `related_project_id` conservés (historique client/projet). Correction « pas en rapport » → `unlink_task` (retire la checklist, garde le soft-contexte). Le snapshot ERP + historique projets du client restent injectés dans le prompt. Voir `skill-actions.js` / `enrichPageContext`.
- **Finir les brouillons Git** : prompt agent dans `docs/PROMPT-AGENT-FINIR-BROUILLONS.txt` — à coller dans une Automation Cursor pour `gh pr ready` + squash-merge des drafts vers `main` (fermer les obsolètes, rebase si conflits).

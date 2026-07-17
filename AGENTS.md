# NEYA ERP — notes agents

## Cursor Cloud specific instructions

- **Design reference :** https://github.com/neyafurniture-lang/neya-craft-flow (public) + preview https://neya-craft-flow.lovable.app — tokens/shell déjà portés dans `frontend/` (voir `docs/design-craft-flow.md`).
- **Ne pas** démarrer les services dans le script d’update : seulement `npm install` frontend + backend.
- Frontend : `cd frontend && npm run dev` · Backend : `cd backend && npm run dev` (ou scripts documentés dans le README / docker-compose).
- Auth locale typique : `admin@neya.local` / voir secrets ou seed DB.
- Porter les écrans Craft Flow **un par un** en gardant les APIs Express existantes (pas de remplacement TanStack Start).
- **Deploy VPS gotcha :** si « Mettre à jour la prod » ne change pas l’UI, vérifier `/health` → `commit`. Un `git fetch` qui échoue (fichiers `.git` en `root` après un `sudo`) laisse le VPS sur l’ancien commit tout en rebuild Docker. Correctif : `sudo chown -R ubuntu:ubuntu /opt/neya-erp/.git` puis `FORCE=1 ./deploy/deploy.sh`. Voir aussi le garde-fou dans `deploy/deploy.sh`.

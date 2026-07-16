# AGENTS.md — NEYA ERP

## Cursor Cloud specific instructions

### Règle critique — base de données

- **Ne jamais modifier la base de production / VPS.** Aucun `DROP`, `TRUNCATE`, `DELETE` massif, reset admin, ni `DATABASE_URL` pointant vers le serveur distant.
- Dans cette VM Cloud Agent, la DB est **locale et vide** (`postgresql://neya:neya@localhost:5432/neya_db`). Une UI sans projets/clients ici **ne signifie pas** que les données du VPS ont disparu.
- Pour démontrer l’app : **login + navigation en lecture seule**. Éviter de créer/supprimer des clients, projets, factures, etc., sauf si l’utilisateur le demande explicitement.
- `npm run db:init` / `initDb()` au boot sont **additifs** (`CREATE IF NOT EXISTS`) sur la DB locale vide — ne pas les lancer contre la prod.

### Services locaux (dev)

| Service | Commande | URL |
|---------|----------|-----|
| PostgreSQL 16 | `sudo pg_ctlcluster 16 main start` | `localhost:5432` |
| Backend API | `cd backend && npm run dev` | http://localhost:4001 |
| Frontend Next | `cd frontend && npm run dev` | http://localhost:3000 |

- Env : `backend/.env` et `frontend/.env.local` (copier depuis les `.env.example` si absents). Ports : API **4001**, front **3000** (pas 4000 en local).
- Login seed local : `admin@neya.local` / `neya2024` (uniquement sur la DB locale de cette VM).
- Health check : `GET http://localhost:4001/health`
- Pas de suite de lint/tests automatisés dédiée dans les `package.json` ; smoke = health + login + pages Next.
- Prod / VPS : voir `README.md` et `deploy/README.md` — ne pas y déployer ni y écrire depuis un setup Cloud Agent.

### Postgres local (si le cluster n’est pas up)

```bash
sudo pg_ctlcluster 16 main start
# User/DB déjà créés une fois : neya / neya_db
```

# Déploiement Git → VPS

Mise à jour du serveur à partir d’un dépôt Git (GitHub, GitLab, etc.) avec **vérification de version** et **procédure automatique**.

## Architecture

```
PC dev                    GitHub/GitLab              VPS
  │                            │                      │
  ├── git push main ──────────►│                      │
  │                            ├── webhook / Actions ─► deploy.sh
  │                            │                      ├── git pull
  │                            │                      ├── docker build
  │                            │                      └── healthcheck
```

## 1. Créer le dépôt Git en ligne

Sur **GitHub** (recommandé) ou GitLab :

```bash
cd neya_erp_mvp
git init
git add .
git commit -m "Initial commit NEYA ERP"
git branch -M main
git remote add origin git@github.com:VOTRE_ORG/neya-erp.git
git push -u origin main
```

Le fichier `VERSION` à la racine suit la version sémantique (`0.1.0`). Incrémentez-le à chaque release notable.

## 2. Premier déploiement sur le VPS

```bash
# Sur le serveur (Ubuntu)
sudo bash deploy/install-server.sh git@github.com:VOTRE_ORG/neya-erp.git

cd /opt/neya-erp
nano .env.production   # secrets, domaine, OAuth Google
./deploy/deploy.sh
```

## 3. Mise à jour manuelle

```bash
cd /opt/neya-erp
./deploy/check-update.sh    # vérifie si origin/main est en avance
./deploy/deploy.sh          # pull + build + redémarrage
```

Forcer un rebuild sans nouveau commit :

```bash
FORCE=1 ./deploy/deploy.sh
```

## 4. Mise à jour automatique (GitHub Actions)

Dans le dépôt GitHub → **Settings → Secrets** :

| Secret | Exemple |
|--------|---------|
| `DEPLOY_HOST` | `123.45.67.89` |
| `DEPLOY_USER` | `root` ou `deploy` |
| `DEPLOY_SSH_KEY` | clé privée SSH |
| `DEPLOY_PATH` | `/opt/neya-erp` |
| `DEPLOY_PORT` | `22` (optionnel) |

Chaque `git push` sur `main` exécute `.github/workflows/deploy.yml` → SSH → `deploy.sh`.

## 5. Mise à jour automatique (cron sur le VPS)

### Recommandé — tous les jours à 00:00 si idle + Git a bougé

N’installe **pas** de rebuild pendant que quelqu’un travaille dans l’ERP.

```bash
cd /opt/neya-erp
./deploy/install-auto-update.sh
```

Cela ajoute :

```
0 0 * * * cd /opt/neya-erp && /bin/bash ./deploy/auto-update-if-idle.sh >> .../cron-auto-update.log 2>&1
```

Logique (`auto-update-if-idle.sh`) :

1. `check-update.sh` → exit **10** seulement s’il y a des commits sur `origin/main`
2. Lit `deploy/.last-activity` (écrit par le backend à chaque usage API, throttle 60 s)
3. Si activité &lt; **120 min** (env `NEYA_AUTO_UPDATE_IDLE_MINUTES`) → **skip** (report au lendemain)
4. Sinon → `deploy.sh`

Vérifier manuellement :

```bash
cd /opt/neya-erp
./deploy/check-update.sh          # STATUS: up_to_date | update_available
./deploy/check-update.sh --json
./deploy/auto-update-if-idle.sh   # dry-run logique (déploie si conditions OK)
```

Désactiver : `NEYA_AUTO_UPDATE_DISABLED=1` dans l’environnement cron, ou retirer la ligne crontab.

### Ancien exemple (attention aux codes de sortie)

`check-update.sh` sort **0** si à jour et **10** si une MAJ existe. Ne pas enchaîner avec `&& deploy.sh` (ça déployait seulement quand déjà à jour).

## 6. Vérifier la version déployée

**API** (public) :

```bash
curl https://erp.neyafurniture.ca/health
```

Réponse :

```json
{
  "status": "ok",
  "service": "NEYA ERP API",
  "version": "0.1.0",
  "commit": "a1b2c3d",
  "environment": "production"
}
```

**État local serveur** : fichier `.deploy-state.json` (commit, date, log).

## 7. Ce que fait `deploy.sh`

1. `git fetch` + `git pull` si nouveau commit sur `main`
2. Lit `VERSION` + commit Git
3. **Backup Postgres** (gzip dans `deploy/backups/`)
4. `docker compose build` + `up -d`
5. Healthcheck `/health` (max ~90 s)
6. Écrit `.deploy-state.json`

## 8. DNS & HTTPS

1. Pointer `erp.neyafurniture.ca` → IP du VPS
2. Renseigner `ERP_DOMAIN` et `ACME_EMAIL` dans `.env.production`
3. Caddy obtient le certificat Let's Encrypt automatiquement

## 9. Fichiers sensibles (jamais dans Git)

- `.env.production`
- `.deploy-state.json`
- `deploy/backups/`
- clés SSH de déploiement

Déjà ignorés via `.gitignore`.

## 10. Rollback d'urgence (`back.sh`)

Après installation (`install-rollback.sh` une fois sur le VPS), commande globale :

```bash
# Sur le VPS
back.sh

# Depuis votre PC (IP du VPS : 51.222.31.75)
ssh ubuntu@51.222.31.75 back.sh

# Windows PowerShell
.\deploy\vps-back.ps1
.\deploy\vps-back.ps1 -Yes   # sans confirmation interactive
```

Le script :
1. Revient au **commit précédent** (`.deploy-state.json`)
2. Restaure le **backup Postgres** pris avant le dernier déploiement
3. Rebuild Docker + healthcheck

Installation de la commande sur le VPS (une fois) :

```bash
cd /opt/neya-erp && sudo ./deploy/install-rollback.sh
```

Rollback manuel (ancienne méthode) :

```bash
cd /opt/neya-erp
git log --oneline -5
git checkout <commit-précédent>
FORCE=1 ./deploy/deploy.sh
```

Restaurer la DB manuellement :

```bash
gunzip -c deploy/backups/neya_db_XXXXXX.sql.gz | docker compose -f docker-compose.prod.yml --env-file .env.production exec -T db psql -U neya neya_db
```

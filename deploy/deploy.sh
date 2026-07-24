#!/usr/bin/env bash
# NEYA ERP — déploiement depuis Git (pull + build Docker + healthcheck)
set -euo pipefail

REPO_DIR="${NEYA_REPO_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
BRANCH="${NEYA_DEPLOY_BRANCH:-main}"
ENV_FILE="${NEYA_ENV_FILE:-$REPO_DIR/.env.production}"
STATE_FILE="${NEYA_STATE_FILE:-$REPO_DIR/.deploy-state.json}"
COMPOSE_FILE="${NEYA_COMPOSE_FILE:-$REPO_DIR/docker-compose.prod.yml}"
LOG_DIR="${NEYA_LOG_DIR:-$REPO_DIR/deploy/logs}"
FORCE="${FORCE:-0}"
SKIP_BACKUP="${SKIP_BACKUP:-0}"

mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/deploy-$(date +%Y%m%d-%H%M%S).log"

log() { echo "[$(date -Iseconds)] $*" | tee -a "$LOG_FILE"; }

cd "$REPO_DIR"

if [[ ! -f "$ENV_FILE" ]]; then
  log "ERREUR: $ENV_FILE manquant. Copiez deploy/.env.production.example"
  exit 1
fi

if [[ ! -f "$COMPOSE_FILE" ]]; then
  log "ERREUR: $COMPOSE_FILE introuvable"
  exit 1
fi

log "=== Déploiement NEYA ERP ==="
log "Répertoire: $REPO_DIR"

LOCAL_BEFORE="manual"
REMOTE="manual"
PREVIOUS_COMMIT="manual"

if git rev-parse --git-dir >/dev/null 2>&1; then
  # Si Docker/sudo a laissé des objets root dans .git, fetch échoue silencieusement
  # côté UI (rebuild de l’ancien commit). Réparer l’ownership avant fetch.
  if [[ -d .git/objects ]] && ! [[ -w .git/objects ]]; then
    log "AVERTISSEMENT: .git/objects non inscriptible — tentative chown"
    if command -v sudo >/dev/null 2>&1 && sudo -n true 2>/dev/null; then
      sudo chown -R "$(id -u):$(id -g)" .git || true
    fi
  fi
  # Fichiers root isolés (index, packed-refs, objets) après un deploy en root
  if find .git -user root -print -quit 2>/dev/null | grep -q .; then
    log "AVERTISSEMENT: fichiers .git appartenant à root — tentative chown"
    if command -v sudo >/dev/null 2>&1 && sudo -n true 2>/dev/null; then
      sudo chown -R "$(id -u):$(id -g)" .git || true
    else
      log "ERREUR: impossible de corriger .git (sudo requis). Exécutez: sudo chown -R \$USER:\$USER /opt/neya-erp/.git"
      exit 1
    fi
  fi

  if ! git fetch origin "$BRANCH"; then
    log "ERREUR: git fetch origin $BRANCH a échoué (permissions .git ? remote ?)"
    log "Astuce VPS: sudo chown -R ubuntu:ubuntu /opt/neya-erp/.git && git fetch origin $BRANCH"
    exit 1
  fi

  LOCAL_BEFORE=$(git rev-parse HEAD)
  REMOTE=$(git rev-parse "origin/$BRANCH")

  if [[ "$LOCAL_BEFORE" == "$REMOTE" && "$FORCE" != "1" ]]; then
    log "Déjà à jour ($LOCAL_BEFORE). Utilisez FORCE=1 pour reconstruire."
    exit 0
  fi

  PREVIOUS_COMMIT="$LOCAL_BEFORE"
  if [[ -f "$STATE_FILE" ]]; then
    PREVIOUS_COMMIT=$(grep -o '"commit"[[:space:]]*:[[:space:]]*"[^"]*"' "$STATE_FILE" | head -1 | sed 's/.*"\([^"]*\)"$/\1/' || echo "$LOCAL_BEFORE")
  fi

  if [[ "$LOCAL_BEFORE" != "$REMOTE" ]]; then
    log "Mise à jour Git: $LOCAL_BEFORE → $REMOTE"
    # reset --hard = déploiement fiable (1 clic). .env.production n'est pas versionné.
    git checkout "$BRANCH" 2>/dev/null || git checkout -B "$BRANCH" "origin/$BRANCH"
    git reset --hard "origin/$BRANCH"
  else
    log "Rebuild forcé (même commit)"
  fi
else
  log "Pas de dépôt Git — déploiement direct des fichiers"
fi

VERSION=$(cat VERSION 2>/dev/null | tr -d '\r\n' || echo "0.0.0")
GIT_COMMIT=$(git rev-parse --short HEAD)
BUILT_AT=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

export APP_VERSION="$VERSION"
export GIT_COMMIT="$GIT_COMMIT"
export BUILT_AT="$BUILT_AT"

log "Version $VERSION (commit $GIT_COMMIT)"

if [[ "$SKIP_BACKUP" != "1" ]] && docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" ps db 2>/dev/null | grep -q running; then
  BACKUP_DIR="$REPO_DIR/deploy/backups"
  mkdir -p "$BACKUP_DIR"
  BACKUP_FILE="$BACKUP_DIR/neya_db_$(date +%Y%m%d_%H%M%S).sql.gz"
  log "Sauvegarde Postgres → $BACKUP_FILE"
  docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" exec -T db \
    pg_dump -U neya neya_db | gzip > "$BACKUP_FILE" || log "AVERTISSEMENT: backup échoué (premier déploiement?)"
  DB_BACKUP_REL="deploy/backups/$(basename "$BACKUP_FILE")"
else
  DB_BACKUP_REL=""
fi

log "Build images Docker..."
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" build --pull

log "Redémarrage des services..."
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d --remove-orphans

log "Attente healthcheck backend..."
HEALTH_OK=0
for i in $(seq 1 45); do
  if docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" exec -T backend \
    node -e "fetch('http://localhost:4000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null; then
    HEALTH_OK=1
    break
  fi
  sleep 2
done

if [[ "$HEALTH_OK" != "1" ]]; then
  log "ERREUR: healthcheck échoué après déploiement"
  log "Logs backend:"
  docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" logs --tail=40 backend | tee -a "$LOG_FILE"
  exit 1
fi

HEALTH_JSON=$(docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" exec -T backend \
  node -e "fetch('http://localhost:4000/health').then(r=>r.text()).then(t=>console.log(t)).catch(e=>console.error(e))" 2>/dev/null || echo '{}')
log "Health: $HEALTH_JSON"

cat > "$STATE_FILE" <<EOF
{
  "version": "$VERSION",
  "commit": "$GIT_COMMIT",
  "full_commit": "$(git rev-parse HEAD 2>/dev/null || echo "$GIT_COMMIT")",
  "branch": "$BRANCH",
  "deployed_at": "$BUILT_AT",
  "previous_commit": "$PREVIOUS_COMMIT",
  "db_backup": "$DB_BACKUP_REL",
  "log_file": "$LOG_FILE"
}
EOF

log "=== Déploiement terminé ==="
log "État enregistré dans $STATE_FILE"

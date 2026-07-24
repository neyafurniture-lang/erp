#!/usr/bin/env bash
# NEYA ERP — déploiement depuis Git (pull + build Docker + healthcheck)
set -euo pipefail

REPO_DIR="${NEYA_REPO_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
BRANCH="${NEYA_DEPLOY_BRANCH:-main}"
ENV_FILE="${NEYA_ENV_FILE:-$REPO_DIR/.env.production}"
STATE_FILE="${NEYA_STATE_FILE:-$REPO_DIR/.deploy-state.json}"
PROGRESS_FILE="${NEYA_PROGRESS_FILE:-$REPO_DIR/deploy/.deploy-progress.json}"
COMPOSE_FILE="${NEYA_COMPOSE_FILE:-$REPO_DIR/docker-compose.prod.yml}"
LOG_DIR="${NEYA_LOG_DIR:-$REPO_DIR/deploy/logs}"
FORCE="${FORCE:-0}"
SKIP_BACKUP="${SKIP_BACKUP:-0}"

mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/deploy-$(date +%Y%m%d-%H%M%S).log"

log() { echo "[$(date -Iseconds)] $*" | tee -a "$LOG_FILE"; }

# percent, stage, label, status(running|done|error|skipped)
write_progress() {
  local percent="$1" stage="$2" label="$3" status="${4:-running}"
  local started="${PROGRESS_STARTED_AT:-$(date -u +"%Y-%m-%dT%H:%M:%SZ")}"
  PROGRESS_STARTED_AT="$started"
  local label_json
  label_json=$(node -e "process.stdout.write(JSON.stringify(process.argv[1] || ''))" "$label" 2>/dev/null || printf '"%s"' "${label//\"/\\\"}")
  cat > "$PROGRESS_FILE" <<EOF
{
  "percent": $percent,
  "stage": "$stage",
  "label": $label_json,
  "status": "$status",
  "started_at": "$started",
  "updated_at": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "log_file": "$LOG_FILE"
}
EOF
}

on_error() {
  local code=$?
  write_progress 100 "error" "Échec du déploiement (code $code)" "error"
  exit "$code"
}
trap on_error ERR

cd "$REPO_DIR"
PROGRESS_STARTED_AT="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
write_progress 5 "start" "Démarrage du déploiement…"

if [[ ! -f "$ENV_FILE" ]]; then
  log "ERREUR: $ENV_FILE manquant. Copiez deploy/.env.production.example"
  write_progress 100 "error" "Fichier .env.production manquant" "error"
  exit 1
fi

if [[ ! -f "$COMPOSE_FILE" ]]; then
  log "ERREUR: $COMPOSE_FILE introuvable"
  write_progress 100 "error" "docker-compose.prod.yml introuvable" "error"
  exit 1
fi

log "=== Déploiement NEYA ERP ==="
log "Répertoire: $REPO_DIR"

LOCAL_BEFORE="manual"
REMOTE="manual"
PREVIOUS_COMMIT="manual"

if git rev-parse --git-dir >/dev/null 2>&1; then
  write_progress 12 "git-fetch" "Récupération GitHub…"
  git fetch origin "$BRANCH"
  LOCAL_BEFORE=$(git rev-parse HEAD)
  REMOTE=$(git rev-parse "origin/$BRANCH")

  if [[ "$LOCAL_BEFORE" == "$REMOTE" && "$FORCE" != "1" ]]; then
    log "Déjà à jour ($LOCAL_BEFORE). Utilisez FORCE=1 pour reconstruire."
    write_progress 100 "skipped" "Déjà à jour — rien à déployer" "skipped"
    exit 0
  fi

  PREVIOUS_COMMIT="$LOCAL_BEFORE"
  if [[ -f "$STATE_FILE" ]]; then
    PREVIOUS_COMMIT=$(grep -o '"commit"[[:space:]]*:[[:space:]]*"[^"]*"' "$STATE_FILE" | head -1 | sed 's/.*"\([^"]*\)"$/\1/' || echo "$LOCAL_BEFORE")
  fi

  if [[ "$LOCAL_BEFORE" != "$REMOTE" ]]; then
    write_progress 22 "git-pull" "Mise à jour des fichiers depuis Git…"
    log "Mise à jour Git: $LOCAL_BEFORE → $REMOTE"
    # reset --hard = déploiement fiable (1 clic). .env.production n'est pas versionné.
    git checkout "$BRANCH" 2>/dev/null || git checkout -B "$BRANCH" "origin/$BRANCH"
    git reset --hard "origin/$BRANCH"
  else
    write_progress 22 "git-pull" "Rebuild forcé (même commit)…"
    log "Rebuild forcé (même commit)"
  fi
else
  log "Pas de dépôt Git — déploiement direct des fichiers"
  write_progress 22 "git-pull" "Déploiement des fichiers locaux…"
fi

VERSION=$(cat VERSION 2>/dev/null | tr -d '\r\n' || echo "0.0.0")
GIT_COMMIT=$(git rev-parse --short HEAD)
BUILT_AT=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

export APP_VERSION="$VERSION"
export GIT_COMMIT="$GIT_COMMIT"
export BUILT_AT="$BUILT_AT"

log "Version $VERSION (commit $GIT_COMMIT)"

if [[ "$SKIP_BACKUP" != "1" ]] && docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" ps db 2>/dev/null | grep -q running; then
  write_progress 35 "backup" "Sauvegarde Postgres…"
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

write_progress 48 "build" "Build des images Docker…"
log "Build images Docker..."
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" build --pull

write_progress 72 "restart" "Redémarrage des services…"
log "Redémarrage des services..."
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d --remove-orphans

write_progress 85 "health" "Vérification healthcheck…"
log "Attente healthcheck backend..."
HEALTH_OK=0
for i in $(seq 1 45); do
  if docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" exec -T backend \
    node -e "fetch('http://localhost:4000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null; then
    HEALTH_OK=1
    break
  fi
  # 85 → 96 pendant l’attente
  write_progress $((85 + i / 4)) "health" "Healthcheck… ($i/45)"
  sleep 2
done

if [[ "$HEALTH_OK" != "1" ]]; then
  log "ERREUR: healthcheck échoué après déploiement"
  log "Logs backend:"
  docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" logs --tail=40 backend | tee -a "$LOG_FILE"
  write_progress 100 "error" "Healthcheck échoué" "error"
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
write_progress 100 "done" "Déploiement terminé" "done"

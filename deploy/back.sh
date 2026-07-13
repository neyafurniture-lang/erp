#!/usr/bin/env bash
# NEYA ERP — retour au backup / commit précédent (rollback d'urgence)
# Usage sur le VPS : back.sh
# Usage à distance : ssh ubuntu@51.222.31.75 back.sh
# Sans confirmation : BACK_CONFIRM=1 back.sh
set -euo pipefail

REPO_DIR="${NEYA_REPO_DIR:-/opt/neya-erp}"
if [[ -d "$(cd "$(dirname "$0")/.." && pwd)" && -f "$(cd "$(dirname "$0")/.." && pwd)/docker-compose.prod.yml" ]]; then
  REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
fi

ENV_FILE="${NEYA_ENV_FILE:-$REPO_DIR/.env.production}"
STATE_FILE="${NEYA_STATE_FILE:-$REPO_DIR/.deploy-state.json}"
COMPOSE_FILE="${NEYA_COMPOSE_FILE:-$REPO_DIR/docker-compose.prod.yml}"
BACKUP_DIR="${NEYA_BACKUP_DIR:-$REPO_DIR/deploy/backups}"
LOG_DIR="${NEYA_LOG_DIR:-$REPO_DIR/deploy/logs}"

mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/rollback-$(date +%Y%m%d-%H%M%S).log"

log() { echo "[$(date -Iseconds)] $*" | tee -a "$LOG_FILE"; }

dc() {
  docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" "$@"
}

read_state_field() {
  local key="$1"
  if [[ ! -f "$STATE_FILE" ]]; then
    echo ""
    return
  fi
  if command -v jq >/dev/null 2>&1; then
    jq -r ".$key // empty" "$STATE_FILE" 2>/dev/null || true
  else
    grep -o "\"$key\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" "$STATE_FILE" | head -1 | sed 's/.*"\([^"]*\)"$/\1/' || true
  fi
}

pick_backup_file() {
  local from_state
  from_state="$(read_state_field db_backup)"
  if [[ -n "$from_state" && -f "$REPO_DIR/$from_state" ]]; then
    echo "$REPO_DIR/$from_state"
    return
  fi
  if [[ -n "$from_state" && -f "$from_state" ]]; then
    echo "$from_state"
    return
  fi

  if [[ ! -d "$BACKUP_DIR" ]]; then
    echo ""
    return
  fi

  # Deuxième backup le plus récent = celui d'avant le dernier déploiement
  local second
  second="$(ls -1t "$BACKUP_DIR"/neya_db_*.sql.gz 2>/dev/null | sed -n '2p' || true)"
  if [[ -n "$second" ]]; then
    echo "$second"
    return
  fi

  ls -1t "$BACKUP_DIR"/neya_db_*.sql.gz 2>/dev/null | head -1 || true
}

restore_database() {
  local backup="$1"
  if [[ -z "$backup" || ! -f "$backup" ]]; then
    log "AVERTISSEMENT: aucun backup DB trouvé — rollback code seulement"
    return 0
  fi

  log "Restauration Postgres ← $backup"
  dc ps db >/dev/null 2>&1 || dc up -d db

  for i in $(seq 1 30); do
    if dc exec -T db pg_isready -U neya -d neya_db >/dev/null 2>&1; then
      break
    fi
    sleep 1
  done

  dc exec -T db psql -U neya -d postgres -v ON_ERROR_STOP=1 -c \
    "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'neya_db' AND pid <> pg_backend_pid();" \
    >/dev/null 2>&1 || true

  dc exec -T db psql -U neya -d postgres -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS neya_db WITH (FORCE);"
  dc exec -T db psql -U neya -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE neya_db OWNER neya;"

  gunzip -c "$backup" | dc exec -T db psql -U neya -d neya_db -v ON_ERROR_STOP=1
  log "Base neya_db restaurée"
}

rollback_git() {
  local prev
  prev="$(read_state_field previous_commit)"
  if [[ -z "$prev" || "$prev" == "manual" ]]; then
    log "Pas de previous_commit — git inchangé"
    return 0
  fi
  if ! git -C "$REPO_DIR" rev-parse --git-dir >/dev/null 2>&1; then
    log "Pas de dépôt Git — code inchangé"
    return 0
  fi

  log "Git checkout → $prev"
  git -C "$REPO_DIR" fetch origin "${NEYA_DEPLOY_BRANCH:-main}" 2>/dev/null || true
  git -C "$REPO_DIR" checkout "$prev"
}

wait_health() {
  local ok=0
  for i in $(seq 1 45); do
    if dc exec -T backend node -e \
      "fetch('http://localhost:4000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" \
      2>/dev/null; then
      ok=1
      break
    fi
    sleep 2
  done
  [[ "$ok" == "1" ]]
}

main() {
  cd "$REPO_DIR"

  if [[ ! -f "$ENV_FILE" ]]; then
    log "ERREUR: $ENV_FILE introuvable"
    exit 1
  fi

  local backup prev current
  backup="$(pick_backup_file)"
  prev="$(read_state_field previous_commit)"
  current="$(read_state_field commit)"

  log "=== ROLLBACK NEYA ERP ==="
  log "Répertoire: $REPO_DIR"
  log "Commit actuel: ${current:-inconnu}"
  log "Cible git: ${prev:-aucune}"
  log "Backup DB: ${backup:-aucun}"

  if [[ "${BACK_CONFIRM:-}" != "1" ]]; then
    echo ""
    echo "⚠️  Rollback d'urgence NEYA ERP"
    echo "   Git  : ${current:-?} → ${prev:-inchangé}"
    echo "   DB   : ${backup:-aucun backup}"
    echo ""
    read -r -p "Continuer ? [oui/NON] " ans
    if [[ "${ans,,}" != "oui" && "${ans,,}" != "o" && "${ans,,}" != "yes" ]]; then
      echo "Annulé."
      exit 0
    fi
  fi

  rollback_git
  restore_database "$backup"

  log "Rebuild Docker (backend + frontend)…"
  dc build backend frontend
  dc up -d --remove-orphans

  if wait_health; then
    log "Healthcheck OK après rollback"
    dc exec -T backend node -e \
      "fetch('http://localhost:4000/health').then(r=>r.text()).then(t=>console.log(t)).catch(()=>{})" \
      2>/dev/null | tee -a "$LOG_FILE" || true
  else
    log "ERREUR: site toujours inaccessible après rollback"
    dc logs --tail=50 backend | tee -a "$LOG_FILE"
    exit 1
  fi

  log "=== Rollback terminé ==="
  log "Log: $LOG_FILE"
}

main "$@"

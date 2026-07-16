#!/usr/bin/env bash
# NEYA ERP — mise à jour auto si GitHub a avancé ET aucune activité ERP récente.
# Destiné à tourner en cron sur l'hôte VPS (pas dans le conteneur).
set -euo pipefail

REPO_DIR="${NEYA_REPO_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
BRANCH="${NEYA_DEPLOY_BRANCH:-main}"
IDLE_MINUTES="${NEYA_AUTO_UPDATE_IDLE_MINUTES:-120}"
ACTIVITY_FILE="${NEYA_ACTIVITY_FILE:-$REPO_DIR/deploy/.last-activity}"
LOG_DIR="${NEYA_LOG_DIR:-$REPO_DIR/deploy/logs}"
LOG_FILE="$LOG_DIR/auto-update-latest.log"
CHECK_SCRIPT="$REPO_DIR/deploy/check-update.sh"
DEPLOY_SCRIPT="$REPO_DIR/deploy/deploy.sh"

mkdir -p "$LOG_DIR"

log() { echo "[$(date -Iseconds)] $*" | tee -a "$LOG_FILE"; }

cd "$REPO_DIR"

if [[ "${NEYA_AUTO_UPDATE_DISABLED:-0}" == "1" ]]; then
  log "SKIP: NEYA_AUTO_UPDATE_DISABLED=1"
  exit 0
fi

if [[ ! -x "$CHECK_SCRIPT" && -f "$CHECK_SCRIPT" ]]; then
  chmod +x "$CHECK_SCRIPT" "$DEPLOY_SCRIPT" 2>/dev/null || true
fi

log "=== Auto-update idle check (branch=$BRANCH idle=${IDLE_MINUTES}m) ==="

set +e
"$CHECK_SCRIPT" >>"$LOG_FILE" 2>&1
CHECK_EC=$?
set -e

if [[ "$CHECK_EC" -eq 0 ]]; then
  log "SKIP: déjà à jour avec origin/$BRANCH"
  exit 0
fi

if [[ "$CHECK_EC" -ne 10 ]]; then
  log "ERREUR: check-update.sh exit $CHECK_EC (réseau/git ?)"
  exit "$CHECK_EC"
fi

log "UPDATE_AVAILABLE: origin/$BRANCH a avancé"

# Activité récente ?
LAST_ISO=""
if [[ -f "$ACTIVITY_FILE" ]]; then
  RAW=$(head -1 "$ACTIVITY_FILE" | tr -d '\r')
  if [[ "$RAW" == \{* ]]; then
    LAST_ISO=$(printf '%s' "$RAW" | sed -n 's/.*"at"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
  else
    LAST_ISO=$(printf '%s' "$RAW" | awk '{print $1}')
  fi
fi

if [[ -n "$LAST_ISO" ]]; then
  LAST_EPOCH=$(date -d "$LAST_ISO" +%s 2>/dev/null || date -j -f "%Y-%m-%dT%H:%M:%S" "${LAST_ISO%%.*}" +%s 2>/dev/null || echo "")
  NOW_EPOCH=$(date +%s)
  if [[ -n "$LAST_EPOCH" ]]; then
    AGE_MIN=$(( (NOW_EPOCH - LAST_EPOCH) / 60 ))
    log "Dernière activité ERP: $LAST_ISO (il y a ${AGE_MIN} min)"
    if [[ "$AGE_MIN" -lt "$IDLE_MINUTES" ]]; then
      log "SKIP: activité récente (< ${IDLE_MINUTES} min) — report à demain"
      exit 0
    fi
  else
    log "WARN: date activité illisible ($LAST_ISO) — on considère idle"
  fi
else
  log "Aucune activité enregistrée — considéré idle"
fi

log "GO: déploiement (git a bougé + idle)"
FORCE=0 "$DEPLOY_SCRIPT" >>"$LOG_FILE" 2>&1
EC=$?
if [[ "$EC" -eq 0 ]]; then
  log "OK: déploiement terminé"
else
  log "ERREUR: deploy.sh exit $EC"
fi
exit "$EC"

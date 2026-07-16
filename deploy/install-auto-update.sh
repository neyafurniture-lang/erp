#!/usr/bin/env bash
# Installe le cron quotidien 00:00 pour auto-update-if-idle.sh
set -euo pipefail

REPO_DIR="${NEYA_REPO_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
SCRIPT="$REPO_DIR/deploy/auto-update-if-idle.sh"
MARKER="$REPO_DIR/deploy/.auto-update-installed"
LOG_DIR="$REPO_DIR/deploy/logs"
CRON_LINE="0 0 * * * cd $REPO_DIR && /bin/bash $SCRIPT >> $LOG_DIR/cron-auto-update.log 2>&1"

mkdir -p "$LOG_DIR"
chmod +x "$REPO_DIR/deploy/check-update.sh" "$REPO_DIR/deploy/deploy.sh" "$SCRIPT" 2>/dev/null || true

# Retirer d'anciennes lignes NEYA auto-update
EXISTING=$(crontab -l 2>/dev/null || true)
FILTERED=$(printf '%s\n' "$EXISTING" | grep -v 'auto-update-if-idle.sh' | grep -v 'NEYA_ERP_AUTO_UPDATE' || true)
{
  printf '%s\n' "$FILTERED"
  echo "# NEYA_ERP_AUTO_UPDATE — MAJ Git si idle + origin a avancé"
  echo "$CRON_LINE"
} | crontab -

echo "$CRON_LINE" > "$MARKER"
echo "OK: cron installé — tous les jours à 00:00"
echo "  $CRON_LINE"
echo "Test manuel :"
echo "  cd $REPO_DIR && ./deploy/check-update.sh"
echo "  cd $REPO_DIR && ./deploy/auto-update-if-idle.sh"
crontab -l | grep -A1 'NEYA_ERP_AUTO_UPDATE' || true

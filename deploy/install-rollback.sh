#!/usr/bin/env bash
# Installe la commande `back.sh` dans le PATH du VPS (une fois)
set -euo pipefail

REPO_DIR="${NEYA_REPO_DIR:-/opt/neya-erp}"
TARGET="$REPO_DIR/deploy/back.sh"
LINK="/usr/local/bin/back.sh"

if [[ ! -f "$TARGET" ]]; then
  echo "ERREUR: $TARGET introuvable"
  exit 1
fi

chmod +x "$TARGET" "$REPO_DIR/back.sh" 2>/dev/null || chmod +x "$TARGET"

if [[ $EUID -ne 0 ]]; then
  sudo ln -sf "$TARGET" "$LINK"
  sudo chmod +x "$LINK"
else
  ln -sf "$TARGET" "$LINK"
  chmod +x "$LINK"
fi

echo "OK — commande installée : back.sh → $TARGET"
echo "Test : ssh ubuntu@$(hostname -I | awk '{print $1}') 'BACK_CONFIRM=0 back.sh'"

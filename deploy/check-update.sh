#!/usr/bin/env bash
# NEYA ERP — vérifier si une mise à jour Git est disponible (sans déployer)
set -euo pipefail

REPO_DIR="${NEYA_REPO_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
BRANCH="${NEYA_DEPLOY_BRANCH:-main}"
STATE_FILE="${NEYA_STATE_FILE:-$REPO_DIR/.deploy-state.json}"

cd "$REPO_DIR"

if ! git rev-parse --git-dir >/dev/null 2>&1; then
  echo "ERREUR: pas un dépôt Git dans $REPO_DIR"
  exit 1
fi

git fetch origin "$BRANCH" --quiet 2>/dev/null || {
  echo "ERREUR: impossible de contacter origin (réseau ou clé SSH)"
  exit 2
}

LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse "origin/$BRANCH")
VERSION=$(cat VERSION 2>/dev/null | tr -d '\r\n' || echo "?")

DEPLOYED_COMMIT=""
if [[ -f "$STATE_FILE" ]]; then
  DEPLOYED_COMMIT=$(grep -o '"commit"[[:space:]]*:[[:space:]]*"[^"]*"' "$STATE_FILE" | head -1 | sed 's/.*"\([^"]*\)"$/\1/' || true)
fi

echo "Branche:     $BRANCH"
echo "Version:     $VERSION"
echo "Local HEAD:  $LOCAL"
echo "Origin:      $REMOTE"
echo "Déployé:     ${DEPLOYED_COMMIT:-jamais}"

if [[ "$LOCAL" == "$REMOTE" ]]; then
  echo "STATUS: up_to_date"
  exit 0
fi

BEHIND=$(git rev-list --count HEAD.."origin/$BRANCH" 2>/dev/null || echo "?")
echo "Commits en retard: $BEHIND"
echo "STATUS: update_available"
exit 10

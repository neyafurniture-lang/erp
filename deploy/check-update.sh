#!/usr/bin/env bash
# NEYA ERP — vérifier si une mise à jour Git est disponible (sans déployer)
# Exit 0 = up_to_date | Exit 10 = update_available | autres = erreur
set -euo pipefail

REPO_DIR="${NEYA_REPO_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
BRANCH="${NEYA_DEPLOY_BRANCH:-main}"
STATE_FILE="${NEYA_STATE_FILE:-$REPO_DIR/.deploy-state.json}"
JSON=0
[[ "${1:-}" == "--json" ]] && JSON=1

cd "$REPO_DIR"

if ! git rev-parse --git-dir >/dev/null 2>&1; then
  if [[ "$JSON" -eq 1 ]]; then
    echo '{"status":"error","error":"not_a_git_repo"}'
  else
    echo "ERREUR: pas un dépôt Git dans $REPO_DIR"
  fi
  exit 1
fi

git fetch origin "$BRANCH" --quiet 2>/dev/null || {
  if [[ "$JSON" -eq 1 ]]; then
    echo '{"status":"error","error":"fetch_failed"}'
  else
    echo "ERREUR: impossible de contacter origin (réseau ou clé SSH)"
  fi
  exit 2
}

LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse "origin/$BRANCH")
LOCAL_SHORT=$(git rev-parse --short HEAD)
REMOTE_SHORT=$(git rev-parse --short "origin/$BRANCH")
VERSION=$(cat VERSION 2>/dev/null | tr -d '\r\n' || echo "?")

DEPLOYED_COMMIT=""
DEPLOYED_AT=""
if [[ -f "$STATE_FILE" ]]; then
  DEPLOYED_COMMIT=$(grep -o '"commit"[[:space:]]*:[[:space:]]*"[^"]*"' "$STATE_FILE" | head -1 | sed 's/.*"\([^"]*\)"$/\1/' || true)
  DEPLOYED_AT=$(grep -o '"deployed_at"[[:space:]]*:[[:space:]]*"[^"]*"' "$STATE_FILE" | head -1 | sed 's/.*"\([^"]*\)"$/\1/' || true)
fi

BEHIND=0
if [[ "$LOCAL" != "$REMOTE" ]]; then
  BEHIND=$(git rev-list --count HEAD.."origin/$BRANCH" 2>/dev/null || echo "0")
fi

STATUS="up_to_date"
EXIT=0
if [[ "$LOCAL" != "$REMOTE" ]]; then
  STATUS="update_available"
  EXIT=10
fi

if [[ "$JSON" -eq 1 ]]; then
  printf '{"status":"%s","branch":"%s","version":"%s","localCommit":"%s","localFull":"%s","originCommit":"%s","originFull":"%s","behind":%s,"deployedCommit":"%s","deployedAt":"%s"}\n' \
    "$STATUS" "$BRANCH" "$VERSION" "$LOCAL_SHORT" "$LOCAL" "$REMOTE_SHORT" "$REMOTE" "${BEHIND:-0}" \
    "${DEPLOYED_COMMIT:-}" "${DEPLOYED_AT:-}"
  exit "$EXIT"
fi

echo "Branche:     $BRANCH"
echo "Version:     $VERSION"
echo "Local HEAD:  $LOCAL_SHORT ($LOCAL)"
echo "Origin:      $REMOTE_SHORT ($REMOTE)"
echo "Déployé:     ${DEPLOYED_COMMIT:-jamais}${DEPLOYED_AT:+ · $DEPLOYED_AT}"

if [[ "$STATUS" == "up_to_date" ]]; then
  echo "STATUS: up_to_date"
  exit 0
fi

echo "Commits en retard: $BEHIND"
echo "STATUS: update_available"
exit 10

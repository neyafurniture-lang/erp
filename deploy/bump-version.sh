#!/usr/bin/env bash
# Incrémente VERSION (patch par défaut)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FILE="$ROOT/VERSION"
CURRENT=$(tr -d '\r\n' < "$FILE")
IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT"
BUMP="${1:-patch}"

case "$BUMP" in
  major) MAJOR=$((MAJOR + 1)); MINOR=0; PATCH=0 ;;
  minor) MINOR=$((MINOR + 1)); PATCH=0 ;;
  patch) PATCH=$((PATCH + 1)) ;;
  *) echo "Usage: $0 [patch|minor|major]"; exit 1 ;;
esac

NEW="$MAJOR.$MINOR.$PATCH"
echo "$NEW" > "$FILE"
echo "VERSION: $CURRENT → $NEW"
git add "$FILE"
echo "Commit suggéré: git commit -m \"release: v$NEW\""

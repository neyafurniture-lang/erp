#!/usr/bin/env bash
# Raccourci racine → deploy/back.sh (rollback VPS)
ROOT="$(cd "$(dirname "$0")" && pwd)"
exec "$ROOT/deploy/back.sh" "$@"

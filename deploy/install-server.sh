#!/usr/bin/env bash
# Installation initiale sur VPS Ubuntu/Debian (Docker + clone Git)
set -euo pipefail

REPO_URL="${1:-}"
INSTALL_DIR="${NEYA_REPO_DIR:-/opt/neya-erp}"
BRANCH="${NEYA_DEPLOY_BRANCH:-main}"

if [[ -z "$REPO_URL" ]]; then
  echo "Usage: $0 <url-git-ssh-ou-https>"
  echo "Ex:    $0 git@github.com:neya/neya-erp-mvp.git"
  exit 1
fi

if [[ $EUID -ne 0 ]]; then
  echo "Exécutez en root ou avec sudo"
  exit 1
fi

apt-get update -qq
apt-get install -y -qq git curl ca-certificates

if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sh
  systemctl enable docker
  systemctl start docker
fi

if ! docker compose version >/dev/null 2>&1; then
  apt-get install -y -qq docker-compose-plugin || true
fi

if [[ ! -d "$INSTALL_DIR/.git" ]]; then
  git clone --branch "$BRANCH" "$REPO_URL" "$INSTALL_DIR"
else
  echo "Dépôt déjà présent dans $INSTALL_DIR"
fi

cd "$INSTALL_DIR"
chmod +x deploy/*.sh back.sh 2>/dev/null || chmod +x deploy/*.sh
if [[ -f deploy/install-rollback.sh ]]; then
  ./deploy/install-rollback.sh || true
fi

if [[ ! -f .env.production ]]; then
  cp deploy/.env.production.example .env.production
  echo ""
  echo ">>> Éditez $INSTALL_DIR/.env.production (secrets, domaine) puis:"
  echo "    cd $INSTALL_DIR && ./deploy/deploy.sh"
fi

echo ""
echo "Installation terminée."
echo "  Repo:  $INSTALL_DIR"
echo "  Env:   $INSTALL_DIR/.env.production"
echo "  Deploy: ./deploy/deploy.sh"

#!/usr/bin/env bash
# Mise à jour in-place (garde .env.production, backups, uploads)
set -euo pipefail

REMOTE_DIR="/opt/neya-erp"
ZIP="/tmp/neya-upload/neya-erp-deploy.zip"
DEPLOY_USER="${1:-ubuntu}"

if [[ ! -f "$ZIP" ]]; then
  echo "ERREUR: archive introuvable ($ZIP)"
  exit 1
fi

if ! command -v unzip >/dev/null 2>&1; then
  sudo apt-get update -qq
  sudo apt-get install -y -qq unzip
fi

sudo mkdir -p "$REMOTE_DIR" /tmp/neya-upload
sudo chown -R "$DEPLOY_USER:$DEPLOY_USER" "$REMOTE_DIR" /tmp/neya-upload

ENV_BACKUP=""
if [[ -f "$REMOTE_DIR/.env.production" ]]; then
  ENV_BACKUP="$(mktemp)"
  cp "$REMOTE_DIR/.env.production" "$ENV_BACKUP"
  echo "Sauvegarde .env.production"
fi

# Fichiers crees par Docker (root) — arreter les conteneurs et reprendre la propriete
if [[ -f "$REMOTE_DIR/docker-compose.prod.yml" ]]; then
  (cd "$REMOTE_DIR" && sudo docker compose -f docker-compose.prod.yml --env-file .env.production down 2>/dev/null) || true
fi
sudo find "$REMOTE_DIR" -mindepth 1 -not -user "$DEPLOY_USER" -exec chown "$DEPLOY_USER:$DEPLOY_USER" {} + 2>/dev/null || true
sudo chown -R "$DEPLOY_USER:$DEPLOY_USER" "$REMOTE_DIR"
# Dossiers public parfois corrompus (permissions ?????) apres builds Docker
sudo rm -rf "$REMOTE_DIR/frontend/public/brand" "$REMOTE_DIR/frontend/public/fiches" 2>/dev/null || true
sudo chown -R "$DEPLOY_USER:$DEPLOY_USER" "$REMOTE_DIR/frontend" 2>/dev/null || true
sudo chmod -R u+rwX "$REMOTE_DIR/frontend" 2>/dev/null || true

cd "$REMOTE_DIR"
set +e
unzip -o "$ZIP" -d "$REMOTE_DIR"
UNZIP_CODE=$?
set -e
if [[ $UNZIP_CODE -ne 0 && $UNZIP_CODE -ne 1 ]]; then
  echo "ERREUR: unzip code $UNZIP_CODE — retry avec sudo..."
  sudo unzip -o "$ZIP" -d "$REMOTE_DIR"
  sudo chown -R "$DEPLOY_USER:$DEPLOY_USER" "$REMOTE_DIR"
fi
chmod +x deploy/*.sh back.sh 2>/dev/null || chmod +x deploy/*.sh
find "$REMOTE_DIR/deploy" -type f -name '*.sh' -exec sed -i 's/\r$//' {} +

if [[ -n "$ENV_BACKUP" && -f "$ENV_BACKUP" ]]; then
  cp "$ENV_BACKUP" "$REMOTE_DIR/.env.production"
  rm -f "$ENV_BACKUP"
  echo ".env.production restauré"
elif [[ ! -f .env.production ]]; then
  cp deploy/.env.production.example .env.production
  echo "ATTENTION: nouveau .env.production — configurez les secrets"
fi
sed -i 's/\r$//' .env.production 2>/dev/null || true

if [[ -f deploy/install-rollback.sh ]]; then
  sudo ./deploy/install-rollback.sh 2>/dev/null || true
fi

VERSION=$(cat VERSION 2>/dev/null | tr -d '\r\n' || echo "0.0.0")
export APP_VERSION="$VERSION"
export GIT_COMMIT="upload-$(date +%Y%m%d)"
export BUILT_AT=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

echo "Build Docker backend + frontend..."
sudo docker compose -f docker-compose.prod.yml --env-file .env.production build --pull backend frontend
sudo docker compose -f docker-compose.prod.yml --env-file .env.production up -d --remove-orphans

echo "Attente healthcheck..."
for i in $(seq 1 60); do
  if sudo docker compose -f docker-compose.prod.yml --env-file .env.production exec -T backend \
    node -e "fetch('http://localhost:4000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null; then
    echo "Healthcheck OK"
    curl -s http://localhost/health 2>/dev/null || true
    exit 0
  fi
  sleep 3
done

echo "ERREUR: healthcheck échoué"
sudo docker compose -f docker-compose.prod.yml --env-file .env.production logs --tail=40 backend
exit 1

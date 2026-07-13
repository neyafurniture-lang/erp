#!/usr/bin/env bash
set -euo pipefail

REMOTE_DIR="/opt/neya-erp"
DEPLOY_USER="${1:-ubuntu}"

if ! command -v unzip >/dev/null 2>&1; then
  sudo apt-get update -qq
  sudo apt-get install -y -qq unzip openssl
fi

sudo rm -rf "$REMOTE_DIR"
sudo mkdir -p "$REMOTE_DIR" /tmp/neya-upload
sudo chown -R "$DEPLOY_USER:$DEPLOY_USER" "$REMOTE_DIR" /tmp/neya-upload

cd "$REMOTE_DIR"
rm -rf backend frontend deploy docker-compose.prod.yml VERSION 2>/dev/null || true
unzip -o /tmp/neya-upload/neya-erp-deploy.zip -d "$REMOTE_DIR" || true
test -f "$REMOTE_DIR/docker-compose.prod.yml"
chmod +x deploy/*.sh
find "$REMOTE_DIR/deploy" -type f -name '*.sh' -exec sed -i 's/\r$//' {} +
sed -i 's/\r$//' deploy/Caddyfile 2>/dev/null || true

if [ ! -f .env.production ]; then
  cp deploy/.env.production.example .env.production
  JWT=$(openssl rand -hex 32)
  PG=$(openssl rand -hex 16)
  sed -i "s|^JWT_SECRET=.*|JWT_SECRET=$JWT|" .env.production
  sed -i "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$PG|" .env.production
  sed -i 's|^ERP_DOMAIN=.*|ERP_DOMAIN=51.222.31.75|' .env.production
  sed -i 's|^FRONTEND_URL=.*|FRONTEND_URL=http://51.222.31.75|' .env.production
  sed -i 's|^NEXT_PUBLIC_API_URL=.*|NEXT_PUBLIC_API_URL=http://51.222.31.75/api|' .env.production
  sed -i 's|^GOOGLE_REDIRECT_URI=.*|GOOGLE_REDIRECT_URI=http://51.222.31.75/api/integrations/google/callback|' .env.production
  sed -i "s|^ADMIN_PASSWORD=.*|ADMIN_PASSWORD=neyha31250|" .env.production
fi
sed -i 's/\r$//' .env.production

if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
  sudo usermod -aG docker "$DEPLOY_USER"
fi

if ! docker compose version >/dev/null 2>&1 && ! sudo docker compose version >/dev/null 2>&1; then
  sudo apt-get install -y -qq docker-compose-plugin 2>/dev/null || true
fi

sed -i 's|^docker compose|sudo docker compose|g' deploy/deploy.sh 2>/dev/null || true

VERSION=$(cat VERSION 2>/dev/null | tr -d '\r\n' || echo "0.0.0")
export APP_VERSION="$VERSION"
export GIT_COMMIT="upload"
export BUILT_AT=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

set -a
# shellcheck disable=SC1091
source .env.production
set +a

echo "Build Docker (10-20 min)..."
sudo docker compose -f docker-compose.prod.yml --env-file .env.production build --pull
sudo docker compose -f docker-compose.prod.yml --env-file .env.production up -d --remove-orphans

echo "Attente healthcheck..."
for i in $(seq 1 60); do
  if sudo docker compose -f docker-compose.prod.yml --env-file .env.production exec -T backend \
    node -e "fetch('http://localhost:4000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null; then
    break
  fi
  sleep 3
done

curl -s http://localhost/health 2>/dev/null || curl -s http://localhost:4000/health 2>/dev/null || true

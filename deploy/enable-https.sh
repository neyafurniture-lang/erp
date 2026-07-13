#!/usr/bin/env bash
# Active HTTPS pour NEYA ERP (domaine + Let's Encrypt via Caddy)
set -euo pipefail

DOMAIN="${1:-erp.neyafurniture.ca}"
EMAIL="${2:-neyafurniture@gmail.com}"
REPO_DIR="${NEYA_REPO_DIR:-/opt/neya-erp}"
ENV_FILE="$REPO_DIR/.env.production"

cd "$REPO_DIR"

echo "=== Vérification DNS ==="
RESOLVED=$(getent hosts "$DOMAIN" | awk '{print $1}' | head -1 || true)
VPS_IP=$(curl -4 -s ifconfig.me || curl -4 -s icanhazip.com || echo "51.222.31.75")
echo "Domaine $DOMAIN → ${RESOLVED:-AUCUN}"
echo "IP VPS              → $VPS_IP"

if [[ -z "$RESOLVED" ]]; then
  echo "ERREUR: le DNS ne résout pas encore $DOMAIN"
  echo "Créez un enregistrement A : $DOMAIN → $VPS_IP"
  exit 1
fi

if [[ "$RESOLVED" != "$VPS_IP" ]]; then
  echo "ATTENTION: $DOMAIN pointe vers $RESOLVED, pas vers ce VPS ($VPS_IP)"
  echo "Corrigez le DNS puis relancez."
  exit 1
fi

echo "DNS OK."

# Mettre à jour .env.production
sudo sed -i "s|^ERP_DOMAIN=.*|ERP_DOMAIN=$DOMAIN|" "$ENV_FILE"
sudo sed -i "s|^ACME_EMAIL=.*|ACME_EMAIL=$EMAIL|" "$ENV_FILE"
sudo sed -i "s|^FRONTEND_URL=.*|FRONTEND_URL=https://$DOMAIN|" "$ENV_FILE"
sudo sed -i "s|^NEXT_PUBLIC_API_URL=.*|NEXT_PUBLIC_API_URL=https://$DOMAIN/api|" "$ENV_FILE"
sudo sed -i "s|^GOOGLE_REDIRECT_URI=.*|GOOGLE_REDIRECT_URI=https://$DOMAIN/api/integrations/google/callback|" "$ENV_FILE"

# Caddyfile HTTPS (sans préfixe http://)
sudo tee "$REPO_DIR/deploy/Caddyfile" >/dev/null <<EOF
{
	email {$EMAIL}
}

{$DOMAIN} {
	encode gzip

	handle /api/* {
		reverse_proxy backend:4000
	}

	handle /uploads/* {
		reverse_proxy backend:4000
	}

	handle /health {
		reverse_proxy backend:4000
	}

	handle {
		reverse_proxy frontend:3000
	}
}
EOF

# Remplacer variables Caddy (fichier statique avec domaine réel)
sudo tee "$REPO_DIR/deploy/Caddyfile" >/dev/null <<EOF
{
	email $EMAIL
}

$DOMAIN {
	encode gzip

	handle /api/* {
		reverse_proxy backend:4000
	}

	handle /uploads/* {
		reverse_proxy backend:4000
	}

	handle /health {
		reverse_proxy backend:4000
	}

	handle {
		reverse_proxy frontend:3000
	}
}
EOF

echo "=== Rebuild frontend (URLs HTTPS) + redémarrage Caddy ==="
sudo docker compose -f docker-compose.prod.yml --env-file .env.production build frontend
sudo docker compose -f docker-compose.prod.yml --env-file .env.production up -d

echo "Attente certificat Let's Encrypt…"
sleep 20
sudo docker compose -f docker-compose.prod.yml --env-file .env.production logs --tail=30 caddy

echo ""
echo "Test:"
curl -sI "https://$DOMAIN/health" | head -n 8 || true
echo ""
echo "=== Terminé ==="
echo "Ouvrez https://$DOMAIN sur iPhone (cadenas sécurisé)."
echo "Mettez aussi à jour Google OAuth redirect URI:"
echo "  https://$DOMAIN/api/integrations/google/callback"

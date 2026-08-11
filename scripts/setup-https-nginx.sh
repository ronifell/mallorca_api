#!/usr/bin/env bash
# Install nginx + Let's Encrypt for API HTTPS (RTDN Pub/Sub push requires HTTPS).
# Proxies Socket.IO with correct WebSocket upgrade headers (see websocket-upgrade-map.conf).
#
# Usage:
#   API_DOMAIN=api.citasmallorca.es bash scripts/setup-https-nginx.sh
#   # or interim:
#   API_DOMAIN=100-48-93-44.nip.io bash scripts/setup-https-nginx.sh
#
# To fix WebSocket on an existing host without reinstalling certbot:
#   sudo bash scripts/patch-nginx-socketio.sh
set -euo pipefail

DOMAIN="${API_DOMAIN:-100-48-93-44.nip.io}"
EMAIL="${CERTBOT_EMAIL:-info@citasmallorca.es}"

echo "=== Installing nginx + certbot ==="
export DEBIAN_FRONTEND=noninteractive
sudo apt-get update -qq
sudo apt-get install -y nginx certbot python3-certbot-nginx

echo "=== nginx WebSocket map ==="
sudo tee /etc/nginx/conf.d/websocket-upgrade-map.conf >/dev/null <<'EOF'
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}
EOF

echo "=== nginx site for ${DOMAIN} (HTTP + WebSocket proxy) ==="
sudo tee /etc/nginx/sites-available/mallorca-api >/dev/null <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN};

    location /socket.io/ {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection \$connection_upgrade;
        proxy_buffering off;
        proxy_read_timeout 86400;
        proxy_send_timeout 86400;
    }

    location / {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection \$connection_upgrade;
        proxy_read_timeout 86400;
        proxy_send_timeout 86400;
    }
}
EOF

sudo ln -sf /etc/nginx/sites-available/mallorca-api /etc/nginx/sites-enabled/mallorca-api
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl enable nginx
sudo systemctl restart nginx

echo "=== Requesting TLS certificate ==="
sudo certbot --nginx -d "${DOMAIN}" --non-interactive --agree-tos -m "${EMAIL}" --redirect

echo "=== Re-applying Socket.IO nginx layout after certbot ==="
sudo API_DOMAIN="${DOMAIN}" bash "$(dirname "$0")/patch-nginx-socketio.sh"

echo "=== HTTPS health check ==="
curl -sS "https://${DOMAIN}/health"
echo

echo "=== Done. API HTTPS base: https://${DOMAIN} ==="
echo "Set on the server .env:"
echo "  API_BASE_URL=https://${DOMAIN}"
echo "  PUBLIC_API_URL=https://${DOMAIN}"

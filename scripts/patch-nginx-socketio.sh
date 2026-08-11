#!/usr/bin/env bash
# Patch production nginx so Socket.IO WebSocket upgrades work through the reverse proxy.
# Safe to re-run. Does not restart Node — only reloads nginx.
#
# Run on the EC2 host:
#   API_DOMAIN=100-48-93-44.nip.io sudo bash scripts/patch-nginx-socketio.sh
#
# Symptom fixed: clients with transports: ['websocket'] get "websocket error" while
# polling handshake returns HTTP 200. Hard-coded Connection "upgrade" on all requests
# breaks Engine.IO long-polling; missing map breaks WSS upgrade.
set -euo pipefail

DOMAIN="${API_DOMAIN:-100-48-93-44.nip.io}"
UPSTREAM="${API_UPSTREAM:-http://127.0.0.1:4000}"
SITE="/etc/nginx/sites-available/mallorca-api"
MAP="/etc/nginx/conf.d/websocket-upgrade-map.conf"

echo "=== nginx WebSocket map (${MAP}) ==="
sudo tee "${MAP}" >/dev/null <<'EOF'
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}
EOF

echo "=== nginx site for ${DOMAIN} ==="
sudo tee "${SITE}" >/dev/null <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN};
    return 301 https://\$host\$request_uri;
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name ${DOMAIN};

    # certbot-managed paths — adjust if your cert paths differ
    ssl_certificate /etc/letsencrypt/live/${DOMAIN}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${DOMAIN}/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    location /socket.io/ {
        proxy_pass ${UPSTREAM};
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
        proxy_pass ${UPSTREAM};
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

sudo ln -sf "${SITE}" /etc/nginx/sites-enabled/mallorca-api
sudo rm -f /etc/nginx/sites-enabled/default

echo "=== nginx -t ==="
sudo nginx -t
sudo systemctl reload nginx

echo "=== smoke checks ==="
curl -sS "https://${DOMAIN}/health" | head -c 120
echo
curl -sS "https://${DOMAIN}/socket.io/?EIO=4&transport=polling" | head -c 120
echo
echo "Done. WebSocket upgrade should work; clients may still use polling fallback until app update."

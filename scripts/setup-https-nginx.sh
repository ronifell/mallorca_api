#!/usr/bin/env bash
# Install nginx + Let's Encrypt for API HTTPS (RTDN Pub/Sub push requires HTTPS).
set -euo pipefail

DOMAIN="${API_DOMAIN:-100-48-93-44.nip.io}"
EMAIL="${CERTBOT_EMAIL:-info@citasmallorca.es}"

echo "=== Installing nginx + certbot ==="
export DEBIAN_FRONTEND=noninteractive
sudo apt-get update -qq
sudo apt-get install -y nginx certbot python3-certbot-nginx

echo "=== nginx site for ${DOMAIN} ==="
sudo tee /etc/nginx/sites-available/mallorca-api >/dev/null <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN};

    location / {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
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

echo "=== HTTPS health check ==="
curl -sS "https://${DOMAIN}/health"
echo

echo "=== Done. API HTTPS base: https://${DOMAIN} ==="

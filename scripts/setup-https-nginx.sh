#!/usr/bin/env bash
# Install nginx + Let's Encrypt for API HTTPS (RTDN Pub/Sub push requires HTTPS).
# Also proxies Socket.IO / WebSocket upgrades for WSS.
#
# Usage:
#   API_DOMAIN=api.citasmallorca.es bash scripts/setup-https-nginx.sh
#   # or interim:
#   API_DOMAIN=100-48-93-44.nip.io bash scripts/setup-https-nginx.sh
set -euo pipefail

DOMAIN="${API_DOMAIN:-100-48-93-44.nip.io}"
EMAIL="${CERTBOT_EMAIL:-info@citasmallorca.es}"

echo "=== Installing nginx + certbot ==="
export DEBIAN_FRONTEND=noninteractive
sudo apt-get update -qq
sudo apt-get install -y nginx certbot python3-certbot-nginx

echo "=== nginx site for ${DOMAIN} (HTTP + WebSocket proxy) ==="
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
        # Socket.IO / WSS
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
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

# Ensure WebSocket headers survive certbot's HTTPS server block rewrite.
if ! sudo grep -q 'proxy_set_header Upgrade' /etc/nginx/sites-available/mallorca-api; then
  echo "WARN: Upgrade header missing after certbot — patch HTTPS block manually."
fi

# Re-apply WS headers to all location / blocks (certbot may rewrite the file).
sudo python3 - <<'PY'
from pathlib import Path
path = Path("/etc/nginx/sites-available/mallorca-api")
text = path.read_text()
needle = "proxy_set_header X-Forwarded-Proto $scheme;"
extra = """proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 86400;
        proxy_send_timeout 86400;"""
if "proxy_set_header Upgrade" not in text and needle in text:
    text = text.replace(needle, extra)
    path.write_text(text)
    print("Patched WebSocket headers into nginx site.")
else:
    print("WebSocket headers already present or unexpected nginx layout.")
PY

sudo nginx -t
sudo systemctl reload nginx

echo "=== HTTPS health check ==="
curl -sS "https://${DOMAIN}/health"
echo

echo "=== Done. API HTTPS base: https://${DOMAIN} ==="
echo "Set on the server .env:"
echo "  API_BASE_URL=https://${DOMAIN}"
echo "  PUBLIC_API_URL=https://${DOMAIN}"

#!/usr/bin/env bash
# Raise nginx upload limit to match multer (8 MB) so chat/profile image multipart
# uploads are not rejected with HTTP 413 before reaching Node.
#
# Run on the EC2 host from the repo root:
#   API_DOMAIN=100-48-93-44.nip.io sudo -E bash scripts/patch-nginx-upload-limit.sh
#
# Or re-apply the full nginx site (includes WebSocket + upload limit):
#   API_DOMAIN=100-48-93-44.nip.io sudo -E bash scripts/patch-nginx-socketio.sh
set -euo pipefail

DOMAIN="${API_DOMAIN:-100-48-93-44.nip.io}"
SITE="/etc/nginx/sites-available/mallorca-api"
LIMIT="${NGINX_CLIENT_MAX_BODY_SIZE:-8m}"

if [ ! -f "${SITE}" ]; then
  echo "ERROR: ${SITE} not found. Run patch-nginx-socketio.sh first."
  exit 1
fi

echo "=== Ensuring client_max_body_size ${LIMIT} in ${SITE} ==="
if grep -q 'client_max_body_size' "${SITE}"; then
  sudo sed -i "s/^[[:space:]]*client_max_body_size[[:space:]]*.*/    client_max_body_size ${LIMIT};/" "${SITE}"
else
  # Insert after the first server_name line in the HTTPS server block.
  sudo awk -v limit="${LIMIT}" '
    /server_name/ && !inserted {
      print
      print "    client_max_body_size " limit ";"
      inserted = 1
      next
    }
    { print }
  ' "${SITE}" | sudo tee "${SITE}.tmp" >/dev/null
  sudo mv "${SITE}.tmp" "${SITE}"
fi

echo "=== nginx -t ==="
sudo nginx -t

echo "=== reload nginx ==="
sudo systemctl reload nginx

echo "=== done (${LIMIT} active on https://${DOMAIN}) ==="

#!/usr/bin/env bash
# Print the Pub/Sub push URL to paste in Google Cloud Console.
set -euo pipefail
cd ~/mallorca_api
source /dev/null
TOKEN="$(grep '^GOOGLE_PLAY_RTDN_TOKEN=' .env | cut -d= -f2-)"
HOST="${API_DOMAIN:-100-48-93-44.nip.io}"
echo ""
echo "Paste this into Pub/Sub subscription → Push → Endpoint URL:"
echo ""
echo "https://${HOST}/api/subscriptions/webhooks/google-play?token=${TOKEN}"
echo ""

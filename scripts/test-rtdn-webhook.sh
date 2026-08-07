#!/usr/bin/env bash
set -euo pipefail
cd ~/mallorca_api
TOKEN="$(grep '^GOOGLE_PLAY_RTDN_TOKEN=' .env | cut -d= -f2-)"
PAYLOAD="$(node -e "const b=Buffer.from(JSON.stringify({testNotification:{version:'1.0'}})).toString('base64'); console.log(JSON.stringify({message:{data:b}}));")"

echo "wrong token -> expect 401"
curl -s -o /dev/null -w '%{http_code}\n' -X POST \
  'http://127.0.0.1:4000/api/subscriptions/webhooks/google-play?token=wrong'

echo "valid token test notification -> expect 200"
curl -s -o /dev/null -w '%{http_code}\n' -X POST \
  "http://127.0.0.1:4000/api/subscriptions/webhooks/google-play?token=${TOKEN}" \
  -H 'Content-Type: application/json' \
  -d "$PAYLOAD"

echo "config:"
curl -s http://127.0.0.1:4000/api/subscriptions/config
echo

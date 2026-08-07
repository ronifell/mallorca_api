#!/usr/bin/env bash
set -euo pipefail
cd ~/mallorca_api

NEW_TOKEN="$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")"
cp .env ".env.bak.rtdn.$(date +%s)"

node -e "
const fs = require('fs');
let text = fs.readFileSync('.env', 'utf8');
text = text.replace(/^GOOGLE_PLAY_RTDN_TOKEN=.*\n?/gm, '');
text = text.trimEnd() + '\n\nGOOGLE_PLAY_RTDN_TOKEN=${NEW_TOKEN}\n';
fs.writeFileSync('.env', text);
"

pm2 restart mallorca-api --update-env
sleep 2

echo "RTDN_TOKEN=${NEW_TOKEN}"
echo "WEBHOOK_URL=https://${API_DOMAIN:-100-48-93-44.nip.io}/api/subscriptions/webhooks/google-play?token=${NEW_TOKEN}"

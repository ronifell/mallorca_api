#!/usr/bin/env bash
# Configure Google Play billing on the production server.
#
# Prerequisites:
#   1. Copy the Play Console service-account JSON to ~/mallorca_api/play-service-account.json
#   2. In Play Console → Users and permissions, invite the service account email with:
#        • View financial data
#        • Manage orders and subscriptions
#
# Run on the server:
#   bash scripts/configure-play-billing-on-server.sh
set -euo pipefail
cd ~/mallorca_api

JSON_FILE="$PWD/play-service-account.json"

if [ ! -f "$JSON_FILE" ]; then
  echo "ERROR: Missing $JSON_FILE"
  echo "Download from Google Cloud → IAM → Service accounts → Keys,"
  echo "then copy to ~/mallorca_api/play-service-account.json"
  exit 1
fi

chmod 600 "$JSON_FILE"

SA_EMAIL="$(node -e "const j=require('$JSON_FILE'); if(!j.client_email||!j.private_key) process.exit(2); console.log(j.client_email);")"
echo "Service account: $SA_EMAIL"

cp .env ".env.bak.$(date +%s)"

node <<NODE
const fs = require('fs');
const path = require('path');
const envPath = path.join(process.cwd(), '.env');
let text = fs.readFileSync(envPath, 'utf8');

text = text.replace(/^GOOGLE_PLAY_PACKAGE_NAME=.*$/gm, '');
text = text.replace(/^GOOGLE_SERVICE_ACCOUNT_JSON_PATH=.*$/gm, '');
text = text.replace(/^GOOGLE_SERVICE_ACCOUNT_JSON=.*$/gm, '');
text = text.replace(/^BILLING_ALLOW_MOCK=.*$/gm, '');
text = text.replace(/\n{3,}/g, '\n\n').trimEnd() + '\n\n';

text += 'GOOGLE_PLAY_PACKAGE_NAME=es.citasmallorca.app\n';
text += 'GOOGLE_SERVICE_ACCOUNT_JSON_PATH=play-service-account.json\n';
text += 'GOOGLE_SERVICE_ACCOUNT_JSON=\n';
text += 'BILLING_ALLOW_MOCK=false\n';

fs.writeFileSync(envPath, text);
console.log('Updated .env Play billing vars');
NODE

grep -E '^GOOGLE_PLAY_PACKAGE_NAME=|^GOOGLE_SERVICE_ACCOUNT_JSON_PATH=|^GOOGLE_SERVICE_ACCOUNT_JSON=|^BILLING_ALLOW_MOCK=' .env \
  | sed 's/\(GOOGLE_SERVICE_ACCOUNT_JSON=\).*/\1<empty>/'

npm run build

echo ""
echo "=== verify-play-billing ==="
npx ts-node scripts/verify-play-billing.ts

pm2 restart 0 --update-env
sleep 3

echo ""
echo "=== /api/subscriptions/config ==="
curl -s http://127.0.0.1:4000/api/subscriptions/config
echo ""
echo ""
echo "Invite $SA_EMAIL in Play Console if verify-play-billing reported 401."

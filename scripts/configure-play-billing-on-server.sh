#!/usr/bin/env bash
set -euo pipefail
cd ~/mallorca_api

chmod 600 play-service-account.json

node -e "const j=require('./play-service-account.json'); if(!j.client_email||!j.private_key) process.exit(2); console.log('ok', j.client_email);"

cp .env ".env.bak.$(date +%s)"

node <<'NODE'
const fs = require('fs');
const path = require('path');
const envPath = path.join(process.cwd(), '.env');
let text = fs.readFileSync(envPath, 'utf8');

text = text.replace(/^GOOGLE_PLAY_PACKAGE_NAME=.*$/gm, '');
text = text.replace(/^GOOGLE_SERVICE_ACCOUNT_JSON_PATH=.*$/gm, '');
text = text.replace(/^GOOGLE_SERVICE_ACCOUNT_JSON=.*$/gm, '');
text = text.replace(/\n{3,}/g, '\n\n').trimEnd() + '\n\n';

text += 'GOOGLE_PLAY_PACKAGE_NAME=es.citasmallorca.app\n';
text += 'GOOGLE_SERVICE_ACCOUNT_JSON_PATH=play-service-account.json\n';
text += 'GOOGLE_SERVICE_ACCOUNT_JSON=\n';

fs.writeFileSync(envPath, text);
console.log('Updated .env Play billing vars');
NODE

# Ensure GOOGLE_SERVICE_ACCOUNT_JSON is empty (path-based) and package is set
grep -E '^GOOGLE_PLAY_PACKAGE_NAME=|^GOOGLE_SERVICE_ACCOUNT_JSON_PATH=|^GOOGLE_SERVICE_ACCOUNT_JSON=' .env | sed 's/\(GOOGLE_SERVICE_ACCOUNT_JSON=\).*/\1<empty>/'

npm run build

pm2 restart 0 --update-env
sleep 3
echo 'CONFIG:'
curl -s http://127.0.0.1:4000/api/subscriptions/config
echo
echo 'LOGS:'
pm2 logs 0 --lines 25 --nostream | tail -30

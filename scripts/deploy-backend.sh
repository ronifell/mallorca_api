#!/usr/bin/env bash
# Deploy backend to the production EC2 host and verify the FCM DELETE route.
#
# Run on the server (~/mallorca_api):
#   bash scripts/deploy-backend.sh
#
# Expected commit (local repo): e4d20df — adds DELETE /api/users/me/fcm-token
set -euo pipefail

cd "$(dirname "$0")/.."

EXPECTED_FEATURES=(
  "router.delete('/me/fcm-token'"
  "async deleteFcm"
  "clearFcmToken"
)

echo "=== mallorca_api deploy ==="
git fetch origin 2>/dev/null || true
GIT_COMMIT="$(git rev-parse HEAD)"
GIT_SHORT="$(git rev-parse --short HEAD)"
echo "Deploying commit: ${GIT_COMMIT} (${GIT_SHORT})"

for needle in "${EXPECTED_FEATURES[@]}"; do
  if ! grep -rq "$needle" src/modules/users/; then
    echo "ERROR: source missing expected feature: $needle"
    exit 1
  fi
done

export GIT_COMMIT
node <<NODE
const fs = require('fs');
const path = require('path');
const envPath = path.join(process.cwd(), '.env');
let text = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
text = text.replace(/^GIT_COMMIT=.*$/gm, '').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n\n';
text += 'GIT_COMMIT=${GIT_COMMIT}\n';
fs.writeFileSync(envPath, text);
console.log('Set GIT_COMMIT in .env');
NODE

npm run build

# pm2 restart clears the in-memory express-rate-limit counters (fixes 429 after logout loops).
if command -v pm2 >/dev/null 2>&1; then
  pm2 restart 0 --update-env
  sleep 3
else
  echo "WARN: pm2 not found — restart the Node process manually to apply changes and reset rate limits."
fi

echo ""
echo "=== /health ==="
curl -s "http://127.0.0.1:4000/health" || true
echo ""

echo ""
echo "=== FCM route smoke (unauthenticated — expect 401, NOT 404) ==="
FCM_STATUS="$(curl -s -o /dev/null -w '%{http_code}' -X DELETE 'http://127.0.0.1:4000/api/users/me/fcm-token')"
echo "DELETE /api/users/me/fcm-token → HTTP ${FCM_STATUS}"
if [ "$FCM_STATUS" = "404" ]; then
  echo "ERROR: DELETE route missing — deploy did not pick up users.routes.ts changes."
  exit 1
fi

echo ""
echo "Deploy complete. Verify from your machine:"
echo "  curl http://100.48.93.44:4000/health"
echo "  gitCommit should equal ${GIT_COMMIT}"

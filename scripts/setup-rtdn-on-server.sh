#!/usr/bin/env bash
# Configure GOOGLE_PLAY_RTDN_TOKEN and Pub/Sub push subscription on the server.
set -euo pipefail
cd ~/mallorca_api

PUSH_ENDPOINT_BASE="http://100.48.93.44:4000/api/subscriptions/webhooks/google-play"
SUBSCRIPTION_ID="mallorca-play-billing-push"
TOPIC_ID="${PLAY_BILLING_TOPIC:-play-billing-notifications}"

if [ ! -f play-service-account.json ]; then
  echo "ERROR: Missing play-service-account.json"
  exit 1
fi

# --- 1. Ensure RTDN token in .env ---
if grep -q '^GOOGLE_PLAY_RTDN_TOKEN=.\+' .env 2>/dev/null; then
  TOKEN="$(grep '^GOOGLE_PLAY_RTDN_TOKEN=' .env | cut -d= -f2-)"
  echo "Using existing GOOGLE_PLAY_RTDN_TOKEN from .env"
else
  TOKEN="$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")"
  cp .env ".env.bak.rtdn.$(date +%s)"
  node -e "
const fs = require('fs');
let text = fs.readFileSync('.env', 'utf8');
text = text.replace(/^GOOGLE_PLAY_RTDN_TOKEN=.*\n?/gm, '');
text = text.trimEnd() + '\n\nGOOGLE_PLAY_RTDN_TOKEN=${TOKEN}\n';
fs.writeFileSync('.env', text);
"
  echo "Added GOOGLE_PLAY_RTDN_TOKEN to .env"
fi

PUSH_ENDPOINT="${PUSH_ENDPOINT_BASE}?token=${TOKEN}"
echo "Push endpoint: ${PUSH_ENDPOINT_BASE}?token=***"

# --- 2. Configure Pub/Sub push subscription ---
node <<NODE
const { google } = require('googleapis');
const fs = require('fs');
const creds = require('./play-service-account.json');
const projectId = creds.project_id;
const topicId = process.env.TOPIC_ID || '${TOPIC_ID}';
const subscriptionId = '${SUBSCRIPTION_ID}';
const pushEndpoint = '${PUSH_ENDPOINT}';

(async () => {
  const auth = new google.auth.GoogleAuth({
    credentials: creds,
    scopes: ['https://www.googleapis.com/auth/pubsub'],
  });
  const pubsub = google.pubsub({ version: 'v1', auth });
  const topicName = \`projects/\${projectId}/topics/\${topicId}\`;
  const subName = \`projects/\${projectId}/subscriptions/\${subscriptionId}\`;

  const topics = await pubsub.projects.topics.list({ project: \`projects/\${projectId}\` });
  const topicNames = (topics.data.topics || []).map((t) => t.name);
  console.log('Available topics:', topicNames.join(', ') || '(none)');

  let resolvedTopic = topicName;
  if (!topicNames.includes(topicName)) {
    const playTopic = topicNames.find((n) =>
      /play|billing|rtdn|subscription/i.test(n),
    );
    if (playTopic) {
      resolvedTopic = playTopic;
      console.log('Using detected topic:', resolvedTopic);
    } else if (topicNames.length === 1) {
      resolvedTopic = topicNames[0];
      console.log('Using only available topic:', resolvedTopic);
    } else {
      throw new Error(
        \`Topic \${topicName} not found. Set PLAY_BILLING_TOPIC or create the topic in GCP.\`,
      );
    }
  }

  const pushConfig = {
    pushEndpoint,
    attributes: { 'x-goog-version': 'v1' },
  };

  try {
    await pubsub.projects.subscriptions.get({ subscription: subName });
    console.log('Updating existing subscription:', subName);
    await pubsub.projects.subscriptions.modifyPushConfig({
      subscription: subName,
      pushConfig,
    });
  } catch (err) {
    if (err.code !== 404) throw err;
    console.log('Creating push subscription:', subName);
    await pubsub.projects.subscriptions.create({
      name: subName,
      topic: resolvedTopic,
      pushConfig,
      ackDeadlineSeconds: 30,
      messageRetentionDuration: '604800s',
    });
  }

  const sub = await pubsub.projects.subscriptions.get({ subscription: subName });
  console.log('Push subscription ready:', sub.data.name);
  console.log('Push endpoint configured:', sub.data.pushConfig?.pushEndpoint?.replace(/token=[^&]+/, 'token=***'));
})();
NODE

# --- 3. Restart API with updated env ---
pm2 restart mallorca-api --update-env
sleep 3

echo ""
echo "=== /api/subscriptions/config ==="
curl -s http://127.0.0.1:4000/api/subscriptions/config
echo ""

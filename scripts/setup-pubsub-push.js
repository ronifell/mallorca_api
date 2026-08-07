/**
 * Configure Pub/Sub push subscription using Firebase admin credentials.
 * Run on server: node scripts/setup-pubsub-push.js
 */
require('dotenv').config();
const { google } = require('googleapis');

const projectId = process.env.FIREBASE_PROJECT_ID;
const token = process.env.GOOGLE_PLAY_RTDN_TOKEN;
if (!projectId || !token) {
  console.error('Missing FIREBASE_PROJECT_ID or GOOGLE_PLAY_RTDN_TOKEN');
  process.exit(1);
}

const topicId = process.env.PLAY_BILLING_TOPIC || 'play-billing-notifications';
const subscriptionId = 'mallorca-play-billing-push';
const apiHost = process.env.API_HTTPS_HOST || '100-48-93-44.nip.io';
const pushEndpoint =
  `https://${apiHost}/api/subscriptions/webhooks/google-play?token=` + token;

const privateKey = (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');

(async () => {
  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.FIREBASE_CLIENT_EMAIL,
      private_key: privateKey,
    },
    scopes: ['https://www.googleapis.com/auth/pubsub'],
  });
  const pubsub = google.pubsub({ version: 'v1', auth });

  const topics = await pubsub.projects.topics.list({ project: `projects/${projectId}` });
  const topicNames = (topics.data.topics || []).map((t) => t.name);
  console.log('Available topics:', topicNames.join(', ') || '(none)');

  const preferred = `projects/${projectId}/topics/${topicId}`;
  let resolvedTopic = preferred;
  if (!topicNames.includes(preferred)) {
    const playTopic = topicNames.find((n) => /play|billing|rtdn|subscription/i.test(n));
    if (playTopic) resolvedTopic = playTopic;
    else if (topicNames.length === 1) resolvedTopic = topicNames[0];
    else throw new Error(`Topic ${preferred} not found`);
  }
  console.log('Using topic:', resolvedTopic);

  const subName = `projects/${projectId}/subscriptions/${subscriptionId}`;
  const pushConfig = { pushEndpoint, attributes: { 'x-goog-version': 'v1' } };

  try {
    await pubsub.projects.subscriptions.get({ subscription: subName });
    console.log('Updating push config for', subName);
    await pubsub.projects.subscriptions.modifyPushConfig({ subscription: subName, pushConfig });
  } catch (err) {
    if (err.code !== 404) throw err;
    console.log('Creating push subscription', subName);
    await pubsub.projects.subscriptions.create({
      name: subName,
      topic: resolvedTopic,
      pushConfig,
      ackDeadlineSeconds: 30,
      messageRetentionDuration: '604800s',
    });
  }

  const sub = await pubsub.projects.subscriptions.get({ subscription: subName });
  const endpoint = sub.data.pushConfig?.pushEndpoint || '';
  console.log('OK push endpoint:', endpoint.replace(/token=[^&]+/, 'token=***'));
})().catch((err) => {
  console.error('PUBSUB_SETUP_FAILED:', err.message);
  if (err.response?.data) console.error(JSON.stringify(err.response.data, null, 2));
  process.exit(1);
});

/**
 * Send a test push to a specific user (or the most-recently-active user if no
 * arg is given). Usage:
 *
 *   npm run test:push -- email:someone@example.com
 *   npm run test:push -- id:9d3b77c5-b4ed-4993-8ef0-d32f2ad9dd52
 *   npm run test:push                    (auto-picks the first user with a token)
 *
 * The script exits with:
 *   - code 0 if FCM accepted the message
 *   - code 1 with a JSON body describing the failure otherwise
 */
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

import { env } from '../src/config/env';
import { pool } from '../src/config/database';

function parseTarget(): { column: 'email' | 'id'; value: string } | null {
  const arg = process.argv[2];
  if (!arg) return null;
  const [k, ...rest] = arg.split(':');
  const value = rest.join(':').trim();
  if (!value) return null;
  if (k === 'email' || k === 'id') return { column: k, value };
  return null;
}

async function main() {
  const admin = await import('firebase-admin');
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: env.firebase.projectId,
        clientEmail: env.firebase.clientEmail,
        privateKey: env.firebase.privateKey,
      }),
    });
  }

  const target = parseTarget();
  const q = target
    ? `SELECT id, email, fcm_token FROM users WHERE ${target.column} = $1 LIMIT 1`
    : `SELECT id, email, fcm_token FROM users WHERE fcm_token IS NOT NULL ORDER BY updated_at DESC LIMIT 1`;
  const args = target ? [target.value] : [];

  const r = await pool.query<{ id: string; email: string; fcm_token: string | null }>(q, args);
  const row = r.rows[0];
  if (!row) {
    console.log(JSON.stringify({ ok: false, reason: 'NO_MATCHING_USER', target }, null, 2));
    await pool.end();
    process.exit(1);
  }
  if (!row.fcm_token) {
    console.log(
      JSON.stringify(
        {
          ok: false,
          reason: 'USER_HAS_NO_FCM_TOKEN',
          userId: row.id,
          email: row.email,
          hint: 'Open the app on the device, log in as this user, grant notification permission, and re-run.',
        },
        null,
        2,
      ),
    );
    await pool.end();
    process.exit(1);
  }

  const res = await admin.messaging().sendEachForMulticast({
    tokens: [row.fcm_token],
    notification: {
      title: '🔔 Push test',
      body: 'Backend simulation — if you see this, FCM delivery works end-to-end.',
    },
    data: { type: 'test', sentAt: new Date().toISOString() },
    android: {
      priority: 'high',
      ttl: 60_000,
      notification: {
        channelId: 'default',
        icon: 'notification_icon',
        color: '#B82E2E',
        priority: 'high',
        defaultSound: true,
        visibility: 'public',
      },
    },
    apns: {
      headers: { 'apns-priority': '10' },
      payload: { aps: { alert: { title: 'Push test', body: 'FCM works.' }, sound: 'default' } },
    },
  });

  const first = res.responses[0];
  console.log(
    JSON.stringify(
      {
        ok: first?.success ?? false,
        userId: row.id,
        email: row.email,
        tokenPrefix: `${row.fcm_token.slice(0, 20)}…`,
        tokenLength: row.fcm_token.length,
        errorCode: first?.error?.code ?? null,
        errorMessage: first?.error?.message ?? null,
        successCount: res.successCount,
        failureCount: res.failureCount,
      },
      null,
      2,
    ),
  );

  await pool.end();
  process.exit(first?.success ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  await pool.end().catch(() => undefined);
  process.exit(1);
});

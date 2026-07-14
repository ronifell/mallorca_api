/**
 * Verifies Firebase Admin + notification pipeline without a physical device.
 * Run: npx ts-node scripts/verify-push.ts
 */
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

import { env } from '../src/config/env';
import { pool } from '../src/config/database';
import {
  ensureFirebaseInitialized,
  isFcmConfigured,
  notificationsService,
} from '../src/modules/notifications/notifications.service';

type StepResult = { step: string; ok: boolean; detail: string };

const results: StepResult[] = [];

function record(step: string, ok: boolean, detail: string) {
  results.push({ step, ok, detail });
  const mark = ok ? 'PASS' : 'FAIL';
  console.log(`[${mark}] ${step}: ${detail}`);
}

async function verifyFirebaseCredentials(): Promise<void> {
  record(
    'Firebase env vars',
    isFcmConfigured(),
    isFcmConfigured()
      ? `project=${env.firebase.projectId}`
      : `missing or invalid PEM — project=${!!env.firebase.projectId}, email=${!!env.firebase.clientEmail}, key=${env.firebase.privateKey.includes('BEGIN PRIVATE KEY')}`,
  );
  if (!isFcmConfigured()) return;

  const ok = ensureFirebaseInitialized();
  record(
    'Firebase Admin init (notifications service)',
    ok,
    ok ? 'credentials accepted via production code path' : 'see error logs above',
  );
}

async function verifyDatabaseTokens(): Promise<{ userId: string; email: string; token: string } | null> {
  try {
    const r = await pool.query<{ id: string; email: string; fcm_token: string | null }>(
      `SELECT id, email, fcm_token
       FROM users
       WHERE fcm_token IS NOT NULL AND length(trim(fcm_token)) > 10
       ORDER BY updated_at DESC NULLS LAST
       LIMIT 5`,
    );
    const count = r.rows.length;
    record(
      'FCM tokens in database',
      count > 0,
      count > 0
        ? `${count} user(s) with token (latest: ${r.rows[0]?.email})`
        : 'no users have fcm_token saved — app must use a native build and log in',
    );
    if (!r.rows[0]?.fcm_token) return null;
    return { userId: r.rows[0].id, email: r.rows[0].email, token: r.rows[0].fcm_token };
  } catch (e) {
    record('FCM tokens in database', false, e instanceof Error ? e.message : String(e));
    return null;
  }
}

async function verifyFcmApiReachable(): Promise<void> {
  try {
    const admin = await import('firebase-admin');
    const app = admin.apps[0];
    if (!app) {
      record('FCM API send (dry run)', false, 'Firebase not initialized');
      return;
    }
    // Invalid token proves the FCM HTTP v1 API is reachable with our credentials.
    const response = await admin.messaging().sendEachForMulticast({
      tokens: ['dry-run-invalid-fcm-token-for-verification'],
      notification: { title: 'Verify', body: 'Dry run' },
    });
    const err = response.responses[0]?.error;
    const apiWorks =
      !!err &&
      (err.code === 'messaging/invalid-argument' ||
        err.code === 'messaging/registration-token-not-registered');
    record(
      'FCM API send (dry run)',
      apiWorks,
      apiWorks
        ? `API reachable (${err?.code})`
        : `unexpected response: ${err?.code ?? 'no error'} ${err?.message ?? ''}`,
    );
  } catch (e) {
    record('FCM API send (dry run)', false, e instanceof Error ? e.message : String(e));
  }
}

async function verifyNotificationService(userId: string | null): Promise<void> {
  if (!userId) {
    record('notifyNewMessage (service)', false, 'skipped — no user with fcm_token');
    return;
  }
  try {
    await notificationsService.notifyNewMessage(userId, 'Push Verify Bot');
    record(
      'notifyNewMessage (service)',
      true,
      `invoked for user ${userId} — check device if token is valid`,
    );
  } catch (e) {
    record('notifyNewMessage (service)', false, e instanceof Error ? e.message : String(e));
  }
}

async function main() {
  console.log('=== Push notification verification ===\n');

  await verifyFirebaseCredentials();
  const latest = await verifyDatabaseTokens();
  await verifyFcmApiReachable();
  await verifyNotificationService(latest?.userId ?? null);

  console.log('\n=== Summary ===');
  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;
  console.log(`${passed} passed, ${failed} failed`);

  if (failed > 0) {
    console.log('\nLikely blockers:');
    if (!results.find((r) => r.step === 'Firebase env vars')?.ok) {
      console.log('- Set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY in Backend/.env');
    }
    if (!results.find((r) => r.step === 'FCM tokens in database')?.ok) {
      console.log('- Run app with: npx expo run:android (NOT Expo Go), log in, grant notification permission');
    }
    if (!results.find((r) => r.step === 'FCM API send (dry run)')?.ok) {
      console.log('- Fix Firebase service account credentials or enable Firebase Cloud Messaging API');
    }
    console.log('- Ensure the server your app calls (100.48.93.44) has the same FIREBASE_* vars if testing on device');
  }

  await pool.end();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await pool.end().catch(() => undefined);
  process.exit(1);
});

import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

import { env } from '../src/config/env';
import { pool } from '../src/config/database';

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

  const r = await pool.query<{ email: string; fcm_token: string }>(
    'SELECT email, fcm_token FROM users WHERE fcm_token IS NOT NULL LIMIT 1',
  );
  const row = r.rows[0];
  if (!row) {
    console.log('No user with fcm_token found');
    process.exit(1);
  }

  const res = await admin.messaging().sendEachForMulticast({
    tokens: [row.fcm_token],
    notification: {
      title: 'Push test',
      body: 'Backend simulation — if you see this, FCM works.',
    },
    data: { type: 'test' },
    android: { priority: 'high' },
  });

  const first = res.responses[0];
  console.log(JSON.stringify({
    email: row.email,
    success: first?.success ?? false,
    errorCode: first?.error?.code ?? null,
    errorMessage: first?.error?.message ?? null,
    successCount: res.successCount,
    failureCount: res.failureCount,
  }, null, 2));

  await pool.end();
  process.exit(first?.success ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  await pool.end().catch(() => undefined);
  process.exit(1);
});

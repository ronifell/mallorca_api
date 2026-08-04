/**
 * Verify Google Play billing credentials and Play Console API access.
 *
 * Usage (on the server, from ~/mallorca_api):
 *   npx ts-node scripts/verify-play-billing.ts
 *
 * Exit 0 = credentials loaded and Android Publisher API reachable.
 * Exit 1 = misconfiguration or insufficient Play Console permissions.
 */
import { env } from '../src/config/env';

async function main() {
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║   Google Play billing verification                       ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log(`packageName:           ${env.googlePlay.packageName || '(empty)'}`);
  console.log(`billing.allowMock:     ${env.billing.allowMock}`);
  console.log(`serviceAccount loaded: ${Boolean(env.googlePlay.serviceAccountJson)}`);

  if (!env.googlePlay.serviceAccountJson) {
    console.error('\nFAIL: No service account JSON loaded.');
    console.error('Fix: place play-service-account.json in ~/mallorca_api/ and set');
    console.error('     GOOGLE_SERVICE_ACCOUNT_JSON_PATH=play-service-account.json');
    console.error('     (or paste JSON into GOOGLE_SERVICE_ACCOUNT_JSON)');
    process.exit(1);
  }

  let creds: { client_email?: string; private_key?: string };
  try {
    creds = JSON.parse(env.googlePlay.serviceAccountJson) as {
      client_email?: string;
      private_key?: string;
    };
  } catch {
    console.error('\nFAIL: GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON.');
    process.exit(1);
  }

  if (!creds.client_email || !creds.private_key) {
    console.error('\nFAIL: service account JSON missing client_email or private_key.');
    process.exit(1);
  }

  console.log(`serviceAccountEmail:   ${creds.client_email}`);

  if (!env.googlePlay.packageName) {
    console.error('\nFAIL: GOOGLE_PLAY_PACKAGE_NAME is not set.');
    process.exit(1);
  }

  const { google } = await import('googleapis');
  const auth = new google.auth.GoogleAuth({
    credentials: creds,
    scopes: ['https://www.googleapis.com/auth/androidpublisher'],
  });
  const androidpublisher = google.androidpublisher({ version: 'v3', auth });

  // A deliberately invalid token: 404/400 means auth worked; 401 means permissions.
  const probeToken = 'verify-play-billing-probe-token';
  try {
    await androidpublisher.purchases.subscriptionsv2.get({
      packageName: env.googlePlay.packageName,
      token: probeToken,
    });
    console.log('\nUnexpected: probe token was accepted (should not happen).');
    process.exit(0);
  } catch (err: unknown) {
    const e = err as { code?: number; message?: string };
    const code = e?.code;
    const message = e?.message ?? String(err);

    console.log(`\nProbe API call → HTTP ${code ?? '?'}: ${message}`);

    if (code === 401) {
      console.error('\nFAIL: Service account lacks Play Console permissions.');
      console.error(`Invite ${creds.client_email} in Play Console → Users and permissions`);
      console.error('Required permissions:');
      console.error('  • View financial data');
      console.error('  • Manage orders and subscriptions');
      console.error('Changes can take a few minutes to propagate.');
      process.exit(1);
    }

    if (code === 404 || code === 400) {
      console.log('\nPASS: Android Publisher API credentials and permissions look OK.');
      console.log('(404/400 on a fake token is expected — real purchase tokens should validate.)');
      process.exit(0);
    }

    console.error('\nWARN: Unexpected API response — check package name and credentials.');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('\nVerification error:', err);
  process.exit(1);
});

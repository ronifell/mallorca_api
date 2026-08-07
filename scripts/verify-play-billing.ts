/**
 * Verify Google Play billing credentials and Play Console API access.
 *
 * Usage (on the server, from ~/mallorca_api):
 *   npm run verify:play-billing
 *
 * Exit 0 = credentials loaded and Android Publisher API reachable.
 * Exit 1 = misconfiguration or insufficient Play Console permissions.
 */
import { env } from '../src/config/env';
import {
  createAndroidPublisherClient,
  parsePlayServiceAccountJson,
} from '../src/utils/googlePlayPublisher';

type ApiError = { code?: number; message?: string };

function httpCode(err: unknown): number | undefined {
  return (err as ApiError)?.code;
}

function httpMessage(err: unknown): string {
  const e = err as ApiError;
  return e?.message ?? String(err);
}

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
    process.exit(1);
  }

  let creds;
  try {
    creds = parsePlayServiceAccountJson(env.googlePlay.serviceAccountJson);
  } catch (err) {
    console.error('\nFAIL:', httpMessage(err));
    process.exit(1);
  }

  console.log(`serviceAccountEmail:   ${creds.client_email}`);
  console.log(`gcpProjectId:          ${creds.project_id ?? '(missing in JSON)'}`);

  if (!env.googlePlay.packageName) {
    console.error('\nFAIL: GOOGLE_PLAY_PACKAGE_NAME is not set.');
    process.exit(1);
  }

  let androidpublisher;
  try {
    androidpublisher = await createAndroidPublisherClient(env.googlePlay.serviceAccountJson);
    console.log('\nStep 1 PASS: JWT auth — access token obtained.');
  } catch (err) {
    console.error('\nStep 1 FAIL: Could not authorize service account JWT.');
    console.error(httpMessage(err));
    console.error('Check private_key in JSON and that androidpublisher.googleapis.com is enabled.');
    process.exit(1);
  }

  // Catalog read — if this 401s, Play Console has not linked this GCP project / SA.
  try {
    const list = await androidpublisher.monetization.subscriptions.list({
      packageName: env.googlePlay.packageName,
      pageSize: 5,
    });
    const ids = (list.data.subscriptions ?? [])
      .map((s) => s.productId)
      .filter(Boolean)
      .slice(0, 5);
    console.log(
      `\nStep 2 PASS: monetization.subscriptions.list — ${list.data.subscriptions?.length ?? 0} subscription(s).`,
    );
    if (ids.length) console.log(`  productIds: ${ids.join(', ')}`);
  } catch (err) {
    const code = httpCode(err);
    console.log(`\nStep 2 → HTTP ${code ?? '?'}: monetization.subscriptions.list`);
    console.log(`  ${httpMessage(err)}`);
    if (code === 401) {
      console.error('\nFAIL: Play Console is not granting API access to this service account.');
      printPlayConsoleFix(creds.client_email, creds.project_id);
      process.exit(1);
    }
    if (code !== 404) {
      console.error('\nWARN: Unexpected list response — check package name.');
    }
  }

  const probeToken = 'verify-play-billing-probe-token';
  try {
    await androidpublisher.purchases.subscriptionsv2.get({
      packageName: env.googlePlay.packageName,
      token: probeToken,
    });
    console.log('\nUnexpected: probe purchase token was accepted.');
    process.exit(0);
  } catch (err) {
    const code = httpCode(err);
    console.log(`\nStep 3 → HTTP ${code ?? '?'}: purchases.subscriptionsv2.get (probe token)`);
    console.log(`  ${httpMessage(err)}`);

    if (code === 401) {
      console.error('\nFAIL: Purchase validation blocked (401).');
      printPlayConsoleFix(creds.client_email, creds.project_id);
      process.exit(1);
    }

    if (code === 404 || code === 400) {
      console.log('\nPASS: Android Publisher API credentials and permissions look OK.');
      console.log('Use Premium → Restore purchases on the device (not Subscribe again).');
      process.exit(0);
    }

    console.error('\nWARN: Unexpected probe response.');
    process.exit(1);
  }
}

function printPlayConsoleFix(serviceAccountEmail: string, projectId?: string) {
  console.error('\nThis is almost always Play Console ↔ GCP linking, not your app code.');
  console.error('\nChecklist:');
  console.error(`  1. Play Console → Settings → Developer account → Related services`);
  console.error(`     Link Google Cloud project${projectId ? ` "${projectId}"` : ''} (Firebase project).`);
  console.error(`  2. Play Console → Users and permissions → invite ${serviceAccountEmail}`);
  console.error('     Account: View financial data + Manage orders and subscriptions');
  console.error('     App (Citas Mallorca): include billing-related permissions');
  console.error('  3. Same Google account must own BOTH the Play developer account AND the GCP project.');
  console.error('  4. After changes, wait 15–60 min (new service accounts can take up to 48 h).');
  console.error('  5. On server, confirm the loaded email matches Play Console:');
  console.error('       node -e "console.log(require(\'./play-service-account.json\').client_email)"');
  console.error('  6. If still failing, contact Google Play Developer Support with this output.');
}

main().catch((err) => {
  console.error('\nVerification error:', err);
  process.exit(1);
});

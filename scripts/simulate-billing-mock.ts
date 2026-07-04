/**
 * Simulation script for the BILLING_ALLOW_MOCK toggle.
 *
 * What it proves:
 *   1. `GET /api/subscriptions/config` mirrors `env.billing.allowMock`.
 *   2. When mock mode is on, the frontend can complete a subscription with a
 *      fake purchase token and the backend grants Premium end-to-end.
 *   3. When mock mode is off, the same request is refused (unless a real
 *      Google service account is configured — we assume it is not, matching
 *      the current backend .env).
 *
 * Usage:
 *   # Simulate mock mode ON  (uses BILLING_ALLOW_MOCK from Backend/.env, currently true)
 *   npx ts-node scripts/simulate-billing-mock.ts
 *
 *   # Simulate mock mode OFF (overrides .env)
 *   $env:BILLING_ALLOW_MOCK='false'; npx ts-node scripts/simulate-billing-mock.ts
 */
import http from 'http';
import { createApp } from '../src/app';
import { env } from '../src/config/env';

interface Purchase {
  platform: 'google_play' | 'app_store';
  productId: 'monthly_premium' | 'annual_premium';
  purchaseToken: string;
}

function mockPurchase(productId: Purchase['productId']): Purchase {
  return {
    platform: 'google_play',
    productId,
    purchaseToken: `dev_token_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
  };
}

async function main() {
  const app = createApp();
  const server = http.createServer(app);
  const PORT = 4321;

  await new Promise<void>((resolve) => server.listen(PORT, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${PORT}/api`;

  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║   BILLING_ALLOW_MOCK simulation                          ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log(`process.env.BILLING_ALLOW_MOCK = ${JSON.stringify(process.env.BILLING_ALLOW_MOCK)}`);
  console.log(`env.billing.allowMock          = ${env.billing.allowMock}`);
  console.log(`env.googlePlay.serviceAccount  = ${env.googlePlay.serviceAccountJson ? '(configured)' : '(empty)'}`);
  console.log('');

  let userId: string | undefined;
  let accessToken: string | undefined;

  try {
    // ────────────────────────────────────────────────────────────
    // 1. GET /subscriptions/config  (public — mirrors env)
    // ────────────────────────────────────────────────────────────
    const configRes = await fetch(`${base}/subscriptions/config`);
    const config = (await configRes.json()) as { mockEnabled: boolean };
    console.log('[1] GET /subscriptions/config');
    console.log(`    → ${configRes.status} ${JSON.stringify(config)}`);
    console.log(`    mockEnabled matches env: ${config.mockEnabled === env.billing.allowMock ? 'YES ✓' : 'NO ✗'}`);
    console.log('');

    // ────────────────────────────────────────────────────────────
    // 2. Register a throwaway user to exercise the auth-gated flow
    // ────────────────────────────────────────────────────────────
    const email = `sim-billing-${Date.now()}@example.local`;
    const password = 'SimTest1234!';
    const regRes = await fetch(`${base}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, acceptedTerms: true, acceptedPrivacy: true }),
    });
    const reg = (await regRes.json()) as {
      accessToken?: string;
      user?: { id?: string };
      message?: string;
    };
    console.log('[2] POST /auth/register  (temp user)');
    console.log(`    → ${regRes.status} email=${email}`);
    if (regRes.status >= 400) {
      throw new Error(`Register failed: ${JSON.stringify(reg)}`);
    }
    accessToken = reg.accessToken;
    userId = reg.user?.id;
    console.log(`    userId=${userId}`);
    console.log('');

    const authHeaders = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    };

    // ────────────────────────────────────────────────────────────
    // 3. Simulate what Frontend/src/services/billing.ts does when
    //    setBillingMockMode(true) is applied.
    // ────────────────────────────────────────────────────────────
    const purchase = mockPurchase('monthly_premium');
    console.log('[3] Simulated frontend mockPurchase("monthly_premium")');
    console.log(`    → ${JSON.stringify(purchase)}`);
    console.log('');

    // ────────────────────────────────────────────────────────────
    // 4. POST /subscriptions/validate  — the real backend endpoint
    // ────────────────────────────────────────────────────────────
    const valRes = await fetch(`${base}/subscriptions/validate`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify(purchase),
    });
    const val = (await valRes.json()) as {
      isPremium?: boolean;
      expiryDate?: string;
      status?: string;
      productId?: string;
      message?: string;
    };
    console.log('[4] POST /subscriptions/validate');
    console.log(`    → ${valRes.status} ${JSON.stringify(val)}`);
    console.log('');

    // ────────────────────────────────────────────────────────────
    // 5. GET /subscriptions/status  — did Premium stick?
    // ────────────────────────────────────────────────────────────
    const statRes = await fetch(`${base}/subscriptions/status`, { headers: authHeaders });
    const stat = (await statRes.json()) as { isPremium: boolean; expiryDate: string | null };
    console.log('[5] GET /subscriptions/status');
    console.log(`    → ${statRes.status} ${JSON.stringify(stat)}`);
    console.log('');

    // ────────────────────────────────────────────────────────────
    // Summary
    // ────────────────────────────────────────────────────────────
    console.log('══════════════════ SUMMARY ══════════════════');
    if (env.billing.allowMock) {
      const ok = valRes.status === 201 && val.isPremium === true && stat.isPremium === true;
      console.log(`Expected: mock purchase succeeds, Premium granted`);
      console.log(`Result:   ${ok ? '✓ PASS' : '✗ FAIL'}`);
      if (val.expiryDate) {
        console.log(`Premium expires: ${new Date(val.expiryDate).toISOString()}`);
      }
    } else {
      const ok = valRes.status >= 400 && stat.isPremium === false;
      console.log(`Expected: mock purchase refused, no Premium`);
      console.log(`Result:   ${ok ? '✓ PASS' : '✗ FAIL'}`);
      console.log(`Backend refusal message: ${val.message ?? '(none)'}`);
    }
    console.log('═════════════════════════════════════════════');
  } finally {
    // Cleanup: delete the throwaway user so we don't leave test rows
    if (userId && accessToken) {
      try {
        const delRes = await fetch(`${base}/users/me`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        console.log(`\nCleanup: DELETE /users/me → ${delRes.status}`);
      } catch (err) {
        console.warn('Cleanup failed:', err);
      }
    }
    server.close();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\nSimulation error:', err);
    process.exit(1);
  });

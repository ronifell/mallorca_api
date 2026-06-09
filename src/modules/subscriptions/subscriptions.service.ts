/**
 * Subscription service.
 *
 * Server-side validates Google Play purchase tokens. Apple App Store
 * validation is stubbed out the same way for forward compatibility (the
 * architecture is platform-aware via `subscriptions.platform`).
 *
 * In dev/test, when GOOGLE_SERVICE_ACCOUNT_JSON is not configured, the
 * validation falls back to a generous 30/365-day grant. This makes it
 * straightforward to exercise the Premium gating end-to-end without
 * configuring Play credentials.
 */
import { query, withTransaction } from '../../config/database';
import { env } from '../../config/env';
import { BadRequest } from '../../utils/errors';
import { logger } from '../../utils/logger';

export type Plan = 'monthly_premium' | 'annual_premium';

const PRODUCT_DURATION_DAYS: Record<string, number> = {
  monthly_premium: 30,
  annual_premium: 365,
};

interface ValidatedPurchase {
  startDate: Date;
  expiryDate: Date;
  autoRenewing: boolean;
  raw: unknown;
}

async function validateWithGooglePlay(
  productId: string,
  purchaseToken: string,
): Promise<ValidatedPurchase> {
  if (!env.googlePlay.serviceAccountJson) {
    if (!env.billing.allowMock) {
      logger.warn('Refused mock purchase (BILLING_ALLOW_MOCK is not enabled)');
      throw BadRequest(
        'Premium purchases must be validated through Google Play. Please complete the in-app purchase flow.',
      );
    }
    logger.warn('GOOGLE_SERVICE_ACCOUNT_JSON not configured; granting MOCK subscription (dev only)');
    const days = PRODUCT_DURATION_DAYS[productId] ?? 30;
    const start = new Date();
    const expiry = new Date(start.getTime() + days * 24 * 60 * 60 * 1000);
    return { startDate: start, expiryDate: expiry, autoRenewing: true, raw: { dev: true } };
  }

  // Production: call Google Play Developer API.
  // androidpublisher.purchases.subscriptions.get
  //   https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.subscriptions/get
  //
  // We dynamic-import googleapis to avoid forcing the dependency in dev.
  const { google } = await import('googleapis');
  const credentials = JSON.parse(env.googlePlay.serviceAccountJson);
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/androidpublisher'],
  });
  const androidpublisher = google.androidpublisher({ version: 'v3', auth });
  const { data } = await androidpublisher.purchases.subscriptions.get({
    packageName: env.googlePlay.packageName,
    subscriptionId: productId,
    token: purchaseToken,
  });

  const startMs = Number(data.startTimeMillis ?? Date.now());
  const expiryMs = Number(data.expiryTimeMillis ?? Date.now());
  return {
    startDate: new Date(startMs),
    expiryDate: new Date(expiryMs),
    autoRenewing: !!data.autoRenewing,
    raw: data,
  };
}

async function validateWithAppStore(
  productId: string,
  _purchaseToken: string,
): Promise<ValidatedPurchase> {
  // Placeholder for future App Store Server Notifications / receipt validation.
  if (!env.billing.allowMock) {
    throw BadRequest(
      'App Store validation is not yet available. Please use Google Play to subscribe.',
    );
  }
  logger.warn('App Store validation not yet implemented; granting MOCK subscription (dev only)');
  const days = PRODUCT_DURATION_DAYS[productId] ?? 30;
  const start = new Date();
  const expiry = new Date(start.getTime() + days * 24 * 60 * 60 * 1000);
  return { startDate: start, expiryDate: expiry, autoRenewing: true, raw: { dev: true } };
}

export const subscriptionsService = {
  async validateAndActivate(
    userId: string,
    input: { platform: 'google_play' | 'app_store'; productId: string; purchaseToken: string },
  ): Promise<{ isPremium: boolean; expiryDate: string; status: string; productId: string }> {
    if (!PRODUCT_DURATION_DAYS[input.productId]) {
      throw BadRequest(`Unknown product id: ${input.productId}`);
    }

    const validated =
      input.platform === 'google_play'
        ? await validateWithGooglePlay(input.productId, input.purchaseToken)
        : await validateWithAppStore(input.productId, input.purchaseToken);

    await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO subscriptions
            (user_id, platform, product_id, purchase_token, start_date, expiry_date, status, raw_payload)
         VALUES ($1, $2, $3, $4, $5, $6, 'active', $7::jsonb)
         ON CONFLICT (platform, purchase_token)
         DO UPDATE SET
           expiry_date = EXCLUDED.expiry_date,
           status      = EXCLUDED.status,
           raw_payload = EXCLUDED.raw_payload,
           updated_at  = NOW()`,
        [
          userId,
          input.platform,
          input.productId,
          input.purchaseToken,
          validated.startDate,
          validated.expiryDate,
          JSON.stringify(validated.raw ?? {}),
        ],
      );
      await client.query(
        `UPDATE users SET is_premium = TRUE, premium_until = $2 WHERE id = $1`,
        [userId, validated.expiryDate],
      );
    });

    return {
      isPremium: true,
      expiryDate: validated.expiryDate.toISOString(),
      status: 'active',
      productId: input.productId,
    };
  },

  async getStatus(userId: string) {
    const r = await query<{
      is_premium: boolean;
      premium_until: Date | null;
    }>('SELECT is_premium, premium_until FROM users WHERE id = $1', [userId]);
    const u = r.rows[0];
    return {
      isPremium: u?.is_premium ?? false,
      expiryDate: u?.premium_until ? u.premium_until.toISOString() : null,
    };
  },

  /**
   * Cron-style cleanup. Marks expired subs as 'expired' and revokes premium.
   * Should be invoked by a scheduler (e.g. node-cron / external cron job).
   */
  async expireDue(): Promise<number> {
    const r = await query(
      `UPDATE subscriptions
         SET status = 'expired', updated_at = NOW()
         WHERE status = 'active' AND expiry_date < NOW()`,
    );
    await query(
      `UPDATE users SET is_premium = FALSE
         WHERE is_premium = TRUE
           AND (premium_until IS NULL OR premium_until < NOW())`,
    );
    return r.rowCount ?? 0;
  },
};

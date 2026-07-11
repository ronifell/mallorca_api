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
import type { androidpublisher_v3 } from 'googleapis';
import { query, withTransaction } from '../../config/database';
import { env } from '../../config/env';
import { premiumWelcomeEmail } from '../../services/emailTemplates';
import { sendMail } from '../../services/mailer';
import { BadRequest, Unauthorized } from '../../utils/errors';
import { logger } from '../../utils/logger';

export type Plan = 'monthly_premium' | 'annual_premium';

const PRODUCT_DURATION_DAYS: Record<string, number> = {
  monthly_premium: 30,
  annual_premium: 365,
};

/**
 * Statuses used by the DB `subscription_status_t` enum. Keep in sync with
 * `Backend/src/db/migrations/001_init.sql`.
 */
type DbSubscriptionStatus = 'active' | 'expired' | 'cancelled' | 'grace';

interface ValidatedPurchase {
  startDate: Date;
  expiryDate: Date;
  autoRenewing: boolean;
  /** DB-safe status to persist. */
  status: DbSubscriptionStatus;
  /**
   * True when Google reported paymentState=0 (payment pending — family
   * approval, bank hold…). We do NOT grant premium in this state; the
   * eventual RTDN "SUBSCRIPTION_PURCHASED" event will trigger a resync.
   */
  pending: boolean;
  raw: unknown;
}

/**
 * Google Play `purchases.subscriptions.get` response.
 * See: https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.subscriptions
 *
 * paymentState:
 *   undefined = subscription cancelled / expired (no active payment)
 *   0 = Payment pending (user's app should show pending UI)
 *   1 = Payment received
 *   2 = Free trial
 *   3 = Pending deferred upgrade/downgrade
 *
 * acknowledgementState:
 *   0 = yet to be acknowledged (Google will refund within 3 days if we don't)
 *   1 = acknowledged
 *
 * cancelReason (present iff cancelled):
 *   0 = User cancelled
 *   1 = System (e.g. billing error)
 *   2 = Replaced with new subscription
 *   3 = Developer cancelled
 */
type PlaySubscriptionPurchase = androidpublisher_v3.Schema$SubscriptionPurchase;

function parseServiceAccountCredentials(): Record<string, unknown> {
  const raw = env.googlePlay.serviceAccountJson;
  if (!raw) {
    throw BadRequest(
      'La facturación de Google Play no está configurada en el servidor. Contacta con soporte.',
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    logger.error('GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON');
    throw BadRequest(
      'Las credenciales de facturación de Google Play están mal configuradas en el servidor. Contacta con soporte.',
    );
  }
  if (!parsed || typeof parsed !== 'object') {
    throw BadRequest(
      'Las credenciales de facturación de Google Play están mal configuradas en el servidor. Contacta con soporte.',
    );
  }
  const creds = parsed as Record<string, unknown>;
  if (typeof creds.client_email !== 'string' || typeof creds.private_key !== 'string') {
    throw BadRequest(
      'Las credenciales de facturación de Google Play están incompletas en el servidor. Contacta con soporte.',
    );
  }
  return creds;
}

/** Cached AndroidPublisher client — avoids re-instantiating on every request. */
let cachedAndroidPublisher: androidpublisher_v3.Androidpublisher | null = null;
async function getAndroidPublisher(): Promise<androidpublisher_v3.Androidpublisher> {
  if (cachedAndroidPublisher) return cachedAndroidPublisher;
  const { google } = await import('googleapis');
  const credentials = parseServiceAccountCredentials();
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/androidpublisher'],
  });
  cachedAndroidPublisher = google.androidpublisher({ version: 'v3', auth });
  return cachedAndroidPublisher;
}

async function validateWithGooglePlay(
  productId: string,
  purchaseToken: string,
): Promise<ValidatedPurchase> {
  if (!env.googlePlay.serviceAccountJson || !env.googlePlay.packageName) {
    if (!env.billing.allowMock) {
      logger.warn('Refused mock purchase (BILLING_ALLOW_MOCK is not enabled)');
      throw BadRequest(
        'Las compras Premium deben validarse a través de Google Play. Completa el proceso de compra dentro de la app.',
      );
    }
    logger.warn('GOOGLE_SERVICE_ACCOUNT_JSON not configured; granting MOCK subscription (dev only)');
    const days = PRODUCT_DURATION_DAYS[productId] ?? 30;
    const start = new Date();
    const expiry = new Date(start.getTime() + days * 24 * 60 * 60 * 1000);
    return {
      startDate: start,
      expiryDate: expiry,
      autoRenewing: true,
      status: 'active',
      pending: false,
      raw: { dev: true },
    };
  }

  const androidpublisher = await getAndroidPublisher();
  let data: PlaySubscriptionPurchase;
  try {
    const res = await androidpublisher.purchases.subscriptions.get({
      packageName: env.googlePlay.packageName,
      subscriptionId: productId,
      token: purchaseToken,
    });
    data = res.data;
  } catch (err: unknown) {
    const e = err as { code?: number; message?: string };
    // 404 → token unknown (probably a fake or already-refunded token).
    if (e?.code === 404 || e?.code === 410) {
      throw BadRequest('Google Play no reconoce este token de compra.');
    }
    logger.error('Google Play validation failed', {
      productId,
      code: e?.code,
      message: e?.message,
    });
    throw BadRequest('La validación con Google Play ha fallado. Inténtalo de nuevo.');
  }

  const startMs = Number(data.startTimeMillis ?? Date.now());
  const expiryMs = Number(data.expiryTimeMillis ?? 0);
  if (!expiryMs) {
    throw BadRequest('Google Play ha devuelto una suscripción sin fecha de caducidad.');
  }

  const now = Date.now();
  if (expiryMs < now) {
    throw BadRequest('Esta suscripción ya ha caducado.');
  }

  // paymentState = undefined → cancelled / no active payment.
  // paymentState = 0        → payment pending (bank hold, family approval…)
  // paymentState = 1|2|3    → payment ok (received / trial / deferred change)
  const paymentState = data.paymentState ?? undefined;
  if (paymentState === undefined) {
    throw BadRequest('Esta suscripción ya no está activa.');
  }

  const pending = paymentState === 0;
  let status: DbSubscriptionStatus = 'active';
  // A cancelReason means the user (or Google) has cancelled the subscription
  // — but they still have access until expiry.
  if (data.cancelReason !== undefined && data.cancelReason !== null) {
    status = 'cancelled';
  }

  // Acknowledge within 3 days or Google auto-refunds. We do this here rather
  // than only from the client so a crash mid-flow can't cost the user their
  // money. Idempotent — safe to call on already-acknowledged tokens.
  if (data.acknowledgementState === 0 && !pending) {
    try {
      await androidpublisher.purchases.subscriptions.acknowledge({
        packageName: env.googlePlay.packageName,
        subscriptionId: productId,
        token: purchaseToken,
        requestBody: {},
      });
      logger.info('Google Play subscription acknowledged', { productId });
    } catch (err: unknown) {
      // Non-fatal: the client may still acknowledge, and Google returns 400
      // on already-acknowledged tokens. Log and continue.
      const e = err as { code?: number; message?: string };
      logger.warn('Google Play acknowledge failed (non-fatal)', {
        productId,
        code: e?.code,
        message: e?.message,
      });
    }
  }

  return {
    startDate: new Date(startMs),
    expiryDate: new Date(expiryMs),
    autoRenewing: !!data.autoRenewing,
    status,
    pending,
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
      'La validación con App Store aún no está disponible. Usa Google Play para suscribirte.',
    );
  }
  logger.warn('App Store validation not yet implemented; granting MOCK subscription (dev only)');
  const days = PRODUCT_DURATION_DAYS[productId] ?? 30;
  const start = new Date();
  const expiry = new Date(start.getTime() + days * 24 * 60 * 60 * 1000);
  return {
    startDate: start,
    expiryDate: expiry,
    autoRenewing: true,
    status: 'active',
    pending: false,
    raw: { dev: true },
  };
}

export const subscriptionsService = {
  async validateAndActivate(
    userId: string,
    input: { platform: 'google_play' | 'app_store'; productId: string; purchaseToken: string },
  ): Promise<{ isPremium: boolean; expiryDate: string; status: string; productId: string }> {
    const userRow = await query<{
      id: string;
      email: string;
      first_name: string | null;
      is_premium: boolean;
    }>(
      'SELECT id, email, first_name, is_premium FROM users WHERE id = $1',
      [userId],
    );
    const userBefore = userRow.rows[0];
    if (!userBefore) {
      throw Unauthorized('Tu sesión ya no es válida. Cierra sesión y vuelve a iniciarla.');
    }

    if (!PRODUCT_DURATION_DAYS[input.productId]) {
      throw BadRequest(`Producto desconocido: ${input.productId}`);
    }

    const validated =
      input.platform === 'google_play'
        ? await validateWithGooglePlay(input.productId, input.purchaseToken)
        : await validateWithAppStore(input.productId, input.purchaseToken);

    // Pending payments should not grant premium yet — Google will send a
    // Real-Time Developer Notification when the payment clears (or fails).
    if (validated.pending) {
      throw BadRequest(
        'Tu pago está pendiente. Activaremos Premium en cuanto Google lo confirme.',
      );
    }

    // If the subscription is cancelled but still has time remaining, we still
    // grant premium until expiry. Only future renewals will fail.
    const isPremium = validated.expiryDate.getTime() > Date.now();

    // Track whether we're inserting a fresh subscription row for this
    // (platform, purchase_token) pair. Only that case should trigger a
    // welcome email — retries of validateAndActivate with the same token
    // (e.g. after a network hiccup) must not re-send the email.
    let isFreshSubscription = false;

    await withTransaction(async (client) => {
      const insert = await client.query<{ inserted: boolean }>(
        `INSERT INTO subscriptions
            (user_id, platform, product_id, purchase_token, start_date, expiry_date, status, raw_payload)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
         ON CONFLICT (platform, purchase_token)
         DO UPDATE SET
           user_id     = EXCLUDED.user_id,
           expiry_date = EXCLUDED.expiry_date,
           status      = EXCLUDED.status,
           raw_payload = EXCLUDED.raw_payload,
           updated_at  = NOW()
         RETURNING (xmax = 0) AS inserted`,
        [
          userId,
          input.platform,
          input.productId,
          input.purchaseToken,
          validated.startDate,
          validated.expiryDate,
          validated.status,
          JSON.stringify(validated.raw ?? {}),
        ],
      );
      isFreshSubscription = insert.rows[0]?.inserted === true;

      if (isPremium) {
        await client.query(
          `UPDATE users SET is_premium = TRUE, premium_until = $2 WHERE id = $1`,
          [userId, validated.expiryDate],
        );
      }
    });

    // Only send the confirmation email on the very first activation of this
    // subscription (new row). This keeps the mail idempotent across retries
    // and skips renewals (which come through the RTDN webhook, not here).
    if (isPremium && isFreshSubscription) {
      void sendMail({
        to: userBefore.email,
        ...premiumWelcomeEmail({
          firstName: userBefore.first_name,
          plan: input.productId as 'monthly_premium' | 'annual_premium',
          expiryDate: validated.expiryDate,
        }),
      }).catch((err) => {
        logger.warn('Premium welcome email failed to send', {
          userId,
          err: err instanceof Error ? err.message : String(err),
        });
      });
    }

    return {
      isPremium,
      expiryDate: validated.expiryDate.toISOString(),
      status: validated.status,
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

  /**
   * Re-fetch a Google Play subscription (typically triggered by an RTDN
   * webhook: renewal, cancel, refund, grace period, on-hold…) and reconcile
   * our DB state.
   */
  async syncGooglePlayPurchase(productId: string, purchaseToken: string): Promise<void> {
    if (!env.googlePlay.serviceAccountJson || !env.googlePlay.packageName) {
      logger.warn('Cannot sync Google Play purchase — service account not configured');
      return;
    }

    const androidpublisher = await getAndroidPublisher();
    let data: PlaySubscriptionPurchase;
    try {
      const res = await androidpublisher.purchases.subscriptions.get({
        packageName: env.googlePlay.packageName,
        subscriptionId: productId,
        token: purchaseToken,
      });
      data = res.data;
    } catch (err: unknown) {
      const e = err as { code?: number; message?: string };
      // 404 typically means the purchase was refunded / voided.
      if (e?.code === 404 || e?.code === 410) {
        await query(
          `UPDATE subscriptions
              SET status = 'cancelled', updated_at = NOW()
            WHERE platform = 'google_play' AND purchase_token = $1`,
          [purchaseToken],
        );
        // Revoke premium for any user whose only active subscription was this one.
        await this.expireDue();
        return;
      }
      logger.error('RTDN sync: purchases.subscriptions.get failed', {
        productId,
        code: e?.code,
        message: e?.message,
      });
      return;
    }

    const expiryMs = Number(data.expiryTimeMillis ?? 0);
    const expiryDate = expiryMs ? new Date(expiryMs) : new Date(0);

    // Reduce Google's rich state model down to our four-value enum:
    //   active  — payment ok, not expired, not cancelled
    //   grace   — cancelled/on-hold but still within paid period
    //   cancelled — user cancelled or Google reports paymentState=undefined
    //   expired — past expiry
    let status: DbSubscriptionStatus = 'active';
    const hasCancelReason = data.cancelReason !== undefined && data.cancelReason !== null;
    if (data.paymentState === undefined || data.paymentState === null) {
      status = 'cancelled';
    } else if (hasCancelReason) {
      // Still has time on the clock → grace; otherwise cancelled outright.
      status = expiryMs > Date.now() ? 'grace' : 'cancelled';
    }
    if (expiryMs && expiryMs < Date.now()) status = 'expired';

    await withTransaction(async (client) => {
      const upd = await client.query<{ user_id: string }>(
        `UPDATE subscriptions
            SET expiry_date = $2,
                status      = $3,
                raw_payload = $4::jsonb,
                updated_at  = NOW()
          WHERE platform = 'google_play' AND purchase_token = $1
       RETURNING user_id`,
        [purchaseToken, expiryDate, status, JSON.stringify(data)],
      );

      if (upd.rowCount === 0) {
        // We don't know this token yet — likely a first-time renewal received
        // out of order. Nothing to reconcile until the client validates.
        logger.info('RTDN sync: unknown purchase token — skipping', { productId });
        return;
      }
      const userId = upd.rows[0].user_id;

      const isActive = status === 'active' && expiryMs > Date.now();
      await client.query(
        `UPDATE users
            SET is_premium    = $2,
                premium_until = CASE WHEN $2 THEN $3 ELSE premium_until END
          WHERE id = $1`,
        [userId, isActive, expiryDate],
      );
    });
  },
};

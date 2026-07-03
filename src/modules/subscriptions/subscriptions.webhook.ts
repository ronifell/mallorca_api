/**
 * Google Play Real-Time Developer Notification (RTDN) webhook.
 *
 * Play delivers renewal / cancellation / refund / grace / on-hold events via
 * a Google Cloud Pub/Sub topic. This endpoint is the "push" subscription for
 * that topic — Google POSTs each notification as:
 *
 *   POST /api/subscriptions/webhooks/google-play?token=<shared-secret>
 *   Content-Type: application/json
 *   {
 *     "message": {
 *        "data": "<base64 JSON DeveloperNotification>",
 *        "messageId": "...",
 *        "publishTime": "..."
 *     },
 *     "subscription": "projects/.../subscriptions/..."
 *   }
 *
 * The decoded `DeveloperNotification` has one of:
 *   - subscriptionNotification: { notificationType, purchaseToken, subscriptionId }
 *   - oneTimeProductNotification: (we don't use these)
 *   - testNotification: sent by Play Console "Send test notification" button
 *
 * Auth model: we don't rely on Google identity tokens (that requires OIDC
 * setup). Instead we require a shared secret in the query string, configured
 * on both sides. Set `GOOGLE_PLAY_RTDN_TOKEN` in the backend and paste the
 * same value in the Pub/Sub push subscription's endpoint URL.
 *
 * @see https://developer.android.com/google/play/billing/rtdn-reference
 */
import { Request, Response } from 'express';
import { env } from '../../config/env';
import { logger } from '../../utils/logger';
import { subscriptionsService } from './subscriptions.service';

interface PubSubEnvelope {
  message?: {
    data?: string;
    messageId?: string;
    publishTime?: string;
    attributes?: Record<string, string>;
  };
  subscription?: string;
}

interface DeveloperNotification {
  version?: string;
  packageName?: string;
  eventTimeMillis?: string | number;
  subscriptionNotification?: {
    version?: string;
    notificationType?: number;
    purchaseToken?: string;
    subscriptionId?: string;
  };
  oneTimeProductNotification?: {
    version?: string;
    notificationType?: number;
    purchaseToken?: string;
    sku?: string;
  };
  testNotification?: { version?: string };
}

/**
 * Google Play RTDN subscription notification types.
 * See: https://developer.android.com/google/play/billing/rtdn-reference#sub
 */
const NOTIFICATION_NAMES: Record<number, string> = {
  1: 'SUBSCRIPTION_RECOVERED',
  2: 'SUBSCRIPTION_RENEWED',
  3: 'SUBSCRIPTION_CANCELED',
  4: 'SUBSCRIPTION_PURCHASED',
  5: 'SUBSCRIPTION_ON_HOLD',
  6: 'SUBSCRIPTION_IN_GRACE_PERIOD',
  7: 'SUBSCRIPTION_RESTARTED',
  8: 'SUBSCRIPTION_PRICE_CHANGE_CONFIRMED',
  9: 'SUBSCRIPTION_DEFERRED',
  10: 'SUBSCRIPTION_PAUSED',
  11: 'SUBSCRIPTION_PAUSE_SCHEDULE_CHANGED',
  12: 'SUBSCRIPTION_REVOKED',
  13: 'SUBSCRIPTION_EXPIRED',
  20: 'SUBSCRIPTION_PENDING_PURCHASE_CANCELED',
};

function timingSafeStringEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

export async function handleGooglePlayRtdn(req: Request, res: Response): Promise<void> {
  const expectedToken = env.googlePlay.rtdnToken;
  const providedToken = String(req.query.token ?? req.query.t ?? '');

  // Always ACK Pub/Sub so it doesn't retry endlessly on config errors —
  // but log loudly. Missing config in prod is deployment mistake, not
  // something Google can fix by retrying.
  if (!expectedToken) {
    logger.error('RTDN webhook received but GOOGLE_PLAY_RTDN_TOKEN not configured');
    res.status(200).end();
    return;
  }
  if (!providedToken || !timingSafeStringEqual(providedToken, expectedToken)) {
    logger.warn('RTDN webhook: invalid or missing shared secret');
    res.status(401).end();
    return;
  }

  const envelope = req.body as PubSubEnvelope;
  const data = envelope?.message?.data;
  if (!data) {
    // Pub/Sub sometimes delivers keep-alive envelopes with no data. ACK.
    res.status(204).end();
    return;
  }

  let notification: DeveloperNotification;
  try {
    const json = Buffer.from(data, 'base64').toString('utf8');
    notification = JSON.parse(json);
  } catch (err) {
    logger.warn('RTDN webhook: unparseable message', {
      err: err instanceof Error ? err.message : String(err),
    });
    // Malformed — ACK so Pub/Sub doesn't retry. Nothing to reconcile.
    res.status(200).end();
    return;
  }

  if (notification.testNotification) {
    logger.info('RTDN test notification received', {
      version: notification.testNotification.version,
      packageName: notification.packageName,
    });
    res.status(200).end();
    return;
  }

  const sub = notification.subscriptionNotification;
  if (sub?.purchaseToken && sub.subscriptionId) {
    const typeName = sub.notificationType
      ? (NOTIFICATION_NAMES[sub.notificationType] ?? `TYPE_${sub.notificationType}`)
      : 'UNKNOWN';
    logger.info('RTDN subscription notification', {
      type: typeName,
      productId: sub.subscriptionId,
      packageName: notification.packageName,
    });

    try {
      await subscriptionsService.syncGooglePlayPurchase(
        sub.subscriptionId,
        sub.purchaseToken,
      );
    } catch (err) {
      logger.error('RTDN reconcile failed', {
        productId: sub.subscriptionId,
        err: err instanceof Error ? err.message : String(err),
      });
      // Return 500 so Pub/Sub retries with backoff.
      res.status(500).end();
      return;
    }
  } else if (notification.oneTimeProductNotification) {
    logger.info('RTDN one-time product notification (ignored — not used)', {
      sku: notification.oneTimeProductNotification.sku,
    });
  }

  res.status(200).end();
}

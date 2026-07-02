/**
 * FCM (Firebase Cloud Messaging) notification service.
 *
 * Initialization is lazy so a missing FIREBASE_* env var doesn't crash the
 * process; we simply log and skip sending. This is helpful for local dev and
 * for staging environments that should not deliver real pushes.
 */
import { query } from '../../config/database';
import { env } from '../../config/env';
import { logger } from '../../utils/logger';

type FirebaseModule = typeof import('firebase-admin');

let firebase: FirebaseModule | null = null;
let initialized = false;
let initFailed = false;

async function getFirebase(): Promise<FirebaseModule | null> {
  if (initFailed) return null;
  if (initialized && firebase) return firebase;
  if (!env.firebase.projectId || !env.firebase.clientEmail || !env.firebase.privateKey) {
    initFailed = true;
    logger.warn('FCM not configured; push notifications disabled');
    return null;
  }
  try {
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
    firebase = admin;
    initialized = true;
    return admin;
  } catch (e) {
    initFailed = true;
    logger.error('Failed to initialize Firebase Admin', {
      err: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}

async function tokensForUser(userId: string): Promise<string[]> {
  const r = await query<{ fcm_token: string | null }>(
    'SELECT fcm_token FROM users WHERE id = $1',
    [userId],
  );
  return r.rows.map((x) => x.fcm_token).filter((t): t is string => !!t);
}

async function isPrefEnabled(
  userId: string,
  pref: 'matches_enabled' | 'messages_enabled' | 'subscription_enabled',
): Promise<boolean> {
  const r = await query<{ enabled: boolean | null }>(
    `SELECT ${pref} AS enabled FROM notification_settings WHERE user_id = $1`,
    [userId],
  );
  return r.rows[0]?.enabled ?? true;
}

/**
 * FCM data payloads must be string-only.
 * Expo Android reads `title` + `message` (not `body`) when presenting data-only pushes
 * while the app is backgrounded or killed — see RemoteNotificationContent.kt.
 */
function buildDataPayload(
  title: string,
  body: string,
  data?: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {
    title,
    body,
    message: body,
    channelId: 'default',
    color: '#B82E2E',
    priority: 'high',
  };
  if (data) {
    for (const [key, value] of Object.entries(data)) {
      if (value != null) out[key] = String(value);
    }
  }
  return out;
}

async function clearInvalidToken(userId: string, token: string): Promise<void> {
  await query('UPDATE users SET fcm_token = NULL WHERE id = $1 AND fcm_token = $2', [
    userId,
    token,
  ]);
}

async function push(
  userId: string,
  payload: { title: string; body: string; data?: Record<string, string> },
) {
  const type = payload.data?.type ?? 'unknown';
  const admin = await getFirebase();
  if (!admin) {
    logger.warn('FCM push skipped — Firebase not configured', { userId, type });
    return;
  }
  const tokens = await tokensForUser(userId);
  if (!tokens.length) {
    logger.warn('FCM push skipped — no device token saved for user', { userId, type });
    return;
  }

  const data = buildDataPayload(payload.title, payload.body, payload.data);

  try {
    // Data-only on Android so ExpoFirebaseMessagingService always receives the message
    // (foreground, background, and killed). Notification+data payloads are handled by the
    // OS tray when backgrounded and skip onMessageReceived, which breaks Expo channels/icons.
    const result = await admin.messaging().sendEachForMulticast({
      tokens,
      data,
      android: {
        priority: 'high',
      },
      apns: {
        headers: { 'apns-priority': '10' },
        payload: {
          aps: {
            alert: { title: payload.title, body: payload.body },
            sound: 'default',
          },
        },
      },
    });

    let successCount = 0;
    result.responses.forEach((response, index) => {
      if (response.success) {
        successCount += 1;
        return;
      }
      const err = response.error;
      logger.error('FCM send failed for token', {
        userId,
        type,
        tokenIndex: index,
        code: err?.code,
        err: err?.message,
      });
      if (
        err?.code === 'messaging/registration-token-not-registered' ||
        err?.code === 'messaging/invalid-registration-token' ||
        err?.code === 'messaging/invalid-argument'
      ) {
        void clearInvalidToken(userId, tokens[index]!);
      }
    });

    if (successCount > 0) {
      logger.info('FCM push delivered', { userId, type, successCount, tokenCount: tokens.length });
    }
  } catch (e) {
    logger.error('FCM send failed', {
      userId,
      type,
      err: e instanceof Error ? e.message : String(e),
    });
  }
}

export const notificationsService = {
  async notifyNewMatch(userAId: string, userBId: string) {
    // Send to both directions.
    await Promise.all(
      [userAId, userBId].map(async (uid) => {
        if (!(await isPrefEnabled(uid, 'matches_enabled'))) return;
        await push(uid, {
          title: '¡Nuevo match! / New match!',
          body: 'Tienes un nuevo match. / You have a new match.',
          data: { type: 'new_match' },
        });
      }),
    );
  },

  async notifyNewLike(receiverId: string, senderId: string) {
    if (!(await isPrefEnabled(receiverId, 'matches_enabled'))) return;
    const r = await query<{ first_name: string | null }>(
      'SELECT first_name FROM users WHERE id = $1',
      [senderId],
    );
    const name = r.rows[0]?.first_name?.trim() ?? '';
    await push(receiverId, {
      title: '💖 New Like!',
      body: name
        ? `${name} te ha dado like. / ${name} liked you.`
        : 'Alguien te ha dado like. / Someone liked you.',
      data: { type: 'new_like', fromUserId: senderId },
    });
  },

  async notifySuperLike(receiverId: string, senderId: string) {
    if (!(await isPrefEnabled(receiverId, 'matches_enabled'))) return;
    const r = await query<{ first_name: string | null }>(
      'SELECT first_name FROM users WHERE id = $1',
      [senderId],
    );
    const name = r.rows[0]?.first_name?.trim() ?? '';
    await push(receiverId, {
      title: '⭐ Super Like!',
      body: name
        ? `${name} te ha enviado un Super Like. / ${name} sent you a Super Like.`
        : 'Alguien te ha enviado un Super Like. / Someone sent you a Super Like.',
      data: { type: 'super_like', fromUserId: senderId },
    });
  },

  async notifyNewMessage(
    receiverId: string,
    fromName: string,
    conversationId?: string,
    preview?: string,
  ) {
    if (!(await isPrefEnabled(receiverId, 'messages_enabled'))) return;
    const body =
      preview?.trim() || 'Tienes un nuevo mensaje. / You received a new message.';
    await push(receiverId, {
      title: fromName || 'Nuevo mensaje',
      body,
      data: {
        type: 'new_message',
        ...(conversationId ? { conversationId } : {}),
      },
    });
  },

  async notifySubscriptionExpiring(userId: string) {
    if (!(await isPrefEnabled(userId, 'subscription_enabled'))) return;
    await push(userId, {
      title: 'Tu suscripción está por caducar / Your subscription is expiring',
      body: 'Renueva tu Premium para seguir disfrutando de todas las funciones.',
      data: { type: 'subscription_expiring' },
    });
  },
};

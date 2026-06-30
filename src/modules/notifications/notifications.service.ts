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

async function push(
  userId: string,
  payload: { title: string; body: string; data?: Record<string, string> },
) {
  const admin = await getFirebase();
  if (!admin) return;
  const tokens = await tokensForUser(userId);
  if (!tokens.length) return;

  try {
    await admin.messaging().sendEachForMulticast({
      tokens,
      notification: { title: payload.title, body: payload.body },
      data: payload.data,
      android: { priority: 'high' },
      apns: {
        payload: { aps: { sound: 'default', contentAvailable: true } },
      },
    });
  } catch (e) {
    logger.error('FCM send failed', { err: e instanceof Error ? e.message : String(e) });
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

  async notifyNewMessage(receiverId: string, fromName: string) {
    if (!(await isPrefEnabled(receiverId, 'messages_enabled'))) return;
    await push(receiverId, {
      title: fromName || 'Nuevo mensaje',
      body: 'Tienes un nuevo mensaje. / You received a new message.',
      data: { type: 'new_message' },
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

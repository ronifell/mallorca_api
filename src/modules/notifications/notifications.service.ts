/**
 * FCM (Firebase Cloud Messaging) notification service.
 *
 * Initialization is lazy so a missing FIREBASE_* env var doesn't crash the
 * process; we simply log and skip sending. This is helpful for local dev and
 * for staging environments that should not deliver real pushes.
 */
import admin from 'firebase-admin';
import { query } from '../../config/database';
import { env } from '../../config/env';
import { logger } from '../../utils/logger';

let initialized = false;
let initFailed = false;
let missingConfigLogged = false;

export function isFcmConfigured(): boolean {
  const { projectId, clientEmail, privateKey } = env.firebase;
  return !!(
    projectId &&
    clientEmail &&
    privateKey &&
    privateKey.includes('BEGIN PRIVATE KEY')
  );
}

/** Used by verify-push.ts to exercise the same init path as live chat pushes. */
export function ensureFirebaseInitialized(): boolean {
  return getFirebase() !== null;
}

function getFirebase(): typeof admin | null {
  if (initFailed) return null;
  if (initialized) return admin;
  if (!isFcmConfigured()) {
    if (!missingConfigLogged) {
      missingConfigLogged = true;
      logger.warn('FCM not configured; push notifications disabled');
    }
    return null;
  }
  try {
    if (admin.apps.length === 0) {
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId: env.firebase.projectId,
          clientEmail: env.firebase.clientEmail,
          privateKey: env.firebase.privateKey,
        }),
      });
    }
    initialized = true;
    logger.info('Firebase Admin initialized for FCM', { projectId: env.firebase.projectId });
    return admin;
  } catch (e) {
    initFailed = true;
    logger.error('Failed to initialize Firebase Admin', {
      err: e instanceof Error ? e.message : String(e),
      stack: e instanceof Error ? e.stack : undefined,
      privateKeyLength: env.firebase.privateKey.length,
      hasBeginMarker: env.firebase.privateKey.includes('BEGIN PRIVATE KEY'),
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
    sound: 'default',
    vibrate: 'true',
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
  const adminSdk = getFirebase();
  if (!adminSdk) {
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
    // Hybrid payload: Android shows the `notification` block in the system tray
    // when the app is backgrounded/killed (most reliable path). The `data` block
    // is still delivered for Expo when onMessageReceived runs in the foreground.
    const result = await adminSdk.messaging().sendEachForMulticast({
      tokens,
      notification: {
        title: payload.title,
        body: payload.body,
      },
      data,
      android: {
        priority: 'high',
        ttl: 86_400,
        notification: {
          channelId: 'default',
          icon: 'notification_icon',
          color: '#B82E2E',
          priority: 'high',
          defaultSound: true,
          visibility: 'public',
        },
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
    const err = e as { code?: string; message?: string } | undefined;
    logger.error('FCM send failed', {
      userId,
      type,
      code: err?.code ?? null,
      err: err?.message ?? String(e),
      hint:
        err?.code === 'app/invalid-credential'
          ? 'Firebase service account key is invalid/revoked. Regenerate at Firebase Console → Project Settings → Service accounts → Generate new private key, then update FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY in .env.'
          : undefined,
    });
  }
}

type AppLang = 'en' | 'es';

async function firstNameOf(userId: string): Promise<string> {
  const r = await query<{ first_name: string | null }>(
    'SELECT first_name FROM users WHERE id = $1',
    [userId],
  );
  return r.rows[0]?.first_name?.trim() ?? '';
}

/** Receiver's selected app language (`users.language`), not the sender's. */
async function languageOf(userId: string): Promise<AppLang> {
  const r = await query<{ language: string | null }>(
    'SELECT language FROM users WHERE id = $1',
    [userId],
  );
  const raw = (r.rows[0]?.language ?? 'es').toLowerCase();
  return raw.startsWith('en') ? 'en' : 'es';
}

const PUSH_COPY = {
  matchTitle: {
    en: '🎉 Congrats!',
    es: '🎉 ¡Enhorabuena!',
  },
  matchBody: {
    en: (name: string) => `You matched with ${name}! Start the conversation.`,
    es: (name: string) => `¡Has hecho un match con ${name}! Empieza la conversación.`,
  },
  matchBodyAnonymous: {
    en: 'You have a new match! Open it and discover who you connected with.',
    es: '¡Has hecho un nuevo match! Ábrelo y descubre con quién has conectado.',
  },
  likeTitle: {
    en: '💖 New Like!',
    es: '💖 ¡Nuevo Like!',
  },
  likeBody: {
    en: (name: string) => `${name} liked you. Check out their profile!`,
    es: (name: string) => `A ${name} le gustas. ¡Descubre su perfil!`,
  },
  likeBodyAnonymous: {
    en: 'Someone liked you! Find out who.',
    es: '¡Alguien te ha dado like! Descubre quién ha sido.',
  },
  superLikeTitle: {
    en: "⭐ You're a superstar!",
    es: '⭐ ¡Eres una superestrella!',
  },
  superLikeBody: {
    en: 'Someone sent you a Super Like this week. Check out who sent it!',
    es: 'Alguien te envió un Super Like esta semana. ¡Comprueba quién lo envió!',
  },
  messageDefaultBody: {
    en: 'You have a new message.',
    es: 'Tienes un nuevo mensaje.',
  },
  messageDefaultTitle: {
    en: 'New message',
    es: 'Nuevo mensaje',
  },
  subscriptionTitle: {
    en: 'Your subscription is about to expire',
    es: 'Tu suscripción está a punto de caducar',
  },
  subscriptionBody: {
    en: 'Renew Premium to keep enjoying every feature.',
    es: 'Renueva tu Premium para seguir disfrutando de todas las funciones.',
  },
} as const;

export const notificationsService = {
  async notifyNewMatch(userAId: string, userBId: string, matchId?: string) {
    // Fetch both display names once so each push can include the OTHER
    // user's name in the title / body.
    const [nameA, nameB] = await Promise.all([firstNameOf(userAId), firstNameOf(userBId)]);

    const targets: { uid: string; otherName: string }[] = [
      { uid: userAId, otherName: nameB },
      { uid: userBId, otherName: nameA },
    ];

    await Promise.all(
      targets.map(async ({ uid, otherName }) => {
        if (!(await isPrefEnabled(uid, 'matches_enabled'))) return;
        const lang = await languageOf(uid);
        await push(uid, {
          title: PUSH_COPY.matchTitle[lang],
          body: otherName
            ? PUSH_COPY.matchBody[lang](otherName)
            : PUSH_COPY.matchBodyAnonymous[lang],
          data: {
            type: 'new_match',
            ...(matchId ? { matchId } : {}),
          },
        });
      }),
    );
  },

  async notifyNewLike(receiverId: string, senderId: string) {
    if (!(await isPrefEnabled(receiverId, 'matches_enabled'))) return;
    const [name, lang] = await Promise.all([firstNameOf(senderId), languageOf(receiverId)]);
    await push(receiverId, {
      title: PUSH_COPY.likeTitle[lang],
      body: name
        ? PUSH_COPY.likeBody[lang](name)
        : PUSH_COPY.likeBodyAnonymous[lang],
      data: { type: 'new_like', fromUserId: senderId },
    });
  },

  async notifySuperLike(receiverId: string, senderId: string) {
    if (!(await isPrefEnabled(receiverId, 'matches_enabled'))) return;
    // Intentionally does NOT reveal the sender's name — the "check who sent
    // it" hook drives the user back into the app.
    const lang = await languageOf(receiverId);
    await push(receiverId, {
      title: PUSH_COPY.superLikeTitle[lang],
      body: PUSH_COPY.superLikeBody[lang],
      data: { type: 'super_like', fromUserId: senderId },
    });
  },

  async notifyNewMessage(
    receiverId: string,
    fromName: string,
    conversationId?: string,
    preview?: string,
  ) {
    if (!(await isPrefEnabled(receiverId, 'messages_enabled'))) {
      logger.info('FCM push skipped — message notifications disabled for user', {
        receiverId,
        conversationId,
      });
      return;
    }
    const lang = await languageOf(receiverId);
    const body = preview?.trim() || PUSH_COPY.messageDefaultBody[lang];
    logger.info('FCM push sending new_message', { receiverId, conversationId });
    await push(receiverId, {
      title: fromName || PUSH_COPY.messageDefaultTitle[lang],
      body,
      data: {
        type: 'new_message',
        ...(conversationId ? { conversationId } : {}),
      },
    });
  },

  async notifySubscriptionExpiring(userId: string) {
    if (!(await isPrefEnabled(userId, 'subscription_enabled'))) return;
    const lang = await languageOf(userId);
    await push(userId, {
      title: PUSH_COPY.subscriptionTitle[lang],
      body: PUSH_COPY.subscriptionBody[lang],
      data: { type: 'subscription_expiring' },
    });
  },
};

/**
 * Real-time push for new matches.
 *
 * When a like becomes a match, we emit a `match:new` socket event to BOTH
 * users so that the celebration modal can appear on each device in real
 * time — not just on the screen of the user who tapped "like" last (whose
 * client already learned about the match from the HTTP response).
 *
 * The payload is sized to be exactly what the `MatchModal` component needs:
 * the OTHER user's id / firstName / first photo URL and the matchId so the
 * "Send a message" CTA can open the conversation directly.
 */
import { query } from '../../config/database';
import { resolveStoredUrl } from '../../services/storage';
import { getIO } from '../../sockets/io';
import { logger } from '../../utils/logger';

interface MatchEventUser {
  id: string;
  firstName: string | null;
  photo: string | null;
}

async function loadMatchUsers(
  userAId: string,
  userBId: string,
): Promise<Record<string, MatchEventUser> | null> {
  const r = await query<{
    id: string;
    first_name: string | null;
    image_url: string | null;
    storage_key: string | null;
  }>(
    `SELECT u.id,
            u.first_name,
            ph.image_url,
            ph.storage_key
       FROM users u
       LEFT JOIN LATERAL (
         SELECT image_url, storage_key
           FROM photos
          WHERE user_id = u.id
          ORDER BY order_index ASC
          LIMIT 1
       ) ph ON TRUE
      WHERE u.id IN ($1, $2)`,
    [userAId, userBId],
  );
  if (r.rowCount !== 2) return null;
  const out: Record<string, MatchEventUser> = {};
  for (const row of r.rows) {
    out[row.id] = {
      id: row.id,
      firstName: row.first_name,
      photo: row.image_url ? resolveStoredUrl(row.image_url, row.storage_key) : null,
    };
  }
  return out;
}

/**
 * Emit `match:new` to each user, with the OTHER user's lightweight profile.
 *
 * Fire-and-forget. Any DB or socket error is logged but does not bubble up,
 * because the match itself has already been persisted and the HTTP response
 * is independent of this side effect.
 */
export async function emitMatchEvents(
  userAId: string,
  userBId: string,
  matchId: string,
): Promise<void> {
  try {
    const users = await loadMatchUsers(userAId, userBId);
    const io = getIO();

    const payloadFor = (otherId: string) => {
      const profile = users?.[otherId];
      return {
        matchId,
        otherUser: profile ?? { id: otherId, firstName: null, photo: null },
      };
    };

    if (!users) {
      logger.warn('emitMatchEvents: full profiles unavailable, emitting minimal payload', {
        userAId,
        userBId,
        matchId,
      });
    }

    io.to(`user:${userAId}`).emit('match:new', payloadFor(userBId));
    io.to(`user:${userBId}`).emit('match:new', payloadFor(userAId));
  } catch (e) {
    logger.error('emitMatchEvents failed', {
      err: e instanceof Error ? e.message : String(e),
      userAId,
      userBId,
      matchId,
    });
  }
}

export interface LikeEventPayload {
  fromUserId: string;
  fromName: string | null;
}

export type SuperLikeEventPayload = LikeEventPayload;

async function loadSenderFirstName(senderId: string): Promise<string | null> {
  const r = await query<{ first_name: string | null }>(
    'SELECT first_name FROM users WHERE id = $1',
    [senderId],
  );
  return r.rows[0]?.first_name?.trim() || null;
}

/**
 * Notify the receiver in real time so foreground clients can show a local banner
 * (FCM alone is unreliable while the app is open on Android).
 */
export async function emitLikeEvent(
  receiverId: string,
  senderId: string,
): Promise<void> {
  try {
    const fromName = await loadSenderFirstName(senderId);
    const io = getIO();
    io.to(`user:${receiverId}`).emit('like:new', {
      fromUserId: senderId,
      fromName,
    } satisfies LikeEventPayload);
  } catch (e) {
    logger.error('emitLikeEvent failed', {
      err: e instanceof Error ? e.message : String(e),
      receiverId,
      senderId,
    });
  }
}

export async function emitSuperLikeEvent(
  receiverId: string,
  senderId: string,
): Promise<void> {
  try {
    const fromName = await loadSenderFirstName(senderId);
    const io = getIO();
    io.to(`user:${receiverId}`).emit('super_like:new', {
      fromUserId: senderId,
      fromName,
    } satisfies SuperLikeEventPayload);
  } catch (e) {
    logger.error('emitSuperLikeEvent failed', {
      err: e instanceof Error ? e.message : String(e),
      receiverId,
      senderId,
    });
  }
}

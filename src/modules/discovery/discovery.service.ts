import { query, withTransaction } from '../../config/database';
import { resolveStoredUrl } from '../../services/storage';
import { calculateAge } from '../../utils/age';
import { BadRequest, NotFound, Forbidden, TooMany } from '../../utils/errors';
import { isUserPremium } from '../../utils/premium';
import {
  Gender,
  InterestedIn,
  acceptedGendersFor,
  interestsAcceptingGender,
  isMutuallyCompatible,
} from './compatibility';

export type RelationshipGoal =
  | 'love'
  | 'friendship'
  | 'chat'
  | 'casual'
  | 'serious'
  | 'long_term';

export interface FeedCandidate {
  id: string;
  firstName: string | null;
  age: number;
  city: string | null;
  bio: string | null;
  gender: Gender | null;
  interestedIn: InterestedIn | null;
  photos: { id: string; url: string; orderIndex: number }[];
  languages: string[];
  isPremium: boolean;
  relationshipGoals: RelationshipGoal[];
  minAge: number;
  maxAge: number;
}

export interface LikeUser extends FeedCandidate {
  likedAt: string;
  isSuperLike: boolean;
}

interface ViewerProfile {
  id: string;
  gender: Gender;
  interestedIn: InterestedIn;
  minAge: number;
  maxAge: number;
  birthDate: Date;
}

async function loadViewer(userId: string): Promise<ViewerProfile> {
  const r = await query<{
    id: string;
    gender: Gender | null;
    birth_date: Date | null;
    interested_in: InterestedIn | null;
    min_age: number | null;
    max_age: number | null;
  }>(
    `SELECT u.id, u.gender, u.birth_date, p.interested_in, p.min_age, p.max_age
     FROM users u
     LEFT JOIN user_preferences p ON p.user_id = u.id
     WHERE u.id = $1`,
    [userId],
  );
  const row = r.rows[0];
  if (!row) throw NotFound('User not found');
  if (!row.gender || !row.interested_in || !row.birth_date) {
    throw BadRequest('Profile is incomplete: gender, birth date and interested-in are required');
  }
  return {
    id: row.id,
    gender: row.gender,
    interestedIn: row.interested_in,
    birthDate: row.birth_date,
    minAge: row.min_age ?? 18,
    maxAge: row.max_age ?? 99,
  };
}

export const SUPER_LIKE_WEEKLY_LIMIT = 5;

export interface SuperLikeQuota {
  isPremium: boolean;
  limit: number;
  used: number;
  remaining: number;
  resetsAt: string | null;
}

async function countWeeklySuperLikes(userId: string): Promise<number> {
  const r = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM super_like_usages
     WHERE user_id = $1
       AND created_at >= NOW() - INTERVAL '7 days'`,
    [userId],
  );
  return Number(r.rows[0]?.count ?? 0);
}

async function oldestSuperLikeInWindow(userId: string): Promise<Date | null> {
  const r = await query<{ created_at: Date }>(
    `SELECT created_at
     FROM super_like_usages
     WHERE user_id = $1
       AND created_at >= NOW() - INTERVAL '7 days'
     ORDER BY created_at ASC
     LIMIT 1`,
    [userId],
  );
  return r.rows[0]?.created_at ?? null;
}

async function hasSuperLikeUsage(userId: string, targetId: string): Promise<boolean> {
  const r = await query(
    `SELECT 1 FROM super_like_usages WHERE user_id = $1 AND target_user_id = $2 LIMIT 1`,
    [userId, targetId],
  );
  return (r.rowCount ?? 0) > 0;
}

export const discoveryService = {
  /**
   * Reciprocal-compatibility filtered feed:
   *
   *   - candidate.gender ∈ viewer.interestedIn
   *   - viewer.gender    ∈ candidate.interestedIn
   *   - viewer's age within candidate's age range AND vice-versa
   *   - exclude self, blocked (either direction), reported, deleted/suspended/banned
   *   - exclude users already swiped (like or pass)
   *   - exclude users already matched
   */
  async getFeed(userId: string, limit: number): Promise<FeedCandidate[]> {
    const viewer = await loadViewer(userId);
    const viewerAge = calculateAge(viewer.birthDate);

    const acceptedGenders = acceptedGendersFor(viewer.interestedIn);
    const acceptableInterests = interestsAcceptingGender(viewer.gender);

    const sql = `
      SELECT u.id, u.first_name, u.birth_date, u.city, u.bio, u.gender, u.is_premium,
             p.interested_in, p.min_age, p.max_age
      FROM users u
      JOIN user_preferences p ON p.user_id = u.id
      WHERE u.id <> $1
        AND u.status = 'active'
        AND u.gender = ANY($2::gender_t[])
        AND p.interested_in = ANY($3::interested_in_t[])
        AND EXTRACT(YEAR FROM AGE(u.birth_date)) BETWEEN $4 AND $5
        AND $6 BETWEEN p.min_age AND p.max_age
        AND NOT EXISTS (
          SELECT 1 FROM blocks b
           WHERE (b.blocker_id = $1 AND b.blocked_user_id = u.id)
              OR (b.blocker_id = u.id AND b.blocked_user_id = $1)
        )
        AND NOT EXISTS (
          SELECT 1 FROM reports r
           WHERE r.reporter_id = $1 AND r.reported_user_id = u.id
        )
        AND NOT EXISTS (
          SELECT 1 FROM likes l
           WHERE l.sender_id = $1 AND l.receiver_id = u.id
        )
        AND NOT EXISTS (
          SELECT 1 FROM passes pa
           WHERE pa.sender_id = $1 AND pa.receiver_id = u.id
        )
        AND NOT EXISTS (
          SELECT 1 FROM matches m
           WHERE (m.user_a_id = LEAST($1::uuid, u.id) AND m.user_b_id = GREATEST($1::uuid, u.id))
        )
        AND EXISTS (SELECT 1 FROM photos ph WHERE ph.user_id = u.id)
      ORDER BY u.last_active_at DESC NULLS LAST, u.created_at DESC
      LIMIT $7
    `;

    const r = await query<{
      id: string;
      first_name: string | null;
      birth_date: Date;
      city: string | null;
      bio: string | null;
      gender: Gender | null;
      is_premium: boolean;
      interested_in: InterestedIn | null;
      min_age: number | null;
      max_age: number | null;
    }>(sql, [
      viewer.id,
      acceptedGenders,
      acceptableInterests,
      viewer.minAge,
      viewer.maxAge,
      viewerAge,
      limit,
    ]);

    if (!r.rows.length) return [];

    const ids = r.rows.map((u) => u.id);
    const photosR = await query<{
      user_id: string;
      id: string;
      image_url: string;
      storage_key: string | null;
      order_index: number;
    }>(
      `SELECT user_id, id, image_url, storage_key, order_index FROM photos
       WHERE user_id = ANY($1::uuid[])
       ORDER BY order_index ASC`,
      [ids],
    );
    const langR = await query<{ user_id: string; language: string }>(
      `SELECT user_id, language FROM user_languages WHERE user_id = ANY($1::uuid[])`,
      [ids],
    );
    const goalsR = await query<{ user_id: string; goal: RelationshipGoal }>(
      `SELECT user_id, goal FROM user_relationship_goals WHERE user_id = ANY($1::uuid[])`,
      [ids],
    );

    const photosByUser = new Map<string, { id: string; url: string; orderIndex: number }[]>();
    photosR.rows.forEach((p) => {
      const arr = photosByUser.get(p.user_id) ?? [];
      arr.push({
        id: p.id,
        url: resolveStoredUrl(p.image_url, p.storage_key),
        orderIndex: p.order_index,
      });
      photosByUser.set(p.user_id, arr);
    });
    const langsByUser = new Map<string, string[]>();
    langR.rows.forEach((l) => {
      const arr = langsByUser.get(l.user_id) ?? [];
      arr.push(l.language);
      langsByUser.set(l.user_id, arr);
    });
    const goalsByUser = new Map<string, RelationshipGoal[]>();
    goalsR.rows.forEach((g) => {
      const arr = goalsByUser.get(g.user_id) ?? [];
      arr.push(g.goal);
      goalsByUser.set(g.user_id, arr);
    });

    return r.rows.map((u) => ({
      id: u.id,
      firstName: u.first_name,
      age: calculateAge(u.birth_date),
      city: u.city,
      bio: u.bio,
      gender: u.gender,
      interestedIn: u.interested_in,
      photos: photosByUser.get(u.id) ?? [],
      languages: langsByUser.get(u.id) ?? [],
      isPremium: u.is_premium,
      relationshipGoals: goalsByUser.get(u.id) ?? [],
      minAge: u.min_age ?? 18,
      maxAge: u.max_age ?? 99,
    }));
  },

  /**
   * Outgoing likes the viewer has sent that did not (yet) become a match.
   * Excludes blocked users in either direction and non-active accounts.
   */
  async getSentLikes(userId: string, limit = 100): Promise<LikeUser[]> {
    return loadLikedUsers(userId, 'sent', limit);
  },

  /**
   * Incoming likes the viewer has received that did not (yet) become a match.
   * Excludes blocked users in either direction and non-active accounts.
   */
  async getReceivedLikes(userId: string, limit = 100): Promise<LikeUser[]> {
    return loadLikedUsers(userId, 'received', limit);
  },

  /** Cancel a previously sent like. No-op if the like does not exist. */
  async unlike(userId: string, targetId: string): Promise<void> {
    if (userId === targetId) throw BadRequest('Cannot unlike yourself');
    await query(
      'DELETE FROM likes WHERE sender_id = $1 AND receiver_id = $2',
      [userId, targetId],
    );
  },

  /**
   * Clears outbound passes and likes that did not become matches so the feed
   * can be shown again from the start with current preference filters.
   */
  async resetFeed(userId: string): Promise<void> {
    await query('DELETE FROM passes WHERE sender_id = $1', [userId]);
    await query(
      `DELETE FROM likes l
       WHERE l.sender_id = $1
         AND NOT EXISTS (
           SELECT 1 FROM matches m
           WHERE m.user_a_id = LEAST($1::uuid, l.receiver_id)
             AND m.user_b_id = GREATEST($1::uuid, l.receiver_id)
         )`,
      [userId],
    );
  },

  async pass(userId: string, targetId: string): Promise<void> {
    if (userId === targetId) throw BadRequest('Cannot pass on yourself');
    await query(
      `INSERT INTO passes (sender_id, receiver_id) VALUES ($1, $2)
         ON CONFLICT (sender_id, receiver_id) DO NOTHING`,
      [userId, targetId],
    );
  },

  /**
   * Like another user. If the like is reciprocal AND mutually compatible, a
   * Match row is created (idempotently) and the result reports `matched: true`.
   */
  async like(
    userId: string,
    targetId: string,
    options?: { isSuper?: boolean },
  ): Promise<{ matched: boolean; matchId?: string; isNewLike: boolean }> {
    return recordLike(userId, targetId, options?.isSuper ?? false);
  },

  async getSuperLikeQuota(userId: string): Promise<SuperLikeQuota> {
    const premium = await isUserPremium(userId);
    if (!premium) {
      return {
        isPremium: false,
        limit: SUPER_LIKE_WEEKLY_LIMIT,
        used: 0,
        remaining: 0,
        resetsAt: null,
      };
    }

    const used = await countWeeklySuperLikes(userId);
    const remaining = Math.max(0, SUPER_LIKE_WEEKLY_LIMIT - used);
    const oldest = await oldestSuperLikeInWindow(userId);
    const resetsAt =
      used >= SUPER_LIKE_WEEKLY_LIMIT && oldest
        ? new Date(oldest.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString()
        : null;

    return {
      isPremium: true,
      limit: SUPER_LIKE_WEEKLY_LIMIT,
      used,
      remaining,
      resetsAt,
    };
  },

  /**
   * Premium-only Super Like with a weekly quota. Upgrades an existing regular
   * like to super; re-super-liking the same user does not consume quota.
   */
  async superLike(
    userId: string,
    targetId: string,
  ): Promise<{
    matched: boolean;
    matchId?: string;
    superLikesRemaining: number;
    isNewSuperLike: boolean;
  }> {
    const premium = await isUserPremium(userId);
    if (!premium) {
      throw Forbidden('Super Like is a Premium feature');
    }

    const existing = await query<{ is_super: boolean }>(
      'SELECT is_super FROM likes WHERE sender_id = $1 AND receiver_id = $2',
      [userId, targetId],
    );
    const alreadySuper =
      (existing.rows[0]?.is_super ?? false) || (await hasSuperLikeUsage(userId, targetId));

    if (!alreadySuper) {
      const used = await countWeeklySuperLikes(userId);
      if (used >= SUPER_LIKE_WEEKLY_LIMIT) {
        throw TooMany('You have used all your Super Likes this week');
      }
    }

    const result = await recordLike(userId, targetId, true, !alreadySuper);
    const quota = await this.getSuperLikeQuota(userId);
    return {
      ...result,
      superLikesRemaining: quota.remaining,
      isNewSuperLike: !alreadySuper,
    };
  },
};

async function recordLike(
  userId: string,
  targetId: string,
  isSuper: boolean,
  consumeSuperLikeQuota = false,
): Promise<{ matched: boolean; matchId?: string; isNewLike: boolean }> {
    if (userId === targetId) throw BadRequest('Cannot like yourself');

    // Block target if target blocked viewer.
    const blocked = await query(
      `SELECT 1 FROM blocks
       WHERE (blocker_id = $1 AND blocked_user_id = $2)
          OR (blocker_id = $2 AND blocked_user_id = $1)
       LIMIT 1`,
      [userId, targetId],
    );
    if (blocked.rowCount) throw BadRequest('Cannot interact with this user');

    return withTransaction(async (client) => {
      const existingLike = await client.query(
        'SELECT 1 FROM likes WHERE sender_id = $1 AND receiver_id = $2',
        [userId, targetId],
      );
      const isNewLike = !existingLike.rowCount;

      // Record the like (idempotent on duplicate). Super likes upgrade the row.
      await client.query(
        `INSERT INTO likes (sender_id, receiver_id, is_super) VALUES ($1, $2, $3)
           ON CONFLICT (sender_id, receiver_id)
           DO UPDATE SET is_super = likes.is_super OR EXCLUDED.is_super`,
        [userId, targetId, isSuper],
      );
      if (consumeSuperLikeQuota) {
        await client.query(
          `INSERT INTO super_like_usages (user_id, target_user_id) VALUES ($1, $2)
             ON CONFLICT (user_id, target_user_id) DO NOTHING`,
          [userId, targetId],
        );
      }
      // Liking implicitly retracts a prior pass on this candidate.
      await client.query(
        `DELETE FROM passes WHERE sender_id = $1 AND receiver_id = $2`,
        [userId, targetId],
      );

      // If a match already exists between these two users, surface that
      // instead of returning matched: false silently.
      const existingMatch = await client.query<{ id: string }>(
        `SELECT id FROM matches
           WHERE user_a_id = LEAST($1::uuid, $2::uuid)
             AND user_b_id = GREATEST($1::uuid, $2::uuid)
           LIMIT 1`,
        [userId, targetId],
      );
      if (existingMatch.rowCount) {
        return { matched: true, matchId: existingMatch.rows[0].id, isNewLike };
      }

      // Check reciprocal like.
      const reciprocal = await client.query(
        'SELECT 1 FROM likes WHERE sender_id = $1 AND receiver_id = $2',
        [targetId, userId],
      );
      if (!reciprocal.rowCount) return { matched: false, isNewLike };

      // Both must be mutually compatible. Re-check at match-time so changes in
      // preferences cannot create stale matches.
      const compatR = await client.query<{
        viewer_gender: Gender;
        viewer_int: InterestedIn;
        target_gender: Gender;
        target_int: InterestedIn;
      }>(
        `SELECT
            u1.gender AS viewer_gender,
            p1.interested_in AS viewer_int,
            u2.gender AS target_gender,
            p2.interested_in AS target_int
         FROM users u1
         JOIN user_preferences p1 ON p1.user_id = u1.id
         JOIN users u2 ON u2.id = $2
         JOIN user_preferences p2 ON p2.user_id = u2.id
         WHERE u1.id = $1`,
        [userId, targetId],
      );
      const c = compatR.rows[0];
      if (!c) return { matched: false, isNewLike };

      const compatible = isMutuallyCompatible(
        { gender: c.viewer_gender, interestedIn: c.viewer_int },
        { gender: c.target_gender, interestedIn: c.target_int },
      );
      if (!compatible) return { matched: false, isNewLike };

      // Canonical (a < b) ordering required by the UNIQUE+CHECK constraint.
      // Use a SQL-level LEAST/GREATEST to ensure ordering matches PG's UUID
      // comparison (which is binary, not lexicographic on the JS string).
      const matchR = await client.query<{ id: string }>(
        `INSERT INTO matches (user_a_id, user_b_id)
           VALUES (LEAST($1::uuid, $2::uuid), GREATEST($1::uuid, $2::uuid))
           ON CONFLICT (user_a_id, user_b_id) DO UPDATE SET matched_at = matches.matched_at
           RETURNING id`,
        [userId, targetId],
      );

      // Auto-create the conversation shell. No initiator yet (depends on which
      // user sends the first message, gated by Premium).
      await client.query(
        `INSERT INTO conversations (match_id) VALUES ($1)
           ON CONFLICT (match_id) DO NOTHING`,
        [matchR.rows[0].id],
      );

      return { matched: true, matchId: matchR.rows[0].id, isNewLike };
    });
}

/**
 * Shared loader for the "likes" lists. Returns up to `limit` users that the
 * viewer has either liked (sent) or has been liked by (received), excluding
 * any pair that has already turned into a match or involves a block in either
 * direction. Hydrates each candidate with their photos and spoken languages
 * so the result can drop straight into a `FeedCandidate`-shaped card.
 */
async function loadLikedUsers(
  userId: string,
  direction: 'sent' | 'received',
  limit: number,
): Promise<LikeUser[]> {
  const joinOn = direction === 'sent' ? 'l.receiver_id' : 'l.sender_id';
  const where = direction === 'sent' ? 'l.sender_id' : 'l.receiver_id';

  const orderBy =
    direction === 'received'
      ? 'ORDER BY l.is_super DESC, l.created_at DESC'
      : 'ORDER BY l.created_at DESC';

  const sql = `
    SELECT
      u.id, u.first_name, u.birth_date, u.city, u.bio, u.gender, u.is_premium,
      p.interested_in, p.min_age, p.max_age, l.created_at AS liked_at, l.is_super
    FROM likes l
    JOIN users u ON u.id = ${joinOn}
    LEFT JOIN user_preferences p ON p.user_id = u.id
    WHERE ${where} = $1
      AND u.status = 'active'
      AND NOT EXISTS (
        SELECT 1 FROM blocks b
         WHERE (b.blocker_id = $1 AND b.blocked_user_id = u.id)
            OR (b.blocker_id = u.id AND b.blocked_user_id = $1)
      )
      AND NOT EXISTS (
        SELECT 1 FROM matches m
         WHERE m.user_a_id = LEAST($1::uuid, u.id)
           AND m.user_b_id = GREATEST($1::uuid, u.id)
      )
    ${orderBy}
    LIMIT $2
  `;

  const r = await query<{
    id: string;
    first_name: string | null;
    birth_date: Date;
    city: string | null;
    bio: string | null;
    gender: Gender | null;
    is_premium: boolean;
    interested_in: InterestedIn | null;
    min_age: number | null;
    max_age: number | null;
    liked_at: Date;
    is_super: boolean;
  }>(sql, [userId, limit]);

  if (!r.rows.length) return [];

  const ids = r.rows.map((u) => u.id);
  const photosR = await query<{
    user_id: string;
    id: string;
    image_url: string;
    storage_key: string | null;
    order_index: number;
  }>(
    `SELECT user_id, id, image_url, storage_key, order_index FROM photos
     WHERE user_id = ANY($1::uuid[])
     ORDER BY order_index ASC`,
    [ids],
  );
  const langR = await query<{ user_id: string; language: string }>(
    `SELECT user_id, language FROM user_languages WHERE user_id = ANY($1::uuid[])`,
    [ids],
  );
  const goalsR = await query<{ user_id: string; goal: RelationshipGoal }>(
    `SELECT user_id, goal FROM user_relationship_goals WHERE user_id = ANY($1::uuid[])`,
    [ids],
  );

  const photosByUser = new Map<string, { id: string; url: string; orderIndex: number }[]>();
  photosR.rows.forEach((p) => {
    const arr = photosByUser.get(p.user_id) ?? [];
    arr.push({
      id: p.id,
      url: resolveStoredUrl(p.image_url, p.storage_key),
      orderIndex: p.order_index,
    });
    photosByUser.set(p.user_id, arr);
  });
  const langsByUser = new Map<string, string[]>();
  langR.rows.forEach((l) => {
    const arr = langsByUser.get(l.user_id) ?? [];
    arr.push(l.language);
    langsByUser.set(l.user_id, arr);
  });
  const goalsByUser = new Map<string, RelationshipGoal[]>();
  goalsR.rows.forEach((g) => {
    const arr = goalsByUser.get(g.user_id) ?? [];
    arr.push(g.goal);
    goalsByUser.set(g.user_id, arr);
  });

  return r.rows.map((u) => ({
    id: u.id,
    firstName: u.first_name,
    age: calculateAge(u.birth_date),
    city: u.city,
    bio: u.bio,
    gender: u.gender,
    interestedIn: u.interested_in,
    photos: photosByUser.get(u.id) ?? [],
    languages: langsByUser.get(u.id) ?? [],
    isPremium: u.is_premium,
    relationshipGoals: goalsByUser.get(u.id) ?? [],
    minAge: u.min_age ?? 18,
    maxAge: u.max_age ?? 99,
    likedAt: u.liked_at.toISOString(),
    isSuperLike: u.is_super,
  }));
}

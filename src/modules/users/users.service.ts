import { query, withTransaction } from '../../config/database';
import { uploadImage } from '../../services/storage';
import { calculateAge, isAdult, MIN_AGE } from '../../utils/age';
import { BadRequest, Conflict, NotFound } from '../../utils/errors';
import { UpdateProfileInput } from './users.schemas';

const MAX_PHOTOS = 6;

export interface PublicProfile {
  id: string;
  firstName: string | null;
  age: number | null;
  gender: 'male' | 'female' | null;
  city: string | null;
  bio: string | null;
  languages: string[];
  photos: { id: string; url: string; orderIndex: number }[];
  isPremium: boolean;
}

export interface MyProfile extends PublicProfile {
  email: string;
  birthDate: string | null;
  interestedIn: 'men' | 'women' | 'both' | null;
  minAge: number;
  maxAge: number;
  appLanguage: string;
  notifications: {
    matches: boolean;
    messages: boolean;
    subscription: boolean;
  };
}

async function loadPhotos(userId: string) {
  const r = await query<{ id: string; image_url: string; order_index: number }>(
    `SELECT id, image_url, order_index FROM photos WHERE user_id = $1 ORDER BY order_index ASC`,
    [userId],
  );
  return r.rows.map((p) => ({ id: p.id, url: p.image_url, orderIndex: p.order_index }));
}

async function loadLanguages(userId: string): Promise<string[]> {
  const r = await query<{ language: string }>(
    'SELECT language FROM user_languages WHERE user_id = $1',
    [userId],
  );
  return r.rows.map((x) => x.language);
}

export const usersService = {
  async getMyProfile(userId: string): Promise<MyProfile> {
    const r = await query<{
      id: string;
      email: string;
      first_name: string | null;
      birth_date: Date | null;
      gender: 'male' | 'female' | null;
      city: string | null;
      bio: string | null;
      is_premium: boolean;
      language: string;
      interested_in: 'men' | 'women' | 'both' | null;
      min_age: number | null;
      max_age: number | null;
      n_matches: boolean | null;
      n_messages: boolean | null;
      n_subscription: boolean | null;
    }>(
      `SELECT u.id, u.email, u.first_name, u.birth_date, u.gender, u.city, u.bio,
              u.is_premium, u.language,
              p.interested_in, p.min_age, p.max_age,
              ns.matches_enabled AS n_matches,
              ns.messages_enabled AS n_messages,
              ns.subscription_enabled AS n_subscription
       FROM users u
       LEFT JOIN user_preferences p ON p.user_id = u.id
       LEFT JOIN notification_settings ns ON ns.user_id = u.id
       WHERE u.id = $1`,
      [userId],
    );
    const u = r.rows[0];
    if (!u) throw NotFound('User not found');

    const [photos, languages] = await Promise.all([
      loadPhotos(userId),
      loadLanguages(userId),
    ]);

    return {
      id: u.id,
      email: u.email,
      firstName: u.first_name,
      birthDate: u.birth_date ? u.birth_date.toISOString().slice(0, 10) : null,
      age: u.birth_date ? calculateAge(u.birth_date) : null,
      gender: u.gender,
      city: u.city,
      bio: u.bio,
      languages,
      photos,
      isPremium: u.is_premium,
      interestedIn: u.interested_in,
      minAge: u.min_age ?? 18,
      maxAge: u.max_age ?? 99,
      appLanguage: u.language,
      notifications: {
        matches: u.n_matches ?? true,
        messages: u.n_messages ?? true,
        subscription: u.n_subscription ?? true,
      },
    };
  },

  async updateProfile(userId: string, input: UpdateProfileInput): Promise<MyProfile> {
    if (input.birthDate && !isAdult(input.birthDate)) {
      throw BadRequest(`You must be at least ${MIN_AGE} years old`);
    }

    await withTransaction(async (client) => {
      const fields: string[] = [];
      const values: unknown[] = [];
      let i = 1;
      const push = (col: string, val: unknown) => {
        fields.push(`${col} = $${i++}`);
        values.push(val);
      };

      if (input.firstName !== undefined) push('first_name', input.firstName);
      if (input.birthDate !== undefined) push('birth_date', input.birthDate);
      if (input.gender !== undefined) push('gender', input.gender);
      if (input.city !== undefined) push('city', input.city);
      if (input.bio !== undefined) push('bio', input.bio);
      if (input.appLanguage !== undefined) push('language', input.appLanguage);

      if (fields.length) {
        values.push(userId);
        await client.query(
          `UPDATE users SET ${fields.join(', ')} WHERE id = $${i}`,
          values,
        );
      }

      if (
        input.interestedIn !== undefined ||
        input.minAge !== undefined ||
        input.maxAge !== undefined
      ) {
        const existing = await client.query<{
          interested_in: 'men' | 'women' | 'both' | null;
          min_age: number;
          max_age: number;
        }>(
          'SELECT interested_in, min_age, max_age FROM user_preferences WHERE user_id = $1',
          [userId],
        );

        const interested = input.interestedIn ?? existing.rows[0]?.interested_in;
        if (!interested) {
          throw BadRequest('"interestedIn" must be provided for the first time');
        }

        const minAge = input.minAge ?? existing.rows[0]?.min_age ?? 18;
        const maxAge = input.maxAge ?? existing.rows[0]?.max_age ?? 99;

        await client.query(
          `INSERT INTO user_preferences (user_id, interested_in, min_age, max_age)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (user_id) DO UPDATE SET
               interested_in = EXCLUDED.interested_in,
               min_age       = EXCLUDED.min_age,
               max_age       = EXCLUDED.max_age,
               updated_at    = NOW()`,
          [userId, interested, minAge, maxAge],
        );
      }

      if (input.languages) {
        await client.query('DELETE FROM user_languages WHERE user_id = $1', [userId]);
        for (const lang of input.languages) {
          await client.query(
            'INSERT INTO user_languages (user_id, language) VALUES ($1, $2) ON CONFLICT DO NOTHING',
            [userId, lang],
          );
        }
      }
    });

    return this.getMyProfile(userId);
  },

  async uploadPhoto(userId: string, buffer: Buffer, mime: string): Promise<{ id: string; url: string; orderIndex: number }> {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(mime)) {
      throw BadRequest('Unsupported image type. Use JPG, PNG, or WEBP');
    }
    const countR = await query<{ count: string }>(
      'SELECT COUNT(*) AS count FROM photos WHERE user_id = $1',
      [userId],
    );
    const count = Number(countR.rows[0]?.count ?? 0);
    if (count >= MAX_PHOTOS) {
      throw Conflict(`You already have the maximum of ${MAX_PHOTOS} photos`);
    }

    const stored = await uploadImage(buffer, mime, `photos/${userId}`);
    const r = await query<{ id: string; order_index: number }>(
      `INSERT INTO photos (user_id, image_url, storage_key, order_index)
         VALUES ($1, $2, $3, $4)
         RETURNING id, order_index`,
      [userId, stored.url, stored.key, count],
    );
    return { id: r.rows[0].id, url: stored.url, orderIndex: r.rows[0].order_index };
  },

  async deletePhoto(userId: string, photoId: string): Promise<void> {
    const r = await query('DELETE FROM photos WHERE id = $1 AND user_id = $2', [
      photoId,
      userId,
    ]);
    if (!r.rowCount) throw NotFound('Photo not found');

    // Re-index remaining photos so order_index stays contiguous.
    await query(
      `WITH ranked AS (
         SELECT id, ROW_NUMBER() OVER (ORDER BY order_index, created_at) - 1 AS rn
         FROM photos WHERE user_id = $1
       )
       UPDATE photos p SET order_index = r.rn FROM ranked r WHERE p.id = r.id`,
      [userId],
    );
  },

  async reorderPhotos(userId: string, ids: string[]): Promise<void> {
    const r = await query<{ id: string }>(
      'SELECT id FROM photos WHERE user_id = $1',
      [userId],
    );
    const existing = new Set(r.rows.map((x) => x.id));
    for (const id of ids) {
      if (!existing.has(id)) throw BadRequest('Photo id not owned by user: ' + id);
    }
    if (ids.length !== existing.size) {
      throw BadRequest('Must include every photo id when reordering');
    }

    await withTransaction(async (client) => {
      for (let i = 0; i < ids.length; i++) {
        await client.query('UPDATE photos SET order_index = $1 WHERE id = $2', [i, ids[i]]);
      }
    });
  },

  async deleteAccount(userId: string): Promise<void> {
    // GDPR: hard delete cascades remove photos, likes, matches, messages, etc.
    // We mark the user as deleted first (soft) then optionally hard delete.
    await withTransaction(async (client) => {
      await client.query(
        `UPDATE users SET status = 'deleted', email = NULL, first_name = NULL,
                          bio = NULL, city = NULL, fcm_token = NULL
         WHERE id = $1`,
        [userId],
      );
      await client.query('DELETE FROM photos WHERE user_id = $1', [userId]);
      await client.query('DELETE FROM refresh_tokens WHERE user_id = $1', [userId]);
      await client.query('DELETE FROM password_resets WHERE user_id = $1', [userId]);
    });
  },

  async exportData(userId: string): Promise<Record<string, unknown>> {
    const profile = await this.getMyProfile(userId);
    const matches = await query(
      `SELECT id, user_a_id, user_b_id, matched_at FROM matches
       WHERE user_a_id = $1 OR user_b_id = $1`,
      [userId],
    );
    const messages = await query(
      `SELECT m.id, m.conversation_id, m.type, m.text, m.image_url, m.created_at
       FROM messages m
       JOIN conversations c ON c.id = m.conversation_id
       JOIN matches mt ON mt.id = c.match_id
       WHERE mt.user_a_id = $1 OR mt.user_b_id = $1`,
      [userId],
    );
    return {
      profile,
      matches: matches.rows,
      messages: messages.rows,
      generatedAt: new Date().toISOString(),
    };
  },

  async updateFcmToken(userId: string, token: string): Promise<void> {
    await query('UPDATE users SET fcm_token = $1 WHERE id = $2', [token, userId]);
  },

  async updateNotificationSettings(
    userId: string,
    input: { matchesEnabled?: boolean; messagesEnabled?: boolean; subscriptionEnabled?: boolean },
  ): Promise<void> {
    const fields: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    if (input.matchesEnabled !== undefined) {
      fields.push(`matches_enabled = $${i++}`);
      values.push(input.matchesEnabled);
    }
    if (input.messagesEnabled !== undefined) {
      fields.push(`messages_enabled = $${i++}`);
      values.push(input.messagesEnabled);
    }
    if (input.subscriptionEnabled !== undefined) {
      fields.push(`subscription_enabled = $${i++}`);
      values.push(input.subscriptionEnabled);
    }
    if (!fields.length) return;
    values.push(userId);
    await query(
      `INSERT INTO notification_settings (user_id) VALUES ($${i})
         ON CONFLICT (user_id) DO UPDATE SET ${fields.join(', ')}, updated_at = NOW()`,
      values,
    );
  },
};

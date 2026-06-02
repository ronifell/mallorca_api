import { query } from '../../config/database';
import { calculateAge } from '../../utils/age';

export interface MatchListItem {
  matchId: string;
  matchedAt: string;
  conversationId: string | null;
  hasConversation: boolean;
  otherUser: {
    id: string;
    firstName: string | null;
    age: number | null;
    city: string | null;
    coverPhoto: string | null;
  };
  lastMessage: {
    id: string;
    text: string | null;
    type: 'text' | 'image';
    senderId: string;
    createdAt: string;
  } | null;
  unreadCount: number;
}

export const matchesService = {
  async list(userId: string): Promise<MatchListItem[]> {
    const r = await query<{
      match_id: string;
      matched_at: Date;
      conv_id: string | null;
      other_id: string;
      other_first_name: string | null;
      other_birth_date: Date | null;
      other_city: string | null;
      cover_photo: string | null;
      last_message_id: string | null;
      last_message_text: string | null;
      last_message_type: 'text' | 'image' | null;
      last_message_sender: string | null;
      last_message_created: Date | null;
      unread_count: string;
    }>(
      `
      SELECT
        m.id AS match_id,
        m.matched_at,
        c.id AS conv_id,
        CASE WHEN m.user_a_id = $1 THEN m.user_b_id ELSE m.user_a_id END AS other_id,
        ou.first_name AS other_first_name,
        ou.birth_date AS other_birth_date,
        ou.city       AS other_city,
        (SELECT image_url FROM photos
           WHERE user_id = CASE WHEN m.user_a_id = $1 THEN m.user_b_id ELSE m.user_a_id END
           ORDER BY order_index ASC LIMIT 1) AS cover_photo,
        lm.id          AS last_message_id,
        lm.text        AS last_message_text,
        lm.type        AS last_message_type,
        lm.sender_id   AS last_message_sender,
        lm.created_at  AS last_message_created,
        COALESCE((
          SELECT COUNT(*) FROM messages mx
          WHERE mx.conversation_id = c.id
            AND mx.sender_id <> $1
            AND mx.read_at IS NULL
        ), 0) AS unread_count
      FROM matches m
      JOIN users ou ON ou.id = CASE WHEN m.user_a_id = $1 THEN m.user_b_id ELSE m.user_a_id END
      LEFT JOIN conversations c ON c.match_id = m.id
      LEFT JOIN LATERAL (
        SELECT id, text, type, sender_id, created_at
        FROM messages
        WHERE conversation_id = c.id
        ORDER BY created_at DESC LIMIT 1
      ) lm ON TRUE
      WHERE (m.user_a_id = $1 OR m.user_b_id = $1)
        AND ou.status = 'active'
        AND NOT EXISTS (
          SELECT 1 FROM blocks b
           WHERE (b.blocker_id = $1 AND b.blocked_user_id = ou.id)
              OR (b.blocker_id = ou.id AND b.blocked_user_id = $1)
        )
      ORDER BY COALESCE(lm.created_at, m.matched_at) DESC
      `,
      [userId],
    );

    return r.rows.map((row) => ({
      matchId: row.match_id,
      matchedAt: row.matched_at.toISOString(),
      conversationId: row.conv_id,
      hasConversation: !!row.last_message_id,
      otherUser: {
        id: row.other_id,
        firstName: row.other_first_name,
        age: row.other_birth_date ? calculateAge(row.other_birth_date) : null,
        city: row.other_city,
        coverPhoto: row.cover_photo,
      },
      lastMessage: row.last_message_id
        ? {
            id: row.last_message_id,
            text: row.last_message_text,
            type: (row.last_message_type ?? 'text') as 'text' | 'image',
            senderId: row.last_message_sender!,
            createdAt: row.last_message_created!.toISOString(),
          }
        : null,
      unreadCount: Number(row.unread_count),
    }));
  },

  async unmatch(userId: string, matchId: string): Promise<void> {
    await query(
      `DELETE FROM matches
        WHERE id = $1
          AND (user_a_id = $2 OR user_b_id = $2)`,
      [matchId, userId],
    );
  },
};

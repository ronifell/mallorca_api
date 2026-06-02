import { query, withTransaction } from '../../config/database';
import { uploadImage } from '../../services/storage';
import { BadRequest, Forbidden, NotFound } from '../../utils/errors';

export interface ConversationContext {
  conversationId: string;
  matchId: string;
  participants: [string, string];
  initiatedBy: string | null;
  messageCount: number;
}

async function loadConversation(conversationId: string): Promise<ConversationContext | null> {
  const r = await query<{
    id: string;
    match_id: string;
    user_a_id: string;
    user_b_id: string;
    initiated_by: string | null;
    msg_count: string;
  }>(
    `SELECT c.id, c.match_id, m.user_a_id, m.user_b_id, c.initiated_by,
            (SELECT COUNT(*) FROM messages mx WHERE mx.conversation_id = c.id) AS msg_count
     FROM conversations c
     JOIN matches m ON m.id = c.match_id
     WHERE c.id = $1`,
    [conversationId],
  );
  const row = r.rows[0];
  if (!row) return null;
  return {
    conversationId: row.id,
    matchId: row.match_id,
    participants: [row.user_a_id, row.user_b_id],
    initiatedBy: row.initiated_by,
    messageCount: Number(row.msg_count),
  };
}

function assertParticipant(ctx: ConversationContext, userId: string) {
  if (!ctx.participants.includes(userId)) {
    throw Forbidden('You are not a participant in this conversation');
  }
}

async function isUserPremium(userId: string): Promise<boolean> {
  const r = await query<{ is_premium: boolean }>(
    'SELECT is_premium FROM users WHERE id = $1',
    [userId],
  );
  return r.rows[0]?.is_premium ?? false;
}

export const chatService = {
  async getOrCreateConversationForMatch(userId: string, matchId: string): Promise<{ id: string }> {
    const r = await query<{ id: string; user_a_id: string; user_b_id: string }>(
      `SELECT m.id, m.user_a_id, m.user_b_id FROM matches m WHERE m.id = $1`,
      [matchId],
    );
    const m = r.rows[0];
    if (!m) throw NotFound('Match not found');
    if (m.user_a_id !== userId && m.user_b_id !== userId) {
      throw Forbidden('Not a participant of this match');
    }
    const c = await query<{ id: string }>(
      `INSERT INTO conversations (match_id) VALUES ($1)
         ON CONFLICT (match_id) DO UPDATE SET match_id = EXCLUDED.match_id
         RETURNING id`,
      [matchId],
    );
    return { id: c.rows[0].id };
  },

  async sendMessage(
    senderId: string,
    conversationId: string,
    input: { type: 'text' | 'image'; text?: string; imageUrl?: string },
  ): Promise<{
    id: string;
    conversationId: string;
    senderId: string;
    receiverId: string;
    type: 'text' | 'image';
    text: string | null;
    imageUrl: string | null;
    createdAt: string;
  }> {
    const ctx = await loadConversation(conversationId);
    if (!ctx) throw NotFound('Conversation not found');
    assertParticipant(ctx, senderId);

    // Premium gate: only premium users can initiate (send the first message).
    if (ctx.messageCount === 0) {
      const premium = await isUserPremium(senderId);
      if (!premium) {
        throw Forbidden('Only Premium users can initiate conversations');
      }
    }

    const receiverId = ctx.participants[0] === senderId ? ctx.participants[1] : ctx.participants[0];

    const insertedId = await withTransaction(async (client) => {
      const r = await client.query<{ id: string; created_at: Date }>(
        `INSERT INTO messages (conversation_id, sender_id, type, text, image_url)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id, created_at`,
        [conversationId, senderId, input.type, input.text ?? null, input.imageUrl ?? null],
      );
      const msg = r.rows[0];

      await client.query(
        `UPDATE conversations
           SET last_message_at = $2,
               initiated_by = COALESCE(initiated_by, $3)
         WHERE id = $1`,
        [conversationId, msg.created_at, senderId],
      );
      return { id: msg.id, createdAt: msg.created_at };
    });

    return {
      id: insertedId.id,
      conversationId,
      senderId,
      receiverId,
      type: input.type,
      text: input.text ?? null,
      imageUrl: input.imageUrl ?? null,
      createdAt: insertedId.createdAt.toISOString(),
    };
  },

  async uploadImage(senderId: string, conversationId: string, buffer: Buffer, mime: string) {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(mime)) {
      throw BadRequest('Unsupported image type. Use JPG, PNG, or WEBP');
    }
    const ctx = await loadConversation(conversationId);
    if (!ctx) throw NotFound('Conversation not found');
    assertParticipant(ctx, senderId);

    const stored = await uploadImage(buffer, mime, `chat/${conversationId}`);
    return { url: stored.url };
  },

  async listMessages(
    userId: string,
    conversationId: string,
    opts: { before?: string; limit: number },
  ) {
    const ctx = await loadConversation(conversationId);
    if (!ctx) throw NotFound('Conversation not found');
    assertParticipant(ctx, userId);

    const params: unknown[] = [conversationId];
    let whereExtra = '';
    if (opts.before) {
      params.push(opts.before);
      whereExtra = ` AND created_at < $${params.length}`;
    }
    params.push(opts.limit);

    const r = await query<{
      id: string;
      sender_id: string;
      type: 'text' | 'image';
      text: string | null;
      image_url: string | null;
      delivered_at: Date | null;
      read_at: Date | null;
      created_at: Date;
    }>(
      `SELECT id, sender_id, type, text, image_url, delivered_at, read_at, created_at
       FROM messages
       WHERE conversation_id = $1 ${whereExtra}
       ORDER BY created_at DESC
       LIMIT $${params.length}`,
      params,
    );

    return r.rows
      .reverse()
      .map((m) => ({
        id: m.id,
        senderId: m.sender_id,
        type: m.type,
        text: m.text,
        imageUrl: m.image_url,
        deliveredAt: m.delivered_at ? m.delivered_at.toISOString() : null,
        readAt: m.read_at ? m.read_at.toISOString() : null,
        createdAt: m.created_at.toISOString(),
      }));
  },

  async markRead(userId: string, conversationId: string) {
    const ctx = await loadConversation(conversationId);
    if (!ctx) throw NotFound('Conversation not found');
    assertParticipant(ctx, userId);

    await query(
      `UPDATE messages SET read_at = NOW()
       WHERE conversation_id = $1 AND sender_id <> $2 AND read_at IS NULL`,
      [conversationId, userId],
    );
  },

  async markDelivered(userId: string, conversationId: string) {
    await query(
      `UPDATE messages SET delivered_at = NOW()
       WHERE conversation_id = $1 AND sender_id <> $2 AND delivered_at IS NULL`,
      [conversationId, userId],
    );
  },

  loadConversation,
  isUserPremium,
};

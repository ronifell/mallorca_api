import { query, withTransaction } from '../../config/database';
import { BadRequest } from '../../utils/errors';

export const moderationService = {
  async block(userId: string, targetId: string): Promise<void> {
    if (userId === targetId) throw BadRequest('Cannot block yourself');
    await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO blocks (blocker_id, blocked_user_id) VALUES ($1, $2)
           ON CONFLICT (blocker_id, blocked_user_id) DO NOTHING`,
        [userId, targetId],
      );
      // Delete any prior likes between them in either direction.
      await client.query(
        `DELETE FROM likes
            WHERE (sender_id = $1 AND receiver_id = $2)
               OR (sender_id = $2 AND receiver_id = $1)`,
        [userId, targetId],
      );
      // Remove any existing match.
      const a = userId < targetId ? userId : targetId;
      const b = userId < targetId ? targetId : userId;
      await client.query(
        `DELETE FROM matches WHERE user_a_id = $1 AND user_b_id = $2`,
        [a, b],
      );
    });
  },

  async unblock(userId: string, targetId: string): Promise<void> {
    await query(
      `DELETE FROM blocks WHERE blocker_id = $1 AND blocked_user_id = $2`,
      [userId, targetId],
    );
  },

  async listBlocks(userId: string) {
    const r = await query<{
      id: string;
      blocked_user_id: string;
      first_name: string | null;
      created_at: Date;
    }>(
      `SELECT b.id, b.blocked_user_id, u.first_name, b.created_at
         FROM blocks b
         JOIN users u ON u.id = b.blocked_user_id
         WHERE b.blocker_id = $1
         ORDER BY b.created_at DESC`,
      [userId],
    );
    return r.rows.map((row) => ({
      id: row.id,
      userId: row.blocked_user_id,
      firstName: row.first_name,
      blockedAt: row.created_at.toISOString(),
    }));
  },

  async report(
    userId: string,
    targetId: string,
    payload: { reason: string; details?: string },
  ): Promise<void> {
    if (userId === targetId) throw BadRequest('Cannot report yourself');
    await query(
      `INSERT INTO reports (reporter_id, reported_user_id, reason, details)
         VALUES ($1, $2, $3, $4)`,
      [userId, targetId, payload.reason, payload.details ?? null],
    );
  },
};

export const adminModerationService = {
  async listReports(opts: { resolved?: boolean }) {
    const params: unknown[] = [];
    let where = '';
    if (opts.resolved !== undefined) {
      params.push(opts.resolved);
      where = `WHERE r.resolved = $${params.length}`;
    }
    const r = await query(
      `SELECT r.id, r.reason, r.details, r.created_at, r.resolved,
              r.reporter_id, r.reported_user_id,
              ru.email AS reported_email, ru.first_name AS reported_first_name, ru.status
       FROM reports r
       JOIN users ru ON ru.id = r.reported_user_id
       ${where}
       ORDER BY r.created_at DESC
       LIMIT 200`,
      params,
    );
    return r.rows;
  },

  async resolveReport(reportId: string): Promise<void> {
    await query(`UPDATE reports SET resolved = TRUE WHERE id = $1`, [reportId]);
  },

  async setUserStatus(
    targetId: string,
    status: 'active' | 'suspended' | 'banned',
  ): Promise<void> {
    await query(`UPDATE users SET status = $1 WHERE id = $2`, [status, targetId]);
  },
};

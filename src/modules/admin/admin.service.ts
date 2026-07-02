import { query, withTransaction } from '../../config/database';
import { resolveStoredUrl } from '../../services/storage';
import { calculateAge } from '../../utils/age';
import { NotFound } from '../../utils/errors';

export interface AdminUserRow {
  id: string;
  email: string | null;
  firstName: string | null;
  age: number | null;
  gender: string | null;
  city: string | null;
  status: 'active' | 'suspended' | 'banned' | 'deleted';
  role: 'user' | 'admin';
  isPremium: boolean;
  premiumUntil: string | null;
  emailVerified: boolean;
  language: string;
  createdAt: string;
  lastActiveAt: string | null;
  photoCount: number;
  coverPhoto: string | null;
  reportsAgainst: number;
}

export interface AdminUserDetail extends AdminUserRow {
  bio: string | null;
  birthDate: string | null;
  interestedIn: 'men' | 'women' | 'both' | null;
  minAge: number;
  maxAge: number;
  languages: string[];
  relationshipGoals: string[];
  photos: { id: string; url: string; orderIndex: number }[];
  stats: {
    matches: number;
    conversations: number;
    messagesSent: number;
    likesGiven: number;
    likesReceived: number;
    superLikesGiven: number;
    passes: number;
    blocksMade: number;
    blocksAgainst: number;
    reportsMade: number;
    reportsAgainst: number;
  };
  subscriptions: {
    id: string;
    platform: string;
    productId: string;
    startDate: string;
    expiryDate: string;
    status: string;
  }[];
  reports: {
    id: string;
    reason: string;
    details: string | null;
    resolved: boolean;
    createdAt: string;
  }[];
}

export interface AdminStats {
  users: {
    total: number;
    active: number;
    suspended: number;
    banned: number;
    deleted: number;
    premium: number;
    signupsToday: number;
    signupsThisWeek: number;
    activeToday: number;
    activeThisWeek: number;
  };
  matches: {
    total: number;
    today: number;
    thisWeek: number;
  };
  messages: {
    total: number;
    today: number;
    thisWeek: number;
  };
  reports: {
    open: number;
    resolved: number;
    total: number;
  };
  subscriptions: {
    activePremium: number;
    monthly: number;
    annual: number;
  };
  growth: {
    date: string;
    signups: number;
  }[];
}

export const adminService = {
  async stats(): Promise<AdminStats> {
    const [
      usersR,
      matchesR,
      messagesR,
      reportsR,
      subsR,
      growthR,
    ] = await Promise.all([
      query<{
        total: string;
        active: string;
        suspended: string;
        banned: string;
        deleted: string;
        premium: string;
        signups_today: string;
        signups_week: string;
        active_today: string;
        active_week: string;
      }>(
        `SELECT
           COUNT(*)                                                                AS total,
           COUNT(*) FILTER (WHERE status = 'active')                               AS active,
           COUNT(*) FILTER (WHERE status = 'suspended')                            AS suspended,
           COUNT(*) FILTER (WHERE status = 'banned')                               AS banned,
           COUNT(*) FILTER (WHERE status = 'deleted')                              AS deleted,
           COUNT(*) FILTER (WHERE is_premium = TRUE AND status != 'deleted')      AS premium,
           COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '1 day')          AS signups_today,
           COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days')         AS signups_week,
           COUNT(*) FILTER (WHERE last_active_at >= NOW() - INTERVAL '1 day')      AS active_today,
           COUNT(*) FILTER (WHERE last_active_at >= NOW() - INTERVAL '7 days')     AS active_week
         FROM users`,
      ),
      query<{ total: string; today: string; week: string }>(
        `SELECT
           COUNT(*)                                                             AS total,
           COUNT(*) FILTER (WHERE matched_at >= NOW() - INTERVAL '1 day')       AS today,
           COUNT(*) FILTER (WHERE matched_at >= NOW() - INTERVAL '7 days')      AS week
         FROM matches`,
      ),
      query<{ total: string; today: string; week: string }>(
        `SELECT
           COUNT(*)                                                              AS total,
           COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '1 day')        AS today,
           COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days')       AS week
         FROM messages`,
      ),
      query<{ open: string; resolved: string; total: string }>(
        `SELECT
           COUNT(*) FILTER (WHERE resolved = FALSE)  AS open,
           COUNT(*) FILTER (WHERE resolved = TRUE)   AS resolved,
           COUNT(*)                                  AS total
         FROM reports`,
      ),
      query<{ active: string; monthly: string; annual: string }>(
        `SELECT
           COUNT(*) FILTER (WHERE status = 'active' AND expiry_date > NOW())                                       AS active,
           COUNT(*) FILTER (WHERE status = 'active' AND expiry_date > NOW() AND product_id = 'monthly_premium')    AS monthly,
           COUNT(*) FILTER (WHERE status = 'active' AND expiry_date > NOW() AND product_id = 'annual_premium')     AS annual
         FROM subscriptions`,
      ),
      query<{ day: Date; signups: string }>(
        `SELECT DATE_TRUNC('day', created_at)::date AS day, COUNT(*) AS signups
           FROM users
          WHERE created_at >= NOW() - INTERVAL '13 days'
          GROUP BY 1
          ORDER BY 1 ASC`,
      ),
    ]);

    const u = usersR.rows[0];
    const m = matchesR.rows[0];
    const msg = messagesR.rows[0];
    const rep = reportsR.rows[0];
    const sub = subsR.rows[0];

    // Fill last 14 days including zero days.
    const growthMap = new Map<string, number>();
    for (const row of growthR.rows) {
      const key = new Date(row.day).toISOString().slice(0, 10);
      growthMap.set(key, Number(row.signups));
    }
    const growth: AdminStats['growth'] = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date();
      d.setUTCHours(0, 0, 0, 0);
      d.setUTCDate(d.getUTCDate() - i);
      const key = d.toISOString().slice(0, 10);
      growth.push({ date: key, signups: growthMap.get(key) ?? 0 });
    }

    return {
      users: {
        total: Number(u.total),
        active: Number(u.active),
        suspended: Number(u.suspended),
        banned: Number(u.banned),
        deleted: Number(u.deleted),
        premium: Number(u.premium),
        signupsToday: Number(u.signups_today),
        signupsThisWeek: Number(u.signups_week),
        activeToday: Number(u.active_today),
        activeThisWeek: Number(u.active_week),
      },
      matches: {
        total: Number(m.total),
        today: Number(m.today),
        thisWeek: Number(m.week),
      },
      messages: {
        total: Number(msg.total),
        today: Number(msg.today),
        thisWeek: Number(msg.week),
      },
      reports: {
        open: Number(rep.open),
        resolved: Number(rep.resolved),
        total: Number(rep.total),
      },
      subscriptions: {
        activePremium: Number(sub.active),
        monthly: Number(sub.monthly),
        annual: Number(sub.annual),
      },
      growth,
    };
  },

  async listUsers(opts: {
    q?: string;
    status?: 'active' | 'suspended' | 'banned' | 'deleted';
    premium?: boolean;
    role?: 'user' | 'admin';
    sort?: 'recent' | 'oldest' | 'active';
    page?: number;
    pageSize?: number;
  }): Promise<{ users: AdminUserRow[]; total: number; page: number; pageSize: number }> {
    const page = Math.max(1, Number(opts.page ?? 1));
    const pageSize = Math.min(100, Math.max(1, Number(opts.pageSize ?? 25)));
    const offset = (page - 1) * pageSize;

    const conds: string[] = [];
    const params: unknown[] = [];

    if (opts.q) {
      params.push(`%${opts.q.toLowerCase()}%`);
      conds.push(`(LOWER(u.email::text) LIKE $${params.length} OR LOWER(COALESCE(u.first_name, '')) LIKE $${params.length} OR LOWER(COALESCE(u.city, '')) LIKE $${params.length})`);
    }
    if (opts.status) {
      params.push(opts.status);
      conds.push(`u.status = $${params.length}`);
    }
    if (opts.premium !== undefined) {
      params.push(opts.premium);
      conds.push(`u.is_premium = $${params.length}`);
    }
    if (opts.role) {
      params.push(opts.role);
      conds.push(`u.role = $${params.length}`);
    }

    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

    let order = 'u.created_at DESC';
    if (opts.sort === 'oldest') order = 'u.created_at ASC';
    if (opts.sort === 'active') order = 'u.last_active_at DESC NULLS LAST';

    const totalR = await query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM users u ${where}`,
      params,
    );
    const total = Number(totalR.rows[0]?.count ?? 0);

    params.push(pageSize, offset);
    const r = await query<{
      id: string;
      email: string | null;
      first_name: string | null;
      birth_date: Date | null;
      gender: string | null;
      city: string | null;
      status: 'active' | 'suspended' | 'banned' | 'deleted';
      role: 'user' | 'admin';
      is_premium: boolean;
      premium_until: Date | null;
      email_verified_at: Date | null;
      language: string;
      created_at: Date;
      last_active_at: Date | null;
      photo_count: string;
      cover_image_url: string | null;
      cover_storage_key: string | null;
      reports_against: string;
    }>(
      `SELECT u.id, u.email, u.first_name, u.birth_date, u.gender, u.city,
              u.status, u.role, u.is_premium, u.premium_until, u.email_verified_at,
              u.language, u.created_at, u.last_active_at,
              (SELECT COUNT(*) FROM photos p WHERE p.user_id = u.id) AS photo_count,
              (SELECT image_url FROM photos p WHERE p.user_id = u.id ORDER BY order_index ASC LIMIT 1) AS cover_image_url,
              (SELECT storage_key FROM photos p WHERE p.user_id = u.id ORDER BY order_index ASC LIMIT 1) AS cover_storage_key,
              (SELECT COUNT(*) FROM reports r WHERE r.reported_user_id = u.id) AS reports_against
         FROM users u
         ${where}
         ORDER BY ${order}
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );

    const users: AdminUserRow[] = r.rows.map((u) => ({
      id: u.id,
      email: u.email,
      firstName: u.first_name,
      age: u.birth_date ? calculateAge(u.birth_date) : null,
      gender: u.gender,
      city: u.city,
      status: u.status,
      role: u.role,
      isPremium: u.is_premium,
      premiumUntil: u.premium_until ? u.premium_until.toISOString() : null,
      emailVerified: u.email_verified_at != null,
      language: u.language,
      createdAt: u.created_at.toISOString(),
      lastActiveAt: u.last_active_at ? u.last_active_at.toISOString() : null,
      photoCount: Number(u.photo_count),
      coverPhoto: u.cover_image_url
        ? resolveStoredUrl(u.cover_image_url, u.cover_storage_key)
        : null,
      reportsAgainst: Number(u.reports_against),
    }));

    return { users, total, page, pageSize };
  },

  async userDetail(id: string): Promise<AdminUserDetail> {
    const r = await query<{
      id: string;
      email: string | null;
      first_name: string | null;
      birth_date: Date | null;
      gender: string | null;
      city: string | null;
      bio: string | null;
      status: 'active' | 'suspended' | 'banned' | 'deleted';
      role: 'user' | 'admin';
      is_premium: boolean;
      premium_until: Date | null;
      email_verified_at: Date | null;
      language: string;
      created_at: Date;
      last_active_at: Date | null;
      interested_in: 'men' | 'women' | 'both' | null;
      min_age: number | null;
      max_age: number | null;
    }>(
      `SELECT u.id, u.email, u.first_name, u.birth_date, u.gender, u.city, u.bio,
              u.status, u.role, u.is_premium, u.premium_until, u.email_verified_at,
              u.language, u.created_at, u.last_active_at,
              p.interested_in, p.min_age, p.max_age
         FROM users u
         LEFT JOIN user_preferences p ON p.user_id = u.id
         WHERE u.id = $1`,
      [id],
    );
    const u = r.rows[0];
    if (!u) throw NotFound('User not found');

    const [
      photosR,
      langsR,
      goalsR,
      statsR,
      subsR,
      reportsR,
    ] = await Promise.all([
      query<{ id: string; image_url: string; storage_key: string | null; order_index: number }>(
        `SELECT id, image_url, storage_key, order_index FROM photos WHERE user_id = $1 ORDER BY order_index ASC`,
        [id],
      ),
      query<{ language: string }>(`SELECT language FROM user_languages WHERE user_id = $1`, [id]),
      query<{ goal: string }>(`SELECT goal FROM user_relationship_goals WHERE user_id = $1`, [id]),
      query<{
        matches: string;
        conversations: string;
        messages_sent: string;
        likes_given: string;
        likes_received: string;
        super_likes_given: string;
        passes: string;
        blocks_made: string;
        blocks_against: string;
        reports_made: string;
        reports_against: string;
      }>(
        `SELECT
           (SELECT COUNT(*) FROM matches WHERE user_a_id = $1 OR user_b_id = $1)                        AS matches,
           (SELECT COUNT(*) FROM conversations c JOIN matches m ON m.id = c.match_id
              WHERE m.user_a_id = $1 OR m.user_b_id = $1)                                                AS conversations,
           (SELECT COUNT(*) FROM messages WHERE sender_id = $1)                                          AS messages_sent,
           (SELECT COUNT(*) FROM likes WHERE sender_id = $1)                                             AS likes_given,
           (SELECT COUNT(*) FROM likes WHERE receiver_id = $1)                                           AS likes_received,
           (SELECT COALESCE(SUM(1), 0) FROM super_like_usages WHERE user_id = $1)                        AS super_likes_given,
           (SELECT COUNT(*) FROM passes WHERE sender_id = $1)                                            AS passes,
           (SELECT COUNT(*) FROM blocks WHERE blocker_id = $1)                                           AS blocks_made,
           (SELECT COUNT(*) FROM blocks WHERE blocked_user_id = $1)                                      AS blocks_against,
           (SELECT COUNT(*) FROM reports WHERE reporter_id = $1)                                         AS reports_made,
           (SELECT COUNT(*) FROM reports WHERE reported_user_id = $1)                                    AS reports_against`,
        [id],
      ),
      query<{
        id: string;
        platform: string;
        product_id: string;
        start_date: Date;
        expiry_date: Date;
        status: string;
      }>(
        `SELECT id, platform, product_id, start_date, expiry_date, status
           FROM subscriptions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20`,
        [id],
      ),
      query<{
        id: string;
        reason: string;
        details: string | null;
        resolved: boolean;
        created_at: Date;
      }>(
        `SELECT id, reason, details, resolved, created_at
           FROM reports WHERE reported_user_id = $1 ORDER BY created_at DESC LIMIT 50`,
        [id],
      ),
    ]);

    return {
      id: u.id,
      email: u.email,
      firstName: u.first_name,
      age: u.birth_date ? calculateAge(u.birth_date) : null,
      gender: u.gender,
      city: u.city,
      bio: u.bio,
      birthDate: u.birth_date ? u.birth_date.toISOString().slice(0, 10) : null,
      status: u.status,
      role: u.role,
      isPremium: u.is_premium,
      premiumUntil: u.premium_until ? u.premium_until.toISOString() : null,
      emailVerified: u.email_verified_at != null,
      language: u.language,
      createdAt: u.created_at.toISOString(),
      lastActiveAt: u.last_active_at ? u.last_active_at.toISOString() : null,
      photoCount: photosR.rows.length,
      coverPhoto: photosR.rows[0]
        ? resolveStoredUrl(photosR.rows[0].image_url, photosR.rows[0].storage_key)
        : null,
      reportsAgainst: Number(statsR.rows[0]?.reports_against ?? 0),
      interestedIn: u.interested_in,
      minAge: u.min_age ?? 18,
      maxAge: u.max_age ?? 99,
      languages: langsR.rows.map((x) => x.language),
      relationshipGoals: goalsR.rows.map((x) => x.goal),
      photos: photosR.rows.map((p) => ({
        id: p.id,
        url: resolveStoredUrl(p.image_url, p.storage_key),
        orderIndex: p.order_index,
      })),
      stats: {
        matches: Number(statsR.rows[0]?.matches ?? 0),
        conversations: Number(statsR.rows[0]?.conversations ?? 0),
        messagesSent: Number(statsR.rows[0]?.messages_sent ?? 0),
        likesGiven: Number(statsR.rows[0]?.likes_given ?? 0),
        likesReceived: Number(statsR.rows[0]?.likes_received ?? 0),
        superLikesGiven: Number(statsR.rows[0]?.super_likes_given ?? 0),
        passes: Number(statsR.rows[0]?.passes ?? 0),
        blocksMade: Number(statsR.rows[0]?.blocks_made ?? 0),
        blocksAgainst: Number(statsR.rows[0]?.blocks_against ?? 0),
        reportsMade: Number(statsR.rows[0]?.reports_made ?? 0),
        reportsAgainst: Number(statsR.rows[0]?.reports_against ?? 0),
      },
      subscriptions: subsR.rows.map((s) => ({
        id: s.id,
        platform: s.platform,
        productId: s.product_id,
        startDate: s.start_date.toISOString(),
        expiryDate: s.expiry_date.toISOString(),
        status: s.status,
      })),
      reports: reportsR.rows.map((rep) => ({
        id: rep.id,
        reason: rep.reason,
        details: rep.details,
        resolved: rep.resolved,
        createdAt: rep.created_at.toISOString(),
      })),
    };
  },

  async setPremium(
    id: string,
    grant: boolean,
    days: number | null,
  ): Promise<void> {
    if (grant) {
      const until = days && days > 0 ? new Date(Date.now() + days * 24 * 60 * 60 * 1000) : null;
      await query(
        `UPDATE users SET is_premium = TRUE, premium_until = $1 WHERE id = $2`,
        [until, id],
      );
    } else {
      await query(
        `UPDATE users SET is_premium = FALSE, premium_until = NULL WHERE id = $1`,
        [id],
      );
    }
  },

  async setRole(id: string, role: 'user' | 'admin'): Promise<void> {
    await query(`UPDATE users SET role = $1 WHERE id = $2`, [role, id]);
  },

  async hardDelete(id: string): Promise<void> {
    // Cascades will handle related tables via ON DELETE CASCADE.
    await withTransaction(async (client) => {
      await client.query(`DELETE FROM users WHERE id = $1`, [id]);
    });
  },

  async listSubscriptions(opts: {
    status?: 'active' | 'expired' | 'cancelled' | 'grace';
    page?: number;
    pageSize?: number;
  }): Promise<{ subscriptions: unknown[]; total: number; page: number; pageSize: number }> {
    const page = Math.max(1, Number(opts.page ?? 1));
    const pageSize = Math.min(100, Math.max(1, Number(opts.pageSize ?? 25)));
    const offset = (page - 1) * pageSize;

    const conds: string[] = [];
    const params: unknown[] = [];

    if (opts.status) {
      params.push(opts.status);
      conds.push(`s.status = $${params.length}`);
    }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

    const totalR = await query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM subscriptions s ${where}`,
      params,
    );
    const total = Number(totalR.rows[0]?.count ?? 0);

    params.push(pageSize, offset);
    const r = await query(
      `SELECT s.id, s.user_id, s.platform, s.product_id, s.start_date, s.expiry_date,
              s.status, s.created_at, u.email, u.first_name
         FROM subscriptions s
         JOIN users u ON u.id = s.user_id
         ${where}
         ORDER BY s.created_at DESC
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );

    return {
      subscriptions: r.rows.map((s: any) => ({
        id: s.id,
        userId: s.user_id,
        userEmail: s.email,
        userFirstName: s.first_name,
        platform: s.platform,
        productId: s.product_id,
        startDate: s.start_date.toISOString(),
        expiryDate: s.expiry_date.toISOString(),
        status: s.status,
        createdAt: s.created_at.toISOString(),
      })),
      total,
      page,
      pageSize,
    };
  },
};

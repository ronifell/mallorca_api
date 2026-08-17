import { query } from '../config/database';

/**
 * Premium entitlement for feature gates.
 *
 * `premium_until` is the source of truth: users keep access until that
 * timestamp even when Google reports the subscription as cancelled during
 * a free trial or billing grace period.
 */
export async function isUserPremium(userId: string): Promise<boolean> {
  const r = await query<{ is_premium: boolean; premium_until: Date | null }>(
    'SELECT is_premium, premium_until FROM users WHERE id = $1',
    [userId],
  );
  const row = r.rows[0];
  if (!row) return false;

  const untilMs = row.premium_until?.getTime() ?? 0;
  if (untilMs > Date.now()) return true;

  if (row.is_premium === true && untilMs === 0) return true;

  // Fallback when users.is_premium drifted but an active subscription row exists
  // (e.g. Play refresh lag, mock billing, or a missed RTDN webhook).
  const sub = await query<{ n: string }>(
    `SELECT COUNT(*)::text AS n
       FROM subscriptions
      WHERE user_id = $1
        AND status IN ('active', 'grace', 'cancelled')
        AND expiry_date > NOW()`,
    [userId],
  );
  return Number(sub.rows[0]?.n ?? 0) > 0;
}

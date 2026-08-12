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

  return row.is_premium === true && untilMs === 0;
}

import { query } from '../config/database';

export async function isUserPremium(userId: string): Promise<boolean> {
  const r = await query<{ is_premium: boolean }>(
    'SELECT is_premium FROM users WHERE id = $1',
    [userId],
  );
  return r.rows[0]?.is_premium ?? false;
}

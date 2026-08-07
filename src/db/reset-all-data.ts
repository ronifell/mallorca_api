/**
 * Delete all application data from PostgreSQL (same effect as reset_all_data.sql).
 *
 * Preserves: table structures, schema_migrations, extensions, ENUM types.
 * Does NOT delete: uploaded files in S3/R2 or local uploads/ — remove those separately.
 *
 * Usage (local / server dev):
 *   npm run reset:data -- --yes
 *
 * Usage (production build on server):
 *   npm run reset:data:prod -- --yes
 */
import { pool } from '../config/database';
import { logger } from '../utils/logger';

const TRUNCATE_TABLES = [
  'messages',
  'conversations',
  'matches',
  'likes',
  'passes',
  'reports',
  'blocks',
  'subscriptions',
  'photos',
  'user_languages',
  'user_preferences',
  'user_relationship_goals',
  'user_interest_selections',
  'notification_settings',
  'refresh_tokens',
  'password_resets',
  'email_verifications',
  'super_like_usages',
  'users',
] as const;

async function main(): Promise<void> {
  const confirmed = process.argv.includes('--yes');
  if (!confirmed) {
    console.error('This deletes ALL users and related data.');
    console.error('Re-run with --yes to confirm:');
    console.error('  npm run reset:data -- --yes');
    process.exit(1);
  }

  const sql = `TRUNCATE TABLE ${TRUNCATE_TABLES.join(', ')} RESTART IDENTITY CASCADE`;

  logger.warn('Resetting all application data…', { tables: TRUNCATE_TABLES.length });
  await pool.query('BEGIN');
  try {
    await pool.query(sql);
    await pool.query('COMMIT');
  } catch (err) {
    await pool.query('ROLLBACK');
    throw err;
  }

  const counts = await pool.query<{ tbl: string; rows: string }>(`
    SELECT 'users' AS tbl, COUNT(*)::text AS rows FROM users
    UNION ALL SELECT 'photos', COUNT(*)::text FROM photos
    UNION ALL SELECT 'matches', COUNT(*)::text FROM matches
    UNION ALL SELECT 'messages', COUNT(*)::text FROM messages
  `);

  logger.info('Database reset complete', { counts: counts.rows });
  console.log('Done. All application tables are empty.');
  console.table(counts.rows);
}

main()
  .catch((err) => {
    logger.error('Database reset failed', { err });
    process.exit(1);
  })
  .finally(async () => {
    await pool.end();
  });

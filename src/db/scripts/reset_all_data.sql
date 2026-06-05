-- =============================================================================
-- Reset all application data
-- =============================================================================
-- Deletes every row from all user-facing tables, including `users`.
--
-- PRESERVED (not touched):
--   • Table structures, indexes, triggers, functions, and ENUM types
--   • PostgreSQL extensions (pgcrypto, citext)
--   • schema_migrations (so migrations are not re-applied on next deploy)
--
-- NOT COVERED by this script:
--   • Files in uploads/ or cloud storage (S3/R2) — delete those separately
--     if you also want profile/chat images removed from disk.
--
-- Usage (psql):
--   psql "$DATABASE_URL" -f src/db/scripts/reset_all_data.sql
--
-- Usage (from Backend folder with .env loaded):
--   psql -h localhost -U postgres -d mallorca_dating -f src/db/scripts/reset_all_data.sql
-- =============================================================================

BEGIN;

-- Child tables first; CASCADE handles any remaining FK dependencies between them.
TRUNCATE TABLE
  messages,
  conversations,
  matches,
  likes,
  passes,
  reports,
  blocks,
  subscriptions,
  photos,
  user_languages,
  user_preferences,
  notification_settings,
  refresh_tokens,
  password_resets,
  users
RESTART IDENTITY CASCADE;

COMMIT;

-- Optional: verify all application tables are empty
-- SELECT 'users' AS tbl, COUNT(*) AS rows FROM users
-- UNION ALL SELECT 'photos', COUNT(*) FROM photos
-- UNION ALL SELECT 'matches', COUNT(*) FROM matches
-- UNION ALL SELECT 'messages', COUNT(*) FROM messages;

-- =============================================================================
-- Mallorca Dating - Migration 002
-- Adds inclusive gender values to the gender_t enum.
--
-- NOTE: ALTER TYPE ... ADD VALUE cannot run inside a transaction block on
-- PostgreSQL < 12. Since the migrator wraps each file in a transaction, this
-- migration is split off so the runner only contains ADD VALUE statements
-- (which are allowed inside a transaction on PG 12+).
-- =============================================================================

ALTER TYPE gender_t ADD VALUE IF NOT EXISTS 'non_binary';
ALTER TYPE gender_t ADD VALUE IF NOT EXISTS 'gender_fluid';
ALTER TYPE gender_t ADD VALUE IF NOT EXISTS 'other';
ALTER TYPE gender_t ADD VALUE IF NOT EXISTS 'prefer_not_to_say';

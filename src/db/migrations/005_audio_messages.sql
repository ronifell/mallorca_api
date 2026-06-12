-- =============================================================================
-- Mallorca Dating - Migration 005
-- Adds audio messages to the chat. We extend the existing message_type enum
-- and add an `audio_url` column that mirrors the `image_url` pattern, so
-- existing pagination / read-receipt logic continues to work unchanged.
-- =============================================================================

ALTER TYPE message_type_t ADD VALUE IF NOT EXISTS 'audio';

ALTER TABLE messages ADD COLUMN IF NOT EXISTS audio_url       TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS audio_duration  REAL;

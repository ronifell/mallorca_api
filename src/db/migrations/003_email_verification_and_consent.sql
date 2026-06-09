-- =============================================================================
-- Mallorca Dating - Migration 003
-- Adds:
--   1. Email verification (column on users + tokens table)
--   2. Strict Terms / Privacy consent timestamps for GDPR audit trail
--   3. Multi-select "interested_in" audit table
-- =============================================================================

-- 1. Email verification ------------------------------------------------------
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at  TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS terms_accepted_at  TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS privacy_accepted_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS email_verifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_email_verif_user       ON email_verifications (user_id);
CREATE INDEX IF NOT EXISTS idx_email_verif_token_hash ON email_verifications (token_hash);

-- 2. Multi-select "interested in" -------------------------------------------
-- We keep `user_preferences.interested_in` (men | women | both) as the
-- matching SQL "fast path". Multi-select is modelled by mapping "everyone"
-- (or men + women) to "both". For audit + future expansion we also persist
-- the raw user-facing selections here.
CREATE TABLE IF NOT EXISTS user_interest_selections (
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  selection  TEXT NOT NULL CHECK (selection IN ('men', 'women', 'everyone')),
  PRIMARY KEY (user_id, selection)
);

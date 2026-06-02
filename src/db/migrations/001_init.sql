-- =============================================================================
-- Mallorca Dating - Initial schema
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "citext";

-- Enumerated types ------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE gender_t AS ENUM ('male', 'female');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE interested_in_t AS ENUM ('men', 'women', 'both');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE message_type_t AS ENUM ('text', 'image');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE subscription_status_t AS ENUM ('active', 'expired', 'cancelled', 'grace');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE subscription_platform_t AS ENUM ('google_play', 'app_store');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE report_reason_t AS ENUM ('fake_profile', 'harassment', 'inappropriate_content', 'spam', 'other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE user_status_t AS ENUM ('active', 'suspended', 'banned', 'deleted');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Users -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email           CITEXT UNIQUE,                          -- citext extension; fallback to lowercase trigger below
  password_hash   TEXT        NOT NULL,
  first_name      TEXT,
  birth_date      DATE,
  gender          gender_t,
  city            TEXT,
  bio             TEXT,
  is_premium      BOOLEAN     NOT NULL DEFAULT FALSE,
  premium_until   TIMESTAMPTZ,
  role            TEXT        NOT NULL DEFAULT 'user',     -- 'user' | 'admin'
  status          user_status_t NOT NULL DEFAULT 'active',
  language        TEXT        NOT NULL DEFAULT 'en',
  fcm_token       TEXT,
  last_active_at  TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- If pgcrypto's citext isn't available, you can switch the email column to TEXT
-- with a unique index on lower(email). To keep portability, do that here:
-- ALTER TABLE users ALTER COLUMN email TYPE TEXT;
-- CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_uniq ON users (lower(email));

CREATE INDEX IF NOT EXISTS idx_users_status        ON users (status);
CREATE INDEX IF NOT EXISTS idx_users_premium       ON users (is_premium);
CREATE INDEX IF NOT EXISTS idx_users_gender        ON users (gender);
CREATE INDEX IF NOT EXISTS idx_users_last_active   ON users (last_active_at DESC);

-- Languages spoken (separate table for normalization) -------------------------
CREATE TABLE IF NOT EXISTS user_languages (
  user_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  language  TEXT NOT NULL,
  PRIMARY KEY (user_id, language)
);

-- User preferences (what gender they are interested in) -----------------------
CREATE TABLE IF NOT EXISTS user_preferences (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  interested_in   interested_in_t NOT NULL,
  min_age         INT NOT NULL DEFAULT 18,
  max_age         INT NOT NULL DEFAULT 99,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Photos ----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS photos (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  image_url   TEXT NOT NULL,
  storage_key TEXT,                          -- internal S3/R2 object key
  order_index INT  NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_photos_user_order ON photos (user_id, order_index);

-- Likes / passes (swipes) -----------------------------------------------------
CREATE TABLE IF NOT EXISTS likes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  receiver_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (sender_id, receiver_id),
  CHECK (sender_id <> receiver_id)
);
CREATE INDEX IF NOT EXISTS idx_likes_receiver ON likes (receiver_id);

CREATE TABLE IF NOT EXISTS passes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  receiver_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (sender_id, receiver_id),
  CHECK (sender_id <> receiver_id)
);
CREATE INDEX IF NOT EXISTS idx_passes_sender ON passes (sender_id);

-- Matches: one row per pair, with a canonical ordering of user ids ------------
CREATE TABLE IF NOT EXISTS matches (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_a_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_b_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  matched_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (user_a_id < user_b_id),
  UNIQUE (user_a_id, user_b_id)
);
CREATE INDEX IF NOT EXISTS idx_matches_user_a ON matches (user_a_id);
CREATE INDEX IF NOT EXISTS idx_matches_user_b ON matches (user_b_id);

-- Conversations ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS conversations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id      UUID NOT NULL UNIQUE REFERENCES matches(id) ON DELETE CASCADE,
  initiated_by  UUID REFERENCES users(id) ON DELETE SET NULL, -- the Premium user who started it
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_message_at TIMESTAMPTZ
);

-- Messages --------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type            message_type_t NOT NULL DEFAULT 'text',
  text            TEXT,
  image_url       TEXT,
  delivered_at    TIMESTAMPTZ,
  read_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_messages_conv_created ON messages (conversation_id, created_at DESC);

-- Subscriptions ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS subscriptions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform        subscription_platform_t NOT NULL,
  product_id      TEXT NOT NULL,                  -- e.g. monthly_premium / annual_premium
  purchase_token  TEXT NOT NULL,
  start_date      TIMESTAMPTZ NOT NULL,
  expiry_date     TIMESTAMPTZ NOT NULL,
  status          subscription_status_t NOT NULL DEFAULT 'active',
  raw_payload     JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (platform, purchase_token)
);
CREATE INDEX IF NOT EXISTS idx_subs_user ON subscriptions (user_id);
CREATE INDEX IF NOT EXISTS idx_subs_status ON subscriptions (status);

-- Reports ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reports (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reported_user_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason            report_reason_t NOT NULL,
  details           TEXT,
  resolved          BOOLEAN NOT NULL DEFAULT FALSE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (reporter_id <> reported_user_id)
);
CREATE INDEX IF NOT EXISTS idx_reports_reported ON reports (reported_user_id);

-- Blocks ----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS blocks (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  blocker_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_user_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (blocker_id, blocked_user_id),
  CHECK (blocker_id <> blocked_user_id)
);
CREATE INDEX IF NOT EXISTS idx_blocks_blocked ON blocks (blocked_user_id);

-- Refresh tokens (server-tracked for revocation) ------------------------------
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  jti         TEXT UNIQUE NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  revoked_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_refresh_user ON refresh_tokens (user_id);

-- Password reset tokens -------------------------------------------------------
CREATE TABLE IF NOT EXISTS password_resets (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Notification preferences ----------------------------------------------------
CREATE TABLE IF NOT EXISTS notification_settings (
  user_id           UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  matches_enabled   BOOLEAN NOT NULL DEFAULT TRUE,
  messages_enabled  BOOLEAN NOT NULL DEFAULT TRUE,
  subscription_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Trigger to keep updated_at fresh -------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_users_updated_at ON users;
CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_prefs_updated_at ON user_preferences;
CREATE TRIGGER trg_prefs_updated_at BEFORE UPDATE ON user_preferences
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_subs_updated_at ON subscriptions;
CREATE TRIGGER trg_subs_updated_at BEFORE UPDATE ON subscriptions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

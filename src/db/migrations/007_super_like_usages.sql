-- Dedicated ledger for Super Like weekly quota. Unlike rows in `likes`, these
-- records are not removed when a user resets their feed or unlikes someone,
-- so the 7-day quota stays accurate across app restarts.

-- Ensure the flag on likes still exists (migration 006 may not have been applied).
ALTER TABLE likes
  ADD COLUMN IF NOT EXISTS is_super BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_likes_super_weekly
  ON likes (sender_id, created_at DESC)
  WHERE is_super = TRUE;

CREATE TABLE IF NOT EXISTS super_like_usages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_user_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, target_user_id),
  CHECK (user_id <> target_user_id)
);

CREATE INDEX IF NOT EXISTS idx_super_like_usages_user_week
  ON super_like_usages (user_id, created_at DESC);

-- Back-fill from any super likes already stored on the likes table.
INSERT INTO super_like_usages (user_id, target_user_id, created_at)
SELECT l.sender_id, l.receiver_id, l.created_at
  FROM likes l
 WHERE l.is_super = TRUE
ON CONFLICT (user_id, target_user_id) DO NOTHING;

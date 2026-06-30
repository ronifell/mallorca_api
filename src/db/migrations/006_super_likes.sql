-- Super Like: premium-only likes flagged on the existing likes row.
ALTER TABLE likes
  ADD COLUMN IF NOT EXISTS is_super BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_likes_super_weekly
  ON likes (sender_id, created_at DESC)
  WHERE is_super = TRUE;

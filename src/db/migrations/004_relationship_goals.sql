-- =============================================================================
-- Mallorca Dating - Migration 004
-- Adds the multi-select "relationship goal" preference and exposes the existing
-- age range preferences on the registration / public profile.
--
-- Storage model mirrors `user_interest_selections`: each goal a user can list
-- lives as its own row keyed by (user_id, goal). Six canonical values are
-- allowed via a CHECK constraint; we store stable enum-like keys (English
-- snake_case) and resolve display labels on the client.
-- =============================================================================

CREATE TABLE IF NOT EXISTS user_relationship_goals (
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  goal       TEXT NOT NULL CHECK (
    goal IN (
      'love',
      'friendship',
      'chat',
      'casual',
      'serious',
      'long_term'
    )
  ),
  PRIMARY KEY (user_id, goal)
);
CREATE INDEX IF NOT EXISTS idx_relationship_goals_goal
  ON user_relationship_goals (goal);

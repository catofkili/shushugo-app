ALTER TABLE teams ADD COLUMN streak_start TEXT;
ALTER TABLE team_daily_activity ADD COLUMN word_count INTEGER NOT NULL DEFAULT 0 CHECK (word_count BETWEEN 0 AND 5000);
ALTER TABLE team_daily_activity ADD COLUMN active_minutes INTEGER NOT NULL DEFAULT 0 CHECK (active_minutes BETWEEN 0 AND 1440);

CREATE TABLE team_leaves (
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  period_start TEXT NOT NULL,
  study_day TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (team_id, user_id, period_start)
);

-- Settled rewards survive leaving or dissolution; only account deletion removes them.
CREATE TABLE team_period_results (
  team_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  period_start TEXT NOT NULL,
  days_passed INTEGER NOT NULL,
  amount INTEGER NOT NULL,
  broken INTEGER NOT NULL,
  culprit INTEGER NOT NULL,
  settled_at TEXT NOT NULL,
  PRIMARY KEY (team_id, user_id, period_start)
);
CREATE INDEX idx_team_period_rewards ON team_period_results(user_id, period_start);

CREATE TABLE duels (
  id TEXT PRIMARY KEY,
  creator_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  levels TEXT NOT NULL,
  question_count INTEGER NOT NULL CHECK (question_count IN (10, 20, 30)),
  questions_json TEXT NOT NULL,
  creator_answers_json TEXT NOT NULL,
  creator_score TEXT NOT NULL,
  opponent_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  opponent_token_hash TEXT,
  opponent_answers_json TEXT,
  opponent_score TEXT,
  winner TEXT CHECK (winner IN ('creator', 'opponent', 'draw')),
  decided_at TEXT,
  created_at TEXT NOT NULL,
  CHECK (opponent_user_id IS NULL OR opponent_user_id <> creator_user_id)
);
CREATE INDEX idx_duels_creator ON duels(creator_user_id, created_at);
CREATE INDEX idx_duels_opponent ON duels(opponent_user_id, created_at);
CREATE TABLE duel_weekly_wins (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  iso_week TEXT NOT NULL,
  duel_id TEXT NOT NULL,
  decided_at TEXT NOT NULL,
  PRIMARY KEY (user_id, iso_week)
);

CREATE TABLE IF NOT EXISTS teams (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  target_level TEXT NOT NULL,
  emoji TEXT NOT NULL,
  visibility TEXT NOT NULL CHECK (visibility IN ('public', 'invite')),
  max_members INTEGER NOT NULL DEFAULT 6 CHECK (max_members BETWEEN 2 AND 8),
  owner_user_id TEXT NOT NULL,
  invite_code TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS team_members (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL,
  user_id TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'member')),
  joined_at TEXT NOT NULL,
  FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS team_daily_activity (
  team_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  study_day TEXT NOT NULL,
  study_count INTEGER NOT NULL DEFAULT 0 CHECK (study_count BETWEEN 0 AND 5000),
  completed INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0, 1)),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (team_id, user_id, study_day),
  FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS team_cheers (
  team_id TEXT NOT NULL,
  sender_user_id TEXT NOT NULL,
  receiver_user_id TEXT NOT NULL,
  study_day TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (team_id, sender_user_id, receiver_user_id, study_day),
  CHECK (sender_user_id <> receiver_user_id),
  FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
  FOREIGN KEY (sender_user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (receiver_user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS team_reports (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL,
  reporter_user_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (team_id, reporter_user_id),
  FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
  FOREIGN KEY (reporter_user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_team_members_team ON team_members(team_id, joined_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_team_one_owner ON team_members(team_id) WHERE role = 'owner';
CREATE INDEX IF NOT EXISTS idx_team_activity_day ON team_daily_activity(team_id, study_day);
CREATE INDEX IF NOT EXISTS idx_team_cheers_receiver ON team_cheers(team_id, receiver_user_id, study_day);
CREATE INDEX IF NOT EXISTS idx_team_reports_team ON team_reports(team_id, created_at);
CREATE INDEX IF NOT EXISTS idx_teams_plaza ON teams(visibility, updated_at);

CREATE TRIGGER IF NOT EXISTS team_capacity_before_insert
BEFORE INSERT ON team_members
WHEN (
  SELECT COUNT(*) FROM team_members WHERE team_id = NEW.team_id
) >= (
  SELECT max_members FROM teams WHERE id = NEW.team_id
)
BEGIN
  SELECT RAISE(ABORT, 'team_full');
END;

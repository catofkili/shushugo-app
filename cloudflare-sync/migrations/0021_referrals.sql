CREATE TABLE referral_codes (
  user_id TEXT PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  device_id TEXT,
  set_unlocked_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE referral_claims (
  invitee_user_id TEXT PRIMARY KEY,
  inviter_user_id TEXT NOT NULL,
  claimed_day TEXT NOT NULL,
  claimed_at TEXT NOT NULL,
  qualified_at TEXT,
  set_unlocked_at TEXT
);
CREATE INDEX idx_referral_claims_inviter ON referral_claims(inviter_user_id);

CREATE TABLE referral_earnings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invitee_user_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  key TEXT NOT NULL,
  day TEXT NOT NULL,
  amount INTEGER NOT NULL,
  inviter_amount INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(invitee_user_id, kind, key)
);
CREATE INDEX idx_referral_earnings_day ON referral_earnings(invitee_user_id, day);

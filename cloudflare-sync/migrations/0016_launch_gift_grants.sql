-- 独立于 7 天 trial_grants：已领取旧试用的账号也能领取一次首月赠送。
CREATE TABLE IF NOT EXISTS launch_gift_grants (
  user_id TEXT PRIMARY KEY,
  granted_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

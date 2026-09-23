-- 每个账号终身只能领取一次 7 天计划试用。单独留领取记录，不能只看 entitlements：
-- 试用结束后 entitlements 会失效，付费也会覆盖它，但这些都不应该让账号重新领取。
CREATE TABLE IF NOT EXISTS trial_grants (
  user_id TEXT PRIMARY KEY,
  granted_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

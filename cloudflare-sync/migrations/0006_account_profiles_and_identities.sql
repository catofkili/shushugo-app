-- 正式账号体系：支持邮箱与 Apple 身份、协议留痕和跨设备个人资料。
ALTER TABLE users ADD COLUMN bio TEXT;
ALTER TABLE users ADD COLUMN target_level TEXT;
ALTER TABLE users ADD COLUMN profile_updated_at TEXT;
ALTER TABLE users ADD COLUMN terms_version TEXT;
ALTER TABLE users ADD COLUMN privacy_version TEXT;
ALTER TABLE users ADD COLUMN consented_at TEXT;

CREATE TABLE IF NOT EXISTS auth_identities (
  provider TEXT NOT NULL,
  provider_subject TEXT NOT NULL,
  user_id TEXT NOT NULL,
  email TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (provider, provider_subject),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_auth_identities_user
  ON auth_identities(user_id);

-- 现有邮箱账号补上身份记录，迁移后仍可原样登录。
INSERT OR IGNORE INTO auth_identities (provider, provider_subject, user_id, email, created_at)
SELECT 'email', lower(email), id, lower(email), created_at
FROM users;

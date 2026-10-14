-- 微信审核员一次性登录密码（见 index.ts 的 reviewLogin）。只存 SHA-256 摘要。
-- first_login_at 为空 = 还没用过，到 use_by 作废；用过之后 7 天（expires_at）作废。
CREATE TABLE IF NOT EXISTS review_passwords (
  password_hash TEXT PRIMARY KEY,
  use_by TEXT NOT NULL,
  first_login_at TEXT,
  expires_at TEXT
);

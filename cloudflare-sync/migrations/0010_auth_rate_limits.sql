-- 认证类限速改用 D1 的原子 UPSERT。
--
-- 原来是 KV 的 get → put：两个节点同时读到 4、同时写回 5，实际放过了两次。
-- 对登录爆破和验证码枚举来说，"大概不超过 N 次" 不是上限。
-- 这张表不带 users 外键：subject 常常是 IP 或邮箱，不是账号。
CREATE TABLE IF NOT EXISTS auth_rate_limits (
  subject TEXT NOT NULL,
  scope TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (subject, scope, window_start)
);

CREATE INDEX IF NOT EXISTS idx_auth_rate_limits_window ON auth_rate_limits(window_start);

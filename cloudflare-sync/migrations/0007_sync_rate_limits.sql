-- 同步接口按账号记录精确的固定窗口额度。边缘 Rate Limiting binding
-- 负责快速挡突发，D1 原子计数负责防止同一账号跨 IP/地区绕过额度。
CREATE TABLE IF NOT EXISTS sync_rate_limits (
  user_id TEXT NOT NULL,
  scope TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, scope, window_start),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sync_rate_limits_window
  ON sync_rate_limits(window_start);

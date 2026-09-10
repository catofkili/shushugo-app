-- App Store Server Notifications 的投递记录。
--
-- ⚠️ 存在的理由是**可验证**：没有它，Apple 的「Request a Test Notification」打进来
-- 之后服务端不留任何痕迹（未认领的交易直接 return），于是「通知地址配对了没有」
-- 这件事根本没法确认，只能等真实退款发生时才发现没配。
--
-- 不能塞进 purchase_events：那张表的 user_id NOT NULL 且外键到 users，
-- 而通知常常在任何账号认领这笔交易之前就到了（测试通知更是压根没有交易）。
CREATE TABLE IF NOT EXISTS apple_notifications (
  id TEXT PRIMARY KEY,
  notification_type TEXT,
  subtype TEXT,
  transaction_id TEXT,
  original_transaction_id TEXT,
  environment TEXT,
  -- ignored / unclaimed / applied / apple_lookup_failed
  outcome TEXT NOT NULL,
  user_id TEXT,
  received_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_apple_notifications_received ON apple_notifications(received_at DESC);

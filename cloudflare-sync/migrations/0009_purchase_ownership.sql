-- 一笔 Apple 原始交易只能给一个应用账号开通 Pro。
--
-- 之前 purchase_events.transaction_id 上确实有唯一索引，但它是在 saveEntitlement
-- **之后**用 INSERT OR IGNORE 写的：第二个账号提交同一笔交易时，权益已经写进去了，
-- 事件插入被忽略也无济于事（实测两个账号都拿到 200 / isPro=true，权益两行、事件一行）。
-- 归属必须在写权益之前定下来，而且要靠数据库的原子约束，不是靠先查后写。
CREATE TABLE IF NOT EXISTS apple_transaction_owners (
  original_transaction_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  claimed_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 回填已有权益的归属，否则上线后老用户续费/恢复购买会被自己挡住。
INSERT OR IGNORE INTO apple_transaction_owners (original_transaction_id, user_id, claimed_at)
SELECT original_transaction_id, user_id, updated_at
FROM entitlements
WHERE original_transaction_id IS NOT NULL AND original_transaction_id != '';

-- purchase_events 现在要记录同一笔交易的**状态变化**（verified → revoked），
-- 而不只是「见过这笔交易」。
--
-- 旧的 transaction_id 唯一索引是给 1.2「一笔交易只给一个账号」用的，但它挡不住
-- （权益在它之前就写好了），归属已改由 apple_transaction_owners 的主键保证。
-- 留着它的副作用是：退款通知回来时那条 revoked 事件会被 INSERT OR IGNORE 丢掉，
-- 审计线索正好断在最需要它的地方。
DROP INDEX IF EXISTS idx_purchase_events_transaction;
CREATE UNIQUE INDEX IF NOT EXISTS idx_purchase_events_transaction_status
  ON purchase_events(transaction_id, user_id, status);

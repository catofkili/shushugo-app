-- 微信小程序虚拟支付的订单。out_trade_no 是我们生成的商户单号，也是权益表里的
-- original_transaction_id：退款推送只带它，靠它找回账号和权益。
-- status: created / paid / delivered / refunded
CREATE TABLE IF NOT EXISTS wechat_orders (
  out_trade_no TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  openid TEXT NOT NULL,
  product_id TEXT NOT NULL,
  price_cents INTEGER NOT NULL,
  status TEXT NOT NULL,
  wx_order_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wechat_orders_user ON wechat_orders (user_id, created_at);

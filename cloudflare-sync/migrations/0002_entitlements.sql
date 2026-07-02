CREATE TABLE IF NOT EXISTS entitlements (
  user_id TEXT PRIMARY KEY,
  is_pro INTEGER NOT NULL DEFAULT 0,
  product_id TEXT,
  source TEXT NOT NULL DEFAULT 'free',
  original_transaction_id TEXT,
  transaction_id TEXT,
  environment TEXT,
  expires_at TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS purchase_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  transaction_id TEXT NOT NULL,
  original_transaction_id TEXT,
  environment TEXT,
  status TEXT NOT NULL,
  raw_payload TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_purchase_events_user_created ON purchase_events(user_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_purchase_events_transaction ON purchase_events(transaction_id);

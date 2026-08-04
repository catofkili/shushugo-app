-- 同步版本必须由服务端原子分配,不能继续依赖客户端时间戳。
ALTER TABLE sync_objects ADD COLUMN generation INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sync_objects ADD COLUMN payload_hash TEXT;

CREATE TABLE IF NOT EXISTS sync_heads (
  user_id TEXT PRIMARY KEY,
  generation INTEGER NOT NULL DEFAULT 0,
  object_key TEXT,
  last_modified TEXT,
  payload_hash TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS sync_uploads (
  operation_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  generation INTEGER NOT NULL,
  object_key TEXT NOT NULL,
  last_modified TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sync_uploads_user_created
  ON sync_uploads(user_id, created_at DESC);

-- 现有整库备份迁移为 generation=0 的当前版本,不删除历史备份。
INSERT OR IGNORE INTO sync_heads (user_id, generation, object_key, last_modified, payload_hash, updated_at)
SELECT latest.user_id, 0, latest.object_key, latest.last_modified, latest.payload_hash, latest.created_at
FROM sync_objects latest
WHERE latest.created_at = (
  SELECT MAX(previous.created_at)
  FROM sync_objects previous
  WHERE previous.user_id = latest.user_id
);

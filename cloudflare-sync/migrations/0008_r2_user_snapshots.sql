-- 旧版本把 Base64 整库存在 KV；新版本把压缩后的“仅用户数据”二进制快照放 R2。
-- 默认值让所有存量对象继续按旧格式读取，完成一次新上传后自然迁移。
ALTER TABLE sync_objects ADD COLUMN storage_backend TEXT NOT NULL DEFAULT 'kv';
ALTER TABLE sync_objects ADD COLUMN snapshot_format TEXT NOT NULL DEFAULT 'legacy-full-sqlite';
ALTER TABLE sync_objects ADD COLUMN compression TEXT NOT NULL DEFAULT 'none';

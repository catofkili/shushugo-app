CREATE TABLE IF NOT EXISTS feedback_reports (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('feedback', 'error', 'hang', 'crash')),
  message TEXT NOT NULL,
  contact TEXT NOT NULL DEFAULT '',
  user_id TEXT,
  platform TEXT NOT NULL,
  app_version TEXT NOT NULL,
  route TEXT NOT NULL,
  diagnostics_json TEXT,
  client_hash TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_feedback_reports_created_at ON feedback_reports(created_at);

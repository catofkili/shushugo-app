#!/usr/bin/env bash
# 只读体检；每次发版前和每周运行：bash scripts/sync-health.sh
set -euo pipefail

sql=$(cat <<'SQL'
BEGIN;
SELECT COUNT(*) AS total_accounts,
       (SELECT COUNT(*) FROM users WHERE email LIKE 'wechat-%') AS wechat_accounts,
       (SELECT COUNT(DISTINCT user_id) FROM sync_objects) AS accounts_with_snapshots
FROM users;

WITH latest_snapshots AS (
  SELECT user_id, MAX(julianday(created_at)) AS latest_snapshot_jd
  FROM sync_objects
  GROUP BY user_id
)
SELECT u.id, u.display_name, u.last_login,
       strftime('%Y-%m-%dT%H:%M:%fZ', s.latest_snapshot_jd) AS latest_snapshot_at
FROM users u
LEFT JOIN latest_snapshots s ON s.user_id = u.id
WHERE julianday(u.last_login) >= julianday('now', '-14 days')
  AND (s.latest_snapshot_jd IS NULL
       OR s.latest_snapshot_jd < julianday(u.last_login, '-3 days'))
ORDER BY julianday(u.last_login) DESC, u.id;
COMMIT;
SQL
)

ssh -i "$HOME/.ssh/shushugo_server" admin@8.148.68.155 \
  "sudo sqlite3 -readonly -header -column /var/lib/shushugo/worker.sqlite \"$sql\""

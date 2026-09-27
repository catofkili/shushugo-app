#!/usr/bin/env bash
set -euo pipefail
umask 077

archive=${1:?usage: sudo install-migration.sh /tmp/shushugo-cloudflare-*.tar.gz}
[[ ${EUID:-$(id -u)} -eq 0 ]] || { echo "Run with sudo." >&2; exit 1; }
[[ -f $archive ]] || { echo "Migration archive not found." >&2; exit 1; }

data=/var/lib/shushugo
service=shushugo-worker.service
scheduled=shushugo-worker-scheduled.service
scheduled_timer=shushugo-worker-scheduled.timer
backup=shushugo-worker-backup.service
backup_timer=shushugo-worker-backup.timer
install -d -o shushugo -g shushugo -m 0700 "$data" "$data/backups"
stage=$(mktemp -d "$data/.import.XXXXXX")
stamp=$(date -u +%Y%m%dT%H%M%SZ)
rollback=$(mktemp -d "$data/rollback-$stamp.XXXXXX")
maintenance=0
imported_db=0
imported_r2=0
success=0

finish() {
  local status=$?
  trap - EXIT
  if (( maintenance && ! success )); then
    systemctl stop "$service" "$scheduled" "$backup" 2>/dev/null || true
    if [[ -f $rollback/worker.sqlite ]]; then
      rm -f "$data/worker.sqlite" "$data/worker.sqlite-wal" "$data/worker.sqlite-shm"
      mv "$rollback/worker.sqlite" "$data/worker.sqlite"
      [[ ! -f $rollback/worker.sqlite-wal ]] || mv "$rollback/worker.sqlite-wal" "$data/worker.sqlite-wal"
      [[ ! -f $rollback/worker.sqlite-shm ]] || mv "$rollback/worker.sqlite-shm" "$data/worker.sqlite-shm"
    elif (( imported_db )); then
      rm -f "$data/worker.sqlite" "$data/worker.sqlite-wal" "$data/worker.sqlite-shm"
    fi
    if [[ -d $rollback/r2 ]]; then
      rm -rf "$data/r2"
      mv "$rollback/r2" "$data/r2"
    elif (( imported_r2 )); then
      rm -rf "$data/r2"
    fi
    chown -R shushugo:shushugo "$data/worker.sqlite" "$data/r2" 2>/dev/null || true
    systemctl start "$service" || true
  fi
  if (( maintenance )); then
    systemctl start "$scheduled_timer" "$backup_timer" || true
  fi
  rm -rf "$stage"
  exit "$status"
}
trap finish EXIT

python3 - "$archive" <<'PY'
import sys
import tarfile

seen = set()
with tarfile.open(sys.argv[1], "r:gz") as archive:
    for member in archive:
        name = member.name
        normalized = name.removeprefix("./")
        trimmed = normalized.rstrip("/")
        parts = trimmed.split("/")
        safe = (
            not normalized.startswith("/")
            and not any(part in ("", ".", "..") for part in parts)
            and not any(ord(char) < 32 or ord(char) == 127 for char in normalized)
            and (trimmed in ("worker.sqlite", "manifest.json", "r2") or trimmed.startswith("r2/"))
        )
        if not safe or not (member.isfile() or member.isdir()) or normalized in seen:
            raise SystemExit(f"Unsafe or duplicate migration archive entry: {name!r}")
        seen.add(normalized)
PY

tar -xzf "$archive" -C "$stage" --no-same-owner --no-same-permissions
[[ -s $stage/worker.sqlite && -f $stage/manifest.json && -d $stage/r2 ]] || { echo "Archive is missing worker.sqlite, manifest.json, or r2/." >&2; exit 1; }
node /opt/shushugo/cloudflare-sync/selfhost/verify-migration.mjs "$stage"

maintenance=1
systemctl stop "$scheduled_timer" "$backup_timer" "$scheduled" "$backup" "$service"
if [[ -f $data/worker.sqlite ]]; then
  sqlite3 "$data/worker.sqlite" ".backup '$data/backups/pre-import-$stamp.sqlite'"
  chown shushugo:shushugo "$data/backups/pre-import-$stamp.sqlite"
  chmod 0600 "$data/backups/pre-import-$stamp.sqlite"
  mv "$data/worker.sqlite" "$rollback/worker.sqlite"
  [[ ! -f $data/worker.sqlite-wal ]] || mv "$data/worker.sqlite-wal" "$rollback/worker.sqlite-wal"
  [[ ! -f $data/worker.sqlite-shm ]] || mv "$data/worker.sqlite-shm" "$rollback/worker.sqlite-shm"
fi
if [[ -d $data/r2 ]]; then mv "$data/r2" "$rollback/r2"; fi
mv "$stage/worker.sqlite" "$data/worker.sqlite"
imported_db=1
mv "$stage/r2" "$data/r2"
imported_r2=1
chown -R shushugo:shushugo "$data/worker.sqlite" "$data/r2"
chmod 0600 "$data/worker.sqlite"
chmod -R go-rwx "$data/r2"
systemctl start "$service"

healthy=0
for _ in {1..30}; do
  if curl -fsS http://127.0.0.1:8787/api/health -o "$stage/health.json" && grep -q '"migrationsApplied":true' "$stage/health.json"; then
    healthy=1
    break
  fi
  sleep 1
done
(( healthy )) || { echo "Self-hosted health check failed; restoring the previous local data." >&2; exit 1; }

systemctl start "$scheduled_timer" "$backup_timer"
success=1
echo "Imported data is live; previous files and pre-import backup are retained under $rollback and $data/backups/."
rm -f "$archive"

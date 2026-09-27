#!/usr/bin/env bash
set -euo pipefail

db=/var/lib/shushugo/worker.sqlite
dir=/var/lib/shushugo/backups
mkdir -p "$dir"
chmod 0700 "$dir"
file="$dir/worker-$(date -u +%F).sqlite"
sqlite3 "$db" ".backup '$file'"
chmod 0600 "$file"
find "$dir" -maxdepth 1 -type f -name 'worker-*.sqlite' -mtime +13 -delete
echo "SQLite backup written: $file"

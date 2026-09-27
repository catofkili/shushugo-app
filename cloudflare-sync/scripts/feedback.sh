#!/usr/bin/env bash
# List private feedback for the developer (no login required by users).
# Usage: bash cloudflare-sync/scripts/feedback.sh [limit]
# The limit defaults to 20 and is capped at 100. This runs a read-only remote D1 query.
set -euo pipefail

limit="${1:-20}"
if [[ ! "$limit" =~ ^[0-9]+$ ]] || (( limit < 1 || limit > 100 )); then
  echo "Usage: $0 [limit 1-100]" >&2
  exit 2
fi

cd "$(dirname "$0")/.."
sql="SELECT created_at, kind, message, contact, user_id, platform, app_version, route, diagnostics_json FROM feedback_reports ORDER BY created_at DESC LIMIT ${limit};"
npx wrangler d1 execute master_nihongo_sync --remote --json --command "$sql"

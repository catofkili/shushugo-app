#!/usr/bin/env bash
set -euo pipefail

find_project_root() {
  local dir="$PWD"
  while [[ "$dir" != "/" ]]; do
    if [[ -f "$dir/frontend/package.json" && -f "$dir/cloudflare-sync/wrangler.jsonc" && -d "$dir/frontend/src" ]]; then
      printf '%s\n' "$dir"
      return 0
    fi
    dir="$(dirname "$dir")"
  done

  dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  while [[ "$dir" != "/" ]]; do
    if [[ -f "$dir/frontend/package.json" && -f "$dir/cloudflare-sync/wrangler.jsonc" && -d "$dir/frontend/src" ]]; then
      printf '%s\n' "$dir"
      return 0
    fi
    dir="$(dirname "$dir")"
  done

  return 1
}

ROOT_DIR="${PROJECT_DIR:-$(find_project_root)}"
DATE_TAG="$(date +%Y-%m-%d)"
OUTPUT="${1:-"$HOME/Documents/master-nihongo-ios-preview-$DATE_TAG.zip"}"
TMP_ZIP="$OUTPUT.tmp"

if [[ -z "$ROOT_DIR" || ! -d "$ROOT_DIR" ]]; then
  echo "Could not locate project root. Set PROJECT_DIR=/path/to/master-nihongo-ios." >&2
  exit 1
fi

cd "$ROOT_DIR"

# git archive 只会打包 HEAD；若工作区有修改，继续执行会悄悄产出旧代码/旧词库，
# 容易把已经修复的隐私问题重新带进分享包。
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "Refusing to create a stale preview: commit or stash your changes first." >&2
  exit 1
fi

rm -f "$TMP_ZIP" "$OUTPUT"

git archive \
  --format=zip \
  --output="$TMP_ZIP" \
  HEAD \
  -- \
  .gitignore \
  README.md \
  cloudflare-sync/README.md \
  cloudflare-sync/migrations \
  cloudflare-sync/package-lock.json \
  cloudflare-sync/package.json \
  cloudflare-sync/src \
  cloudflare-sync/wrangler.jsonc \
  docs/APP_STORE_READINESS.md \
  docs/DATABASES.md \
  docs/DEPLOYMENT_GUIDE.md \
  docs/DISTRIBUTION.md \
  docs/PACKAGING.md \
  docs/PROJECT_SUMMARY.md \
  docs/QUICK_START.md \
  docs/TESTING_GUIDE.md \
  docs/TROUBLESHOOTING.md \
  docs/XCODE_GUIDE.md \
  frontend/.env.example \
  frontend/capacitor.config.ts \
  frontend/index.html \
  frontend/ios \
  frontend/package-lock.json \
  frontend/package.json \
  frontend/postcss.config.js \
  frontend/public/nihongo.db \
  frontend/src \
  frontend/tailwind.config.js \
  frontend/tsconfig.json \
  frontend/vite.config.ts \
  scripts/build-ios.sh \
  scripts/install-webview-plugins.sh \
  scripts/package-preview.sh \
  scripts/quick-reload.sh \
  scripts/quick-start.sh \
  scripts/setup-xcode.sh

mv "$TMP_ZIP" "$OUTPUT"
echo "Created $OUTPUT"

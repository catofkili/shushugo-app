#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DATE_TAG="$(date +%Y-%m-%d)"
OUTPUT="${1:-"$HOME/Documents/master-nihongo-ios-preview-$DATE_TAG.zip"}"

cd "$ROOT_DIR"

git archive \
  --format=zip \
  --output="$OUTPUT" \
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
  frontend/scripts/import_jlpt_words.py \
  frontend/src \
  frontend/tailwind.config.js \
  frontend/tsconfig.json \
  frontend/vite.config.ts \
  scripts/build-ios.sh \
  scripts/install-webview-plugins.sh \
  scripts/package-preview.sh \
  scripts/quick-reload.sh \
  scripts/quick-start.sh \
  scripts/setup-xcode.sh \
  scripts/sync-content.mjs

echo "Created $OUTPUT"

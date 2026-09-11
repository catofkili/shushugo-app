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
OUTPUT="${1:-"$HOME/Documents/shushugo-preview-$DATE_TAG.zip"}"
TMP_ZIP="$OUTPUT.tmp"

if [[ -z "$ROOT_DIR" || ! -d "$ROOT_DIR" ]]; then
  echo "Could not locate project root. Set PROJECT_DIR=/path/to/shushugo." >&2
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

# ⚠️ 清单里少一个目录 = 收到包的人按 README 跑 npm run build 就失败。
# 已经踩过的:
#   frontend/scripts —— prebuild 要跑里面的 verify-release-db.mjs 和
#     verify-kanji-reading-unit-index.mjs;user-data-tables 的测试也直接读它。
#   frontend/eslint.config.js —— 没有它 npm run lint 起不来。
#   cloudflare-sync/scripts —— Worker 的 npm test 跑的是这里的规则测试。
# 打完包之后下面会解压到临时目录真跑一遍 check/lint/test/build,别把那一步删了。
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
  cloudflare-sync/scripts \
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
  frontend/eslint.config.js \
  frontend/postcss.config.js \
  frontend/public/nihongo.db \
  frontend/scripts \
  frontend/src \
  frontend/tailwind.config.js \
  frontend/tsconfig.json \
  frontend/vite.config.ts \
  scripts/build-ios.sh \
  scripts/package-preview.sh \
  scripts/setup-xcode.sh

# 解压到临时目录真跑一遍质量门禁。清单漏文件是**静默**的 —— zip 照样产出,
# 只有接收者会撞上。除非显式 SKIP_PREVIEW_VERIFY=1(离线时)。
if [[ "${SKIP_PREVIEW_VERIFY:-0}" != "1" ]]; then
  VERIFY_DIR="$(mktemp -d)"
  trap 'rm -rf "$VERIFY_DIR"' EXIT
  unzip -q "$TMP_ZIP" -d "$VERIFY_DIR"
  (
    cd "$VERIFY_DIR/frontend"
    npm ci
    npm run check
    npm run lint
    npm test
    npm run build
  )
  (
    cd "$VERIFY_DIR/cloudflare-sync"
    npm ci
    npm run check
    npm test
  )
  echo "Verified the packaged sources build from a clean checkout."
fi

mv "$TMP_ZIP" "$OUTPUT"
echo "Created $OUTPUT"

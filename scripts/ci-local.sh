#!/bin/sh
# 在本机跑一遍和 GitHub CI（.github/workflows/ci.yml）一样的闸门。推 main 之前先跑它：
# 推送会同时触发 CI 和 Pages 部署，红了再修就是多等一轮线上。
#
# 2026-10-03 一次推送踩出来的三个红灯，都是这里能提前抓到的：
#   - local-schema.sql 改了没重新生成小程序共享包（check-shared）
#   - 出厂词库改了没重新生成汉字读音单元索引（prebuild 校验）
#   - 推送范围里的旧提交没有小程序配对（check-parity 对整段范围逐个提交检查）
# 想完全模拟 CI（没有 .local/、没有 node_modules 以外的本地文件），在干净克隆里跑：
#   git clone --no-hardlinks . ../_ci-check && ln -s $PWD/frontend/node_modules ../_ci-check/frontend/node_modules && ../_ci-check/scripts/ci-local.sh
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
BASE=$(git -C "$ROOT" rev-parse origin/main 2>/dev/null || true)

echo "== frontend（typecheck + lint + test + build）"
cd "$ROOT/frontend"
npm run check
npm run lint
npm test
npm run build
rm -rf dist

echo "== wechat-miniprogram（全部检查，含 check-shared / check-parity）"
cd "$ROOT/wechat-miniprogram"
TZ=Asia/Shanghai PARITY_BASE_SHA="$BASE" PARITY_HEAD_SHA=$(git -C "$ROOT" rev-parse HEAD) npm test

echo "== cloudflare-sync（typecheck + test）"
cd "$ROOT/cloudflare-sync"
npm run check
npm test

echo "全部通过。"

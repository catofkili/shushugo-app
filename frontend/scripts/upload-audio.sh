#!/usr/bin/env bash
# 把 public/audio/ 整个推到 R2。用 rclone 而不是 wrangler:两万多个小文件,wrangler 一次一个要跑一小时。
#
# 一次性准备:
#   brew install rclone
#   npx wrangler r2 bucket create shushugo-audio
#   rclone config create r2 s3 provider=Cloudflare access_key_id=… secret_access_key=… \
#       endpoint=https://<account-id>.r2.cloudflarestorage.com acl=private
#   Cloudflare 后台:R2 → shushugo-audio → 设置 → 自定义域名(如 audio.shushugo.app)
#     → CORS 策略:[{"AllowedOrigins":["*"],"AllowedMethods":["GET"],"AllowedHeaders":["*"],"MaxAgeSeconds":86400}]
#     (index.json 是跨域 fetch,没 CORS 就整个退回系统语音,而且没有任何报错)
#   然后:GitHub 仓库变量 AUDIO_BASE_URL=https://audio.shushugo.app/,iOS 构建前 export VITE_AUDIO_BASE_URL=同上
#
# 之后每次生成完:bash scripts/upload-audio.sh
set -euo pipefail
cd "$(dirname "$0")/../public/audio"
# 文件名是内容哈希,永不改内容,缓存一年;index.json 会变,给短缓存。
rclone copy --checksum --transfers 32 --exclude 'index.json' --exclude 'manifest.json' --exclude '_*' \
  --header-upload 'Cache-Control: public, max-age=31536000, immutable' . r2:shushugo-audio
rclone copy --checksum --include '**/index.json' --header-upload 'Cache-Control: public, max-age=300' . r2:shushugo-audio
echo "已同步到 r2:shushugo-audio。核对:curl -sI \$VITE_AUDIO_BASE_URL/examples/index.json"

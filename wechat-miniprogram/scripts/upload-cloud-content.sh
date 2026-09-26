#!/usr/bin/env bash
# 把出厂词库（原库 + gzip 压缩版）+ 内容 manifest（默认）、单词读音（--audio）或例句音频（--examples）推到云开发的云存储。
# 每次 bake-seed-db 之后跑一次；音频只在重新合成后跑。
# 需要先 `tcb login`（设备码登录，微信扫码）。tcb 装在哪都行：TCB=/path/to/tcb ./scripts/upload-cloud-content.sh
#
# ⚠️ 本机的 HTTP 代理（127.0.0.1:1082）会让 COS 上传 503（tunneling socket could not be established），
# 这里一律把代理环境变量摘掉再调 tcb。2026-09-20 实测：带代理 11,053 个文件一个都传不上去。
set -euo pipefail
cd "$(dirname "$0")/.."
unset HTTP_PROXY HTTPS_PROXY http_proxy https_proxy ALL_PROXY all_proxy
TCB=${TCB:-tcb}
ENV_ID=$(node -p "require('./cloudbaserc.json').envId")
FILE_ID_BASE=$(node -p "require('./src/config.js').seedDatabaseUrl.replace(/\/seed\/nihongo\.db$/, '')")
[ -n "$FILE_ID_BASE" ] || { echo "config.js 的 seedDatabaseUrl 还没填 fileID 前缀"; exit 1; }

if [ "${1:-}" = "--examples" ]; then
  # 例句音频（约 143 MB / 一万一千多个文件）。小程序按 audioBaseUrl 把 /words 换成 /examples 来找（speech.weapp.ts）。
  # 2026-09-26 之前从没传过：真机报「这条云端音频暂不可用」、audio/examples/index.json 返回 STORAGE_FILE_NONEXIST。
  AUDIO=../frontend/public/audio/examples
  VOICE=${VOICE:-voicevox-8}
  INDEX=$(mktemp)
  node -e "const d=require('$PWD/$AUDIO/index.json');if(Array.isArray(d.voices)){d.voices=d.voices.filter(v=>v.id==='$VOICE')}d.default='$VOICE';process.stdout.write(JSON.stringify(d))" > "$INDEX"
  $TCB storage upload "$INDEX" audio/examples/index.json -e "$ENV_ID" < /dev/null
  $TCB storage upload "$AUDIO/$VOICE" "audio/examples/$VOICE" -e "$ENV_ID" --times 3 < /dev/null
  rm -f "$INDEX"
  exit 0
fi

if [ "${1:-}" = "--audio" ]; then
  # 只传默认声音（voicevox-8 春日部つむぎ，约 45 MB / 10,919 个文件）；index.json 也只列这一个，
  # 免得设置页给人选一个云端没有的声音。
  AUDIO=../frontend/public/audio/words
  VOICE=${VOICE:-voicevox-8}
  INDEX=$(mktemp)
  node -e "const d=require('$PWD/$AUDIO/index.json');d.voices=d.voices.filter(v=>v.id==='$VOICE');d.default='$VOICE';process.stdout.write(JSON.stringify(d))" > "$INDEX"
  $TCB storage upload "$INDEX" audio/words/index.json -e "$ENV_ID" < /dev/null
  $TCB storage upload "$AUDIO/$VOICE" "audio/words/$VOICE" -e "$ENV_ID" --times 3 < /dev/null
  rm -f "$INDEX"
  exit 0
fi

DB=../frontend/public/nihongo.db
BYTES=$(stat -f %z "$DB")
WORDS=$(sqlite3 "$DB" 'select count(*) from words')
VERSION=$(sqlite3 "$DB" "select value from app_state where key='jlpt_word_metadata_version'")
MANIFEST=$(mktemp)
cat > "$MANIFEST" <<JSON
{"version":"$VERSION","databaseUrl":"$FILE_ID_BASE/seed/nihongo.db","expectedBytes":$BYTES,"expectedWords":$WORDS}
JSON
echo "manifest: $(cat "$MANIFEST")"
$TCB storage upload "$DB" seed/nihongo.db --times 3 -e "$ENV_ID" < /dev/null
# 压缩版：Taro 版首装先下 seed/nihongo.db.gz（database-runtime.weapp.ts，fflate gunzip），拿不到才回退上面的原库。
# 2026-09-26 之前从没传过——真机日志「压缩出厂库不可用，回退原库 -403003 empty download url」，首装多下好几倍的字节。
GZ=$(mktemp).gz
gzip -9 -c "$DB" > "$GZ"
echo "gzip: $(stat -f %z "$GZ") bytes (原库 $BYTES)"
$TCB storage upload "$GZ" seed/nihongo.db.gz --times 3 -e "$ENV_ID" < /dev/null
rm -f "$GZ"
$TCB storage upload "$MANIFEST" seed/manifest.json --times 3 -e "$ENV_ID" < /dev/null
rm -f "$MANIFEST"

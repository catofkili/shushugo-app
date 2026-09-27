#!/usr/bin/env bash
# 把出厂词库（原库 + Brotli 压缩版）+ 内容 manifest（默认）、单词读音（--audio）或例句音频（--examples）推到云开发的云存储。
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
  # VOICES = index.json 里列出的声音（云端必须真有，否则设置页 / 柚子商店会给人一个云端没有的声音），第一个是默认；
  # UPLOAD = 这次要传的目录（默认同 VOICES，已传过的可以省掉，一个声音约 45 MB / 11,053 个文件、十来分钟）。
  # 2026-09-27：柚子商店卖 voicevox-10 / 11，而云端一直只有 voicevox-8，小程序里试听没声、买了也用不上。补传：
  #   VOICES="voicevox-8 voicevox-10 voicevox-11" UPLOAD="voicevox-10 voicevox-11" ./scripts/upload-cloud-content.sh --audio
  AUDIO=../frontend/public/audio/words
  VOICES=${VOICES:-${VOICE:-voicevox-8}}
  UPLOAD=${UPLOAD:-$VOICES}
  DEFAULT_VOICE=${VOICES%% *}
  INDEX=$(mktemp)
  node -e "const d=require('$PWD/$AUDIO/index.json');const want='$VOICES'.split(' ');d.voices=d.voices.filter(v=>want.includes(v.id));if(d.voices.length!==want.length)throw new Error('index.json 里缺声音：'+want);d.default='$DEFAULT_VOICE';process.stdout.write(JSON.stringify(d))" > "$INDEX"
  for voice in $UPLOAD; do
    $TCB storage upload "$AUDIO/$voice" "audio/words/$voice" -e "$ENV_ID" --times 3 < /dev/null
  done
  # index 放在目录之后传：先列出声音、文件还没到齐的那几分钟里，选了新声音的人会一直 404。
  $TCB storage upload "$INDEX" audio/words/index.json -e "$ENV_ID" < /dev/null
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
# 压缩版：Taro 版首装先下 seed/nihongo.db.br（database-runtime.weapp.ts，微信原生 readCompressedFile 解压），拿不到才回退上面的原库。
# ⚠️ 必须是 Brotli：官方文档 compressionAlgorithm「目前仅支持 br」。2026-09-26 传的是 .db.gz，真机上解压必定失败——
# 每个新用户先白下 2.2 MB 的 gz，再回退下 11.5 MB 原库（用户实测首次打开干等一分钟）。Brotli 版约 1.34 MB。
BR=$(mktemp).br
node -e "const z=require('zlib'),fs=require('fs');const b=fs.readFileSync(process.argv[1]);fs.writeFileSync(process.argv[2],z.brotliCompressSync(b,{params:{[z.constants.BROTLI_PARAM_QUALITY]:11,[z.constants.BROTLI_PARAM_LGWIN]:24,[z.constants.BROTLI_PARAM_SIZE_HINT]:b.length}}))" "$DB" "$BR"
echo "brotli: $(stat -f %z "$BR") bytes (原库 $BYTES)"
$TCB storage upload "$BR" seed/nihongo.db.br --times 3 -e "$ENV_ID" < /dev/null
rm -f "$BR"
$TCB storage upload "$MANIFEST" seed/manifest.json --times 3 -e "$ENV_ID" < /dev/null
rm -f "$MANIFEST"

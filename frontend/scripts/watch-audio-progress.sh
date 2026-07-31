#!/bin/bash
# 监视 build-word-audio.mjs 的进度。每跨过 N 个词报一行,带速度和预计剩余时间;
# 卡住超过 2 分钟会明确告诉你「没在动」—— 省得盯着屏幕猜它死了没有。
#
#   bash scripts/watch-audio-progress.sh          # 每 200 个报一次
#   bash scripts/watch-audio-progress.sh 50       # 每 50 个报一次
#
# Ctrl-C 退出(只是看进度,不影响生成)。
#
# 注:每个声音的状态存在临时文件里,不用关联数组 —— macOS 自带的 bash 是 3.2,没有。

STEP=${1:-200}
BASE="$(cd "$(dirname "$0")/.." && pwd)"
ROOT="$BASE/public/audio/words"
TOTAL=$(cd "$BASE" && sqlite3 public/nihongo.db \
  "SELECT COUNT(*) FROM (SELECT DISTINCT kanji, kana FROM words)" 2>/dev/null || echo 11055)
STATE=$(mktemp -d)
trap 'rm -rf "$STATE"' EXIT

count_for() { ls "$ROOT/$1"/*.aac 2>/dev/null | wc -l | tr -d ' '; }

printf '监视 %s\n每 %s 个词报一次,总目标 %s 个/声音。Ctrl-C 退出。\n\n' "$ROOT" "$STEP" "$TOTAL"

last_total=-1
last_change=$(date +%s)

while true; do
  now=$(date +%s)
  total_now=0

  for dir in "$ROOT"/*/; do
    [ -d "$dir" ] || continue
    voice=$(basename "$dir")
    n=$(count_for "$voice")
    total_now=$((total_now + n))
    file="$STATE/$voice"

    # 第一次见到这个声音:记下起点(断点续跑时已有的文件不算进速度)
    if [ ! -f "$file" ]; then
      echo "$n $now $(( n / STEP * STEP ))" > "$file"
      printf '[%s] %-14s 起点 %s 个\n' "$(date +%H:%M:%S)" "$voice" "$n"
      continue
    fi

    read -r start_n start_t milestone < "$file"
    # 速度基准要从「真正开始产出」算起。排队等前一个声音时这里一直不动,
    # 若把那段空等算进平均速度,剩余时间会离谱到几千分钟。
    if [ "$n" -eq "$start_n" ]; then
      echo "$n $now $milestone" > "$file"
      start_t=$now
    fi
    if [ "$n" -ge $((milestone + STEP)) ]; then
      milestone=$(( n / STEP * STEP ))
      echo "$start_n $start_t $milestone" > "$file"
      did=$(( n - start_n ))
      secs=$(( now - start_t ))
      if [ "$did" -gt 0 ] && [ "$secs" -gt 0 ]; then
        rate=$(echo "scale=1; $did * 60 / $secs" | bc)
        eta=$(echo "scale=0; ($TOTAL - $n) * $secs / $did / 60" | bc)
        printf '[%s] %-14s %5s/%s (%s%%)  %s 个/分  剩约 %s 分钟\n' \
          "$(date +%H:%M:%S)" "$voice" "$n" "$TOTAL" $(( n * 100 / TOTAL )) "$rate" "$eta"
      else
        printf '[%s] %-14s %5s/%s\n' "$(date +%H:%M:%S)" "$voice" "$n" "$TOTAL"
      fi
    fi
  done

  # 停滞检测:这才是「到底还在不在干活」的答案
  if [ "$total_now" -ne "$last_total" ]; then
    last_total=$total_now
    last_change=$now
  elif [ $(( now - last_change )) -ge 120 ]; then
    if pgrep -f build-word-audio >/dev/null; then
      # 快到总数时不动 ≠ 卡住:生成完还要扫目录、写 index.json 和上万条的
      # manifest.json,这段不产生 .aac,计数自然不变。
      if [ "$total_now" -ge $(( TOTAL - 20 )) ]; then
        printf '[%s] …收尾中(在写索引和对照表,不产生新音频文件)\n' "$(date +%H:%M:%S)"
      else
        printf '[%s] ⚠️  %s 分钟没有新文件,但生成进程还在 —— 可能卡在某个词上\n' \
          "$(date +%H:%M:%S)" $(( (now - last_change) / 60 ))
      fi
    else
      printf '[%s] ⏹  生成进程已结束,共 %s 个文件。收工。\n' "$(date +%H:%M:%S)" "$total_now"
      exit 0
    fi
    last_change=$now
  fi

  sleep 10
done

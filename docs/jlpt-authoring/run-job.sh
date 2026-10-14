#!/bin/sh
# 一份题的流水线：Codex 手写 → 另开一个 Codex 会话盲做审校。只做调度，不出题。
# 用法：run-job.sh N3 vocab "1 漢字読み 8|2 表記 6|…"
# REVIEW_ONLY=1：已有 questions.json 时跳过出题，只跑审校（Codex 额度中断后补跑用）
set -u
ROOT=$HOME/Documents/shushugo-wt/_codex/jlpt-trial
LV=$1; SEC=$2; TABLE=$3
# OUT=$ROOT/set2 这样写到第 2 套的目录（导入时 --src 指过去）；默认是第 1 套
OUT=${OUT:-$ROOT}
DIR=$OUT/$LV-$SEC; mkdir -p "$DIR"; cd "$DIR" || exit 1
# 前几套这一级这一科用过的考点，这一套不许再用
USED=$(node -e '
const fs=require("fs"),path=require("path");const [root,me,name]=process.argv.slice(1);
const dirs=[path.join(root,name),...fs.readdirSync(root).filter(d=>/^set\d+$/.test(d)).map(d=>path.join(root,d,name))];
const out=new Set();for(const d of dirs){if(path.resolve(d)===path.resolve(me))continue;const f=path.join(d,"questions.json");
if(!fs.existsSync(f))continue;for(const q of JSON.parse(fs.readFileSync(f,"utf8")))if(q.target&&q.target.surface)out.add(q.target.surface);}
process.stdout.write([...out].join("、"));' "$ROOT" "$DIR" "$LV-$SEC")
# 已入库题库的考点（卷 1–3 返修时换过考点，只看旧 questions.json 会漏）
BANK="${JLPT_REPO:-$HOME/Documents/shushugo}/frontend/src/data/jlpt/$(echo "$LV" | tr A-Z a-z).json"
if [ -f "$BANK" ]; then
  BT=$(node -e 'const b=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write([...new Set(b.questions.map(q=>q.target&&q.target.surface).filter(Boolean))].join("、"))' "$BANK")
  USED="${USED}${USED:+、}${BT}"
fi
codex=/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex
if [ "$SEC" = vocab ]; then NAME="言語知識（文字・語彙）"; else NAME="言語知識（文法）"; fi
ROWS=$(echo "$TABLE" | tr '|' '\n' | awk '{printf "| %s | %s | %s |\n",$1,$2,$3}')

header() { cat <<EOF
# 本次任务（$1）

- 等级：${LV}　科目：${NAME}
- 工作目录：${DIR}（只在这里写文件）
- 题型和题数：

| mondai | 题型 | 题数 |
|---|---|---|
$ROWS

$( [ -n "$USED" ] && printf "%s\n\n%s\n" "- ⚠️ 下面这些考点在前几套已经用过，这一套**不许再用**（换别的同级词 / 语法；干扰项可以用）：" "  $USED" )

EOF
}
# 模型：10-10 作者看了 luna 出的卷 4 说「狗屁不通」，默认换成 B 档 sol；JLPT_MODEL 可覆盖。
# JLPT_CODEX_HOMES="$HOME/.codex-b $HOME/.codex"：前一个号撞额度就换下一个号重跑（10-09 加了第二个号）
run() {
  for home in ${JLPT_CODEX_HOMES:-$HOME/.codex}; do
    CODEX_HOME=$home "$codex" exec --skip-git-repo-check -C "$DIR" -s workspace-write -m "${JLPT_MODEL:-gpt-6.1-sol}" \
      -c model_reasoning_effort="${JLPT_EFFORT:-high}" -o "$1.last.md" - < "$1.prompt.md" > "$1.log" 2>&1
    status=$?
    grep -q "your usage limit" "$1.log" || {
      # 模型临时满载（10-13 卷 4 N2 文法就这样失败）：等一会重试，最多 6 次
      n=0; while grep -q "at capacity" "$1.log" && [ $n -lt 6 ]; do
        n=$((n+1)); sleep 120
        CODEX_HOME=$home "$codex" exec --skip-git-repo-check -C "$DIR" -s workspace-write -m "${JLPT_MODEL:-gpt-6.1-sol}" \
          -c model_reasoning_effort="${JLPT_EFFORT:-high}" -o "$1.last.md" - < "$1.prompt.md" > "$1.log" 2>&1; status=$?
      done
      grep -q "your usage limit" "$1.log" || return $status; }
  done
  return 1
}

rm -f DONE FAILED
if [ "${REVIEW_ONLY:-}" != 1 ] || [ ! -s questions.json ]; then
{ header 出题
  echo '交付：本目录下的 `questions.json`，以及 `self-check.md`（写完后自己从头做一遍：犹豫过的题号和原因、因此改过的题、正解位置分布、考点覆盖）。完成后最后一条消息只写一句：交付了什么、有几道题标了 doubt。'
  echo; cat "$ROOT/rules.md"; } > write.prompt.md
[ "${PROMPT_ONLY:-}" = 1 ] && exit 0   # 只生成 write.prompt.md（交给 Claude 子代理手写时用）
run write || { echo "出题阶段退出码非 0" > FAILED; exit 1; }
grep -q "usage limit" write.log && { echo "出题阶段撞额度" > FAILED; exit 1; }
fi
[ -s questions.json ] || { echo "出题阶段没有产出 questions.json" > FAILED; exit 1; }
# 补跑审校时以出题稿为准：上一次审校中途停下可能已经改了一半
[ "${REVIEW_ONLY:-}" = 1 ] && [ -s questions.draft.json ] && cp questions.draft.json questions.json
# 出题稿的正解位置常是 1234 循环，盲做会被规律带着走：审校前先洗一遍（和导入用同一个函数）。
# JLPT_REPO 指向带 frontend/scripts/build-jlpt-bank.mjs 的仓库目录（还没合进 main 时指向 worktree）
node --input-type=module -e '
const [, file, seed, script] = process.argv; const fs = await import("node:fs");
const { shuffleAnswers } = await import(script);
fs.writeFileSync(file, JSON.stringify(shuffleAnswers(JSON.parse(fs.readFileSync(file, "utf8")), seed), null, 2) + "\n");
' questions.json "review-$LV-$SEC" "${JLPT_REPO:-$HOME/Documents/shushugo}/frontend/scripts/build-jlpt-bank.mjs" \
  || { echo "审校前打乱正解位置失败" > FAILED; exit 1; }

{ header 审校; cat "$ROOT/review.md"; echo; cat "$ROOT/rules.md"; } > review.prompt.md
# 旧 review.md 留着的话，审校这次撞额度失败也会被当成审完（卷 3 第一次就是这样被误标完成的）
rm -f review.md
if run review && [ -s review.md ] && ! grep -q "usage limit" review.log; then touch DONE
else echo "审校阶段失败（退出码非 0、没有 review.md 或撞额度）" > FAILED; exit 1; fi

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
codex=/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex
if [ "$SEC" = vocab ]; then NAME="言語知識（文字・語彙）"; else NAME="言語知識（文法）"; fi
ROWS=$(echo "$TABLE" | tr '|' '\n' | awk '{printf "| %s | %s | %s |\n",$1,$2,$3}')

header() { cat <<EOF
# 本次任务（$1）

- 等级：$LV　科目：$NAME
- 工作目录：$DIR（只在这里写文件）
- 题型和题数：

| mondai | 题型 | 题数 |
|---|---|---|
$ROWS

$( [ -n "$USED" ] && printf "%s\n\n%s\n" "- ⚠️ 下面这些考点在前几套已经用过，这一套**不许再用**（换别的同级词 / 语法；干扰项可以用）：" "  $USED" )

EOF
}
run() { "$codex" exec --skip-git-repo-check -C "$DIR" -s workspace-write -m gpt-6-luna \
  -c model_reasoning_effort="max" -c service_tier="fast" -o "$1.last.md" - > "$1.log" 2>&1; }

rm -f DONE FAILED
if [ "${REVIEW_ONLY:-}" != 1 ] || [ ! -s questions.json ]; then
{ header 出题
  echo '交付：本目录下的 `questions.json`，以及 `self-check.md`（写完后自己从头做一遍：犹豫过的题号和原因、因此改过的题、正解位置分布、考点覆盖）。完成后最后一条消息只写一句：交付了什么、有几道题标了 doubt。'
  echo; cat "$ROOT/rules.md"; } > write.prompt.md
run write < write.prompt.md || { echo "出题阶段退出码非 0" > FAILED; exit 1; }
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
if run review < review.prompt.md && [ -s review.md ] && ! grep -q "usage limit" review.log; then touch DONE
else echo "审校阶段失败（退出码非 0、没有 review.md 或撞额度）" > FAILED; exit 1; fi

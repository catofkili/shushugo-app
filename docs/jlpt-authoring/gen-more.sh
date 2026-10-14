#!/bin/sh
# 2026-10-13 补量：卷 4、卷 5（整套卷，题数同 gen-set.sh 的表）+ 卷 6（练习题池 pool，只进「按题型练」，不进模拟卷）。
# 每科一条链，按 4→5→6 顺序出（后出的避开前面用过的考点）；同时最多 5 条链（并行的 Codex 别超过 5 个）。
# 可反复跑：有 DONE 跳过，有 questions.json 只补审校。脱离会话启动：
#   JLPT_REPO=<带 build-jlpt-bank.mjs 的仓库目录> JLPT_CODEX_HOMES="$HOME/.codex-b $HOME/.codex" \
#   python3 -c 'import os,sys;os.setsid();os.execvp(sys.argv[1],sys.argv[1:])' ./gen-more.sh >> gen-more.log 2>&1 &
cd "$(dirname "$0")" || exit 1
export LANG=en_US.UTF-8
# 套卷：同 gen-set.sh
t() { case "$1" in
  N5-vocab) echo "1 漢字読み 7|2 表記 5|3 文脈規定 6|4 言い換え類義 3";;
  N4-vocab) echo "1 漢字読み 7|2 表記 5|3 文脈規定 8|4 言い換え類義 4|5 用法 4";;
  N3-vocab) echo "1 漢字読み 8|2 表記 6|3 文脈規定 11|4 言い換え類義 5|5 用法 5";;
  N2-vocab) echo "1 漢字読み 5|2 表記 5|3 語形成 3|4 文脈規定 7|5 言い換え類義 5|6 用法 5";;
  N1-vocab) echo "1 漢字読み 6|2 文脈規定 7|3 言い換え類義 6|4 用法 6";;
  N5-grammar) echo "1 文法形式の判断 9|2 文の組み立て 4|3 文章の文法 4";;
  N4-grammar) echo "1 文法形式の判断 13|2 文の組み立て 4|3 文章の文法 4";;
  N3-grammar) echo "1 文法形式の判断 13|2 文の組み立て 5|3 文章の文法 5";;
  N2-grammar) echo "1 文法形式の判断 12|2 文の組み立て 5|3 文章の文法 5";;
  N1-grammar) echo "1 文法形式の判断 10|2 文の組み立て 5|3 文章の文法 4";;
esac; }
# 题池：5 套卷之后每个题型补到 40 道左右。文章题不进池（导入器一份题只收一篇文章），文法形式已够。
p() { case "$1" in
  N5-vocab) echo "1 漢字読み 5|2 表記 15|3 文脈規定 10|4 言い換え類義 25";;
  N4-vocab) echo "1 漢字読み 5|2 表記 15|3 言い換え類義 20|4 用法 20";;
  N3-vocab) echo "1 表記 10|2 言い換え類義 15|3 用法 15";;
  N2-vocab) echo "1 漢字読み 15|2 表記 15|3 語形成 25|4 文脈規定 5|5 言い換え類義 15|6 用法 15";;
  N1-vocab) echo "1 漢字読み 10|2 文脈規定 5|3 言い換え類義 10|4 用法 10";;
  N5-grammar) echo "1 文の組み立て 20";;
  N4-grammar) echo "1 文の組み立て 20";;
  N3-grammar) echo "1 文の組み立て 15";;
  N2-grammar) echo "1 文の組み立て 15";;
  N1-grammar) echo "1 文の組み立て 15";;
esac; }
job() { # $1 套号 $2 科目
  d="set$1/$2"
  [ -f "$d/DONE" ] && return 0
  [ -f "$d/CLAIMED" ] && return 0   # 已交给 Claude 子代理手写，写完撤掉 CLAIMED 再跑才补审校
  r=; [ -s "$d/questions.json" ] && r=1
  if [ "$1" = 6 ]; then tbl=$(p "$2"); else tbl=$(t "$2"); fi
  OUT="$PWD/set$1" REVIEW_ONLY=$r ./run-job.sh "${2%-*}" "${2#*-}" "$tbl"
}
if [ "${1:-}" = prompt ]; then  # ./gen-more.sh prompt <套号> <科目>：只生成 set<套号>/<科目>/write.prompt.md
  if [ "$2" = 6 ]; then tbl=$(p "$3"); else tbl=$(t "$3"); fi
  OUT="$PWD/set$2" PROMPT_ONLY=1 ./run-job.sh "${3%-*}" "${3#*-}" "$tbl"; exit $?
fi
if [ "${1:-}" = chain ]; then
  for s in 4 5 6; do
    job "$s" "$2" || { echo "$(date) 卷 $s $2 失败，这一科后面的停下"; exit 1; }
    echo "$(date) 卷 $s $2 完成"
  done
  exit 0
fi
echo "$(date) 补量开始"
printf '%s\n' N1-grammar N2-grammar N3-grammar N4-grammar N5-grammar N1-vocab N2-vocab N3-vocab N4-vocab N5-vocab \
  | xargs -P 5 -I{} sh ./gen-more.sh chain {}
for s in 4 5 6; do
  ok=1; for d in "set$s"/*/; do [ -f "$d/DONE" ] || { echo "$(date) 卷 $s 未完成: $d"; ok=; }; done
  [ -n "$ok" ] && { touch "SET$s-DONE"; echo "$(date) 卷 $s 完成"; }
done
echo "$(date) ALL-FINISHED"

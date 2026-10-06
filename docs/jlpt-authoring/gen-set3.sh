#!/bin/sh
# 卷 3 重出（2026-10-06）：第一次全撞额度，gen-sets.sh 却照样留了 SET3-DONE。
# 这一版每批 5 个，全部 10 份都有 DONE 才写 SET3-DONE。N2/N3 语汇上次已写完，只补审校。
cd "$(dirname "$0")" || exit 1
rm -f SET3-DONE
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
job() { lv=${1%-*}; sec=${1#*-}; OUT="$PWD/set3" REVIEW_ONLY=${2:-} ./run-job.sh "$lv" "$sec" "$(t "$1")"; }
for x in N5-vocab N4-vocab N1-vocab N5-grammar N4-grammar; do job $x & done; wait
for x in N3-grammar N2-grammar N1-grammar; do job $x & done
job N2-vocab 1 & job N3-vocab 1 & wait
for d in set3/*/; do [ -f "$d/DONE" ] || { echo "未完成: $d"; exit 1; }; done
touch SET3-DONE

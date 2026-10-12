#!/bin/sh
# 卷 3 重出。第一次（10-04）全撞额度，gen-sets.sh 却照样留了 SET3-DONE；
# 第二次（10-06）又撞额度，随后会话结束，后台进程被一起杀掉，留下一堆写了一半的审校。
# 所以这一版可以反复跑：已有 DONE 的跳过，已有 questions.json 的只补审校；同时最多 5 个 Codex；
# 全部 10 份都有 DONE 才写 SET3-DONE。要脱离 Claude 会话启动（会话一结束就杀进程）：
#   JLPT_REPO=<仓库目录> python3 -c 'import os,sys;os.setsid();os.execvp(sys.argv[1],sys.argv[1:])' ./gen-set3.sh >> gen-set3.log 2>&1 &
# 单跑一份：./gen-set3.sh N3-vocab
cd "$(dirname "$0")" || exit 1
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
if [ -n "${1:-}" ]; then
  [ -f "set3/$1/DONE" ] && exit 0
  r=; [ -s "set3/$1/questions.json" ] && r=1
  OUT="$PWD/set3" REVIEW_ONLY=$r exec ./run-job.sh "${1%-*}" "${1#*-}" "$(t "$1")"
fi
rm -f SET3-DONE
printf '%s\n' N1-grammar N2-grammar N3-grammar N1-vocab N2-vocab N3-vocab N4-vocab N5-vocab N4-grammar N5-grammar |
  xargs -P 4 -n 1 "$PWD/gen-set3.sh"
for d in set3/*/; do [ -f "$d/DONE" ] || { echo "未完成: $d"; exit 1; }; done
touch SET3-DONE

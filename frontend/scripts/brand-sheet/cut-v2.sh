set -e
# 从作者的定妆总表裁出 public/brand/sheet/ 里的全部素材。总表路径、每格坐标都在这里，换总表就改坐标重跑。
# 裁 → 双三次放大（小图标 4x、插画 3x）→ 抠面板底色 + 软边，全在 upcut.mjs（stdlib-only，不装依赖）。
SRC=~/收集日/ce61da7d-0b11-417b-95b7-c8f5ccbf4567.png
OUT=/Users/lsc/Documents/shushugo/frontend/public/brand/sheet
S=$(cd "$(dirname "$0")" && pwd)
rm -rf "$OUT"; mkdir -p "$OUT"
# c 名字 x0 y0 x1 y1 —— 裁下来、抠掉面板底色，再放大 2 倍（sips 重采样）
# 小图标 4 倍、插画 3 倍；抠底 + 软边都在放大后的图上做（upcut.mjs）
c() { case "$1" in icon-*|tab-*|tool-*|decor-*|walk-*) SC=4;; *) SC=3;; esac; node "$S/upcut.mjs" "$SRC" "$OUT/$1.png" $2 $3 $(( $4 - $2 )) $(( $5 - $3 )) $SC 212; }
# 表情
c mood-default    19 418 129 510
c mood-happy     139 418 248 510
c mood-content   255 418 360 510
c mood-study     369 418 488 510
c mood-idea      503 412 601 510
c mood-fight     615 418 721 510
c mood-confused  732 418 840 510
c mood-surprised 851 418 957 510
c mood-working   979 418 1089 510
c mood-love     1092 418 1206 510
# 功能图标（线性 + 水豚点缀）
c icon-home       30 605 101 680
c icon-vocab     115 605 184 680
c icon-grammar   211 605 278 680
c icon-practice  297 605 357 680
c icon-stats     385 605 456 680
c icon-favorites 474 605 540 680
c icon-me        560 605 636 680
c icon-study-modes    675 608 754 682
c icon-kanji-readings 768 608 844 682
# Tab Bar（简洁版）
c tab-home      887 624 932 684
c tab-study     954 624 1002 684
c tab-practice 1023 624 1070 684
c tab-stats    1090 624 1136 684
c tab-me       1159 624 1200 684
# 工具盘图标（更多）
c tool-notebook   30 772 110 838
c tool-speak     127 772 207 838
c tool-listen    227 772 307 838
c tool-kana      326 772 406 838
c tool-review    426 772 506 838
c tool-plan      524 772 604 838
c tool-night     621 772 701 838
c tool-settings  720 772 800 838
c tool-delete    818 772 898 838
c tool-share     916 772 996 838
c tool-download 1015 772 1095 838
c tool-more     1115 772 1195 838
# 空状态 / 提示插画
c empty-box      32 912 174 1010
c empty-search  245 900 361 1010
c empty-network 420 900 611 1010
c empty-newuser 656 900 789 1010
c empty-done    871 900 976 1010
c empty-bye    1071 900 1184 1010
# 其他常用素材
c decor-set      18 1158 225 1212
c bubble-cheer  254 1130 346 1200
c bubble-great  345 1132 440 1206
c bubble-more   442 1130 560 1236
c card-daily    569 1125 776 1236
c walk-1  792 1150 850 1216
c walk-2  855 1150 917 1216
c walk-3  925 1150 987 1218
c walk-4  999 1150 1059 1216
c scene-onsen  1088 1126 1194 1232
# Logo 与标题
c logo-lockup  455  98 723 265
c splash-sleep 741 110 975 275
c quote-splash 1005 125 1192 235
node "$S/strip.mjs" && rm "$OUT"/walk-[1-4].png

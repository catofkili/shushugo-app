set -e
# 鳄鱼皮肤（柚子商店的 mascot-croc）。作者 2026-09-19 的五张鳄鱼分图在 ~/收集日/ 顶层（1448×1086）。
# 裁法和 cut-hires.sh 一样：一格一格按「墨水包围盒」裁（坐标用 scratchpad 的 profile 脚本量的
# 行/列墨水区间再各放 8px），泛洪抠面板底色、软边、TRIM 到内容。
# 输出到 public/brand/sheet-croc/，文件名和默认那套逐一对应，Sticker 按装备切目录；
# 这套没有的（满足/加油/工具盘/气泡/走路帧等）退回默认水豚那份，见 CapybaraMascot.tsx。
D=~/收集日
OUT=/Users/lsc/Documents/shushugo/frontend/public/brand/sheet-croc
S=$(cd "$(dirname "$0")" && pwd)
mkdir -p "$OUT"
T=$D/82f80f8e-23cb-4bdb-99e7-8f0852961513.png   # Tab 图标 6
M=$D/ab8cd674-a047-43eb-a8df-c7d1172d4436.png   # 表情 8
I=$D/ca2650d0-e60e-4c96-9988-c602de8f72cb.png   # 功能图标 9（含日语多音）
E=$D/dccfc7d4-0c59-4e23-b870-5600e5333367.png   # 空状态 6
B=$D/bf50bdd7-a886-419f-afb4-201eae48b90e.png   # 图标浅/深、横版 Logo、看书
c() { TRIM=1 node "$S/upcut.mjs" "$1" "$OUT/$2.png" $(( $3 - 8 )) $(( $4 - 8 )) $(( $5 - $3 + 16 )) $(( $6 - $4 + 16 )) 1 ${BG:-234}; }
# Tab：行 [143,418] [612,874]，列 [119,406] [580,874] [1064,1364]
c $T tab-home      119 143  406 418
c $T tab-study     580 143  874 418
c $T tab-grammar  1064 143 1364 418
c $T tab-practice  119 612  406 874
c $T tab-stats     580 612  874 874
c $T tab-me       1064 612 1364 874
# 表情：行 [139,453] [598,864]，列 [32,340] [397,693] [745,1052] [1112,1406]
c $M mood-default    32 139  340 453
c $M mood-happy     397 139  693 453
c $M mood-study     745 139 1052 453
c $M mood-idea     1112 139 1406 453
c $M mood-confused   32 598  340 864
c $M mood-surprised 397 598  693 864
c $M mood-working   745 598 1052 864
c $M mood-love     1112 598 1406 864
# 功能图标：行 [50,290] [411,645] [752,1007]，列 [123,432] [560,878] [1002,1340]
c $I icon-home          123  50  432  290
c $I icon-vocab         560  50  878  290
c $I icon-grammar      1002  50 1340  290
c $I icon-practice      123 411  432  645
c $I icon-stats         560 411  878  645
c $I icon-favorites    1002 411 1340  645
c $I icon-me            123 752  432 1007
c $I icon-study-modes   560 752  878 1007
c $I icon-kanji-readings 1002 752 1340 1007
# 空状态：行 [103,408] [593,908]，列 [67,436] [536,904] [991,1395]
c $E empty-box      67 103  436 408
c $E empty-search  536 103  904 408
BG=225 SAT=32 c $E empty-network 991 103 1395 408
c $E empty-newuser  67 593  436 908
c $E empty-done    536 593  904 908
c $E empty-bye     991 593 1395 908
# 图标页：横版 Logo、看书（带一句「鼻子太长了」）。浅色图标那格抠掉奶油底就只剩一只鳄鱼,没有用处,不裁
c $B logo-lockup    60 660  720 1010
BG=225 SAT=32 c $B scene-reading 840 640 1390 1010
# 深色图标自带深蓝圆角底,走圆角蒙版;皮肤装上后它就是问候条 / 导航栏那枚品牌图标(浅色主题也用它,一枚 App 图标本来就该是块实心的)
node "$S/roundmask.mjs" $B "$OUT/app-icon.png" 767 75 552 544 106

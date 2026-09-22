set -e
# 作者 2026-09-19 晚上补的五张高清分图（~/收集日/未命名文件夹，1448×1086，一格约 300px），
# 覆盖总表裁出来的同名文件。在 cut-v2.sh 之后跑：总表上有、这里没有的（满足/加油/一字多音/
# 工具盘更多图标/气泡/每日一句/走路帧）仍然用总表那份。不放大（已经够大），只抠底 + 软边 + 裁边。
D=~/收集日/未命名文件夹
OUT=/Users/lsc/Documents/shushugo/frontend/public/brand/sheet
S=$(cd "$(dirname "$0")" && pwd)
A=$D/9ce31203-deca-4808-b29a-65876260a22d.png   # 表情 8
B=$D/f6f10223-7bd4-4ba2-97e4-2a79f6dad118.png   # 功能图标 8（含学习模式）
C=$D/20b6f540-8ab3-4f85-a372-3d12ebf4bb71.png   # 空状态 6
E=$D/1234012a-9b88-45b6-85b7-a20fcb92d882.png   # Tab 图标 6（含语法）
F=$D/e3094d72-6464-456f-ae0a-936d4ae0b2c9.png   # 图标 / 横版 Logo / 看书插画
c() { TRIM=1 node "$S/upcut.mjs" "$1" "$OUT/$2.png" $3 $4 $(( $5 - $3 )) $(( $6 - $4 )) 1 234; }
c $A mood-default    36 140 352 455
c $A mood-happy     398 140 700 455
c $A mood-study     738 140 1060 460
c $A mood-idea     1108 138 1400 458
c $A mood-confused   40 580 352 865
c $A mood-surprised 396 580 696 865
c $A mood-working   738 600 1058 865
c $A mood-love     1106 592 1402 868
c $B icon-home        52 140 333 445
c $B icon-vocab      393 150 697 445
c $B icon-grammar    757 136 1048 445
c $B icon-practice  1122 133 1408 445
c $B icon-stats       68 597 342 885
c $B icon-favorites  394 600 693 888
c $B icon-me         745 607 1056 888
c $B icon-study-modes 1099 598 1413 888
c $C empty-box       32 100 466 440
c $C empty-search   527  88 903 440
c $C empty-network  988  99 1398 440
c $C empty-newuser   63 600 445 935
c $C empty-done     527 583 905 935
c $C empty-bye      985 570 1408 935
c $E tab-home        95  89 435 445
c $E tab-study      535 113 919 445
c $E tab-grammar   1032 125 1402 445
c $E tab-practice    86 595 455 920
c $E tab-stats      545 629 921 925
c $E tab-grammar-me 1041 622 1380 920
mv "$OUT/tab-grammar-me.png" "$OUT/tab-me.png"
THIN=1 ERASE=340,122,999,999 c $F logo-lockup     70 715 485 960
ERASE=0,0,26,112 c $F splash-sleep   434 715 810 960
c $F scene-reading  873 622 1363 1000
# App 图标深色版：自带深色圆角底，不能泛洪抠底，走圆角蒙版（半径按边缘探出来 ≈ 98）
node "$S/roundmask.mjs" $F "$OUT/../shushugo-icon-dark.png" 840 56 441 438 98
# 浅色版就是 shushugo-cover.png（1254，已透明角）缩到 512
sips -z 512 512 "$OUT/../shushugo-cover.png" --out "$OUT/../shushugo-icon.png" >/dev/null

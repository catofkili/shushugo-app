set -e
# 作者 2026-09-23 晚补的四张表情分图（~/收集日/未命名文件夹，1448×1086，每张 5 格）。
# 流程同 cut-hires.sh：不放大，只抠底 + 软边 + 裁边。坐标是按墨水区间量的（每格外扩 12px）。
# 输出到本脚本所在 checkout 的 public/brand/sheet（cut-hires.sh 那份写死了主目录，别照抄）。
D=~/收集日/未命名文件夹
S=$(cd "$(dirname "$0")" && pwd)
OUT=$S/../../public/brand/sheet
A=$D/3264d16e-49bb-4710-b491-6fc6bc6a4df9.png   # 生病 / 饿了 / 欢呼 / 头晕 / 挥手
B=$D/3fca1ad6-2674-47a1-a46a-c0534fabce91.png   # 惊吓 / 害羞 / 抱心 / 想不通 / 得意
C=$D/56a84e29-7f08-407e-9f3f-c6e134a1c263.png   # 大哭 / 生气 / 想问 / 睡着 / 耶
E=$D/b64db3e2-0e5a-4fc7-bd69-b0d1386d74f9.png   # 电脑 / 听歌 / 看书 / 伸懒腰 / 攥拳
c() { TRIM=1 node "$S/upcut.mjs" "$1" "$OUT/$2.png" $3 $4 $(( $5 - $3 )) $(( $6 - $4 )) 1 234; }
c $A mood-sick       32 239  492 511
c $A mood-hungry    519 142  927 533
c $A mood-cheer     978 147 1430 520
c $A mood-dizzy     286 598  668 956
c $A mood-wave      769 635 1219 958
c $B mood-shocked    43 192  463 529
c $B mood-shy       519 241  925 528
c $B mood-heart     987 213 1390 537
c $B mood-puzzled   222 598  670 931
c $B mood-proud     758 627 1199 933
c $C mood-cry        28 241  461 517
c $C mood-angry     508 212  945 504
c $C mood-ask       989 137 1421 502
c $C mood-sleep     203 604  671 957
c $C mood-yay       743 596 1270 953
c $E scene-laptop    37 229  486 541
c $E scene-music    528 200  960 528
c $E scene-book    1018 228 1393 540
c $E scene-stretch  203 607  708 940
c $E mood-fired-up  785 607 1239 933

set -e
# 作者 2026-09-24 补的一批分图（~/收集日/未命名文件夹，1448×1086，每张 2×2 四格，格下是淡蓝标签胶囊）。
# 流程同 cut-extra.sh：不放大，只抠底 + 软边 + 裁边。
# 坐标是用脚本量的：每格在「标签胶囊上沿 − 5px」以上找墨水包围盒，再外扩 ~10px；
# 胶囊上沿按淡蓝底（b>235 且 b−r>18）逐行扫出来（功能图标那张右列有蓝色选中卡，会被误判，按左列的值用）。
# 输出到本脚本所在 checkout 的 public/brand/sheet。
# ⚠️ 必须排在 cut-v2.sh、cut-hires.sh 之后跑：icon-vocab / icon-kanji-readings 在那两份里也有旧版，后跑的赢。
D=~/收集日/未命名文件夹
S=$(cd "$(dirname "$0")" && pwd)
OUT=$S/../../public/brand/sheet
TEAM_A=$D/5ce6b987-f395-426e-98bc-25a556797b55.png  # 组队头图 1–4
TEAM_B=$D/34ad9748-2894-4fb0-9229-41c1ecf29336.png  # 组队头图 5–8
MUSIC=$D/04b827ce-8831-4735-8e94-49280c8afe63.png   # 电钢 1/2、木琴 1/2
VOICE=$D/19da904e-a322-4d78-a5da-2a32b2e15fb6.png   # 男声 1/2、女声 1/2
REPAIR=$D/0b58f453-3cc2-4173-a01b-38d6d4358532.png  # 补签卡 1–4
FUNC=$D/70485e6d-fc31-46c4-8162-31209ce5b1b7.png    # 一字多音 1/2、柚子商店、选词（日文版；044f5ae3 是同一套的中文拼音版，不用）
ROLL_A=$D/1c760b66-af7d-4750-b8a1-18edde7d4586.png  # 翻滚 1–4
ROLL_B=$D/a52900a1-a0a4-4518-ad3b-1b342867c8f5.png  # 翻滚 5–8
c() { TRIM=1 node "$S/upcut.mjs" "$1" "$OUT/$2.png" $3 $4 $(( $5 - $3 )) $(( $6 - $4 )) 1 234; }

c $TEAM_A scene-team     44 146  702 510
c $TEAM_A scene-team-2  744 180 1406 510
c $TEAM_A scene-team-3   44 620  706 986
c $TEAM_A scene-team-4  744 616 1406 986
c $TEAM_B scene-team-5   44 150  698 502
c $TEAM_B scene-team-6  744 134 1406 502
c $TEAM_B scene-team-7   44 620  702 978
c $TEAM_B scene-team-8  744 626 1406 978

c $MUSIC item-sound-epiano    127 151  628 506
c $MUSIC item-sound-epiano-2  850 146 1340 506
c $MUSIC item-sound-marimba   127 624  619 983
c $MUSIC item-sound-marimba-2 852 622 1323 983

c $VOICE item-voice-male     174 161  606 517
c $VOICE item-voice-male-2   852 133 1315 517
c $VOICE item-voice-female   170 626  579 986
c $VOICE item-voice-female-2 878 623 1271 986

c $REPAIR item-repair-card    142 152  611 490
c $REPAIR item-repair-write   835 140 1308 493
c $REPAIR item-repair         129 607  642 972
c $REPAIR item-repair-cheer   828 607 1357 973

c $FUNC icon-kanji-readings  76 182  695 516
c $FUNC icon-kanji-choice   787 178 1365 516
c $FUNC icon-shop           116 634  622 990
c $FUNC icon-vocab          775 638 1390 990

# 翻滚 8 帧：每帧先各自裁边，再由 strip.mjs 按同一格子底对齐拼成一条（CSS steps(8) 翻帧）
c $ROLL_A roll-1  127 180  618 500
c $ROLL_A roll-2  874 182 1297 500
c $ROLL_A roll-3  175 641  568 956
c $ROLL_A roll-4  804 676 1351 956
c $ROLL_B roll-5  160 171  595 506
c $ROLL_B roll-6  883 189 1321 506
c $ROLL_B roll-7  186 642  595 967
c $ROLL_B roll-8  860 636 1329 967
node "$S/strip.mjs" roll 8
# 第一帧另存一份给商店「小路走法」当商品图（同 walk-frame 之于 walk-strip）
cp "$OUT/roll-1.png" "$OUT/roll-frame.png" && rm "$OUT"/roll-[1-8].png

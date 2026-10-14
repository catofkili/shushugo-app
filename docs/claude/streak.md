# 连胜火苗

> 规格和进度在 `docs/STREAK_SPEC.md`；这里只放判据和踩过的坑。和柚子 / 成就的口径关系见 `learning-progress-and-rewards.md`。

## 连胜火苗：判据现算，两档（亮 / 金）（2026-10-14，规格 `docs/STREAK_SPEC.md`）

- 判据全在 `frontend/src/lib/streak.ts`，不新建表：金 = `checkins` 有这天且不是补签；补 = 补签补的；亮 = 金或补，或当天作答 ≥ 20 次，或有效学习 ≥ 300 秒（`STREAK_LIT`）。
  「连续天数」「最长」「累计」「快断了」都从这里现算。主页 chip、完成页日历、分享图、柚子 7 日连击、补签的「洞」都换成了这一个口径；
  **组队打卡和成就的 `longestDayStreak` 没跟着换，也不许跟着换**（各自口径见规格 §0）。
- `todayStreakStatus()` 只查今天、给每题都要问一次的地方用；`streakSnapshot()` 扫全表。两个判据必须一致，`streak.test.ts` 有对拍。
- **小火苗保连胜，大火苗得奖励**（作者 10-14 定）：7 日连击 +300 按「这一段连胜里的大火苗个数 `goldInStreak` 攒满 7 的倍数、且今天是大火苗」发；小火苗和补签只让连胜不断。`settleYuzu` 和庆祝层的「+300」用同一判据。
- 庆祝「今天放过没有」记在 localStorage `mn-streak-celebrated:<学习日>`（设备偏好，不同步）。
  `StreakCelebrationGate` 里**只在领到时 setShow**：`claimStreakCelebration()` 领一次就记账，第二次一定返回 null；
  直接 `setShow(claim())` 会被 StrictMode 双跑的 effect 冲掉第一次领到的结果 —— 标记写了、层没弹，10-14 在 5201 上踩到。
- ⚠️ 小程序的吉祥物贴纸是**按分包放的**（`taro-spike-2/scripts/sync-brand-assets.mjs`：`mainNames` / `packageNames`），
  组件在主包页面（主页、单词）上用了只在分包里的贴纸，就是一张空图、不报错。庆祝层因此只用主包里有的
  （`mood-fired-up` / `mood-yay` / `mood-cheer` / `mood-wave`）；详情页在 content-pages，用到的 `mood-shocked` 补登记进了那个分包。
  以后给会出现在主包页面的组件挑贴纸，先查 `mainNames`。
- 类名前缀：火苗 `sf-`、庆祝层 `sc-`、详情页 `stk-`。**不能用 `sp-`**：拼写页占了（`.sp-card` 撞过），而且 `split-route-css.mjs` 会把 `sp-*` 规则当成单词页的挪走。

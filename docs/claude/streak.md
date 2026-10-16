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

### 2026-10-16 增补：主页火苗从小药丸放大成问候语右边一块

作者：「连胜火苗应该在更显眼的地方」。给了两版：A 挂在大卡右上沿的白胶囊（贴着水豚头上的小符号）、B 问候语右边一块（34px 火苗 + 26px 数字 + 「天」），作者选 B。
没学是 `--ds-inset` 底灰字、学完 `--ds-warn-tint` 底橙字、金色那天金字（按钮上挂 `is-off / is-lit / is-gold`，不用 `:has()`，小程序不认）。34px 仍低于 40px，所以不画脸——一屏一只水豚之外不再多一张脸。
顶栏那一行是 `AppNavigation` 渲染的，小程序用原生标题栏、到不了，所以火苗只能放在页面内容里，两端才一致。
同时修了「比昨天少 N 个」时刻气泡：它挂在大卡上沿外面，但大卡 `overflow:hidden`（裁右上角装饰圆），气泡上半截一直被裁掉。现在挂在 `.zoo-tray-today` 上。

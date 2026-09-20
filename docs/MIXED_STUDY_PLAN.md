# 混合学习 + 圆环学习量 + 会员范围（2026-09-20 定，分五步做）

作者定的产品口径，原话在会话里，这里是整理后的判据。**改这份计划先改这里。**

## 0. 会员范围（无广告，只一档 Pro）

| 锁 | 免费 |
|---|---|
| 疑难辨析（页面、卡上入口、连线卡） | 经典 / 快速 / 错题本 / 反向 / 汉字读音 / 自选 |
| 一字多音 | 词库、收藏、统计、词汇量测试 |
| 混合学习模式（下面那个新的） | 语法列表、语法考题（单独的） |

定价：月 ¥12 / 年 ¥98 / 永久 ¥298。iOS 在 App Store Connect 对齐；小程序在 `cloudflare-sync/wrangler.jsonc` 的
`WECHAT_PAY_PRICES`。**先不做去广告档**——根本没有广告。

`FeatureId` 加三个：`confusionGroups`、`kanjiReadingUsage`、`mixedStudy`。`Paywall` 的 `benefits` 跟着改
（那几行是买之前看到的承诺，必须和真锁着的功能对得上）。

## 1. 四种卡进同一条 FSRS 流水线

| 卡 | 身份 | 表 | 正面 | 反面 | 现状 |
|---|---|---|---|---|---|
| 单词 | `word_id` | `progress` / `reviews` | 中文 | 日文 | 有 |
| 语法 | `grammar_id` | `grammar_progress` / `grammar_reviews` | 句型 | 接续 + 中文意 | 有 |
| **单独汉字** | 一个字（`char`） | **`kanji_char_progress` / `kanji_char_reviews`**（新） | 一个字 | 音读 / 训读 + 例词（带释义） | 无。⚠️ 和现有 `kanji_unit_*`（按「一个字的一种读音」为单位、在 `feature.kanji_unit_scheduler_v1` 旗子后面）**不是一回事**，也不动它 |
| **疑难** | 一个辨析组（`type:label`，同 `confusion_mastered` 主键） | **`confusion_progress` / `confusion_reviews`**（新） | 连线题 | 辨析稿 | 现有辨析题（`distinction-quiz.ts`）**只写 `confusion_mastered` 不进 FSRS，废掉** |

### 单独汉字卡

- 候选集：目标等级及以下的词里出现过的汉字（从 `kanji_reading_unit_runtime.json` 的 units 聚出 char 集合）。
- 反面数据：读音来自 `kanji_readings.json`（KANJIDIC，音读 / 训读）；多音字附 `kanji_reading_usage.json` 那一行说明
  （520 个字有）；例词 = 该字出现的词按熟悉度取前几个，带 `words.meaning`。**不新造内容**，全是已有三份数据的拼装。
- 评分四档同单词；`isGraduatedForDay` 那条「Learning / Relearning 不算毕业」照用。
- 中文母语者认字不认音，所以这张卡考的是读音，不考写法——和「汉字读音」方向是同一个前提，只是单位从词换成字。

### 疑难连线卡

- 题面：左列组内成员（词形按 `displayForm`），右列题面（`questionMeaning`，同辨析题现在的口径）打乱。
  **点也算连线**：点左边一个再点右边一个就是一条线，不强制拖。
- 评分不让用户点四档，按结果算：一次全对 → Good；错 1 条 → Hard；错 ≥ 2 → Again；
  全对且用时 < 组员数 × 4 秒 → Easy。用时用 `study-clock` 那套交互口径。
- `confusion_mastered` 留着：标了「已掌握」的组不进队列（等于手动毕业）。
- 组的成员题面缺的整组跳过（沿用 `quizGroups` 的判据），绝不退回 `words.meaning`。
- 入口从疑难辨析页搬到**主页**（学习工具那一盘）；旧的 `DistinctionQuizPage` 删。

### 三处登记，一处都不能漏

新表照例：`sync/tables.ts`（策略：progress 表 lww、reviews 表 append + `sync_uid`）、
`scripts/user-data-tables.mjs`（出厂库泄漏守卫）、`local-schema.sql`。小程序侧 `SNAPSHOT_TABLES`
要跟上，否则**进了正式协议的表不再受透传保护**（见 wechat-miniprogram README）。

## 2. 混合学习模式

替换现在的 `mixed`（每 5 个单词插一条语法）。新的：四种卡各自有「今日新学 + 今日复习」两个数，
合成一条队列交错出（交错比例按各自剩余量，语法/汉字/疑难不因单词多而饿死——同「新词保底每 8 张一个」的道理）。
某一类当天数为 0 就不出。撤销按作答顺序分派（`undoKinds` 那套扩到四种）。

## 3. 学习量：一份状态，三个入口

状态只有一份，存 `studyPreferences`（localStorage，本机）：

```ts
dailyPlan: {
  total: number;                 // 用户定的当天总量
  words:     { fresh: number; review: number };
  grammar:   { fresh: number; review: number };
  kanji:     { fresh: number; review: number };
  confusion: { fresh: number; review: number };
}
```

现有 `dailyGoal` / `grammarDailyGoal` / `reviewCap` / `kanji_unit_daily_quota` **废掉**，迁移时按老值填进新结构。
⚠️ 「名额只由用户说了算，积压不缩水新词」那条不变：`fresh` 就是当天要学的新卡数，不因复习多而缩。

三个入口改的是同一份状态：

1. **圆环**（主页，替换 `.zoo-goal` 那颗 chip 和设置页「每日学习量」一节）
   - 四段，三个滑钮，中间写总量；滑钮可重合（某段 0）。
   - **段长 = log(1 + 数量)，数字是真的**：400 词 vs 20 语法按原比例语法细到看不见。
     （原计划 √池子，做出来单词还占八成，改 log；段长只看当前数量，不看池子，所以新用户 15/5/5/5 也是四段清楚。）
   - 拖动中只改状态，松手才落盘重排（否则掉帧）。
   - 点一段 → 放大成该类型自己的一段，里面一个滑钮分「新学 / 复习」。
   - 每段标**建议下限**：复习 ≥ 当天到期数；新学 ≥ ⌈目标等级剩余未学 ÷ 距下次 JLPT 天数⌉（`nextExamDate`）。
     低于只提示，不阻止。
2. **数字表单**（朴实无华，八个数字框 + 总量，设置页）——环拖不准的时候用。
3. **备考一键**：「现在 N几」默认从数据算（`learnedLevel`，学过的词过半的最高一级；没学过 → 从零）+「下次考 N几」
   → 按标准量算强度和预计每日用时。汉字 / 辨析的剩余量也按 (现在, 目标] 分级算（`level_rank`）。
4. **一键安排**：复习 = 今天到期全部，新学 = 平时额度（表单 / 备考一键定的那份；没定过是默认 15/5/5/5）。
   拖圆环不改这份基线。另有「撤回」（会话内栈）。
   ⚠️ **不用用户自己的数据算用时**（作者边看视频边学，效率不代表标准）：
   固定每卡秒数——单词 12s、语法 25s、汉字 10s、疑难 40s——乘上数量就是预计用时。
   强度 = 各类型「目标等级总量 − 当前等级已学」÷ 距考试天数，复习按 FSRS 到期估（到期数天均值）。

## 4. 顺序

1. 会员门（半天）—— 独立，先做
2. 汉字卡 + 疑难连线卡进 FSRS（大头；先汉字后疑难）
3. 混合模式吃四种卡
4. 环 + 表单 + 备考一键（没有 2 的数据，环是空的）
5. 小程序跟进（新表进 `SNAPSHOT_TABLES`、同样的门）

`scheduler/priority.ts` 的「按陌生度排、上限装不下纯随机」那条不动。

## 5. 进度（2026-09-20）

| 步 | 状态 |
|---|---|
| 1 会员门 | ✅ iOS + 小程序（辨析页 / 一字多音 / 混合模式；Paywall 文案） |
| 2 汉字卡 + 连线卡进 FSRS | ✅ `card-log.ts` 抽公共部分；两种卡各自 progress/reviews/tasks 三张表，三处登记，合并后重放 |
| 3 混合模式吃四种卡 | ✅ 插播语法 → 汉字 → 辨析轮着来；尾巴依次接；撤销四种；首页角标 / 小路 / 脚注算进去 |
| 4 圆环 + 表单 + 备考一键 | ✅ `daily-plan.ts` + `DailyPlanRing` + `DailyPlanPanel`，主页和设置页同一个组件 |
| 5 小程序跟进 | ⏳ 新表进 `SNAPSHOT_TABLES`（否则退出透传保护）、同样的卡和门 |
| 旧辨析题页删除 | ⏳ `DistinctionQuizPage` 还在（Pro 门后面），入口从辨析页搬走后再删 |

坑：
- `INTENSITY_MIN`(5) 仍是设置页滑杆的下限，但偏好本身允许 0（圆环拖成 0）；`reviewCap` 的 0 是「自动」，
  圆环写回时 0 存成 1。
- 改了额度要重排今天的清单：单词走 `refreshTodayWordPlan`，汉字 / 辨析走 `refreshMixedCardTasks`
  （`card-log.clearTasks` 删今天的投影再建，已答的卡由 FSRS 状态说话，不丢）。
- 连线卡的评分只看连错次数，没有用时那条（原计划的「< 组员数 × 4 秒 → Easy」删了：
  第一次见就全对已经走 known → Easy，同词级路径，再加用时是第二套口径）。
- 连线组的等级 = 最难成员的等级（`confusion_progress.level_rank`），池子和清单只数目标等级以内的。

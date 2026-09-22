# 起点水平 → 备考计划：开发计划（2026-09-22 定）

原则（用户定的）：**系统可以复杂，但要替用户给出相对最优的默认，用户可以完全不管。**
第一次打开只问「现在哪一级、考哪一级」，剩下的算法算；算出来的计划要告诉他压力多大、什么时候最重，
明显不现实的给提示不拦。不再把「学习模式 / 题型」推到用户面前。

背景决策见 `CLAUDE.md`「起点水平 → 备考计划」一节；这份文件只讲**怎么做、按什么顺序、每步怎么验收**。

---

## 0. 常数表（所有数字集中在这里，改数只改这里）

| 常数 | 值 | 来源 / 理由 |
|---|---|---|
| `ANSWERS_PER_NEW_WORD_M1` | 8 | 作者库实测一个新词第一个月答 9.4 次（706 词），一般人顽固词少，取 8 |
| `SECONDS_PER_CARD` | 单词 12 / 语法 25 / 汉字 10 / 辨析 40 | `daily-plan.ts` 已有，不拿用户历史 |
| 巩固期 | `min(21, 窗口/4)` | 已做（`consolidationDays`），窗口锚 `jlptPlanStartedOn` |
| 新词 / 语法封顶 | 50 / 12 每天 | `MAX_DAILY_NEW_*` 已有；超了 = `feasible=false` |
| 起点先验：起点那一级 | 稳定性 30 天，到期均匀撒在前 14 天 | N4 = 876 ÷ 14 ≈ 63/天露面 |
| 起点先验：起点以下各级 | 稳定性 90 天，到期撒在前 30 天 | 几乎不露面，答对一次就是半年后 |
| 熟悉度滑块 5 档 | 0 → 没学过 · 25 → 3 天 · 50 → 10 天 · 75 → 30 天 · 100 → 90 天 | 对数；起点等级填默认（起点级 = 75，以下 = 100，以上 = 0） |
| 负荷档位（第 4 周稳态分钟/天） | ≤30 轻松 · 30–60 稳妥 · 60–90 压力不小 · >90 激进 · `feasible=false` 不现实 | 只有 ≥60 才在界面上说话 |
| 薄弱加量 | 近 7 天首答正确率 < 70% 且该题型 ≥ 50 题 → 最多 +40% **分钟**，从正确率 > 85% 的题型挪 | 分母是分钟不是题数（辨析 40 s、单词 12 s） |
| 送 Pro | 7 天，一个账号一次，计划创建那一刻 | 走云端 `trial` 权益 |
| 压力曲线 | 横轴 8 周，第一个学习周结束后才显示 | 用户定的 |

---

## 1. 数据模型

### 1.1 新的用户状态

| 键 | 存哪 | 同步 | 内容 |
|---|---|---|---|
| `starting_level` | `app_state` | lww，**要同步**（不是 device-local） | `"kana-none" \| "kana" \| "N5"…"N1" \| "beyond"` |
| `type_familiarity` | `app_state` | lww，同步 | `{ words, grammar, kanji, confusion }` 各 0–100 |
| `level_prior_applied` | `app_state` | lww，同步 | 先验写入的版本戳 + 起点 + 滑块值；写过就不再写 |
| `jlptPlanStartedOn` | `studyPreferences`（localStorage） | 不同步 | 已做。计划窗口锚 |
| `showJlptLevel` | `studyPreferences` | 不同步 | 已做，默认关 |

⚠️ `starting_level` 和滑块**只是先验**。两周后数据说了算：`learnedLevel()`（按数据算「现在 N 几」）继续留着，
备考一键的「现在」默认值从 `learnedLevel() ?? starting_level` 取。

### 1.2 先验行长什么样

先验写进各表的 FSRS 列，**不写流水**（`reviews` 只记真实作答）：

```
seen_count = 1, fsrs_state = 2 (Review), fsrs_stability = S, fsrs_difficulty = 5,
fsrs_due = 撒开的日期, fsrs_last_review = NULL, fsrs_reps = 0, fsrs_lapses = 0
```

先验行的签名 = `seen_count = 1 AND fsrs_reps = 0 AND fsrs_last_review IS NULL`。
需要区分「真学过」和「先验」的地方（覆盖率、成就、词库色阶）按这个签名排除，不加新列。

为什么 `seen_count` 要写 1：`fsrs-store.ts` 里 words 的 `eligible` 是 `seen_count > 0`，
0 的话进不了到期集、反而会被当新词抽走。代价是词库页上这些词显示成「学过 · 1–3 月」档，
覆盖率会跳到 100%——后者按签名排除，前者可以接受（它们确实在队列里）。

四张表都写：`progress`（词）、`grammar_progress`、`kanji_char_memory`、`confusion_progress`。
辨析组的先验按**最难成员**的等级（`level_rank` 已有），组里有成员没先验就不写。

### 1.3 只写一次，且只写还没学过的行

`applyLevelPrior()` 只碰 `seen_count = 0 AND known_forever = 0` 的行，写完把
`level_prior_applied` 记下来。重装 / 换设备：`app_state` 同步回来带着这个键，不会再写第二遍；
progress 行本身也同步了。用户改起点（备考页）→ 只对**仍然是先验签名**的行重算，真学过的不动。

---

## 2. 分步

每步独立可测、可单独合并；顺序是依赖顺序。

### Step 1 · 负荷模型（纯函数，无 UI）

`lib/plan/load-model.ts`

```ts
predictLoad({ newWordsPerDay, newGrammarPerDay, newKanjiPerDay, newConfusionPerDay,
              priorDuePerDay: { week1, week2 }, weeks = 8 })
  → { perWeek: { minutes, answers }[8], peakWeek, steadyMinutes, tier }
tierOf(minutes) → "light" | "steady" | "heavy" | "aggressive"
```

- 每周分钟 = Σ 题型（新/天 × 该周的「每个新词本周要答几次」曲线 × 秒数）+ 先验到期 × 秒数。
  曲线用 `ANSWERS_PER_NEW_WORD_M1` 按周拆：第 1 周 3、第 2 周 2、第 3 周 1.5、第 4 周 1.5、之后每周 0.5。
  （总和 8；第 4 周是 4 个 cohort 叠满的稳态峰。）
- 判据 `load-model.test.ts`：N4→N3 75 天（38 词 + 3 语法 + N4 63/天两周）第 4 周 ≈ 70 分 → heavy；
  五十音→N1 75 天 → 206 词/天 → infeasible；0 新词只有先验 → light。
- 先做它是因为 Step 3、6、7 都读它。

### Step 2 · 先验写入（纯数据，无 UI）

`lib/onboarding/level-prior.ts`

- `familiarityDefaults(startingLevel)` → 四个滑块默认值。
- `stabilityFor(slider)`、`spreadDays(slider)`。
- `applyLevelPrior({ startingLevel, familiarity })`：四张表各一条 UPDATE，按 1.2 的行形态；
  到期日撒开用 `word_id % spreadDays`（确定性，两端一致）。
- `priorSignatureSql` 导出给覆盖率 / 成就用。
- 写完 `requestFullSnapshot()`（改了几千行 progress，别等增量）+ `notifyProgressUpdated()`。
- 判据 `level-prior.test.ts`（出厂库）：N4 起点 → N5 888 + N4 876 行有先验、N3 一行没有；
  N4 的到期落在 14 天内且每天 ≈ 63；再跑一次一行不动；已答过的行（造一条 reviews）不被覆盖；
  改成 N3 起点 → N3 行加上、原 N4 行不动（仍是先验签名，稳定性改成 90）。
- ⚠️ 三处登记不用动（没有新表），但 `scripts/user-data-tables.mjs` 的出厂库守卫要确认 progress 的
  FSRS 列在出厂库里仍然全空。

### Step 3 · 备考一键升级 + 档位提示

`daily-plan.ts` 的 `examPreset` / `applyExamPreset`、`JlptPlanPage`

- `examPreset(current, target)` 返回值多带 `load: predictLoad(...)`；`current` 默认
  `learnedLevel() ?? starting_level`。
- 结果卡文案按档位：轻松 / 稳妥不说；压力不小 → 「第 N 周最重，约 X 分钟/天」；激进 → 加一句
  「明显超出常规，建议降一级或改考期」；不现实 → 已有的「按上限也吃不完，差 N 天」。
- **N4 双向**不用写规则：先验里忘掉的词进重学、到期数涨、`predictLoad` 的 `priorDuePerDay` 按
  实际到期重算 → 档位提示是实时的。要做的只有一条：`priorDuePerDay` 从库里现算，不用常数。
- 判据：`daily-plan.test.ts` 加「preset 带 load 且 tier 正确」。

### Step 4 · 两问 onboarding

`components/LevelSetup.tsx`（首启弹层 + 备考页「重新设定」共用一个组件）

- 第一行 chip：现在 —— 不懂五十音 / 五十音到 N5 / N5 / N4 / N3 / N2 / N1 / 专业进阶。
  默认 `learnedLevel() ?? "kana"`。
- 第二行 chip：考 —— N5…N1。默认 `jlptTarget`。考期默认下一场，可改。
- 「细调」折叠：四根 5 档滑块，默认 `familiarityDefaults(现在)`。
- 底部结果卡 = Step 3 的 preset 文案 + 「开始」。
- 点开始：写 `starting_level` / `type_familiarity` / `jlptTarget` / 考期 → `applyLevelPrior` →
  `applyExamPreset` → `refreshTodayWordPlan` + `refreshMixedCardTasks` → Step 7 送 Pro → 进学习页。
- 首启判据：`starting_level` 没写过且库里 `reviews` 为空（老用户不弹，备考页可以手动进）。
- 「不懂五十音」「专业进阶」在 Step 8 落地前：选了也能开始，但结果卡多一句
  「五十音教学还没上线，先从 N5 词开始」/「N1 以上内容还没有，按 N1 全量安排」。
- 判据：仓库没有 testing-library，组件不测；逻辑全在 Step 1–3 的纯函数里，组件只是接线。

### Step 5 · 薄弱加量

`daily-plan.ts` 加 `weakBoost()`

- 近 7 天各题型首答正确率（`reviews` / `grammar_reviews` / `card-log`），题数 < 50 的题型不判。
- 最低且 < 70% 的题型：其新学额度 × 1.4（按分钟折算成题数），差额从正确率 > 85% 的题型里按分钟扣；
  没有可扣的就只加不扣（总分钟涨，档位提示会跟着变）。
- 只在「一键安排 / 备考一键」和每天首次生成计划时算，用户手动拖过的段当天不动。
- 判据 `daily-plan.test.ts`：造 7 天流水，辨析 60% / 单词 90% → 辨析 +40% 分钟、单词按分钟扣掉等量。

### Step 6 · 压力曲线

`components/LoadCurve.tsx`，挂在备考页「每日学习量」下面、主页进度概览「每日」旁边

- 第一个学习周结束后才显示（`MIN(reviewed_on)` 距今 ≥ 7 天）。
- 数据 = `predictLoad` 用**今天实际**的新学额度 + 实际到期分布；8 根柱、峰值那根标「最重」。
- 一行字：「第 N 周最重，约 X 分钟/天；之后老词间隔拉长会回落」。
- 判据：纯函数在 Step 1 已测；这里只是画。

### Step 7 · 送 Pro（云端 trial 权益）

`cloudflare-sync/src/entitlement-rules.ts` + `index.ts`、`frontend/src/lib/purchases.ts`

- 新来源 `trial`：`entitlementStrength` 里排在「过期订单」之上、「有效订阅」之下；有到期；
  **同一原始交易可改写自己那行**的例外不适用（它没有交易），只允许被更强的覆盖。
- `POST /api/entitlements/trial`：登录用户、`trial_grants` 表按 user_id 唯一，`INSERT OR IGNORE` + 读回；
  已发过返回 409。没登录的设备不发（客户端把「送」延到登录成功的 `CLOUD_AUTH_EVENT`，和待校验购买同一套排队）。
- 迁移 `0015_trial_grants.sql`；`/api/health` 加 `migrations.trial`。
- 客户端：计划创建时调一次；文案按档位（0 节表）。
- 判据：`scripts/entitlement-rules.test.mjs` 加 trial 强度；路由测试：同账号两次 → 第二次 409；
  永久 Pro 账号发 trial → 权益不变。

### Step 8 · 内容：五十音 / 专业进阶（独立，可并行）

- 五十音：一张表（平 / 片，行列）+ 假名题（假名 → 罗马音四选一，反向），自己一份 FSRS 表
  `kana_memory`（照三处登记），一周的量。起点选「不懂五十音」时前 7 天只出它，词的计划从第 8 天起算
  （`jlptPlanStartedOn` + 7）。
- 专业进阶：没有内容就先不摆这一档；等有 N1 以上词表再加。

### 收尾

- 删掉 2026-09-22 加在圆环上的模式 chip 行（`DailyPlanPanel` 的 `zoo-plan-modes`）——用户不该再从这里选模式；
  圆环保留「看得到、能拖、一键回到计划」。
- 学习模式页保留，但主页大卡不再摆模式 chip。「题型面板 + 试一题」作为备选，等 Step 1–7 上线后看是否还需要。
- `docs/MIXED_STUDY_PLAN.md` 第 3 节末尾加一行指到这份文件。

---

## 3. 顺序与验收

```
Step 1 负荷模型 ──┐
Step 2 先验写入 ──┼─→ Step 3 备考一键 ─→ Step 4 两问 UI ─→ Step 5 薄弱加量 ─→ Step 6 曲线
                  │                                       └─→ Step 7 送 Pro（Worker 可先行）
Step 8 五十音 ────┘（独立）
```

每步合并前：`npm run check && npm run lint && npm test`；Step 2 之后在作者真实库上跑一次
`applyLevelPrior`（`MERGE_DB` 那种方式，只读副本），确认 N4 到期分布和 CLAUDE.md 里的数对得上。

⚠️ 作者的 dev server 开着时**不许**改会触发内容迁移的文件（`grammar_seed.json`、`study-core.ts` 的版本常量）。
这个计划不动它们，但 Step 8 建 `kana_memory` 表要进 `local-schema.sql`——建表本身安全，别顺手升种子版本。

---

## 4. 风险

1. **先验行污染统计**：覆盖率 / 成就 / 词库色阶把 1,764 个先验行当学过。按签名排除是每个读取方各改一处，
   漏一处就是一个假数。Step 2 交付时列出所有 `seen_count > 0` 的读取方并逐个判。
2. **先验和同步**：老设备没跑过 Step 2 的代码、收到带先验的 progress 行 —— 行形态是合法的 FSRS 行，
   老代码照常调度，无害。反过来新设备先验写完、老设备又推一份 `seen_count = 0` 的旧行 —— progress 按
   `sync_updated_at` lww，新的赢。
3. **负荷模型的 8 次是估的**：作者库 9.4，别人可能 6。曲线上写「预计」，第一周后用实测到期数替换预测。
4. **送 Pro 被薅**：只发给登录账号、一账号一次；删号重注是另一个账号——接受，7 天不值得再加闸。
5. **Step 8 五十音**是新内容线，量不小，别和 1–7 绑在一个版本里。

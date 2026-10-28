# 级别普查：哪些地方只按 N3 想问题（2026-10-28）

起因：作者发现起点先验填 N5，实际学的却是 N3 的词。17c0f468 已修单词 / 语法 / 汉字 / 辨析四处新内容投放，
但作者要的是**找根本**，所以这次不是只读文档，而是把全仓库「读级别」的地方过了一遍，再用真实库和出厂库交叉验证。

**方法与边界**：静态普查（grep 全部 `N3` 字面量、`jlptTarget` / 起点读取点、`WHEN 'N5' THEN` 这类级别映射、
数字级别比较；`frontend/src`、`taro-spike-2`、`cloudflare-sync`、`wechat-miniprogram`、`scripts`），
外加两份数据：作者真实库 `frontend/.local/live.db`（`npm run db`）和出厂库 `frontend/public/nihongo.db` 的按级别分布。
**没有跑运行时的「起点 × 目标」矩阵**（见末尾建议 5），没有看真机 / 开发者工具。

> **状态更新（同日）**：H1（汉字单元模式）已修，建议 5（投放矩阵测试）已做（`plan-level-matrix.test.ts`），详见 `docs/claude/fsrs-and-review-scheduling.md` 末节。
> 其余（建议 1、3、4、6 与 M/L 各条）仍待作者拍板。

## 一句话结论（根本原因）

**「用户现在在哪一级」在系统里没有单一事实来源。** 至少并存六套概念，每个功能各取其一：

| # | 概念 | 存在哪 | 谁在读 |
| --- | --- | --- | --- |
| 1 | 自报起点 `starting_level` | app_state | 备考页、设定页、重估 |
| 2 | **实际落库的先验起点** `level_prior_applied.level` | app_state | 只有 `plan-level-order.ts`（17c0f468 才开始读） |
| 3 | 目标 `jlptTarget`（localStorage 偏好） + `jlpt_plan_target`（app_state）两份 | 两处 | 几乎所有功能 |
| 4 | **汉字单元目标** `kanji_unit_target_level`（默认 N1） | app_state | 只有汉字单元调度器 |
| 5 | 各页面自己的「当前选的级别」 | localStorage / 组件 state | 语法页（默认 N5）、JLPT 练习（默认=目标）、词库筛选、对战（默认 N3）、组队（默认 N3） |
| 6 | 素材自带的 `level_rank`（汉字、辨析） | 表列 | 汉字 / 辨析的 `level_rank <= 目标` 硬过滤 |

作者自己的库就是活证据：`starting_level = N4`、`level_prior_applied.level = N5`（两周后重估下调一级）、
`jlpt_plan_target = N3`、`kanji_unit_target_level = 2`（N3）——**同一个人，四个口径**。
修之前只有「目标」被投放读到，所以起点填什么都不影响学什么。这不是某一处的 bug，而是结构：谁新写一个投放入口，
默认抄的就是「目标那一级」（作者自己是 N3，一直看不出来）。

附带的结构性症状：**级别 → 序号的映射被抄了十几份，「未知级别」处理各不相同**：

- SQL `CASE … WHEN 'N5' THEN` ×7：`level-plan.ts`×2（0 起、未知 99）、`search-api.ts`、`progress-api.ts`×2、`word-library.ts`、`analytics/stats.ts`（1 起、未知 9）；
  `plan-level-order.ts` 的 `planLevelRankSql` 是第 8 份（未知 **0 = 排最前**）。
- TS 映射 `{N5:0…}` ×4：`mixed-cards.ts`、`confusion-cards.ts`（未知 `?? 4`）、`daily-plan.ts`、`models/familiarity.ts`；
  还有 `?? 2`（= N3）的兜底两处：`mixed-cards.ts:21`、`daily-plan.ts:122`；`talk/cards.ts:70` 的 `|| 3`。
- 级别清单 `["N5","N4","N3","N2","N1"]` 抄了二十多份（多数无害，只是枚举）。

## 逐条发现

严重度：**高** = 会让「先验 / 起点」与实际学的对不上；**中** = 与计划脱节但用户可见可调；**低** = 兜底 / 默认值 / 文案。

### 高

**H1. 汉字单元模式完全不看计划**（`lib/kanji-unit-scheduler.ts:70-85, 349-380`）
- 有自己的目标级别 `kanji_unit_target_level`，**默认 N1**（= 全都不罚），不跟 `jlptTarget` 走，也不看起点。
- 排序分 = 产量 + 边际完成数×3 + 重要度×0.5 − 超纲级数×**6**。产量是「出现在多少个词里」，高频字几十到几百，
  所以 6 分/级的级别权重实际上压不住产量：**排序基本是级别无关的高频字优先**。
- 没有任何「起点以下的先验字不再出 / 先出起点上一级」的逻辑。汉字模式默认开（`isKanjiUnitSchedulerEnabled` 默认 true）。
- 这是同一个 bug 的第五个入口，17c0f468 没覆盖到。作者自己把它设成 N3（rank 2）所以没发现。

### 中

**M1. 默认目标 N3 写死在三处**：`studyPreferences.ts:123`（`defaultStudyPreferences.jlptTarget`，normalize 非法值也回落 N3）、
`LevelSetup.tsx:82`（设定页第 2 步预选 N3，且是高亮态，用户容易以为自己没选过）、`daily-plan.ts` / `mixed-cards.ts` 的 `?? 2`。
起点选 N5 的初学者不碰第 2 步就是「N5 起步、考 N3」。17c0f468 之后行为是「先 N4 再 N3」，不再错乱，但这个默认是产品决定，应该是有意的而不是惯性。

**M2. 例句难度没按词的级别控**（出厂库实测，`example_lemmas` 分词后在词表里查级别，**下限估计**）：

| 词的级别 | 例句里含更难级别词的比例 | 含比自己难 ≥2 级的词 |
| --- | --- | --- |
| N5 | **41%** | 15% |
| N4 | 20% | 8% |
| N3 | 9% | 1% |
| N2 | 2% | 0% |
| N1 | 0% | 0% |

例如 N5「玄関」的例句是「玄関に濡れた傘を置くための場所を作りました」（濡れる 等）。N5/N4 学习者会在例句里撞上超纲词。
单词本身、释义、分词、义项键、振假名在各级覆盖都是齐的（912/846/1906/3235/4020 条全有）。这是内容问题，不是代码问题。

**M3. 当天已生成的任务表不随代码修复重排**。`STAGE1_PLAN_VERSION = "capped-random-v4"` 在 17c0f468 里没改，
所以更新应用那天已排好的单词新词表（以及汉字 / 辨析 / 语法当日清单）保持旧顺序，次日才对齐。
改设定（`LevelSetup`、`recalibrateLevelStartingPoint`）会触发 `refreshTodayWordPlan` + `refreshMixedCardTasks`，所以只有「纯升级代码」这一种路径漏。
作者自己库里 10-28 的单词表是 12 个 N3 + 13 个 N4（对得上修复后的顺序），说明至少这天已重排。

**M4. 目标存了两份**：`getStudyPreferences().jlptTarget`（localStorage）和 `app_state.jlpt_plan_target`。
`saveStudyPreferences` 会同步后者，`level-plan` 云合并后反向恢复前者；任一边漏同步就会出现「备考页说 N4、出题按 N3」。当前没发现漏，但这是第二个可以分叉的点。

**M5. 页面级默认**：`JlptPracticePage.tsx:26` 默认 = 目标级（起点 N5 的人进刷题看到的是 N3 题）；
`GrammarQuiz.tsx:44` / `grammarPreferences.ts` 默认 N5（和计划无关）；`DuelPage.tsx:31`、`TeamPage.tsx:54`、
`cloudflare-sync/src/index.ts:2436` 默认 N3。都是用户可改的入口，但第一眼就和计划对不上。

### 低

- **L1. 无级别词排第 0 档**（`plan-level-order.ts` `ELSE 0`）：无级别的词（自定义词、基础词）对所有人都排在最前。
  现在真实库里无级别词为 0 条，但**导入词表（`word-list-import.ts`）会产生**；语义上「基础词先补」是对的，别无意中变成「用户导入的 1000 个词压过 N4」。
- **L2. 词汇量测试的 `LEVEL_WEIGHT`**（`vocab-test.ts:619`）是按出厂各级词数算的 Neyman 权重（N5 261 / N4 334 / N3 934 …），
  词库增减后不会自动更新；对测试结果无方向性偏置，只是权重会过期。
- **L3. `content-matrix.ts` 的 `CONTENT_BY_LEVEL`** 是写死的各级内容量（N3 单词 2096 等，和出厂库 1906 不同是因为含启动迁移），有测试守着；
  辨析量（8/33/58/91/154）是「可出题」的组数，而 `confusion_progress` 里是 20/48/110/291/540（含不可出题的同义组），口径不同但有意。
- **L4. 辨析在低级别很薄**：可出题组 N5 仅 8、N4 仅 33，起点 N5 的人辨析一周内就见底（之后顺推到 N3 的 58）。内容量问题，不是逻辑问题。
- **L5. `talk/cards.ts:70`** 无级别的填词按 3（N3）算难度，只影响挑哪组填充词。
- **L6. 淘汰的原生小程序**（`wechat-miniprogram/src/pages/*`）有自己的 N3 默认（组队、每日计划）。按记忆它已淘汰，只跑它的 `npm test`，不用改。
- **L7. 文案**：`TeamPage.tsx:511` placeholder「例如：N3 每日打卡」；两条语法解释里写了「见 N3」，是内容事实，不用改。

## 查过、没问题的（别重复查）

- 单词新词、混合模式语法、汉字字卡、辨析的投放：已走 `plan-level-order.ts`（17c0f468），`newWordOrderSql` 的三个入口（任务表 / 加餐 / 兜底）和 `word-api.ts` 的两处都用同一份。
- 主页角标 / 小路 / 备考页 / 圆环：`PLAN_GRAMMAR_LEVEL`、`levelsInScope`、`remainingPlanWords` 口径一致。
- 单词音频：各级总量覆盖全库（每声音 11,801 条 ≥ 去重后的词数）；例句音频 11,683 条。
- JLPT 刷题题库：五级各 6 套、5 篇长文，N5/N4 带全文注音，题量 N5 264 / N4 325 / N3 345 / N2 365 / N1 270（按考纲结构，不是 N3 独大）。
- 语法：各级条目数 127/136/146/155/205，字段齐。人工题面表 `MANUAL_GRAMMAR_QUESTIONS` 只有 21 条，是例外清单而不是覆盖表。
- 开口练习（talk）：场景不分级；拼写（spelling）：不挑级别；词汇量测试：按级分层抽样，方法本身对级别中性。
- 小程序（Taro）：数据层从网页源码打包，投放逻辑同一份；`taro-spike-2/src` 没有自己的 N3 字面量。

## 建议（按优先级；都没动，等作者定）

1. **收成一个模块**（治根）：新建 `lib/jlpt/levels.ts`，只放 `LEVELS`、`levelIndex()`、`levelRankSql(column, { base, unknown })`，
   再放一个 `planScope()`（= 落库起点 + 目标 + 每类熟悉度，即现在 `plan-level-order.ts` 做的事）。上面那十几份映射和 `?? 2` 全部改成引用。
   再加一条测试：grep 源码里 `WHEN 'N5' THEN` 与 `{ N5: 0` 只允许出现在这个文件。——否则下一个新入口还会各抄各的。
2. **汉字单元模式接进计划**（H1）：目标改成跟 `jlptTarget` 走（设置里那个单独的目标条要么删要么改成「跟随计划」），
   排序加「起点以下降权 / 计划范围内按级别顺推」，用 `currentPlanLevelRanks("kanji")`。需要作者拍：这个模式是想「按计划」还是「想练哪个练哪个」。
3. **默认目标**（M1）：设定页第 2 步别预选 N3（或预选「起点上一级」），或至少不高亮成已选；`studyPreferences` 的默认值保留 N3 但注明只是兜底。需要作者拍。
4. **例句难度**（M2）：对 N5 / N4 的 912 + 846 条例句做「超纲词」筛查并重写（可以委派 sol 出清单、luna 重写、再抽查）。
   判据建议：N5 例句里不出现比 N4 更难的词（专有名词、数词除外）。需要作者拍要不要做，以及是否接受例句变短。
5. **加一个投放矩阵测试**：参数化「起点 ∈ {kana, N5, N4, N3, N2} × 目标 ∈ {N4, N3, N2}」，对每个新内容入口（单词三入口、语法、汉字字卡、辨析、汉字单元）
   断言第一批新内容的级别。`plan-level-order.test.ts` 现在只测了 N5 起点 + N3 目标这一格；矩阵测试能让「忘了接计划」的入口直接红。
6. **STAGE1_PLAN_VERSION**（M3）：下次再改投放顺序时顺手 bump 一下，让当日未作答的表重排。这次是否补，看作者当天有没有人撞上。

## 未提交 / 他人改动提醒

主目录工作区有另一会话未提交的 `level-advance.ts`（升级提示，读 `currentFirstPlanLevelIndex` 与 `jlptTarget`）、五十音改动等；本次普查没改任何代码，只新增本文件。

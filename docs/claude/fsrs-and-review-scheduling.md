# FSRS、复习排程与语法题

## 答一次题该做多少事（2026-09-06 大修）

实测起点：真实库（46,618 条 reviews / 2,522 个学过的词）上**点一次评分，主线程同步
阻塞中位 549ms**，每 50 次作答里有一次冻 **4~6 秒**，再加上 2 秒后一次 100~510ms 的落盘。
改完是**中位 73~79ms、80 次里最大 153ms**，落盘那一下从 35.9MB 变成几 KB。

根因只有一条：**「记一次账」被绑成了「重算全应用状态 + 重写整个数据库」，还全挤在
keydown 的同一个同步 task 里**（`submitWordAnswer` 是同步的，后面那串 `await` 等的都是
已 resolve 的 promise，微任务在同一个 task 里跑完）。四条改动，每条都对应一个「全量」习惯：

| 改的 | 之前 | 现在 |
|---|---|---|
| `ensureProgressInitialized` | 每答一次跑 **6 遍**（每遍 11,740 行的全表 INSERT OR IGNORE + 全表 UPDATE words），115ms | `oncePerDatabase("word-progress")`，一个库一次 |
| `getWordStats` | 30 个统计字段全算好再返回，每答一次算 **2 遍** | 首页才看的字段改成惰性 getter，读到才算 |
| `getProgressOverview`（App.tsx） | 挂在 PROGRESS_UPDATED 上无条件重算，学习页里也算 | 看不见就记脏标记，回到首页再补 |
| `updateMemoryProfileIfNeeded` | 在答题路径上，每 50 次触发一次全量历史聚合 | 整个摘掉，只由统计页算；SQL 本身改写成窗口函数 |

合计：**每次作答的 SQL 从 318 条 / 536ms 降到 102 条 / 69ms**。

⚠️ **「幂等」不等于「免费」。** 那 6 遍 `ensureProgressInitialized` 是十几个 API 入口
各自「反正它幂等，调一下保险」调出来的。闸门用 `oncePerDatabase`（`database/db-utils.ts`）
按 **db 实例**记，不是模块级 boolean —— 同步合并、恢复快照、导入备份都会换掉 db 实例，
那时候必须重跑。同一个实例上新增了 words 行（词单导入）要由那条路自己补 progress 行。

⚠️ **`getWordStats` 别改回「先全算好再返回」。** 学习页每张卡只读
stage1Progress / dailyRelief / stage1Done / dailyPlanDone 这几项；30 天曲线、打卡表、
全库 COUNT、反向和汉字的当日计划都是首页才看的。惰性字段算完就记住，所以首页拿到的
仍然是同一时刻的一致快照。**减负和压轴（`ensureDailyRelief` / `ensureDailyTail`）
必须留在立即算那一档** —— 它们带写，是「今天该给你什么」的一部分，不是展示用的统计。

⚠️ **记忆画像（adaptive.ts）不参与任何调度，别再挂回答题路径。** 它自己的注释就写着
「只用于统计页展示」。代价是从不打开统计页的人，画像停在上次打开时的值 —— 不影响出题。
里面两条相关子查询已换成窗口函数（保持率 3.8s → 约 0.4s），
`adaptive.test.ts` 里**抄了一份旧 SQL 当基准对拍**，改口径必须两边一起动。

### 预算下一张：点下去之前就算好，记账挪到换卡之后（2026-09-26）

iPhone 小程序里点一次「认识」要 330–440 ms（JS 和 SQLite 的 wasm 都是解释执行，其中 SQL 约 180 ms）。
桌面 Node 上从真实库出发每题约 8 ms / 62 条 SQL。用户原话：「不是点了认识不认识再去算下一个，
在用户还在看题看答案的时候就已经要开始算了」。现在：

- **看这张卡的时候先算好**（`word-api` 的 `startAnswerPreviews` / `addAnswerPreview`）：在 SAVEPOINT 里用
  **正式的**作答和选卡代码真的把「答成认识」「答成忘记」各走一遍、选出下一张，然后整个回滚。
  ⚠️ **别改成「模拟作答之后的状态」**：下一张依赖重刷排队、今天完成了几个、最近连错几个词、新词保底、
  顽固词当场接着刷，全在库里，模拟漏一项预算就和真选的不一样。会话状态（当前卡 / 排队 / 上一张 / 撤销栈）
  都在 `app_state`，回滚一并还原。回滚管不到的：同步派发的 `PROGRESS_UPDATED`（`withProgressEventsMuted` 压住，
  不压的话小路会把回滚前的假进度画出来）、`persistSoon`（回滚后才排保存，存的是原样数据，无害）。
- **点下去**：有预算就直接换卡（按键处理 0.5–1.5 ms，原来 12–22 ms，桌面实测），记账（`submitWordAnswerWithPreview`）
  等这一帧画出来再做（`afterPaint`：rAF + 50 ms 兜底，页面藏起来时 rAF 不跑，不能让记账跟着停）。
  模糊借「忘记」那份、熟知借「认识」那份——两种答法之后候选池只差当前这张，但收尾阶段（剩余 ≤ 一成）当前这张
  可能被再出，那时不借（`sharedWithinClass`）。
- **走同步路径的情况**：没算好、预算作废、这一下要插语法卡、「忘记」会打开错题回顾（预算里顺带判过）、今天学完了、
  压轴 / 错题回顾 / 汉字单元。同步路径就是原来那条，行为不变。
- ⚠️ **作废判据是 `SELECT total_changes()`**：预算之后库里有任何写入（学习时长每分钟结账、成就、柚子）就不用。
  **sql.js 的 `export()` 会关掉再重开连接，total_changes 清零**——整库落盘（网页 5 分钟一次、开发环境镜像 20 秒一次）
  之后预算全部作废。安全的一侧，但作废了没人重算，所以**翻面那一下**（`revealAnswer`）发现预算不新鲜就后台重算：
  从翻面到评分通常至少一秒。
- ⚠️ **记账挪到换卡之后，所有碰当前卡的操作都要先 `flushPendingAnswer()`**：下一次评分、撤销、跳到相似词、换模式。
  漏了的话，撤销撤的是再前一题（实测：立刻撤销应当回到刚答的那张）。
- 挑卡查询顺带瘦身：只读挑卡用得到的列，挑中那一张再按 id 取完整卡（`pickedCard`）。原来 `w.*` + 便签整行读
  今天所有到期卡（作者库 522 行、带例句 / 振假名 / 释义长文本），占每题 SQL 时间一半多。
- 判据在 `word-api/answer-preview.test.ts`：预算完库（进度、流水、任务、app_state、墓碑）一个字不变、不派发事件；
  认识 / 忘记的预算和真答完选出的逐步一致（同一串随机数种子）；借同类答法的那张真答完之后仍是合法候选；有别的写入就作废。
- **还没做**：iPhone 真机前后对比。剩下的点击开销是 React 渲染新卡（桌面 6–14 ms），Taro 下是 setData 约 4 ms + 协调。

## 复习算法：只有 FSRS（2026-08-01 起）

**单词、汉字、语法三个阶段统一由 `ts-fsrs`（Anki 同款 FSRS）调度。自研的 score / 连胜梯子 / 回归模式已整体删除，别再往回加分数。**

- `fsrs-scheduler.ts` — 算法本体（与实体无关）：评分映射、学习步骤、leech 阈值、`isMastered`
- `fsrs-store.ts` — 状态持久化，泛化成可挂任意表：`WORD_FSRS`(progress) / `KANJI_FSRS`(kanji_memory) / `GRAMMAR_FSRS`(grammar_progress)
- `word-api/stage1.ts` — 当日任务表生成；`scheduler/priority.ts` — 出题优先级
- `review-budget.ts` — 每日复习上限、续杯批量、疲劳检测

⚠️ **`isGraduatedForDay` 不能只比 due 和学习日边界**（2026-09-10 修）。
学习日边界是凌晨四点：03:55 答「忘记」，重学步骤把 due 排到 04:05 —— 越过了边界，
于是它被当成「今天已毕业」，这一场里再也不出现。用户点了忘记却等不来那次确认，
而 FSRS 那边这张卡明明还停在 Relearning 的第一步。
现在 **Learning / Relearning 一律不算毕业**：那两个状态下 due 永远是下一个短期步骤，
不是真正的复习间隔。判据在 `fsrs-scheduler.test.ts`。

## 语法考题：和单词同一套 FSRS（2026-08-27 改）

`lib/grammar-quiz.ts` + `pages/GrammarQuiz.tsx`。入口在语法列表页工具条的「考题」，
和「沉浸学习」并排。**题面是句型，答案是接续 + 中文意。**

**语法是第四个走同一条流水线的阶段**（正向 / 反向 / 汉字读音 / 语法）：
FSRS 到期集 → 当日复习上限 → 新语法配额 → 学习步骤（没毕业就当天隔几张重刷）
→ 往 `grammar_reviews` 记流水。作答那一段和 `word-api/direction-answer.ts`
一字不差，包括**当天首答点认识按 Easy** 和顽固卡的三步重学。

⚠️ **上一版写着「刻意不上 FSRS，一个等级只有一百来条」，那条理由是错的。**
它只在「第一次过一遍」的时候成立 —— 洗牌洗的是顺序，不是「哪些今天该复习」，
所以第二轮开始每次都得把已经记牢的一百多条重新点一遍，真正忘掉的那几条淹在里面。
条数少不改变遗忘曲线的形状。

- 数据落 **`grammar_progress`**（数字 grammar_id，和 `grammar_points` 同一套 id）
  的 `fsrs_*` 列 + `grammar_reviews` 流水。两张表本来就接了云同步，
  `jlpt/status.ts` 和 `progress-api.ts` 早就在按 `p.fsrs_due` 查语法了 —— 改完它们才有数。
- **刻意没建当日任务表。** stage1_tasks 是给八千词做物化的；语法一个等级一百来条，
  「今天该做什么」现算一次几毫秒，「今天做过什么」由 `grammar_reviews` 说了算。
- **新语法配额走自己的旋钮 `preferences.grammarDailyGoal`（默认 5 条/天，2026-09-06 改）。**
  原来蹭的是单词的 `dailyGoal`，那是错的：一个等级只有一百来条，按每日新词 15 排
  等于八天过完一级，而一条语法要记的是接续 + 用法，不是一个词形。范围 [0, 30]，
  **0 = 今天只复习学过的，不进新条目**（单词那根滑杆下限是 5，语法允许停）。
  和单词各排各的一份、互不挤占；复习上限仍然共用 `reviewCap`（那是「一天最多复习多少」
  的唯一旋钮）。判据钉在 `grammar-quiz.test.ts`。今天的过完了
  想继续走「再学 10 条」（`extendGrammarQuizPlan`，把当天配额抬高，记在
  `grammar_state` 的 `quiz_encore:<等级>:<日期>`），不自动往后借明天的账。
- 评分四颗：忘记 / 模糊 / 认识 / 熟知，V/B/N/M，和单词学习共用
  `answerOptions` + `answerHotkeyLabels`。**「模糊」以前不摆是因为没有调度器接
  Hard 档**，现在有了。
- 重刷队列和「刚答过的别连出」共用 `word-api/session-state`，方向键叫 `grammar` ——
  那条通道上队列项里的 `word_id` 装的是 grammar_id。
- 没有排片器：干扰隔离靠「同混淆组」，而语法点没有那份数据。
- 「错得最多」那份列表还在（按 `forgot_count` 倒序），现在只是攻坚入口，不再是唯一的算法。
- 等级选择器长在考题页自己身上，不沿用列表页那个可以选「全部」的筛选：备考是按等级来的。

### 语法「抓手」：一句 ≤20 字，说这条最容易错在哪（2026-09-08）

`src/data/grammar_key_points.json`（741 条，人工逐条写）+ `lib/grammar-key-points.ts`。
显示在语法考题卡（翻面后，接续和中文意之下、例句之上）、语法辞典、语法库、沉浸阅读四处。

⚠️ **它不是「把解释缩短」，是「说解释里没说的那一点」。** 重写之后的 `explanation`
本来就短（**中位 49 字、p90 59 字、最长 72 字**），在 49 个字里再划三个字收益接近零。
真正累的是**四个字段 × 741 条在同一屏上等重摆开**，没有主次。所以抓手写的是
「这条最容易错在哪」——`ではない` 不是 `ではありません`、`ことにする` 是自己决定而
`ことになる` 是别人定的、`しか` 后面必须接否定。判据是「删掉它，这张卡还剩什么」。

- **键是 `grammar_points` 的 `pattern`，不是 grammar.ts 的字符串 id。** 语法考题卡
  （`GrammarCard`）拿到的只有 DB 那一行，学习页拿到的是 grammar.ts 的 point ——
  用 pattern 当键两边共用同一份，考题卡也就不用为了查一句抓手把 1.5 MB 的
  grammar.ts 拉进自己的包。重名的 14 条在 `aliases` 里存 id → 带后缀的 pattern。
- ⚠️ **故意不进数据库、不进 `grammar_seed`。** 它是内容不是用户状态；加一列就要动
  `ensureGrammarSeed` 那条会掉条目、会删用户进度的迁移路径（见下一节），
  而这份 JSON 换一版只是换个文件，没有迁移、不用升种子版本。
- ⚠️ **也绝不要写进 `grammar_highlights`。** 那张表是**用户自己划的重点**：走云同步、
  按 block + start/end 存、带 `GRAMMAR_HIGHLIGHT_DATASET_VERSION` 失效检测、上限 500 条。
  混进去的后果是「用户清空自己的重点会把系统的一起清掉」，以及每次内容改版给每个人
  糊几百条「此重点已失效」。
- 样式一份：`.grammar-key-point`（辞典 / 语法库 / 沉浸阅读三处共用）。
  **浅色主题单独沉一档**（#81D8CF 在奶油底上读不动，同振假名标注那条）。
  考题卡不用这个类 —— 那张卡的颜色由调用方通过 `--quiz-accent` 传进来
  （考题页青绿 / 混合模式琥珀），写死就破了那条口径。
- 体检在 `grammar-key-points.test.ts`：741 条一条不缺、都在 20 字以内、
  **重名的两条不许串成同一句**（やる 在 N5 是「做，比する随便」、在 N4 是「给晚辈」，
  按 title 查会并成一条）。

### 接续标在题面每个 `～` 的头上（翻面后）

`grammar-formation.ts` 的 `patternAttachment`。`～` 是这张卡真正的坑，光在答案区
写一行接续，眼睛还得自己把「名词／用言普通形」和句型里的哪个 `～` 对上号。

`formation` 是人写的说明文不是可解析的语法，所以原则是**宁可不标**（判不准返回 null，
下面那行完整接续照旧）。出厂库 741 条里 554 条标得出来。四条判据：

1. 题面得有 `～`、接续得有 `＋`（没 `＋` 的是整句说明，不是「A ＋ 句型」的形状）；
2. 取 `＋` 前第一段；它自己不能再含 `～`（`～が／は＋他動詞て形` 说的是助词）；
3. ⚠️ **它不能和题面的字面部分互相包含** —— `もう～`、`お／ご～になる`、`なにしろ～から`
   的第一段是 もう／お／なにしろ，那是句型自己的一部分，标上去就成了「往 `～` 里填 お」；
4. ⚠️ 多个 `～` **只认叠用**（`～にしろ～にしろ`：字面两两重复、接续只有一段）。
   `～から～にかけて`、`～ば～ほど` 两个坑填的不是一个东西，把第一个坑的答案抄到
   第二个头上比不标更糟。
   两条独立规则写在一起的那 55 条走 `splitFormationRules` 各取一段再并起来
   （`動詞て形／動詞ない形`），只取头一段会把另一半说没了。

⚠️ **标注是绝对定位的，不占行内空间** —— 句型自己的排版和换行一个字都不变。
真拿 `<ruby>` 做的话，`名词／用言普通形` 会把那个 `～` 的基字撑到一百多像素宽，
四个 `～` 的叠用句型在手机上直接散架。代价是容器要留出上方空间和行距
（`.grammar-pattern--annotated`）。颜色走橙色系区别于振假名的绿，
**浅色主题单独沉一档**（#E8971C 在奶油底上只有 2.2:1，11px 小字读不动）。

⚠️ **翻面前不标。** 接续正是这张卡要考的一半，答题前摆出来就是给答案。

⚠️ **语法有两份进度，别混用。** 列表页的「熟悉/没记住」在 `hooks/useStudyStore` 的
**localStorage** 里，按 grammar.ts 的**字符串 id**（pdf-n3-010）存，**不同步**；
考题这份在 `grammar_progress`，**数字 id**，同步。两边桥接要靠 pattern 匹配，而
两份 id 体系不同，所以现在**没有合并**，考题是自成一套的。
（seed 和出厂库的 741/731 那条已于 2026-09-08 修掉，见下一节；
但列表页那份 localStorage 进度和 `grammar_progress` 仍然是两本账。）

### 混合模式（单词 + 语法，2026-09-05）

`STUDY_MODES` 的 `mixed`：今日计划照旧，**每答 `MIXED_GRAMMAR_EVERY`(5) 个单词插一条语法**。

- **没有第二套语法逻辑。** 插播出的是 `getGrammarQuizSession` / `submitGrammarQuizAnswer`
  ——语法考题页那同一副牌（同一份 `grammar_progress`、同一个当日计划和新条目配额、
  同一套 FSRS 和重刷队列）。在哪边答的都算数，两处进度天然是一份账。
- **卡片也只有一份**：`features/grammar-quiz/GrammarCard`，考题页和混合模式共用
  （连键位一起）。**差别只有颜色**：考题页走全应用的青绿，混合模式走琥珀
  （`QUIZ_ACCENT_AMBER`，和接续标注的橙同一系）。配色靠 CSS 变量传 ——
  Tailwind 的 hex 是静态字符串，塞不进变量，所以 hover 那一档在 `styles.css`
  的 `.quiz-accent-btn` 里。
- ⚠️ **语法卡是「盖在」单词卡上面的**，不改单词那边的任何状态：下一张单词卡照常排好摆在
  底下，答完清掉就接着背词。所以插播不需要碰 stage1 的取词、减负、压轴、当日回顾。
  代价是 WordStudy 的全局键盘监听得让开（`grammarCard` 在时直接 return，
  键位归 GrammarCard 自己那一套）。
- **等级跟着备考目标走**（`preferences.jlptTarget`），不给第二个等级选择器——
  多一个旋钮就多一处口径，而「我在考哪一级」设置页里已经答过了。
- 语法今天过完了就不插，也不借明天的账（想多学去考题页点加餐）。反过来，**单词今天背完
  之后剩下的语法会接着上**，两边都空了才算今天完成（`loadNext` 里的 `grammarTail`）。
- ⚠️ **首页角标 `modeCounts.mixed` = 词数 + 今天还欠的语法条数**（`stats.grammarRemaining`，
  走 `grammarPlanRemaining`，不抽卡只数数）。第一版只报词数，结果是混合和经典在主页上
  写着同一个数 —— 多出来的那部分工作量在界面里根本不存在。单位因此从「词」换成「项」，
  大卡脚注那一行也从「新词 · 复习」换成「单词 · 语法」（两栏加起来仍等于大卡的合计）。
- ⚠️ **「上一个」必须按作答顺序分派（2026-09-05 修）。** 单词和语法各有一份互相不知道
  对方存在的撤销栈（`last_answer` / `quiz_undo:<等级>`），而学习页的撤销一直只调
  `undoLastWordAnswer`。于是答完一条语法再点「上一个」，撤掉的是**语法之前那个单词**：
  语法留下一次不该留的作答（FSRS 已推进、流水已写），单词丢掉一次该留的 ——
  **一次误操作造两笔假数据**，而按钮还亮着，看着像正常工作。语法卡显示时整页被顶掉、
  工具栏跟着不在，所以那会儿连撤都撤不了。现在 `WordStudy` 记一小段 `undoKinds`
  （只在内存里，长度同 `UNDO_LIMIT`）按栈顶分派，语法卡自带一颗撤销按钮。
  ⚠️ **混合模式下只撤这一次进页面之后答的**：顺序不落库，退出再进来就没了，
  这时按「word」去撤等于把同一个 bug 换个入口复现。判据在 `mixed-undo.test.ts`
  （⚠️ 它跑的是被调用的那两个函数；分派本身在组件里，仓库没有 testing-library，覆盖不到）。
  ⚠️⚠️ **语法卡还摆在屏幕上时，栈顶那一笔一定是单词**（`submitAnswer` 先压栈、再
  `maybeGrammarTurn`）—— 所以点语法卡右上那颗撤销走的是单词分支，撤掉的是语法卡**底下**
  那张单词卡：库里退了、屏幕纹丝不动，看着就是「上一个不能用」（2026-09-06 报）。
  现在单词分支里顺手把插播收回去（`setGrammarCard(null)` + 计数退回
  `MIXED_GRAMMAR_EVERY - 1`）：那次作答不算数了，插播也不该被它提前用掉。
- **松鼠轨道在混合模式里数「单词 + 语法」**（2026-09-06 改，原来只数单词）。
  原因和首页角标那条一样：角标、大卡脚注早就按合计在说话，小路只数单词的话，插播那几条
  语法答完顶上纹丝不动，而分母还比大卡小一截 —— 两个数字当面打架。分子分母各自加上
  `stats.grammarDone` / `+ grammarRemaining`（`SquirrelTrail` 的 `mode === "mixed"` 分支）。
  ⚠️ **只有混合模式这么算**：经典模式那条路仍然是 `stage1_tasks` 的物化，语法不掺进去。
  ⚠️ 代价是学习页每答一次多两条语法当日计划的 SQL（`grammarPlanDone` / `grammarPlanRemaining`
  都是惰性字段，但小路每次 `PROGRESS_UPDATED` 都会读到它们）。

## 语法考题：「A／B」两个写法不能互相推出来的，拆成两条（2026-09-18）

用户报的是 `～てしかた（が）ない／てしようがない`：看到前一个就点了认识，后一个其实不会。
一张卡两个写法、一套 FSRS，等于用 A 的熟练度给 B 记账。

**242 条带 `／` 的标题逐条看过，拆了 26 条（→ 54 条，741 → 769 行）**，记录在
`frontend/scripts/grammar-variant-splits.json`（连新条目的正文、例句、抓手一起），
由 `scripts/apply-grammar-variant-splits.mjs` 一次性写进 `grammar.ts` 和抓手表。判据：

| 拆 | 不拆 |
|---|---|
| **换了词**：しかた／しよう、なんか／なんて、もちろん／もとより、いうものの／言い条、や／や否や、いらっしゃる／おいでになる | 活用变体：にあたって／にあたり、ごとき／ごとく／ごとし、というと／といえば |
| **敬语对**：あげる／さしあげる、もらう／いただく、くれる／くださる（含 て 形三对）、どう／いかが、誰／どなた、たち／がた、かな／かしら、だろう／でしょう、なぜ／どうして／なんで | 通则变体：ず／ないで（ずにはおかない／ないではおかない）、しろ／せよ、濁音（くらい／ぐらい、とおり／どおり）、缩约（ておく／とく、てしまう／ちゃう、やしない／はしない） |
| **一张卡两个意思**：かねる／かねない、次第／次第だ、だけあって／だけに／だけのことはある、にたえる／にたえない、うちは／ないうちに | 肯否对（得る／得ない、わけがない／わけはない）、范式（これ／それ／あれ／どれ、お／ご～） |

没拆但想过的：`見える／お見えになる`（拆出来的「見える」单独当题面只会被当成「看得见」，
合着写反而把「来る 的尊敬语」这层意思带出来了）、`極まる／極まりない`（同义，只是形似否定）、
`なくてはならない／なくてはいけない`（ならない／いけない 这对在 146/147 已经各有一条）。

拆的机制全走既有的内容管线，**没有第二套「子卡」**：

- 旧条目改成第一个写法、保留 id 和进度；第二个写法是新条目（id 形如 `pdf-n3-061-2`，
  bookOrder 紧跟原条目，后面全部顺延）。**新条目从零开始** —— 拆的理由正是 B 不该继承 A 的
  FSRS 状态。升版本时旧名 → 新名由 `study-core.ts` 的 `GRAMMAR_PATTERN_RENAMES` 接住，
  不登记的话旧进度会被当成「新版本里已不存在的语法点」删掉（`grammar-seed.test.ts` 钉着）。
- `～とは` / `～なんて` 在 N3（定义 / 轻视）和 N1（吃惊）各一条，N1 那条拿到 `（N1-2）` 后缀，
  重命名表里写的也是带后缀的。**题面上后缀一律摘掉**（`grammarQuizQuestion`）——
  它只是 UNIQUE 约束需要的，露出来先把等级说出去；抓手表按后缀 pattern 各拿各的。
- 新例句没有预生成音频（文件名是句子哈希），运行时退到系统 TTS。
  要补：开 VOICEVOX 跑 `node scripts/build-example-audio.mjs`，只补缺的。

### ⚠️ 顺手查出：重建出来的 grammar_id 从来没和新装用户对上过

`ensureGrammarSeed` 是 `DELETE FROM grammar_points` 再 INSERT，而 AUTOINCREMENT 在
DELETE 之后接着上次的最大值往下编 —— 实测作者自己的库重建九次后 id 落在 **6600~7340**，
新装用户是 1~741。`grammar_progress` 正是按数字 grammar_id 跨设备同步的，
「words / grammar_points 这类出厂内容两端一致」那条前提一直是假的。
现在重建前 `DELETE FROM sqlite_sequence WHERE name = 'grammar_points'`，
出厂库那边 `build-furigana.mjs` 改成按 grammar.ts 整表重建、显式 `id = bookOrder`，
`verify-release-db.mjs` 钉住 `id == sort_order == 1..N`。
**增删语法条目只改 grammar.ts，别手工往库里 INSERT** —— 两边各自按同一个顺序编号才对得上。
重建时顺手清掉 `quiz_undo:*` 和 `review_queue_grammar`：里面存的是旧 id，按旧 id 撤销会
删掉一条已经迁走的流水，计数却退不回去。

### ⚠️⚠️ 用户 dev server 开着的时候，工作区里的任何「回退」都是一次降级重建（2026-09-18 踩到）

这次拆分落地时我在用户正学着的 5173 dev server 底下跑了一次 `git stash` / `git stash pop`
（只是为了确认 lint 警告是不是原有的）。stash 那十几秒里工作区退回 HEAD：
`grammar_seed.json` 是 741 行的旧版、`study-core.ts` 没有重命名表 —— 页面热重载，
`ensureGrammarSeed` 看见「库版本 ≠ 常量」就按**旧种子**重建了一遍：新标题在旧种子里找不到，
**用户当天在 3 条拆分语法上的作答（流水 1289–1291）连同 progress 一起被删掉了**；
pop 回来再重建一次，已经没有东西可迁。`grammar_points_archive` 里那一代
`2026-09-18` 标签的 769 行就是这次降级留下的痕迹。

判据：**只要用户的 dev server 在跑，就不许 `git stash` / `git checkout -- <src>` /
改 `grammar_seed.json`、`study-core.ts` 这类会触发内容迁移的文件**。要验证「这些警告是不是
原有的」，用 `git worktree` 另开一份，或者 `git show HEAD:<file>` 比对。
迁移本身没有回滚路径 —— 删掉的行只有云端上一代快照里还有（如果开了云同步）。

## ⚠️ 语法种子升版本会走一条从没跑过的代码路径（2026-08-23 踩到）

`ensureGrammarSeed` 只在 `grammar_state.dataset_version != GRAMMAR_SEED_VERSION` 时才跑。
从写下来到 2026-08-23 版本一次都没升过，于是里面那条 INSERT **14 个列名配 13 个占位符**
一直没被发现。真升一次版本的结果是：每个已安装用户启动时崩在 `initDatabase`，
界面显示「本地词库读取失败」—— 一次内容更新把所有人的 App 变砖。已修，
回归测试在 `grammar-seed.test.ts`（强行写入一个假版本号，跑完整条重建路径）。

### ⚠️ seed 和出厂库曾经用两套重名消歧写法（2026-09-08 修）

**`grammar_seed.json` 一度只有 731 行，而出厂库 `public/nihongo.db` 是 741 行。**
根因不是「少了 10 条」，是**两边各用一套 pattern 重名消歧**（`pattern` 有 UNIQUE 约束，
而 grammar.ts 里有 14 组同名语法点分布在不同等级）：

| | 重名的第二条写成 |
|---|---|
| 出厂库（`syncGrammarDbContent`） | `やる（N4-2）`、`～をよそに（N1-2）` |
| 旧 seed | `やる（N5・做（比「する」语气更随便））` |

`ensureGrammarSeed` 是**按 pattern 字符串**把用户进度迁到新 id 的，两套写法谁也对不上谁。
真升一次版本的后果：**16 个语法点从老用户库里消失**，它们上面的
`grammar_progress` / `grammar_reviews` / `grammar_mistakes` 被末尾那句
`DELETE ... WHERE grammar_id >= OFFSET` 一并删掉（archive 只存 grammar_points 内容，
不存进度，删了回不来）；而且出厂库自己的 `dataset_version` 已经是新值，
**新装用户走 early return 保留 741 条、老用户重建成 731 条，两边 grammar_id 从此错位** ——
`sync/tables.ts` 里 `grammar_progress` 正是按数字 `grammar_id` 同步的，
那行「words / grammar_points 这类出厂内容两端一致」的注释就是这个前提。

现在 seed 改成**和出厂库逐行同构**（741 行、bookOrder 顺序、同一套 `（N4-2）` 后缀，
生成代码在 `build-furigana.mjs` 写 `grammarRows` 那一段），升版本对老用户是无损重建。
闸门在 `verify-release-db.mjs`：**逐行比对 seed 和 grammar_points 的 13 个字段**，
差一行就拒绝构建。

⚠️ **自愈判据后面还有一道闸，别让它把修复挡回去**（2026-09-10 修）。
第一层是「版本戳相等**且** `COUNT(*) == GRAMMAR_SEED_ROW_COUNT`」才早退；
但下一层还有一条 `if (grammarSeed.version === grammarVersion) return`，
它本意是提示「常量落后于 JSON」。**不带「常量确实落后」这个前提的话**，
三个版本号相等、只有条数少了的库会在这里原地 return，还打一句误导的
「GRAMMAR_SEED_VERSION 常量落后」—— 自愈那一层等于白写。
现在的条件是 `JSON 版本 == 库版本 && 库版本 != 常量`。判据在 `grammar-seed.test.ts`。

### ⚠️ 发布校验比对的是 12 个字段,不是 7 个（2026-09-10 补）

`verify-release-db.mjs` 原来只逐行比 pattern / meaning / 首条例句 /
等级 / 排序 / 分词。**语法的文字层(用法说明 `notes`、中文译文 `example_meaning`、
接续 `formation`、辨析 `confusions`)一个都没在比** —— 而那正是 2026-09 为了版权
逐条重写的东西:出厂库和 grammar.ts 在这几列上悄悄分家,谁都不会知道,
因为界面读的是库,而重写记录对的是 grammar.ts。

⚠️ **出厂库和 iOS 那份必须用同一条 SELECT**（`GRAMMAR_TEXT_SQL`）。
两处各写一份列清单的话,加一列就会让「两份库正文不一致」永远成立(列数都对不上)。

（2026-08-23 改 `～うちは／ないうちに` 的释义时就撞上这条：最后**没有升版本**，
改成直接把新释义写进 `public/nihongo.db` 和 `ios/App/App/public/nihongo.db`
——`verify-release-db.mjs` 会逐条比对出厂库和 grammar.ts，两边一致才让构建过。
动过 `public/nihongo.db` 之后要跑 `npm run build:kanji-unit-index`，
那个索引里存着库文件的 sha256。）

## 错题本的阈值必须踩用户自己那条分布的尾巴（2026-08-23 重调）

用户报告「背完一天回首页看到错题 1200 道」。判据本身的形状没问题，**是三个阈值都拍在了
分布的正中间**，于是「错题本」= 学过的词的一半。实测 1,262 个，改完 261 个。

| 信号 | 旧 | 新 | 为什么 |
|---|---|---|---|
| 加权错误率 | ≥ 0.5 | **≥ 0.65** | 判据把「忘记」按 2 倍权重算，而用户忘记率本来就有 25% —— 实测 1,563 个学过的词里加权错误率**中位数正好 0.50**（p25=0.42 / p75=0.55 / p90=0.61）。0.5 选的是「较差的一半」，0.65 才在 p90 以外 |
| 记忆强度上限 | < 60 天 | **< 21 天** | 每三周复习一次的词（stability≈21）是健康的成熟卡，不是错题 |
| FSRS 难度 ≥ 8.5 | 有 | **整条删掉** | 见下 |

⚠️ **别再拿 `fsrs_difficulty` 当判据。** 它是 Again +2 / Hard +1 / Good 0 / Easy −1 的累加量，
均值回归项极弱 —— 只要历史上反复忘过就永久顶在满档，再也下不来。实测用户库 1,927 个
学过的词里 **1,160 个难度落在 9 档、1,023 个顶到 9.5 以上**，光这一条就放出 1,225 个「错题」
（其中 380 个只中这一条）。它正是 `filters.ts` 那段注释自己说要避开的
「只增不减的终身计数器」，只是换了个名字。

留下的两条都是**比例**判据（遗忘占复习的比例、忘记/模糊的加权占比），会随着答对次数
自动降下来 —— 所以错题本会自己变小，是能清完的一批，不是只涨不跌的账。
`word-api.mistakes.test.ts` 里正反两条都钉着：真薄弱的词要进，**表现普通的词（加权错误率
0.60、难度顶到 10）必须不进**。

## 压轴卡：按「记得牢」挑，不是按「此刻回忆概率高」挑（2026-09-01 修）

`word-api/daily-tail.ts`。今天的计划全毕业之后再送 3~7 张轻松的收尾。

⚠️ **老判据 `recall >= 0.82` 排序取前 7 张是错的。** recall 是「距上次复习多久 ÷ 稳定性」
的函数，**刚答过的卡 recall 恒等于 1** —— 于是排在最前面的永远是今天刚复习过、
而且因为老记不住所以复习得最勤的那批。实测用户 2026-08-31 的压轴七张里四张是这么进来的：

| 词 | 看过 | 忘过 | 稳定性 |
|---|---|---|---|
| 別れ | 30 次 | 11 次 | **0.57 天** |
| 虫 | 8 次 | 3 次 | 0.83 天 |
| 鍋 | 12 次 | 4 次 | 1.45 天 |
| 袖 | 9 次 | 3 次 | 3.84 天 |

说好的「轻松收尾」，端上来的是他最不熟的词 —— 用户原话是「现在的简单词好像也在推我
不太熟悉的词」。现在按**稳定性**设闸（`fsrs_stability >= 14` 天，和「昨日减负」那批词的
实际水平同一档：实测减负词 14~21 天），达标的候选**随机取**，不再按 recall 排序；
今天已经答过的词也排掉（那不是「再确认一次」，是一小时前刚做过的题）。
实测用户库里达标候选 870~900 个，够选。

⚠️⚠️ **改压轴的挑法必须同时把 `TAIL_STATE_KEY` 升版**（现在是 `daily_tail_v2`，
和 `daily_relief_v2` 同一个套路）。`ensureDailyTail` 见到当天已有状态就直接返回 ——
第一版改完判据没换 key，用户当天怎么刷新都还是老那七张，反馈是「你的更新我这边没变化」。
**按天生成、存在 app_state 里的东西，改判据 = 换 key**，否则改动要等到第二天才看得见。

⚠️ **答错的压轴卡要挪到队尾重来（最多两次）。** 压轴卡走的是正式 FSRS，答错的那一下
已经写进库里了，界面上却让这个词当场消失、直接进完成页 —— 说好再确认一次却没确认。
「上一个」也要能用：撤销时 `rewindDailyTail` 把队列退一格（连答错时排进队尾的那一份
一起撤掉），并留在压轴模式里，否则撤一下就掉出压轴直接看到完成页。

**顺带一条实测结论（不是 bug）**：用户每天的复习池 288 张里 237 张是「看过 10 次以上、
稳定性只有 4.8 天、平均忘过 4 次」的词。这是 FSRS 的必然结果 —— 记牢的词间隔被拉长、
自然很少露面，每天队列里剩下的当然就是最不稳的那批。他学过的 2,088 个词里 34%
稳定性不到 7 天，那才是「天天见的都是不熟的词」的来源。

## 选词 = 优先级 + 排片，两件事

**「谁更该复习」和「放在序列的这个位置合不合适」是两层，别混在一个打分函数里。**
往 `priorityComponents` 里加项去凑「前 20 张要有几个容易的」，就是在攒互相打架的魔法数字。

- `scheduler/priority.ts` — **谁更该复习**：陌生度（FSRS stability 越低越靠前）、lapses、importance。只看单张卡。
- `scheduler/sequencer.ts` — **排片**：硬约束过滤 + 按优先级加权随机。纯函数，状态显式传入，
  所以能写序列级测试（「任意 12 张窗口内同混淆组 ≤ 1 个」这种）。
- `scheduler/interference.ts` — 混淆组邻接表，三份来源合并：自他动词对（`verb_pair_hints`，368 对）、
  释义相近组（`similar_meaning_groups`，38 组）、音形相近（`confusion.ts` 口径，全库 47726 对 / 覆盖 73%）。
  音近**只在当天候选集内**两两算，按天缓存；绝不能每张卡扫全库。

### ⚠️ 优先级按「有多陌生」排，不按「欠了多久」（2026-09-17 改）

2026-08-04 删自研分数时，「有多该复习」被顺手翻译成「due 过期了几天 × 6」（Anki 默认的
due date 顺序）。它成立的前提是每天清完队列；清不完的话陈年尾巴永远排最前，
昨天刚学的词永远垫底。实测用户库（最近 10 天）：**昨天首见的词 100% 落在当天最后 1/4**
（平均相对位置 0.81–0.96），末段答错率 40% vs 前三段 30%，末段 74% 是重刷。
当天最后剩下没答的 3 张全是昨天的新词、stability 0.01–0.3 天。

用户原话：「欠得久的都是老朋友怎么都有印象，真正陌生的是这几天新学的」。
过期 14 天的卡再拖 8 小时不会更忘（早忘了），stability 0.3 天的会 —— FSRS 作者对积压
场景的建议也是同一个方向（先复习还救得回来的）。现在 `score = 50 × (1 − log₂(1+stability) / log₂31)`：
0.3 天 ≈ 48、3 天 ≈ 36、30 天+ = 0。**欠了多久不再进优先级**（`age` 那项还托着
「太久没见」的底）。**随机抖动从 8 抬到 60**（`JITTER`）：用户要的是「整体偏陌生的先出，
但局部乱序」，8 分抖动对着 0–50 的陌生度等于按分死排。60 分下差 21 分（昨天新学 vs
14 天没见的老朋友）仍有约 76% 排前面，差 6 分的两张接近对半。`priority.test.ts` 钉着「昨天新学 + 昨天见过」必须压过「14 天没见的老朋友」。

⚠️ **顺手查出一条从没生效过的约束**：`pickStage1Next` 的 SELECT 原来不带
`fsrs_stability / difficulty / last_review`，`recallFromRow` 拿不到 stability 就返回 undefined，
于是正向这条路上**每张卡的 recall 都是 0.7 占位值** —— 排片器的「开场减压（recall ≥ 0.35）」
和「连败保护（避开最难的一半）」在经典模式里一次都没真正筛过东西。反向 / 汉字那条
（`direction-plan.ts`）一直是带的。列已补上；别再从 stage1 的 SELECT 里删 fsrs 列。

排片的四条规则（都是「能满足就满足，满足不了就跳过」，永远选得出一张）：

| 规则 | 做法 |
|---|---|
| 干扰隔离 | 同混淆组的词 12 张内不挨着出 |
| 开场减压 | 前 6 张不给顽固词、不给预测最难的 |
| 连败保护 | 连着错 2 个**不同**的词 → 避开预测最难的一半 |
| 加权随机 | 优先级前 6 名按 0.5^名次 抽，取代 argmax（不然最过期的那批连着糊脸） |

**新词保底每 8 张一个**（`NEW_WORD_MIN_SHARE`）。只按「剩余新词 / 剩余总量」穿插的话，
复习积压会把新词饿死：实测用户当天复习任务 232～688 条、新词配额 15，比例只有 3%，
于是一天答四五百张也只碰得到三个新词，配额那 15 个天天剩十二个没见过。
配额的意思是「今天要学这么多新词」，不是「新词占计划的百分之几」——积压是复习的事，
不该由新词买单。（配额本身 = 设置页「每日学习量」里的第一根滑杆，`dailyGoal`，存在 localStorage。）

**主页备考格底下也有一个入口**（`.zoo-goal`，2026-09-06）：一枚 chip
「每日新的 · 单词 15 · 语法 5」，点开是两行档位 chip（档位说法直接用
`INTENSITY_ANCHORS` / `GRAMMAR_INTENSITY_ANCHORS`，不另抄一份）。

- **摆在备考格底下是因为上面那行「还差 新词 50 · 新语法 6」正是按考期算出来的应学量**，
  而旋钮是它的另一半：计划说要 50，你设的是 15。所以盘子里多一颗
  「按 N3 备考计划：单词 50 · 语法 6」，一键把两个数抬到计划值
  （`Math.max`，只往上不往下）。**计划值低于当前设定时整行不出现** ——
  那说明强度已经够，没必要劝人往下调；考前 21 天的收尾期计划值是 0，条件天然不成立。
- ⚠️ **它不是第二份状态**：存的还是 `studyPreferences`，改完发 `PREFERENCES_EVENT`，
  设置页那两根滑杆同一秒跟着动（主页也监听这个事件，所以反过来也成立）。
  **主页只给档位 chip，不放滑杆**：随手改一下用 chip，精调去设置页（盘子最后一行是入口）。
- ⚠️ **改完必须 `refreshTodayWordPlan()`**：新词名额是排计划那一刻定的，
  不重排的话大卡上的数要等到明天才认这个新值。

**设置页的「每日学习量」是独立一节，排在「学习偏好」前面**（2026-09-06 拆出来）。
四个量在一张卡里：单词新词 / 语法新条目 / 汉字读音总题量 / 每日复习上限。
原来它们埋在「学习偏好」里，前面还压着自动播放、动物园音效、显示罗马音三个开关 ——
用户（作者本人）找不到自己在哪调每天背多少词。**别再把新的开关插进这一节**，
它只装「今天给我多少题」这一类的量。

**名额这个数只由用户说了算，三条口径都有测试钉着**（`word-api/new-word-quota.test.ts`）：

| 情况 | 行为 | 为什么 |
|---|---|---|
| 今天复习积压 600 条 | 新词还是 30 个 | 积压是复习的事。名额不因它缩水 |
| 一整天没背 | 明天还是 30 个，**不是 60** | 欠的账只改「先给谁」，不改「给几个」。补作业式的堆积只会让人再也不想打开 |
| 今天只背了 5 个 | 明天那 25 个**优先回来**，补 5 个新的凑满 30 | —— |

第三条 2026-08-23 才修：`newWordOrderSql` 末尾是 `ABS(RANDOM())`，
没背到的词第二天会被重新丢回八千词的随机池，回来的概率和任何一个陌生词一样，
等于「今天没背完」这件事没有任何后果。现在新词名额分三档，档内才轮到随机：
**① 例句词典里点名要的 → ② 排过但没背到的（按第一次排进计划的日期升序，等最久的先回来）→ ③ 全新词**。

顽固词（leech）**不置顶**：`critical` 只给 12 分、`mistake` 封顶 40 分（都远低于陌生度上限 50），
上限装得下全部到期词时每天最多引入 `LEECH_DAILY_INTAKE` 个，集中攻坚交给错题本模式。
失败八次的词是「卡片坏了」不是「复习不够」，加密只会让整场变成受刑。

### ⚠️ 上限装不下时选词是纯随机，不按任何推词逻辑（2026-09-18，用户定的；顽固词闸 09-20 补回）

`fsrsDueWordIds`：**先过顽固词闸**（池子 = 到期非顽固全部 + 随机 `LEECH_DAILY_INTAKE` 个顽固词），
闸后还 > 复习上限 → 在这个池子里 `ORDER BY RANDOM()`，**没有「刚栽跟头优先」、没有 due 顺序**。
装得下时全进，老排序只影响 `order_index`。
⚠️ 09-18 那版是「装不下就随机、闸不生效」，用户 09-20 当场否了（「顽固词有 10 的上限，慢慢来」）：
到期 587 里 243 个顽固词，不先挡的话随机 400 个里四成是它们。**闸永远生效，随机只在闸之后。**
「今天该复习的」这个数也按闸后算（`plannedDueCount` = 非顽固到期 + min(顽固到期, 10)），
圆环的复习建议 / 一键安排用的都是它，不是裸到期数。

理由是模拟出来的（用户真实库前推 180 天，`scratchpad/sim.mjs` 那套）：任何有偏好的选法
都有一批词被结构性饿死——按 due 选，昨天新学的（due 是今天）永远排最后、上限一卡整批掉出计划；
按 stability 选，老朋友 539 个 90 天没见、最长 176 天。随机没有偏好：每个到期词每天被抽中的
概率 = 上限 ÷ 池子，尾巴是随机的。上限 150 + 新词 30、答对率 0.85·R 下，随机的积压反而最小
（3,860 vs due 4,333 / stability 5,973），中位过期天数和 due 顺序一样（17 天）。

⚠️ **顽固词闸（`LEECH_DAILY_INTAKE`）是这个用户积压的全部来源**（2026-09-18 实测）：
此刻到期 220 个学过的词里 **219 个是顽固词**，253 个顽固词 stability 只有 1.3 天、
FSRS 想每天见它们一次，闸每天只放 10 个（加餐那条路没闸，实际 12–34 个），
于是它们永远过期、每次露面 36% 答对率、lapses 继续涨——自我维持。模拟删掉闸：
日均作答 +18%（361 → 426），积压当天清零，顽固词总数不变（两种跑法都 ~770）。
闸本身不减少顽固词，只是把它们藏起来。**用户 09-20 定了：闸留着，永远生效，慢慢来。**

⚠️ **加餐（`startEncore`）那条路还是「due 升序 + lapses 降序」**，没跟着改。

⚠️ **模拟里 150 上限 + 30 新词在任何选法下都超载**（积压 4,000–6,000）。上限不减少工作量，
只是往后推；真正的杠杆是新词随上限收缩（Anki 默认「复习到顶就不出新卡」），
这和上面「名额只由用户说了算」那条冲突，还没动。

例外：顽固词连着错到 `STUBBORN_MISTAKE_STREAK` 时**当场接着刷**，这条走 `pickStage1Next` 里的
早返回，不进排片——排片会把刚答错的词当难词避开，正好把钻研机制废掉。

口径速查：

| 概念 | 判据 |
|---|---|
| 到期 / 薄弱 | `fsrs_due <= studyDayEnd()`，**`fsrs_due IS NULL` 也算到期** |
| 顽固词 | `fsrs_lapses >= 8` |
| 长期低分词 / 错题本 | `filters.ts` 的 `mistakeCandidateSql` / `isLongTermWeak`（两份，改口径要一起改） |
| 已掌握 | 间隔（`fsrs_due − fsrs_last_review`）≥ 180 天 |
| 当天是否再出 | 是否毕业（下次到期越过本学习日边界） |
| 重刷隔几张 | 3~8 张；**长期低分词的毕业判定那次拉到 8~20** |

「毕业判定拉远」的道理：中间步骤隔 3 张再问，答对的是工作记忆，但那没关系——中间答对也不毕业，
FSRS 不会据此拉长间隔。只有「答对就当天出队」那一次会真的改写长期间隔，靠残留答对的话
FSRS 就收到假的「记住了」，把复习排到几天后，然后必然再忘。排不下就尽量靠近，**不留到明天**。

**保留的不是分数**：stage2/汉字的 `temp_score`、`mistake_streak` 是会话内计数器（这一轮过没过、要不要贴脸重复），`sessionScoreDelta` 只服务它们。`progress.score`、`low_history`、`mastered_on`、`reviews.score_after` 是遗留列，**不再读写**。

坑：SQL 模板字符串里注释用 `--` 不能用 `//`；`ensureFsrsColumns` 按 (db, 表名) 记忆化，测试里 DROP/CREATE 同名表要自带 `fsrs_*` 列。



## 名单式快速复习：只当场练，不进记忆（2026-10-14 用户定）

完成页「快速复习今天的顽固词」、周报「复习这些词」都走 `QuickStudyPanel` 的名单模式（`wordIds` / `stubbornQuickIds`）。

- **不写 FSRS、不记专注度。** 这批词当天已经按计划答过，再提交一遍等于同一天给同一个词叠多次评分。
  名单模式的提交只在组件里记「忘记/模糊」，末页提交后这些词成为下一轮，全部认识才结束；练完也不调 `onDailyModeComplete`（那个会切学习模式）。
  `recordStubbornQuickStudy` 记加餐账（柚子/周加餐次数）照旧——那是「做了」，不是「记住了」。
- ⚠️ **这个入口从上线起就没打开过名单。** 网页 `App.tsx` 的 `navigateToPage` 一进 `quick-study` 就无条件把 `stubbornQuickIds` 清成 null，
  而 `actions.startStubbornQuickStudy` 是先放名单再跳页，于是用户看到的是「已学完」的今日快速学习。
  小程序（`taro-spike-2/src/platform/WeappPage.tsx`）早就按「从 word / weekly-report 来的不清」修过；网页现在用同一条判据。
  再加入口往 quick-study 塞名单时，要么从这两页跳，要么同步改两边的判据。


## 语法揭晓时的汉字还原（2026-10-19）

题面继续保留假名，不提前显示汉字记忆提示，防止学习者依赖汉字才认得句型。`GrammarCard` 只在 `revealed` 后、抓手上方显示「假名 → 汉字」和一句中文钩子；例句区不改。语法详情页在抓手旁常驻显示，便于查阅。没有提示就不输出块或占位。

数据增补在既有 `frontend/src/data/grammar_key_points.json` 的顶层 `kanji` 键：`pattern → [假名片段, 汉字片段, 钩子]`。键与 `points` 使用同一份 DB pattern；详情页的 grammar.ts point 通过同一份 `aliases` 处理重名。复用这个 JSON 是为了小程序零接线：继续使用已经声明的 `grammarKeyPoints` 懒加载内容，不增加 JSON、懒加载入口或主包页面 import。`grammarKanjiHint` 只接受长度为 3 且每项都是字符串的数组；未加载的懒代理和异常值返回 null，避免把代理对象交给 JSX 导致整页崩溃。

收录宁缺毋滥：假名必须是 pattern 中原样连续出现的片段；对应汉字必须是同一个词的通行辞典写法，至少含一字汉字，且 pattern 尚未含该汉字。中文钩子不超过 22 字，要从汉字意思连到本条语法的用法，不能只重复释义。不收纯助词、罕用汉字（如「筈」）、多种写法难定取舍或会误导的联想；拿不准就跳过，不为凑数量硬收。形式名词、补助动词的汉字仅用于记忆关联，不要求把正文中的假名改写成汉字；钩子不宣称词源，也不得编造词源。


## 当日错题回顾 →「集中拿下」：先邀请、锁定一批、隔开再对一次才算（2026-10-23 重做，作者拍板）

**起因**：作者反馈「出现之后点两下认识又不在了」。按 10-23 真实作答记录查出四件事：

1. **出口太松**：轮内每个词答对一次就进 resolved，候选通常四五个，点几下就空了；退出时横幅直接消失，没有收尾。
2. **第一张常是刚答错的词**：候选按「今天出现次数」降序，刚忘的那个次数最多，2 秒后再考 —— 答对的是工作记忆。
3. **轮内作答从来没写进 FSRS**：旧版只在界面上 `setCard(reviewCard)`，库里的当前卡还是下一张 stage1 卡，
   `applyWordAnswer` 的 `claimCurrentCard` 把这些作答当「过期/重复提交」静默丢掉。所以 10-23 的 `reviews` 里找不到回顾那一段。
   新版提交前 `submitWordAnswer(..., dailyReview=true)` 先 `setCurrentCard`。
4. **红色卡从设计系统上线（09-23）起就没显示过**：`design.css` 的 `[data-theme] .dictionary-card { background: var(--ds-surface) !important }`
   特异度 0,2,0，盖掉了只写 `.daily-review-card` 的 !important。新样式写成 `[data-theme] .dictionary-card.daily-review-card`。
   **往 `.dictionary-card` 上加主题色的任何类都要这样写**，否则看不出效果、也没有报错。

**现行判据**（`word-api/daily-review.ts` + 纯函数 `word-api/daily-review-round.ts`，页面 `WordStudy.tsx`，组件 `features/word-study/DailyReviewRound.tsx`）：

- **候选**：今天 stage1 任务里、今天正向作答 ≥3 次（`DAILY_REVIEW_MIN_SEEN`）、仍未过（`fsrs_due <= studyDayEnd` 且非熟知）。
- **邀请**（`shouldInviteDailyReview`，计划模式 stage1 每题记账后问一次，快路径的 `pendingAnswerRef` 里也问）：
  候选 ≥5、不疲劳、当天 <2 轮、第二轮距第一轮开始 ≥30 题、不在暂缓期。**便宜的闸放前面**——小程序每题都调，候选查询是逐词子查询。
  不再走「60–80% 上膛 + 下一次忘记开火」，也不再需要预算里的 `dailyReviewWouldStart`（邀请盖在卡位上，不劫持已经预算好的下一张）。
- **先不**：第一次暂缓 20 题，第二次当天不再问（`daily_review_v2.declined`）。状态按天作废，`daily_review_v1` 已弃用。
- **一轮**：开局锁定前 8 个候选（`dailyReviewBatch`）。每词状态 pending → once → done：
  pending 时作答**写 FSRS**（和正常作答一样），答对进 once；once 时是**复查，不写 FSRS、不进 reviews**（作者定：同一天叠评分会干扰排期），
  答对才 done，答错退回 pending（下次再答会重新写 FSRS）。出牌跳过最近 2 张（只剩它们时放宽），邀请前刚答的那个词初始就在「最近」里。
- **出口**：全部 done → 完成卡（「N 个都拿下了」+ 进度点全实心 +「继续」，**不自动消失**）；或顶栏「先到这」随时退，没拿下的下一轮还会是候选。
  退出后：邀请时盖住的那张 stage1 卡若仍是今天未完成任务就恢复（`continueTodayPlanStudy(resumeWordId)`），否则 `loadNext` 重取。
- 轮内不可撤销；撤销 / 切模式 / 跳相似词都会 `clearDailyReview()`。
- 样式在 `DailyReviewRound.css`（暖橙，不用红色——还没拿下的词不该画成惩罚）；动效遵守 `prefers-reduced-motion` 和偏好里的动效档位。

验证：网页 5233 端口走通邀请 → 一轮 → 完成 → 继续，`reviews` 里每词恰好多一条（复查那下没有写入）；「先不」后 `snoozeUntilAnswerCount = 当前题数 + 20`。

## ⚠️ 新内容按计划级别顺推，先验之后必须对齐（2026-10-28 修，`plan-level-order.ts`）

用户转述的反馈：「填的 N5，学的 N3」。查下来起点先验本身是好的（起点及以下写成「学过」），坏在**投放新内容的四处都不看起点**：

| 类型 | 修之前 | 后果（起点 N5、考 N3，出厂词库实测） |
| --- | --- | --- |
| 单词 `newWordLevelRankSql` | N5/N4/N3 同一档（08-17 定的，那时还没有起点设定），档内按 importance、再随机 | 头 40 个新词 30 个 N3、10 个 N4（N3 剩 1906、N4 846，importance 差不多）；目标 N4 的人也排进 N3 |
| 语法（混合模式） | `grammarLevel()` 只传目标那一级 | N4 语法一条都不出；先验写进 N5/N4 的语法永远不到期出题，圆环（`grammarPools` 按整个范围数）却算着它们 |
| 汉字 `createKanjiCharTasks` | 目标及以下按出现次数排 | N3 高频字和 N4 混着进 |
| 辨析 `createConfusionTasks` | 目标及以下按「学过成员多」排 | 同上 |

还顺带查出**第二个洞**：「今天新学了几条」一律按「今天答过、以前没答过」算，**先验卡第一次真实作答也被当成新学**。
语法的新条目名额就是这么扣的：起点 N5 的人复习 5 条先验里的 N5 语法，当天 5 条新语法名额就扣光了，一条 N4 都出不来
（测试里第一次就是这么红的）。同一个口径还在备考页「新词 / 新语法已做」（`jlpt/status.ts`）、主页统计的 `newToday`、
stage1 从流水回填任务表（回填成 'new' 会占新词配额）里。

**现行判据**（改任何一处新内容投放都要守）：

- 级别顺序只有一份：`planLevelRanks(起点, 该类熟悉度, 目标)` —— 计划范围（起点上一级 → 目标）逐级顺推，一级学完再进下一级；
  超出目标的排最后（排序不是过滤，范围学完还能接上更高级）；起点以下、无级别的排第 0 档。
  起点那一级熟悉度为 0 时先验不写它，起点本级就是第一档（和 `daily-plan.ts` 的 `remainingPlanWords` 同一条判据）。
  五十音 / 专业进阶 / 没设过起点：从 N5 顺推。
- 起点读 **`level_prior_applied`（先验实际落库时的那份）**，不读自报设置：两周后 `recalibrateLevelStartingPoint` 会按真实首答上下调一级重写先验，投放要跟着落库的走。
  `plan-level-order.ts` 故意不 import `level-plan.ts`（它引着 word-api / 汉字 / 辨析，会成环）。
- 单词 stage1 的「欠着的（以前排进计划没背到）」只在**同一级里**优先：`ORDER BY 例句词典点名, 级别档, 欠着的, …`。
  不这样的话，修之前同档随机排进来的 N3 欠账会一直插在 N4 前面。
- 混合模式语法用 `PLAN_GRAMMAR_LEVEL`（= 备考范围 N5 → 目标，新条目按级别顺推，复习覆盖整个范围）；
  出题、主页角标 / 小路（`stats.ts`）、例句预取（`WordStudy.tsx`）三处必须同一个值。语法页自己选等级的那条路仍是单一等级。
- 「新学」= 以前没答过 **且** 不在 `level_prior_baselines`（`priorBaselineSql`）。基线在真实作答后保留，答过也认得出来。
- 判据在 `plan-level-order.test.ts`：起点 N5 考 N3，单词当天新词全是 N4（含一条欠着的 N3 不插队）、语法新条目全是 N4 且名额不被先验复习扣、汉字 / 辨析第一张是 N4 且不倒退。
- **别改回同档随机**。08-17 的理由（「作者在别处学过，低级别大多会」）现在由先验 + 作答负责；级别顺序归计划。

影响面：作者自己（起点 N4、熟悉度 75、考 N3）单词 / 汉字 / 辨析第一档本来就是 N3，几乎不变；**语法会开始出先验里到期的 N5/N4**
（10-13 写的先验，到期日撒在 30 / 14 天里，现在不少已到期），受语法复习上限约束。当天已经生成的任务表不重排，次日起对齐。

**2026-10-28 增补**：修完之后又做了一次全仓库级别普查（结论：「用户在哪一级」没有单一事实来源，汉字单元模式是同一个 bug 的第五个入口，N5/N4 例句含超纲词 41%/20%），见 `docs/audits/2026-10-28-level-census.md`。新增任何新内容投放入口前先读它的「建议 1、5」。

**2026-10-28 H1 已修（汉字单元模式）**：`kanji-unit-scheduler.ts` 的目标不再单独存（原 `kanji_unit_target_level`，默认 N1），
`getKanjiUnitTargetLevelRank()` 直接读 `jlptTarget`；新字音先按 `unitPlanRank` 分档再比覆盖分：计划范围（起点上一级 → 目标）逐级顺推 → 起点以下 → 超出目标。
一处和 `plan-level-order.ts` 的口径不同，**别「统一」回去**：字音没有先验基线，起点以下的字音其实都还是新的，
所以排在计划范围之后（50 档）而不是像单词那样排第 0 档先补，否则起点 N4 的人汉字模式先把 N5 字音全练一遍。
设置页（`KanjiUnitPlanSettings`）不再有目标级别按钮，只显示「跟着备考计划」。
**投放矩阵测试**：`plan-level-matrix.test.ts` 对起点 N5/N4/N3 × 目标 N4/N3/N2 共 9 格，逐个入口（单词 / 语法 / 汉字字卡 / 辨析 / 汉字单元）断言第一批新内容的级别。
**新增任何挑新内容的入口都要在那里加一行。**

### 2026-10-28 一级学完问三选一

本节覆盖 `daily-plans-and-study-modes.md` 同日旧稿里「只问单词、只报目标、继续 / 暂停」的实现描述；旧稿保留作历史。
状态仍放 `app_state.level_advance`，改成 `words` / `grammar` 各一份
`{ answered, pausedAt, stoppedAt, pausedLevel, upTo, backfill }`；旧扁平状态由 `readLevelAdvance` 只读入 `words`，语法从空状态开始。

- **提问**：`levelAdvancePrompt` 分别检查每类的前沿 `max(jlptTarget, upTo)`，覆盖 ≥95%、未回答才问；
  单词用 `seen_count > 0 OR known_forever`，语法用真实 `grammar_reviews` 或 `known_forever = 1`，分母都是该级内容总数。
  只有先验基线、没有真实流水的语法卡不计覆盖；前沿在 `currentFirstPlanLevelIndex(kind)` 之前也不问，避免把起点先验误报为学完。
  N1 不问；同一时刻只显示一张，单词优先，但两类的暂停计时都会处理。
- **往上**：`answerLevelAdvance(kind, level, "up")` 将 `upTo` 设为更难一级（N3 → N2）、把本级加入 `answered`，清掉该类暂停。
  `levelAdvanceTarget` 算扩展后的范围；`currentPlanLevelRanks(kind)` 让范围内新内容逐级顺推，扩展级不再掉到 100+ 档。
  语法还有过滤条件，因此 `scopeLevels(PLAN_GRAMMAR_LEVEL)` 必须用扩展范围，不能只改排序。
  主页 `word-api/stats.ts` 的语法计数 / 小路、`mixed-session.ts` 的出题、`WordStudy.tsx` 的例句预取继续共用 `PLAN_GRAMMAR_LEVEL`，自然同步。
- **回补**：`answerLevelAdvance(kind, level, "back")` 将 `backfill` 设为紧邻的较低一级（N3 → N4）、记录本级已回答并清暂停；
  `currentPlanLevelRanks(kind)` 将该级压到 −1 档，比基础漏网的 0 档更早。只影响所选种类的新内容，复习仍走 FSRS。
  用户明确只补紧邻一级，不把「补 N4」扩成从 N5 重学；仅当该级存在且有未学新内容时，`LevelAdvancePrompt.backfill` 才有值、主页才出按钮。
  回补级新内容耗尽后，原顺推自然接上，不再额外清空或重排复习。
- **先不加**：`answerLevelAdvance(kind, level, "pause")` 记录该类 `pausedAt / pausedLevel`、清 `stoppedAt`；
  `levelAdvanceNewCap` / `getEffectiveStudyPreferences` 仅在覆盖层封顶该类 `dailyGoal` 或 `grammarDailyGoal`，不改用户保存的平时额度。
  先把本级剩余新内容收尾，到 100% 后由 `levelAdvancePrompt` 记录 `stoppedAt`，从这一刻停一周，期满自动恢复并再次询问。
  语法 `grammarNewQuota` 也套该封顶，防止已存在的加餐额度穿透暂停；另一类和复习额度不受影响。

**不能改 `jlptTarget`**：它绑定考试目标、倒计时、计划锚点和每日量推荐；「想接着学 N2」不代表「改考 N2」。
`daily-plan.ts` / `jlpt/status.ts` 的目标口径这次保持原样，**已知缺口：备考页数字仍按备考目标算，不计入 upTo 扩展的学习内容**。
主页三按钮和种类文案在 `ZooHome.tsx`，Taro 小程序复用同一组件；本次不重建 `web.js` / reports，提交前需统一构建共享产物。
判据在 `level-advance.test.ts`（含语法真实流水与先验、扩范围实际出题 / 混合模式 / 例句预取、相邻回补、各自暂停、单词优先和旧状态兼容）。

## 先验限速（2026-10-29）

### 事故与 10-28 说明的更正

10-13 将起点设为 N5 时，127 条语法写入了起点先验，稳定性 30 天，到期日撒在
10-14 至 10-28。那两周混合模式只出目标级 N3，先验没有被验证；10-28 的
`17c0f468` 将语法范围改成 N5 → 目标后，积压在同一天进入普通到期池，当天安排
154 条语法、首次作答 97 条先验。问题是**把待验证先验当成普通到期债务**，不是单纯上限太大。
单词原来也没有小额验证机制，文档中的「约 63 条/天」只是到期日均匀散开后的平均数。

上节「新内容按计划级别顺推」中「受语法复习上限约束」的说法**不成立**：
`grammarReviewCap = 0` 是沿用单词复习上限，当时约 600，挡不住这批先验。
旧段保留作事故记录；现行露面节奏以本节为准，不能再拿普通 cap 当先验保护。

### 定义、额度与到期日

实现只有 `frontend/src/lib/prior-pacing.ts` 一份，单词 / 语法 / 汉字字卡 / 辨析各有独立额度。
**待验证先验** = `level_prior_baselines` 有对应的 `(entity, entity_key)`，并且没有该卡的任何
真实流水：`words → reviews.word_id`、`grammar → grammar_reviews.grammar_id`、
`kanji → kanji_char_reviews.char`、`confusion → confusion_reviews.group_key`。
单词的任一方向有一次真实作答就已经验证；虚拟 `fsrs_last_review` 和 `seen_count = 1` 不算。
第一次真实作答验证一条，重复刷、换方向再答不重复占名额；已验证卡回到普通 FSRS。

| 命名常量（集中在 prior-pacing.ts） | 值 | 用途 |
| --- | --- | --- |
| `PRIOR_QUOTA_INITIAL` | 5 | 每类初始每日验证额度 |
| `PRIOR_QUOTA_MIN` | 1 | 额度下限 |
| `PRIOR_QUOTA_MAX` | 8 | 额度上限 |
| `PRIOR_CHECK_EVERY` | 10 | 每满一窗口先验首答后检查一次 |

- 候选仍须未标熟知、`seen_count > 0`、`fsrs_due <= studyDayEnd()`，按 due 最早、主键升序放行。
  当天已验证的不同先验条目先扣额度，再放行剩余额度。普通复习 cap 为 0 或已用完，也不能吞掉这份独立额度；先验也不挤占普通复习。
- 每收满 `PRIOR_CHECK_EVERY` 条首答，以 `know` 占比检查：≥90% 减 1，<70% 加 1，其余不变；
  夹在上下限内，再清空窗口。窗口只数先验首答，不数普通复习。
- 正向、反向、旧汉字读音都用 words 的同一份放行名单；方向自己的 due 仍须到期。
  已经生成的当天任务由 `reconcilePriorTasks` 收口，升级当天也不会继续出旧池里的整批先验。
- **不修改库里的 due，不改先验写入、不写迁移**。基线中的稳定性、虚拟上次复习和撒开的 due
  是 FSRS 重放起点；due 仍表示是否具备候选资格及先后顺序，不再表示待验证卡欠下了几百条债。
  为限速把它们挪到明天，会改坏记忆状态、撤销重放和跨设备合并；等候应由候选池的闸门表达。
  起点以下各级原有的较晚 due 也因此继续有效，不会被提前抽出来。
- 「新学」仍按 10-28 的 `priorBaselineSql` 排除基线卡，和本节「待验证」不同：基线在验证后也保留。
  未放行先验不计今日欠账或积压；未来负荷用 `forecastPriorReleases` 按每天额度展开，未来正确率未知，沿用当前额度预测。

### 同步：状态由流水重放得出

`app_state` 的 `prior_pace:words / grammar / kanji / confusion` 保存 JSON `{quota, window}`。
`lib/sync/tables.ts` 已将整个 `app_state` 按 key 登记为 **lww**；这些键不在设备本地过滤名单，
无需另建表或给每个 key 登记第二份同步规则。缺失或坏值只读回初始额度，不修写 FSRS。

`rebuildPriorPace(kind)` 从基线卡的真实流水各取第一条，按学习日、真实时间和 `sync_uid`
依次重放窗口；`id` 只作最后的本机兜底，同一时刻不能靠本机自增 id 决定首答。
正常首答和撤销首答都接到重放；**`mergeDatabaseBytes` 在流水和墓碑合并、卡片记忆重放后，
同一个事务内重建四类额度**。仅让两台设备的 JSON 做 LWW 会丢掉另一台窗口内的作答，不能替代这一步。
流水并集相同，重放出的额度和窗口就相同；当天已用名额也从同一份首次作答流水去重计算。
离线设备在合并前无法知道对方已答的条目，合并后按实际总数扣完，不会再补发已经用掉的名额。

### 到期 / 剩余数入口对账

2026-10-29 在 `frontend/src` 全量搜索 `fsrs_due`、`fsrsDue*`、`dueCount`、`*Remaining`、
`*Progress`，并追到调用方。下表行号对应本次工作区，路径除注明外均相对 `frontend/src/`。
「已改」含上一轮已写的接线；「未改」明确说明继承哪道闸，或为什么不属于当天待验证复习池。

| 入口 文件:行 | 改了 / 没改 | 口径与原因 |
| --- | --- | --- |
| `lib/fsrs-store.ts:456` `fsrsDueCount` | 已改 | 到期条件后用 `priorGateSql`，只数放行的待验证先验；`now` 参数仍沿用调用方的截止时间。 |
| `lib/fsrs-store.ts:493`、`:506` `plannedDueCount / cappedDueCount` | 已改 | 普通卡先走顽固词闸 / cap，排除 `pendingPriorSql` 后另加 `priorIdsForEntity`，先验不占普通 cap。 |
| `lib/fsrs-store.ts:511`（到期查询 `:529 / :535 / :550 / :567`）`fsrsDueWordIds` | 已改 | 普通候选统一排除待验证先验，末尾追加同一放行名单；计数和选卡共用来源。 |
| `lib/fsrs-store.ts:431` `DUE_SQL` | 未改 | 裸条件常量；全仓库无消费者，实际统计 / 选卡使用上面三个入口。 |
| `lib/word-api/stage1.ts:118 / :148 / :203` 建任务、旧任务收口 | 已改 | `fsrsDueWordIds` + `reconcilePriorTasks(WORD_FSRS)`，回填的当日先验首答不扣普通 review cap。 |
| `lib/word-api/stage1.ts:329 / :415 / :464` 进度和出卡 | 未另改查询 | 都先 `ensureStage1Tasks`，读取已经按放行名单收口的同一张任务表；完成分子只数真实任务。 |
| `lib/word-api/stage1.ts:102` 导入词激活 | 未改 | 只更新 moji 导入批次的激活标记，不选卡、不计今日工作量；下游任务创建仍走统一闸。 |
| `lib/word-api/stage1.ts:268 / :275 / :324` 今日音频和干扰缓存 | 未改 | 只预取现有任务的素材 / 缓存，不分配名额或出题；正式任务 / 出卡在上两行收口。 |
| `lib/word-api/stage1.ts:295 / :375` 明日音频、续杯剩余 | 已改 | 无现成任务表的查询直接用 `priorGateSql`，明日按明日学习日和边界计算。 |
| `lib/word-api/direction-plan.ts:65 / :80 / :97 / :133` 反向、旧汉字读音建池 | 已改 | `fsrsDueWordIds` / `priorIdsForEntity` 与正向共用 words 名单，旧方向任务也收口；先验在普通 cap 外追加。 |
| `lib/word-api/direction-plan.ts:165 / :224 / :260` 方向进度 / 出卡 | 未另改查询 | 都经 `ensureDirectionTasks`，读同一份已收口任务。 |
| `lib/word-api/directions.ts:140 / :151` 按需播种方向卡 | 已改 | 播种前走 words 的 `priorGateSql`，未放行卡不能借新方向入口出现。 |
| `lib/grammar-quiz.ts:257 / :268 / :454 / :479` `planIds / grammarPlanRemaining / pickCard` | 已改共用入口 | `grammarReviewEntity` 限范围后经 `fsrsDueWordIds`；剩余数和实际取卡都从 `planIds` 取名单。 |
| `lib/grammar-quiz.ts:158 / :463 / :470` 圆环池、完成数、例句预取 | 已改池 / 预取；完成数未改 | 圆环用 `plannedDueCount / cappedDueCount`；预取走同范围 `priorGateSql`；完成数只看今天真实作答且已毕业的卡。 |
| `lib/word-api/stats.ts:143 / :185 / :227 / :241` `grammarRemaining / modeCounts / mixed` 分母 | 已改 low 查询，其余继承 | 单词取 stage1 任务进度，语法取 `grammarPlanRemaining(PLAN_GRAMMAR_LEVEL)`，汉字 / 辨析取 `mixedCardCounts`；混合分母为四份同口径之和。 |
| `lib/mixed-cards.ts:75 / :81 / :83` `mixedCardCounts` | 未改 | 先创建两类任务，再读下列 progress，继承 card-log 的统一闸，不复制限速逻辑。 |
| `lib/card-log.ts:163 / :175 / :179 / :201 / :221 / :249` 建池、取卡、进度、dueCount | 已改 | 普通到期排除待验证，另加 `priorIdsForEntity`；建池、取卡、数进度都 `reconcilePriorTasks`；dueCount 同源。 |
| `lib/kanji-char-cards.ts:238 / :252` `kanjiCharProgress / kanjiCharPool` | progress 未改；新增 priorCount 导出 | 全部转给 card-log；汉字资格集合仍沿用既有出题判据。 |
| `lib/confusion-cards.ts:237 / :248` `confusionCardProgress / confusionCardPool` | progress 未改；新增 priorCount 导出 | 全部转给 card-log；不匹配 / 已掌握组仍按既有资格排除。 |
| `lib/daily-plan.ts:66 / :68 / :127 / :203` 单词池、`grammarPools`、四段圆环及写回 | 已改 | 池子取各类共享计数，普通 cap 之外加 priorExtras；写回时减去渲染时那份 extras，防止偷偷改大普通 cap。 |
| `lib/daily-plan.ts:288 / :305` 备考预设和未来负荷 | 已改 | 今日复习用同源池；未来先排除待验证旧 due，再按 `forecastPriorReleases` 加每天放行量。 |
| `lib/jlpt/status.ts:98 / :107 / :127 / :135` 今日复习、积压、shortfall | 已改 | 今日工作量 = 普通到期 + 放行先验 + 今日已验证；积压排除仍待验证的旧 due。已做数仍读真实流水。 |
| `lib/level-advance.ts:27 / :72` `levelProgress / levelAdvancePrompt` | 未改 | 没有到期读入口；它检查级别覆盖和剩余新内容，不统计今日待复习数。保留原有升级 / 暂停逻辑。 |
| `lib/kanji-unit-scheduler.ts:455 / :461 / :509 / :515` 汉字单元到期池与进度 | 未改 | 查的是 `kanji_unit_memory.unit_key`，只有单元自己的流水；四类先验没有 unit_key 基线。例词有 words 基线也不等于单元先验，测试已验证不扣 words 名额。 |
| `components/LoadCurve.tsx:26 / :34`、`lib/study-load.ts:148 / :177` | 已改 | 今日 pending 走 `priorGateSql`；未来图排除待验证的旧 due，改加逐日放行预测，不制造积压峰。普通卡原有负荷口径保留。 |
| `lib/progress-api.ts:30 / :41 / :62` 分级 low 数 | 已改 | 单词 / 语法的「到期薄弱」走对应 `priorGateSql`；历史覆盖率仍按真实作答判据。 |
| `lib/word-library.ts:253 / :307 / :371 / :405 / :439` 到期筛选、列表、tally、详情 | 已改 | 动态 `dueInLibrarySql` 共用 words 闸，避免模块初始化时固定住当天名单；记忆强度色阶不变。 |
| `lib/achievements/stats.ts:208` `dueBacklog` | 已改 | 成就的到期积压加 words 闸，未放行的先验不虚增积压；其余成就是历史事实统计。 |
| `lib/review-budget.ts:110` `reviewBacklogCount` | 未改 | 调用已加闸的 `fsrsDueCount`，无需第二次计算。 |
| `lib/word-api.ts:175 / :222` 筛选学习及兜底 | 本次补漏 | 在共用 filter 上加 `priorGateSql`，队列、到期和兜底路径都不能绕过；补回归测试。 |
| `lib/word-api.ts:478 / :551` 续杯、例句词典加餐 | 续杯已改；加餐本次补漏 | 两处直接到期查询都用 words 闸；未放行的例句词不会先报告加入成功、再被任务收口清掉。 |
| `lib/word-api.ts:396 / :988 / :1290` 一键完成、恢复计划、预算剩余 | 未另改查询 | 先 ensure / nextCard 再读当天收口任务；不会把任务外的待验证先验带入统计或批量作答。 |
| `lib/word-api/daily-review.ts:49 / :91` 集中拿下 | 未改 | 候选必须在今日任务且今天正向真实答过至少 3 次，已不可能是待验证先验；计数和候选同条件。 |
| `lib/word-api/mistakes.ts:57`、`lib/word-api/daily-tail.ts:101`、`lib/word-api/daily-relief.ts:60` | 未改 | 错题 / 压轴分别要求真实累计表现或 seen_count ≥3；减负来自昨日真实流水。先验初始化 seen_count=1、无流水，进不来。 |
| `lib/word-api/picked.ts:77 / :89` 自选清单 | 未改 | 用户明确点名的临时突击，既有规则刻意不看到期、也不进每日计划；remaining 和取卡都读 pickedRows。若主动验证了先验，流水照样扣当日后续放行名额。 |
| `lib/talk/schedule.ts:51`、`lib/kana-progress.ts:167`、`lib/spelling/store.ts:75` | 未改 | 开口 / 假名 / 拼写各有独立记忆；四类基线没有这些 entity。拼写这里仅按正向 due 排播种顺序，不统计正向待还债。 |
| `lib/level-plan.ts:112 / :151`、`lib/models/familiarity.ts:36`、`lib/scheduler/priority.ts:110`、`lib/word-list-import.ts:517` | 未改 | 分别是先验写入、熟悉度、已入池卡排序、导入 / FSRS 修复，均不生成今日到期剩余数；保留原有数据语义。 |
| `lib/yuzu.ts:170` 等任务完成 / 奖励消费者 | 未改 | 读取 `stage1ProgressCounts` 或真实历史流水，继承已经收口的任务分母，不独立查待验证先验。 |

### 回归与构建

`prior-pacing.test.ts` 中四类参数化用例分别调用 stage1、语法 `planIds → pickCard`、汉字字卡、
辨析的实际路径，直接断言**放行名单长度 = 剩余计数 = 完整出卡集合大小**，并核对混合角标、
圆环及两类 card pool；普通 cap 设得比先验额度小，确保不能吞名额。
另覆盖 127 条语法事故、额度上下调和夹限、先答后重刷、撤销检查点、无先验老库、三方向、
旧任务 / 续杯、汉字单元边界，以及筛选 / 例句加餐漏口。
云合并回归走真正的 `mergeDatabaseBytes`，验证两边首答合成窗口、旧 LWW 值不能覆盖事实、
重复合并不重计；四类另验证同一时刻变更本机 id 不改变首答和额度。

小程序只从网页源码生成 `wechat-miniprogram/src/shared/web.js`，不手改原生 JS。
本次新增逻辑使共享包原先约 767 KiB，超过原有 760 KiB 闸门约 7 KiB；构建脚本仅为主包
启用 esbuild 的局部标识符压缩（导出名 / 对象属性保留），生成物为 586,974 B（约 573 KiB），没有提高预算。
`LoadCurve` 与 Taro 仍编译同一份 TSX，已在 parity-map 登记；Taro 构建变化的 reports 要随本补丁交付。

**本次机器验收（2026-10-29）**：`frontend && npx tsc --noEmit` 零错；`npx vitest run`
183 文件通过、3 文件跳过，1,496 项通过、26 项跳过。`wechat-miniprogram && npm test`
32 个脚本全部通过，单独的 `npm run check-shared` 也通过。Taro 完整构建链和 `npm test` 通过，
主包 1,897,529 / 1,900,000 B，未许可的核心 / 页面重复均为 0。普通 Taro 命令重现本机已记录的
Doctor Rust `system-configuration` NULL object panic；按既有办法只给 Taro 编译加 `--no-check`，
资产、CSS、异步内容、API、分包预算、重复模块和 referral 检查全部照常执行，未改闸门。
构建实际改变的报告只有 `taro-spike-2/reports/package-gates.json`、`package-sizes.json`、
`webpack-stats.json`（后者含 worktree 绝对路径导致的大量差异），没有把构建资产副作用留在 src 下。

**既有测试与运行边界**：03:54 的首次全量出现自选清单「答错的词还会在本轮回来」失败，
在从同一 HEAD 导出的独立副本里也复现；当时接近凌晨四点，重学 due 会越过学习日边界。
另有一次整场序列的混淆组随机断言失败；04:01 的全量运行已全部通过，没有改这两处生产逻辑或测试断言。
独立网页端口 5247 的 Vite 及 HTTP 监听均被沙箱以 `listen EPERM` 拒绝；微信开发者工具
`cli open` 也因自身本地监听被相同限制拒绝。因此**实际页面 / 窄屏视觉检查、Taro 开发者工具运行未完成**，
不能拿编译和 smoke 通过替代。没有刷新 5173、写用户学习库、提交、合并或推送；改动留在本 worktree。

### 多日负荷模拟（2026-10-29，`frontend/src/lib/daily-load-simulation.test.ts`）

改投放范围、先验、升级 / 回补、复习上限之后，跑一遍它看「会不会某天成批冒出来」。默认跳过，整套约 9 分钟：

```bash
cd frontend && SHUSHUGO_LOAD_SIM=1 npx vitest run src/lib/daily-load-simulation.test.ts --configLoader runner --no-cache
# 加 SHUSHUGO_LIVE_DB=.local/live.db 再从真实库往后推 30 天（只读、只打印计数）
```

- 「真实时间线」情景按 10-28 事故原样重放：起点 N5→N3、N3 10-21 学完空一周、10-28 范围放开、10-29 起点改 N4 + 回补 N4。
  在限速前的 `14e9d390` 上，同一时间线 10-28 放出 127 条先验（真实当天排 154 条、首答 97 条），证明模拟抓得住真因；限速后语法每天最多 18 条。
- 真实库 10-29 的 51 条 = 43 条普通复习（21 条是 10-28 首答后又到期的 N4/N5、21 条是早学的 N3）+ 8 条先验（10-28 首答正确率低，额度被调到上限）。
- 两个 `it.fails`（首答忘一半 / 几乎全忘）是已知现象：没有计划额度时，语法普通复习沿用单词上限约 600，会慢慢涨到每天 113 / 276 条。
  这是逐日累积，不是突然爆量（「前 7 天中位数 ×4+20」那条断言照样通过）；要不要给语法单设默认上限，作者还没定。
- 单词作答走 `submitWordAnswer`。不要为了测试给 `word-api.ts` 的内部函数加 `export`：哪怕只加一个 export，也会让小程序 `web.js` 产物变化，`check-shared` 就红。

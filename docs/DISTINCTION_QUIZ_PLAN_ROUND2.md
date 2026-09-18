# 执行计划·第二轮：题面要准、要全（2026-09-16）

> 接 `DISTINCTION_QUIZ_PLAN.md`。第一轮出题功能已验收通过；**这一轮不碰代码，只改数据**。
> 优先级明确：**意思准确 > 覆盖面 > 出题**。所有输入清单和校验闸门都已经准备好，
> 照着做即可。仍然只在 `question-meaning-review/` 下写批次文件，不改 `words.meaning`。

## 0. 第一轮验收发现的问题（这一轮要修的）

第一轮 916 条辨析题面里，**447 条把原文的第二义砍掉了**（校验器现在会逐条列出）：

| 词 | 原文 | 第一轮写成 | 问题 |
|---|---|---|---|
| 聞く | 听；询问 | 听 | 「询问」是 N5 核心义，丢了就是教错 |
| 始める | 开始 | 开始做 | 靠措辞暗示他动词，读不出来；见 §2.4 |
| 出す | 拿出；提交 | 拿出 | 同上 |
| 報じる | 报答；报道 | 报道 | 同上 |
| 休む | 休息；请假 | 休息 | 同上 |

原因是把「组内首义分得开」当成了唯一目标。**这行字同时是日常正向题的题面**，
用户每天看的是它，不是辨析题。分得开是约束，准确、完整是目的。

另外第一轮的 `reason` 全是同一句模板（「按人工辨析注记补充动作方向…」），
没有信息量。这一轮 `reason` 必须写这个词自己的理由（见 §2.3）。

## 1. 三份输入清单（已生成，在 `question-meaning-review/`）

重新生成的命令（改了覆盖表之后重跑，清单里的 `reviewedQuestionMeaning` 会跟着更新）：

```bash
cd frontend && CANDIDATES_OUT=../question-meaning-review/distinction-candidates.json npx vitest run src/lib/distinction-candidates.test.ts
```

| 文件 | 内容 | 规模 | 这一轮做什么 |
|---|---|---|---|
| `distinction-candidates.json` | 第一轮那 370 组（pair / stem / kanji-choice / reading-register），每个成员带 `meaning`（原文）、`note`（人工稿拆出的按成员注）、`reviewedQuestionMeaning`（第一轮写的） | 916 成员 | **阶段 F：修 447 条丢义项的** |
| `distinction-candidates-synonym.json` | 814 个 synonym 组（有人工稿 `summary`，第一轮没做），形状同上 | 1,840 成员，其中 764 个没有题面 | **阶段 G：补齐 764 条，并核对已有的** |
| `distinction-candidates-unreviewed.json` | 没有人工稿的组（homophone / reading-sense），只列还有成员缺题面的组，整组导出 | 182 组，253 个成员要写 | **阶段 H：补齐 253 条** |

三份清单里每个成员都有 `kanji` / `kana`（批次文件的键，**原样抄**）、`surface`、`jlpt`、
`exampleJp` / `exampleMeaning`。

## 2. 写法规则（比第一轮多了「保全义项」，其余不变）

### 2.1 保全义项（新，最重要）

- 原文里**正确的义项一个都不许丢**。原文两个义项，题面就至少两个；三个及以上取最常用的三个。
- 分得开的抓手写进**首义**或首义后的括号，不靠删义项来分：
  - ❌ 聞く → 「听」
  - ✅ 聞く → 「听；询问」（首义「听」已经和组内 聞こえる「听得见（自然传入耳朵）」分得开）
  - ✅ 冷やす → 「冰镇；把…弄凉」、冷ます → 「晾凉；使热物降温」
- 原文义项本身是错的、或者是另一个同形词的义项混进来的，才可以丢，
  **必须在 `reason` 里写「舍弃义项：<丢的是哪个、为什么>」**。校验器按这个字符串放行。
- 义项顺序：**最常用的放首义**。第一轮有些为了分组把冷僻义提到了前面，改回来。

### 2.2 其余规则（同第一轮，照抄）

1. 同一组内两两分得开：`level: "major"` 的组，任何两个成员**首义**不能相同。
2. 单独看仍是这个词的正确翻译，不写只有在组里才看得懂的暗号。
3. 抓手用中文说：动作方向（自己变冷 / 把…弄凉）、对象（找想要的 / 找丢失的）、
   语域（正式 / 口语）、汉字用法。括号只用全角 `（）`。
4. 不许出现假名、日文词形、罗马字。
5. 首义 ≤ 8 个汉字，整条 ≤ 20 字，最多三个义项，用「；」分隔。
6. `level: "interchangeable"` 的组允许首义相同，不硬造区别。
7. 键是 `kanji` + `kana`，一个字符不差；已经存在于旧批次的条目**在原文件里改**，不重复追加
   （`build-runtime-overrides.mjs` 遇重复键直接抛错）。

### 2.4 自他动词：括号的位置就是语法角色（新，pair / stem 组必须遵守）

中文不标自他，靠措辞暗示（「开始」vs「开始做」）用户读不出来。改用**一条固定约定**，
学一次就会，368 个词全部照它写：

| | 写法 | 例 |
|---|---|---|
| **他动词** | 括号放在**后面**，写典型宾语；或者用 把…/使…/让…/弄… | 打开（门、盖子）、冰镇（啤酒、西瓜）、使停下、把…弄凉、弄丢 |
| **自动词** | 括号放在**前面**，写典型主语；或者用 变…/…了/…着/自己… | （门）开着、（身体、天气）变冷、（饭菜）变凉、停了、自己开始 |

冷 那一组照约定写出来是：

```
冷やす  冰镇（啤酒、西瓜）；把…弄凉
冷ます  晾凉（热汤、热茶）
冷える  （身体、天气）变冷；发凉
冷める  （饭菜）变凉；（热情）冷却
```

括号里的搭配不是装饰——**搭配才是这几个词真正的区别**（冷やす 用冰、冷ます 放着等），
比「使/被」更接近用法。搭配从 `exampleJp` / `exampleMeaning` 和人工稿 `summary` 里取，
写两个以内，用顿号分隔。

哪个是自、哪个是他，以 `frontend/src/data/verb_pair_hints.json` 为准（键是假名，
值第一项是「自动词 / 他动词」），不要自己判。校验器对这 368 个词强制检查：
他动词题面必须含后括号或 把/使/让/弄；自动词题面必须含前括号或 变/了/着/自己，
且不能以 把/使/让 开头。报 `pair marker` 的逐条改。

stem 组里不在 `verb_pair_hints` 的派生词（下ろす / 買い占める 这类）不强制，但同组里有自他对的，
写法向它们看齐。

### 2.3 `reason` 怎么写

一句话，说**这个词**：保留了哪些义项、抓手是什么、和组里谁分开。例：

```
"reason": "pair:聞く / 聞こえる — 保留「听；询问」两义；首义「听」与 聞こえる「听得见」靠主动/自然分开"
"reason": "synonym:警察 — 与 警察官（个人）、警官（正式称呼）分开：这是机构与统称；舍弃义项：原文「巡警」是旧译，日语不指该警衔"
```

## 3. 阶段 F：修第一轮的 447 条

```bash
node question-meaning-review/validate-manual-batch.mjs 2>&1 | grep "sense dropped"
```

这就是工单：每行给出 `kanji|kana`、原文、现在的题面。逐条到 `manual-batch-0031～0034`
（以及旧批次里那 26 条）**原地改** `questionMeaning` 和 `reason`。
对照 `distinction-candidates.json` 里同组其它成员的题面，改完仍要满足 2.2-①。

验收：`validate-manual-batch.mjs` 零 `sense dropped`（或每条都有「舍弃义项：」），
`cd frontend && npx vitest run src/lib/distinction-candidates.test.ts` 绿。

## 4. 阶段 G：synonym 组（814 组）

`distinction-candidates-synonym.json`。这类组的定义是「中文提示相同的近义词」
（晩ご飯 / 夕食 / 夕飯；警察 / 警察官 / 警官）—— 正是「题面这行字在问哪个词」答不出来的那批，
覆盖它们的价值最高。

- 764 个 `reviewedQuestionMeaning: null` 的成员：新写，进 `manual-batch-0035.json` 起，
  每批 ≤ 200 条，`classification: "distinction"`。
- 1,076 个已有题面的成员：**逐组核对**是否满足 2.2-①（同组首义不同）。已有题面来自
  第一批 5,853 条普通审校，当时没看组，所以 警察 / 警察官 很可能都写着「警察」。
  不满足的在原批次里改。
- 抓手优先用人工稿 `summary` 里的说法；`note` 是从 summary 里按成员拆出来的，可能为空。
- synonym 组里 `level: "interchangeable"` 的（可互换）允许首义相同，见 2.2-⑥。

做完这一阶段，把 `frontend/src/lib/distinction-candidates.test.ts` 里回归测试的这两行删掉：

```ts
      // 当前运行时还包含额外的 synonym 审查组；370 组计划不覆盖它们。
      if (group.type === "synonym") return;
```

删掉后测试必须绿——这是阶段 G 的验收，它以后钉住 synonym 组的题面不再回退。
（这是这一轮唯一允许改的代码。）

## 5. 阶段 H：无人工稿的组（253 条）

`distinction-candidates-unreviewed.json`。这些组没有 `summary`：

- **homophone（同音异义，公園 / 講演 / 公演）**：本来就是不同的词，中文天然分得开，
  按普通题面审校写（README 里 `same_meaning` / `manual_translation` / `partial_overlap` 口径），
  `classification` 用那三个之一，**不用 `distinction`**。只要写得准，不必刻意造区别。
- **reading-sense（一形多读·多义，開く あく / ひらく）**：同一表记两个词，必须靠意思分：
  按 2.2 写，`classification: "distinction"`。

## 6. 剩下的 3,000 条（本轮不做，记在这里）

覆盖表 6,611 / 10,609 个种子词。三个阶段做完约 7,700。剩下约 2,900 个词
（N1 ≈ 1,300、N2 ≈ 1,100，其余是散的）不在任何辨析组里，干扰最小，
原文抽检也没有明显质量问题（假名泄漏 47 条、超 20 字 144 条）。
下一轮如果要做，用 `candidate-index` 的老流程按 N3 → N2 → N1 推进，先修那 47 + 144 条。

## 7. 每批写完必跑

```bash
node question-meaning-review/build-runtime-overrides.mjs
node question-meaning-review/validate-manual-batch.mjs
cd frontend && npx vitest run src/lib/distinction-candidates.test.ts src/lib/distinction-quiz.test.ts src/lib/vocab-test-distractors.test.ts src/lib/models/word-distinctions.test.ts
```

最后 `cd frontend && npm test` 全绿再交。

## 8. 交付说明要写什么

- 阶段 F：改了多少条；用了「舍弃义项」的有几条，列出来（这些要人看）。
- 阶段 G：新写多少条、改了多少条已有题面；哪些组你分不开、按可互换处理了（列 groupKey）。
- 阶段 H：homophone 多少条、reading-sense 多少条。
- 覆盖表最终条数。
- **写不出来、拿不准的词单独列一张表**，不要硬编。

## 9. 第三轮（2026-09-16 验收第二轮后补）：自他约定没落地，近义组抓手弱

第二轮验收结果：覆盖表 7,592 条，辨析组成员 100% 覆盖，`sense dropped` 0，
所有 major 组首义两两不同，`npm test` 全绿。**硬约束全部满足。**

但 §2.4 的自他约定实际上没执行——校验器当时按假名查 `verb_pair_hints`（它的键是卡面词形，
有汉字的用汉字），闸门等于没开，模型没看到报错。修好之后 **251 条**不合约定：

```
立てる (他)「竖起；制订；发出，冒起」   → 竖起（旗子、柱子）；制订（计划）；冒起
負ける (自)「输；难以忍受」              → （比赛、人）输；难以忍受
伸びる (自)「伸长（自行）；发展」        → （身高、头发）伸长；发展；（能力）增强
見つける (他)「找到；主动发现目标」       → 找到（东西、人）；发现
```

「（自行）」「主动…」这种写法是把语法标签塞进括号，不是 §2.4 要的**典型搭配**。
括号里放的是这个词平时带什么主语/宾语，那才是用户答题时真正能用上的线索。

### 阶段 I：251 条自他题面（工单 = 校验器 `pair marker` 输出）

```bash
node question-meaning-review/validate-manual-batch.mjs 2>&1 | grep "pair marker"
```

逐条按 §2.4 改：他动词后括号写 1～2 个典型宾语，自动词前括号写 1～2 个典型主语，
从 `distinction-candidates.json` 里该词的 `exampleJp` / `exampleMeaning` 取。
「（自行）」「（主动）」「主动…」「自己…」这类语法标签**删掉**，换成搭配。
义项照 §2.1 全部保留。验收：`pair marker` 为 0。

### 阶段 J：114 个近义组的弱抓手（工单 `synonym-weak-cues.json`）

`question-meaning-review/synonym-weak-cues.json`：major 近义组里没有任何括号、
首义又高度相似的组，带 `summary` 和每个成员现在的题面。例：

```
警察 / 警察官 / 警官   警察机构；警察人员 | 警察人员；警察官 | 警察官称呼   ← 「警察官称呼」不是意思
健康 / 健やか          健康 | 健康的；健全的
チケット / 切符 / 票    票 | 车票；票 | 票，选票
```

按 `summary` 把差别写成括号抓手：警察「警察（机构、统称）」、警察官「警察（个人、正式）」、
警官「警察（口语称呼）」；切符「票（车票、门票）」、チケット「票（演出、机票）」。
写不出真差别的（summary 自己也说可互换的），在 `reason` 里写「可互换」并保持现状，
交付时列出 groupKey。

### 顺手修的 5 条（把语域说明写成了第二义项）

色(いろ)「颜色；日常说法」→「颜色」；色(しょく)「色调；复合词用法」→「色（复合词用）」；
年月(ねんげつ)「年月；书面说法」→「年月（书面）」；来る「来；普通用法」→「来」；
〜書「～书；书面」→「～书（文件）」。「；」后面必须是意思，语域进括号。

### 验收

同 §7，外加 `pair marker` 为 0。交付说明列出阶段 J 里按「可互换」处理的组。

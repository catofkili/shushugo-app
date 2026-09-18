# 执行计划：辨析组题面精修 + 辨析题（2026-09-15）

> 给执行者的话：这份计划由上一轮会话在读完代码后写成，里面的文件路径、函数名、
> 数据形状都核对过。**先通读一遍再动手**；遇到和计划不一致的地方，以代码为准，
> 但要把不一致写进最后的交付说明里。所有工作在 `frontend/` 下，不碰用户真实学习
> 数据（`frontend/.local/live.db` 只读，且本计划不需要它）。

## 0. 背景：问题是什么、做完长什么样

用户在做题时发现 冷やす / 冷ます / 冷える / 冷める 这类词一起出现在选项里，分不开。
根因不是出题算法，是**中文本身分不开**：

| 词 | 库里的 `words.meaning` |
|---|---|
| 冷やす | 冰镇；**冷却** |
| 冷ます | **冷却**；晾凉 |
| 冷える | 变冷；**冷却** |
| 冷める | 变凉；**冷却** |

四个选项三个写「冷却」，这道题考的是猜。

现有的「疑难辨析」（`src/data/confusion_distinction_reviews.ts`，370 组人工稿）
写的是**整组一句话**（「冷える表示东西自己变冷；冷やす表示把东西冷却、冰镇。」），
能读不能问：没有「一条中文 → 唯一一个词」的映射，所以只能看、不能练。

做完之后应该是：

1. 这 370 组里的每个成员都有一条**互相分得开**的题面中文，写进已有的
   `question_meaning_overrides.json`（不新建数据格式）。一份数据三处受益：
   日常正向题的题面、查词汇量的释义题选项、辨析题的题面。
2. 查词汇量的释义题选项优先用这份精修过的中文，而不是 `words.meaning` 原文。
3. 新增「辨析题」：给一条中文线索，选项是这组的成员，选完当场亮组内那句辨析。
   **不进 FSRS、不进当日计划、不新建表**；一组全答对 → 已掌握（复用现有的
   `confusion_mastered`），答错 → 清掉已掌握。

分四个阶段，**A→B→C 一个 commit，D 一个 commit，E 随各自 commit 走**。

## 1. 不许做的事（都是 CLAUDE.md 里钉过的，违反就是回归）

- **辨析题不许写 `reviews` / `progress` / 任何 FSRS 字段。** 答案全露着或者组内四选一的
  评分不是记忆证据，喂给 FSRS 是假数据（见 CLAUDE.md「辨析只有一份」「气泡里没有
  认识/忘记/模糊，以后也别加」）。
- **不新建数据库表。** 新表要在三处登记（`sync/tables.ts`、`scripts/bake-seed-db.mjs`
  的 `userDataTables`、`legacy-word-migrations`），漏一处静默出事。已有的
  `confusion_mastered`（`group_key` 主键，已登记同步 lww）够用。
- **不往 `confusion-groups.ts` 里加分组规则，不另起一份手写组。** 组的数据只有那一份。
- **卡面词形一律走 `confusion-groups.displayForm(member)`**，不许 `kanji || kana`：
  外来語行的 `kanji` 存的是词源（camera / gramme），直接摆出来是在教英文。
- **题面中文里不许出现假名、日文汉字词形**（`validate-manual-batch.mjs` 会拦假名，
  日文词形靠自觉——题面里写着答案等于没出题）。
- **不改 `words.meaning`**（words 表不同步、词单导入会整表覆盖）。精修只进覆盖表。
- 改 `CLAUDE.md` / `question-meaning-review/README.md` 时**只增补不精简**。

## 2. 阶段 A：把 370 组的成员和现状导出来（约半小时）

组是运行时从 `words` 表算出来的（`confusionGroups()`），node 脚本直接读不到，
所以用 vitest 落盘，照 `src/lib/models/confusion-audit.test.ts` 里 `AUDIT_OUT` 的套路。

**新建** `frontend/src/lib/distinction-candidates.test.ts`（env 不给就跳过，
不影响 `npm test`）：

```ts
import { describe, expect, it, vi } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import initSqlJs, { type Database } from "sql.js";

let testDb: Database;
vi.mock("./database", () => ({
  getDatabase: () => testDb,
  initDatabase: async () => testDb,
  exportDatabase: () => null,
  importDatabase: async () => undefined
}));

import { confusionGroups, displayForm, resetConfusionGroups } from "./confusion-groups";
import { distinctionNotesFor, distinctionReviewFor } from "../data/confusion_distinction_reviews";
import { reviewedQuestionMeaning } from "./models/question-meaning-overrides";

// 用法：CANDIDATES_OUT=../question-meaning-review/distinction-candidates.json npx vitest run src/lib/distinction-candidates.test.ts
describe.skipIf(!process.env.CANDIDATES_OUT)("导出辨析组题面候选", () => {
  it("写出每组成员的现状", async () => {
    const SQL = await initSqlJs();
    testDb = new SQL.Database(new Uint8Array(readFileSync(
      fileURLToPath(new URL("../../public/nihongo.db", import.meta.url))
    )));
    resetConfusionGroups();
    const out = confusionGroups().flatMap((group) => {
      const review = distinctionReviewFor(group.key);
      if (!review) return [];
      const notes = distinctionNotesFor(review.summary, group.members.map((m) => ({
        key: String(m.id), forms: [displayForm(m), m.kanji, m.kana]
      })));
      return [{
        groupKey: group.key,
        type: group.type,
        level: review.level,
        summary: review.summary,
        members: group.members.map((m) => ({
          id: m.id,
          kanji: m.kanji,
          kana: m.kana,
          surface: displayForm(m),
          jlpt: m.jlptLevel,
          meaning: m.meaning,
          note: notes.get(String(m.id)) ?? "",
          reviewedQuestionMeaning: reviewedQuestionMeaning(m.kanji, m.kana) ?? null,
          exampleJp: m.exampleJp,
          exampleMeaning: m.exampleMeaning
        }))
      }];
    });
    writeFileSync(process.env.CANDIDATES_OUT!, JSON.stringify(out, null, 2));
    expect(out.length).toBeGreaterThan(300);
  });
});
```

跑：

```bash
cd frontend && CANDIDATES_OUT=../question-meaning-review/distinction-candidates.json npx vitest run src/lib/distinction-candidates.test.ts
```

预期约 370 组、约 900～1,000 个成员。`distinction-candidates.json` **提交进仓库**
（和 `candidate-index.json` 一样，是审校的输入清单）。

⚠️ 成员里 `reviewedQuestionMeaning` 非 null 的（估计三四十个）已经在某个
`manual-batch-*.json` 里有条目。`build-runtime-overrides.mjs` 遇到重复键会直接抛错，
所以这些词**必须改原批次里那条**，不能在新批次里再写一条。用
`grep -rn '"kanji":"冷やす"' question-meaning-review/manual-batch-*.json` 找。

## 3. 阶段 B：写题面（主体工作，约 1,000 条）

### 3.1 产出文件

`question-meaning-review/manual-batch-0022.json` 起（现有到 0021，看目录取下一个号；
一批 200 条左右，方便审）。条目格式同现有批次：

```json
{"kanji":"冷やす","kana":"ひやす","questionMeaning":"冰镇；把…弄凉","classification":"distinction","reason":"pair:冷える / 冷やす — 他动词，人为使某物变冷，和 冷ます（晾凉热的东西）分开"}
```

- `kanji` / `kana` **原样抄候选清单里的**（键是这两个字段，一个字符不对就挂不上）。
- `classification` 一律 `"distinction"`（新值；`validate-manual-batch.mjs` 只统计
  不校验枚举，README 里要补一条口径说明，见阶段 E）。
- `reason` 写组 key 和分开的依据，给审校的人看。

### 3.2 写法规则（每条都要过）

1. **同一组内两两分得开**：任何两个成员的 `questionMeaning` 不能相同，
   **首义（第一个「；」之前）也不能相同**。冷 那组不能再出现三个「冷却」。
2. **单独看仍然是这个词的正确翻译。** 这行字同时是日常正向题的题面，用户看到
   「冰镇；把…弄凉」要能答出 冷やす，不能写成只有在组里才看得懂的暗号
   （❌「他动词那个」）。
3. **分开的抓手写在正文里，不写日文。** 自他对用动作方向：「自己变冷」vs「把…弄凉」；
   汉字使い分け用对象：「找（想要的）」vs「找（丢失的）」；语体组用括号：「明后天（正式）」。
   括号只用全角 `（）`。
4. **不许出现假名、日文词形、罗马字。**「冰镇（ひやす）」会被校验拦下；
   「冷やす」出现在题面里等于把答案印在题上。
5. **长度**：首义 ≤ 8 个汉字（撞车索引 `questionMeaningKeyOf` 按首义 + 8 字截断分组，
   超过的部分不参与判「近不近」）；整条 ≤ 20 字，最多三个义项，用「；」分隔。
6. **以人工稿 `summary` 和拆好的 `note` 为准**，`words.meaning` 原文只是参考——
   它正是分不开的那份。例句（`exampleJp` / `exampleMeaning`）用来确认常用义。
7. **`level: "interchangeable"` 的 25 组也要写**，但允许首义相同、靠第二义或括号分：
   「晚饭；晚餐（口语）」vs「晚饭；晚餐（书面）」——这类组本来就可互换，
   硬造区别是编造语言事实。分不开就写成一样并在 `reason` 里注明「可互换」，
   阶段 D 的出题函数会把这种组整组跳过。
8. 成员里有 `surface` 和 `kanji` 不同的（方括号注音、alternate 表记）照常写，
   键仍然是 `kanji`+`kana`。

### 3.3 示例（冷 那两组，直接可用）

```json
{"kanji":"冷える","kana":"ひえる","questionMeaning":"自己变冷；发凉","classification":"distinction","reason":"pair:冷える / 冷やす — 自动词，天气、身体、饮料自己变凉"},
{"kanji":"冷やす","kana":"ひやす","questionMeaning":"冰镇；把…弄凉","classification":"distinction","reason":"pair:冷える / 冷やす — 他动词，人为冷却，常指用冰或冰箱"},
{"kanji":"冷める","kana":"さめる","questionMeaning":"变凉（热的东西、热情）","classification":"distinction","reason":"pair:冷ます / 冷める — 自动词，饭菜放凉、兴趣冷淡"},
{"kanji":"冷ます","kana":"さます","questionMeaning":"晾凉；使冷却","classification":"distinction","reason":"pair:冷ます / 冷める — 他动词，把热的东西放凉"}
```

⚠️ 覚める（さめる，醒来）和 冷める 是同音异义，不在人工稿组里，不要顺手写它。

### 3.4 每批写完要跑的三条

```bash
node question-meaning-review/build-runtime-overrides.mjs
node question-meaning-review/validate-manual-batch.mjs
cd frontend && npx vitest run src/lib/models/word-distinctions.test.ts src/lib/confusion-distinction-reviews.test.ts src/lib/models/question-meaning-index.test.ts
```

（第三条里哪个测试文件不存在就去掉；目的是确认改覆盖表没打坏题面和撞车索引。）

### 3.5 组内唯一性校验（新加，阶段 B 的验收）

在阶段 A 那个测试文件里再加一个 `it`，**不按 env 跳过，常驻 `npm test`**：

```ts
it("人工辨析组的每个成员题面首义互不相同（可互换组除外）", () => {
  const firstSense = (t: string) => t.split(/[；;]/)[0].trim();
  const bad: string[] = [];
  confusionGroups().forEach((group) => {
    const review = distinctionReviewFor(group.key);
    if (!review || review.level !== "major") return;
    const seen = new Map<string, string>();
    group.members.forEach((m) => {
      const q = reviewedQuestionMeaning(m.kanji, m.kana);
      if (!q) { bad.push(`${group.key}: ${displayForm(m)} 没有题面`); return; }
      const fs = firstSense(q);
      if (seen.has(fs)) bad.push(`${group.key}: ${displayForm(m)} 与 ${seen.get(fs)} 首义都是「${fs}」`);
      seen.set(fs, displayForm(m));
    });
  });
  expect(bad).toEqual([]);
});
```

阶段 B 没写完之前这条是红的，**写完必须绿**。它以后钉住的是：
再加人工辨析组时，成员题面不能忘了写。

## 4. 阶段 C：查词汇量的释义题选项换口径（约 20 行）

`frontend/src/lib/vocab-test.ts` 第 195～210 行 `wordRows()`，
`meaning: asText(row.meaning)` 改成优先读覆盖表：

```ts
import { reviewedQuestionMeaning } from "./models/question-meaning-overrides";
// ...
meaning: reviewedQuestionMeaning(asText(row.kanji), asText(row.kana)) ?? asText(row.meaning),
```

只改这一处就够：`answerIndexBySurface` 的 `meanings` 索引、`optionValue`、
`alsoCorrect` 判重全部读 `row.meaning`，口径自动一致。

不改 `promptFor`（题面是日文词，和这次无关）。

验收：`npx vitest run src/lib/vocab-test.test.ts src/lib/vocab-test-distractors.test.ts`
全绿；在 `vocab-test-distractors.test.ts` 里加一条：冷やす 的释义题四个选项首义两两不同
（用 `public/nihongo.db` 那套加载方式，文件里已有）。

## 5. 阶段 D：辨析题（新页面 + 一个纯函数模块）

### 5.1 `frontend/src/lib/distinction-quiz.ts`（纯函数，可测）

```ts
export interface DistinctionQuestion {
  groupKey: string;
  prompt: string;              // 答案那个成员的 reviewedQuestionMeaning
  options: { id: number; surface: string }[];   // 组内全部成员，displayForm，打乱
  answerId: number;
  summary: string;             // 组的人工稿 summary
  notes: Map<string, string>;  // distinctionNotesFor 拆出的按成员注，key = String(id)
}

export type QuizScope =
  | { kind: "group"; key: string }
  | { kind: "type"; type: ConfusionType }
  | { kind: "today" }          // 今天正向题里出现过的词所在的组
  | { kind: "learned" };       // 至少两个成员 progress.seen_count > 0 的组

export function quizGroups(scope: QuizScope): ConfusionGroup[];
export function buildQuestions(groups: ConfusionGroup[], rng?: () => number): DistinctionQuestion[];
export function settleGroup(groupKey: string, allCorrect: boolean): void;
```

规则：

- `quizGroups` 只收**有人工稿、`level === "major"`、成员 ≥ 2、每个成员都有
  `reviewedQuestionMeaning` 且首义两两不同**的组。缺一个成员题面就整组跳过，
  **不回退到 `words.meaning`**——回退回去就是「三个冷却」。
- `today`：`SELECT DISTINCT word_id FROM reviews WHERE reviewed_on = ? AND direction = 'forward'`
  （`studyDate()` 在 `word-api/stubborn-today.ts` 里怎么取就怎么取），词所在的组用
  `confusionGroupsForWord(id)`，按 key 去重。
- `learned`：`progress.seen_count > 0` 的 id 集合，组内命中 ≥ 2 个才要。
- `buildQuestions`：每组每个成员一题，题在组内相邻（先把这组的题出完再换组）；
  组的顺序打乱；一场上限 24 题（超过就按组截断，别截到半组）。
- `settleGroup`：`setConfusionMastered(key, allCorrect)`——全对置 1，有错清掉。
  它已经 `persistSoon()` 了，不用再喊。**不写别的表。**

### 5.2 `frontend/src/pages/DistinctionQuizPage.tsx`

照 `VocabTestPage.tsx` 的选项按钮样式（四个大按钮，选中后正确项绿、错选红），
**不要计时器**。每题选完显示：对/错、该组 `summary`、四个选项各自的 `note`
（`notes.get(String(id))`，没有就不显示）。「下一题」手动点。

结束页：按组列出 全对 / 有错，全对的组标「已掌握」（就是 `settleGroup` 写进去的），
有错的组给一个「再练这组」按钮（scope = group）。底部一个「回疑难辨析」。

scope 从 URL / props 传入；页面挂载时 `warmConfusionGroups()` 已经在学习页做过，
这里直接调 `quizGroups` 即可（首次 112ms 可接受）。

`quizGroups` 返回空数组时显示一句「这个范围里还没有能练的组」，不报错。

### 5.3 路由与入口

- `App.tsx`：照 `ConfusionPage` 的懒加载 + `renderToolSubpage(...)` 写法加一页，
  标题「辨析练习」。查 `toolPageTitles` 的形状，加一个键。
- `ConfusionPage.tsx`：
  - 头部（类别 chip 那一排旁边）一个「练一练」按钮：当前选中某一类 → `type` scope；
    没选 → `learned` scope。
  - 每张组卡片的详情里（`open` 那个大卡）一个「练这组」：`group` scope。
    只在 `quizGroups({kind:"group",key})` 非空时显示——没题面的组按钮不出现。
- 完成页 `features/word-study/WordStudyPanels.tsx`：在「今天的顽固词」那张卡**下面**
  加一张「今天碰到的易混组 N 组」，N = `quizGroups({kind:"today"}).length`，
  N = 0 整卡不出现。一个按钮「练一练」→ `today` scope。
  和顽固词一样**只在完成页现算一次**。

**不加进 `STUDY_MODES`**：模式是「换选词通道」，这个是另一种题型 + 另一个页面，
和查词汇量同级，是工具页。

### 5.4 测试 `frontend/src/lib/distinction-quiz.test.ts`

用 `confusion-distinction-reviews.test.ts` 那套 sql.js + `public/nihongo.db` 加载：

1. `buildQuestions` 出的每题：`options` 里恰好一个 `id === answerId`；
   `prompt` 等于答案成员的 `reviewedQuestionMeaning`；同组题的 prompt 两两不同。
2. 手造一组：某成员没有题面 → `quizGroups` 不含这组。
3. `settleGroup(key, true)` 后 `masteredConfusionKeys()` 含 key；
   `settleGroup(key, false)` 后不含。
4. `reviews` 表在整个测试前后行数不变（钉「不进 FSRS」）。

## 6. 阶段 E：文档（随对应 commit 提交，只增补）

- `question-meaning-review/README.md`：判定口径加一条
  `distinction`：人工辨析组的成员，题面必须在组内两两分得开；附阶段 A 的导出命令和
  阶段 B 的规则 1～8。
- `CLAUDE.md`「辨析只有一份」那节末尾加一小节「辨析题（2026-09-xx）」，写清：
  不进 FSRS、不新建表、已掌握复用 `confusion_mastered`、缺题面整组跳过不回退、
  可互换组不出题；以及「查词汇量释义题选项走覆盖表」这一条。
- 阶段 B 的验收测试（3.5）留在 `distinction-candidates.test.ts` 里常驻。

## 7. 交付顺序与验收

| commit | 内容 | 必须绿 |
|---|---|---|
| 1 | 阶段 A 导出测试 + `distinction-candidates.json` + 阶段 B 全部批次 + 覆盖表重建 + 阶段 C + README | `node question-meaning-review/validate-manual-batch.mjs`；`cd frontend && npm test` |
| 2 | 阶段 D 全部 + CLAUDE.md | `cd frontend && npm test`；`npm run build` 不报错；`npx tsc --noEmit` |

commit message 正文写清：改了多少条题面、多少组因「可互换」或「分不开」跳过、
跳过的组 key 列表（放在 message 里而不是代码里）。

最后在交付说明里列出：**哪些组你写不出互相分得开的题面**（不要硬编），
让人工来决定。

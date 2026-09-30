# 开口练习（日常会话）实现规格 —— ⚠️ 实验功能，不进任何发布包

> 内容来源：[`DAILY_CONVERSATION_CORPUS.md`](DAILY_CONVERSATION_CORPUS.md)（30 条说话公式 + 15 个场景 60 句）。
> 方向：2026-09-25 会话里定的「看情景 → 开口说 → 翻面对照」，2026-09-30 用户确认按这个方向做，
> 并说场景图可以用 image2.5 生成（当时「看图说话」是因为没图才延后的，现在一起做）。
> 分工：Claude 定规格、做发布闸门和同步层、审内容；Codex 做实现（难的 gpt-6.1-sol，简单的 gpt-6-luna max）。

## 0. ⚠️ 发布闸门（先读这一节）

用户原话：「这个功能初期肯定上不了，要备注好，不要把断头工作上传到要发布的小程序 / App 上」。

**唯一的开关是编译期常量 `__EXP_TALK__`**（布尔字面量，由构建工具替换，不是运行时变量）：

| 构建 | `__EXP_TALK__` | 怎么打开 |
|---|---|---|
| 网页开发服务器（`vite`，5173 / 5199…）、vitest | `true` | 默认开 |
| 网页 / iOS 正式构建（`vite build`） | `false` | `SHUSHUGO_EXP_TALK=1 npm run build`（只给自测用） |
| 小程序（`taro build`） | `false` | `SHUSHUGO_EXP_TALK=1 npm run build:weapp`（只出预览码，**永远不许上传**） |

硬规则：

1. **开口练习的代码只能从三个入口被引用**，每个入口都包在 `__EXP_TALK__` 里：
   `frontend/src/routes/index.ts` 的路由表、主页上的入口按钮、`taro-spike-2/src/platform/route-table.cjs` 的页面登记。
   `lib/` 里任何非 `lib/talk/` 的模块都不许 import `lib/talk/`（同步合并也不许，见 §3）。
   这样 `__EXP_TALK__ = false` 时打包器整段摇掉，发布包里一个字节都没有。
2. **小程序上传前 `npm run check:release` 会拦**：`app.json` 里有 `talk` 页面、或者产物里出现
   `__SHUSHUGO_EXP_TALK__` 标记字符串，就不许上传。`lib/talk/` 的入口模块里放一句
   `export const TALK_MARKER = "__SHUSHUGO_EXP_TALK__";` 并在页面里用到它（防止被摇掉），
   这是检查脚本认的指纹。
3. **iOS 发版脚本 `scripts/build-ios.sh` 见到 `SHUSHUGO_EXP_TALK=1` 直接退出。**
4. 上线那天要做的事列在 §7，**在那之前谁也不许把 `__EXP_TALK__` 的默认值改成 true**。

## 1. 产品：看情景 → 开口说 → 翻面对照

**不打字、不做选择题、App 不听也不判**。选择题练的是认出来（正确率接近百分之百、没有难度），
打字和「减轻做题压力」冲突。所以：题面给情景，用户出声说一遍，翻面看标准说法 + 听音频。

### 1.1 两种卡

| 卡 | key | 题面 | 用户要说的 |
|---|---|---|---|
| 公式卡 | `f:<公式id>`（`f:F02`） | 场景图（有的话）+ 中文意图，槽位每次换一个词：「向店员要：水」 | 公式套上这个词：`お水をお願いします。` |
| 接话卡 | `r:<场景id>:<行号>`（`r:S01:1`） | 场景图 + 场景标题；**自动播放对方上一句的音频，文字先藏着** | 自己这一句：`はい、お願いします。` |

- 接话卡：场景里每一句 `self: true` 的话都是一张。前一句是对方说的，就先播对方那句；
  它是开场白（前面没有对方的话），题面改成这一句的中文意思。
- 接话卡练的是真实对话里最难的那一下反应，所以对方那句**先听后看**，文字要点提示才露出来。

### 1.2 评分：不点四档，按用了几次提示自动算

一级一级给台阶，想不起来就点「提示」，点到底就是翻面：

| 卡 | 提示 1 | 提示 2 | 提示 3 |
|---|---|---|---|
| 公式卡 | 句型骨架（公式的 `skeleton`，槽位已填好：`お水を ……`） | 开头几个字（答案前 40%，至少 2 个字符，后接「…」） | 翻面 |
| 接话卡 | 对方原文 + 中文 | 我这句的中文意思 | 开头几个字 |

- 用了 0 次 → `know`；1 次 → `fuzzy`；2 次及以上 → `forgot`。翻面本身不算提示。
- 翻面后主按钮是「下一张」（按上面规则记账）；旁边一个次要的「没说对」→ 记 `forgot`。
  这是给诚实的人留的口子，不强迫；和疑难连线卡「按连错几次算、不让用户选分」同一个思路。
- **提示用量只在这一张卡的这一次作答里算**，不跨卡、不存库（存的是折算后的 answer）。

### 1.3 槽位：每次换一个词，免得背成顺口溜

- 每条公式在内容里带一组候选词（8–12 个，日文 + 中文，能在词库里查到的带 `wordId`）。
- 出卡时从候选里挑一个：**优先挑用户学过的词**（`progress.seen_count > 0`），同一张卡尽量不和上次用同一个词
  （上次用的词记在 `talk_reviews.filler` 里）；学过的一个都没有就在全部候选里随机。
- FSRS 按公式记忆（key 是 `f:F02`，不按「公式 + 词」），所以每次练的都是新句子，但调度的是公式本身。
- 有的公式有两个槽位（F11 `[A]と[B]は、どう違いますか`）——候选按组给（`fillers` 里一项就是一组完整替换）。

### 1.4 场景图

15 个场景各一张（`frontend/public/talk/scenes/S01.jpg` … `S15.jpg`），由 Codex 用图像生成（image2.5）出。
**图里不许有任何文字**（生成的日文是乱码，而且会把答案露出来）。风格跟品牌贴纸（`frontend/public/brand/sheet/`）走：
暖色、奶油底、扁平插画，「我」是那只水豚。公式卡如果能挂到某个场景就显示那张图，挂不上就只有中文。

### 1.5 隔离

- 不进每日计划、圆环、混合学习、自动选词、备考额度、成就、柚子、周报。只有自己一个入口（主页「学习工具」里一格，同样包在 `__EXP_TALK__` 里）。
- 每天新卡 `TALK_NEW_PER_DAY = 5`（常量，实验期不做设置项），复习到期全出。
  新卡顺序按场景走：场景 1 里自己要说的话用到的公式先出公式卡、再出这个场景的接话卡，然后场景 2……
- 音频：对方那句和翻面后的标准说法都走 `speech.playExample(text)`（没有预生成音频时退回系统语音；
  小程序里没有系统语音，所以小程序预览版暂时可能没声音，见 §7）。

## 2. 内容格式（`frontend/src/data/talk_content.json`，懒加载）

```ts
interface TalkContent {
  version: string;                // 内容版本，改内容就改
  formulas: TalkFormula[];
  scenes: TalkScene[];
}
interface TalkFormula {
  id: string;                     // "F02"，跟 corpus 文档一致，永不改（它是记忆的 key）
  intent: string;                 // 想做什么（中文）「说自己想要」
  pattern: string;                // "[物]をお願いします。"  槽位写成 [名字]
  skeleton: string;               // "[物]を ……"  提示 1 用，槽位同名
  prompt: string;                 // 中文题面模板「向店员要：{物}」，槽位写成 {名字}
  note: string;                   // 使用提醒（翻面后显示）
  fillers: Array<Record<string, { ja: string; zh: string; wordId?: number }>>;
                                  // 每项是一组完整替换：[{ 物: { ja: "お水", zh: "水", wordId: 123 } }, …]
  scene?: string;                 // 挂哪个场景的图（可选）
}
interface TalkScene {
  id: string;                     // "S01"
  title: string;                  // 「便利店：便当加热」
  note?: string;                  // 场景下面那段提醒
  lines: Array<{
    speaker: string;              // 「店员」「顾客」……
    self: boolean;                // 这句是不是学习者要说的
    ja: string;
    zh: string;
    formulas: string[];           // ["F02", "F22"]；听力入口 / 朋友语体等没有公式的写 []
  }>;
}
```

- 公式 `pattern` 里的槽位名、`skeleton` 里的、`prompt` 里的、每组 `fillers` 的键，四处必须一致。
- 填好的句子必须是通顺的日语（「お水をお願いします」可以，「雨をお願いします」不行）——所以候选词是**人挑的**，不是从词库里随便抽名词。
- `wordId` 按出厂库 `words` 表 `kanji`/`kana` 查；查不到就不写，不许猜。

## 3. 存储：三张表，**只在本机，不上云**

和单独汉字卡、疑难连线卡同一套（`lib/card-log.ts`：流水是事实、memory 是检查点、tasks 是当天投影）：

```sql
-- local-schema.sql（照例建在这里，ensureSyncSchema 才会给它们挂触发器）
talk_memory  (card_key TEXT PRIMARY KEY, seen_count…, fsrs_*…, known_forever…)   -- 列照 confusion_progress
talk_reviews (id INTEGER PRIMARY KEY AUTOINCREMENT, card_key, reviewed_on, reviewed_at, answer, hints INTEGER, filler TEXT, …) -- 列照 confusion_reviews，多 hints / filler 两列
talk_tasks   (reviewed_on, card_key, …, PRIMARY KEY (reviewed_on, card_key))  -- 列照 confusion_tasks
```

`sync/tables.ts` 里登记，但带 **`cloud: false`**：

```ts
{ table: "talk_memory", keys: ["card_key"], strategy: "lww", cloud: false },
{ table: "talk_tasks", keys: ["reviewed_on", "card_key"], strategy: "lww", cloud: false },
{ table: "talk_reviews", keys: ["sync_uid"], strategy: "append", cloud: false },
```

⚠️ **为什么不上云**：合并前的 `assertSnapshotWritable` 见到本版本不认识的表就**整次拒绝同步**
（「云端学习数据包含当前版本无法保留的表，请先更新应用」）。作者自己的 5173 开发版打开了这个功能，
而作者手机上装的是已发布的 1.0.0 —— 开发版只要把 `talk_*` 推上云，手机就再也同步不了。

`cloud: false` 的语义（Claude 在 `sync/` 里实现，Codex 不用动）：

- **本机落盘照常**：`SYNCED_TABLES` 里仍有它们，所以触发器会盖 `sync_updated_at`、`local-delta` 的增量会带上它们，
  删除留墓碑（撤销作答要靠它在重启后仍然生效）。
- **不进云快照**：`syncedTablesForCloud()` 过滤掉；导出时它们的墓碑也不带。
- **合并不碰它们**：本机的 `talk_*` 行原样保留。
- **收到带 `talk_*` 的云快照一律拒绝**（`assertSnapshotWritable` 不把 `cloud: false` 的表算作「认得的」）：
  上线之后，还没更新的旧版本会提示「请先更新」，而不是收下再在下一次上传时把它们从云端削掉。

照例三处登记：`sync/tables.ts`、`scripts/user-data-tables.mjs`（出厂库泄漏守卫）、`local-schema.sql`。
`legacy-word-migrations` 的合并搬迁**不用管**：talk 的记忆按公式 / 场景行存，不挂 `word_id`（`filler` 里存的是词形文本）。

## 4. 代码布局与接口（Codex 按这个写）

```
frontend/src/lib/talk/
  content.ts     loadTalkContent() / talkContentLoaded() / talkContent()   懒加载 JSON
  cards.ts       卡片生成：allCardKeys()、talkCard(key, day) → TalkCard（题面、提示、答案、音频文本、图）
  schedule.ts    ensureTalkTables()、createTalkTasks(day)、pickTalkNext(day)、recordTalkAnswer(key, hints, gaveUp, filler)、
                 undoLastTalkAnswer()、talkProgress(day)、replayTalkReviews()   —— 全部基于 createCardLog
  index.ts       对外只从这里出；含 TALK_MARKER
frontend/src/pages/TalkPage.tsx          页面（设计系统：三种面、两种控件、MascotSay）
frontend/src/routes/talk.tsx             ToolSubpage 包一层
taro-spike-2/src/study/talk/index.tsx    小程序页面（照 study/vocab-test/index.tsx）
```

```ts
type TalkHintLevel = 0 | 1 | 2 | 3;
interface TalkCard {
  key: string;                      // "f:F02" | "r:S01:1"
  kind: "formula" | "reply";
  sceneId?: string; sceneTitle?: string; image?: string;  // "/talk/scenes/S01.jpg"
  prompt: string;                   // 中文题面（接话卡是场景标题下那行说明）
  partnerLine?: { speaker: string; ja: string; zh: string };  // 接话卡：对方那句（先只播音频）
  hints: string[];                  // 按 §1.2 的顺序，长度 2 或 3
  answer: { ja: string; zh: string };
  note?: string;
  filler?: string;                  // 本次用的词形（记进流水，下次避开）
}
const answerForHints = (hintsUsed: number, gaveUp: boolean): WordAnswer =>
  gaveUp || hintsUsed >= 2 ? "forgot" : hintsUsed === 1 ? "fuzzy" : "know";
```

## 5. 验收（每个 Codex 任务自己的那部分）

- 数据层：`lib/talk/*.test.ts`——同一张公式卡连续出两次换词、学过的词优先、提示次数 → 评分、撤销能精确回到上一状态、
  新卡顺序按场景、每天新卡不超过 5、`talk_*` 不出现在 `syncedTablesForCloud()` 和导出的快照里。
- 内容：`lib/talk/content.test.ts`——四处槽位名一致、场景行引用的公式都存在、id 唯一、每条公式至少 8 组候选、
  带 `wordId` 的在出厂库里真能查到且词形对得上。
- 闸门：`__EXP_TALK__ = false` 时 `vite build` 产物里搜不到 `__SHUSHUGO_EXP_TALK__`；
  `taro build`（不带环境变量）后 `check:release` 通过、`app.json` 没有 talk 页；带环境变量时 `check:release` 失败。
- 页面：独立端口（≥ 5200）375×812 浅色 / 深色各截一张，公式卡、接话卡、翻面、完成页；**不许打开 / 刷新 5173**。

## 6. 暂时不做

- 语音识别打分（学习者发音识别不准，被机器误判比没反馈更打击人；WKWebView 里也基本不可用）。
- 录音回放对比（加分项，放第二版）。
- 设置项（每日新卡数、开关）、上云、成就 / 柚子挂钩。

## 7. 上线清单（真要发布时按顺序做，缺一条都别发）

1. 内容终稿过一遍人审（日文由 Claude / 作者核，不接受外部 AI 自己说「核对过」）。
2. 预生成音频：对方的话、每句标准说法、每条公式 × 每组候选的填好句子（VOICEVOX，走例句管线）。
   小程序没有系统语音，没音频的话接话卡在小程序里是哑的。
3. 场景图压缩后确认小程序分包体积（每包 2 MiB）。
4. 同步：先发一版「认得 `talk_*`、但仍 `cloud: false`」的所有端（它们收到带 talk 的快照会拒绝，不会削数据）→
   等所有端都更新 → 再发 `cloud: true` 的版本，并在 `sync/merge.ts` 的重放那段接上 `replayTalkReviews`
   （和 `replayConfusionReviews` 同一处，动态 import）。
5. 删掉 `__EXP_TALK__` 和 `SHUSHUGO_EXP_TALK`，删掉 `check-release.mjs` 那两条拦截，删掉 `build-ios.sh` 那行。
6. Pro 与否、成就 / 柚子挂不挂，发之前问作者。

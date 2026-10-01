# 开口练习（日常会话）实现规格 —— ⚠️ 实验功能，不进任何发布包

> 内容来源：[`DAILY_CONVERSATION_CORPUS.md`](DAILY_CONVERSATION_CORPUS.md)（2026-10-02 起 32 条说话公式 + 30 个场景 168 句；初版是 30 条 + 15 个场景 60 句）。
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

### 1.0 2026-10-02 改版（和下面各节冲突时以本节为准）

作者原话：「我是想要一个语音转文字效果的，让用户语音转文字给他看文字，但还是由用户自己决定是对是错，
我们不对用户的文字准确度打分，然后这种具体场景应该让用户自己选择自己要练什么场景」；
「回复性质的题看情况应该可以不给文字只给听力的，交给用户自己决定吧」。三件事：

1. **场景由用户自己挑，不再每天自动推 5 张新卡。** 首页是 30 个场景的格子（2 列，≥600 宽 3 列），每格写「n 句」/「练过 x / n 句」/
   「已收集」，有到期的再加「待复习 k」；有到期卡时格子上面一颗「复习 n 张」。
   - 一场的卡（`sceneSessionKeys`）：按对话顺序，每句自己的话之前放它用到的、这一场还没放过的公式卡，然后是这句的接话卡；
     最后补 `scene === 这个场景` 的公式卡。**场景练习里公式卡配这一场的图**（`talkCard(key, { sceneId })`），不配公式自己挂的场景。
   - 一场之内：「没说对」或用了 ≥2 条提示的卡排到本场末尾再来一次，每张最多一次（`lib/talk/session.ts`）；进度分母不含重来。
   - 复习（`talkDueKeys`）：`seen_count > 0` 且 `fsrs_due <= 学习日边界`，按到期先后。
   - 完成页：「这个场景练完了」+ 新收集到的场景横卡 +「再练一遍 / 换个场景」。收集判据不变（这个场景的接话卡都答过）。
   - 删掉的：`TALK_NEW_PER_DAY`、`createTalkTasks`、`extendTalkTasks`、`pickTalkNext`、`talkProgress`、图鉴弹层。
     `talk_tasks` 表**留着、不再写入**：`card-log` 的 `tasksTable` 是必填配置，删表要连 card-log 一起改，不值。
   - 欢迎卡：从没答过时格子上面一张横排小卡（插画 +「看场景，开口说一句 / 挑一个场景开始」），**不放按钮**——下面的格子就是入口。
2. **「说一句」：语音转文字，只给用户看，不打分。** 见 §1.9。
3. **接话卡对方那句「看字 / 只听」由用户选**（对方那块右上角两段开关，记在本机 `localStorage` 的 `shushugo-talk-listen-only`，默认看字）：
   - 看字：对方原文 + 中文直接摆出来，**不算提示**；提示只剩「我这句的中文 → 开头几个字」两条。
   - 只听：原文藏着，第 1 条提示才在对方那块里露出来（算一次提示），后面两条同上。
   - **放不出声音时没法只听**（小程序预览版、音频文件缺失）：一律摆出原文、开关不出现、提示同「看字」。
     原来的实现在这种情况下原文已经摆着，第 1 条提示却还是同一句原文、还算一次——白扣用户一档评分，改版时一并修了。
   - 开关只在还没用提示、没翻面时出现（用了提示再切模式，提示的序号就对不上了）；「再听一遍」是对方那块标题行里的小喇叭。
   - 为了让接话卡在 375×812 上「翻面」不掉出屏幕：练习卡上的场景图裁成 16:9（格子里仍是 4:3），开口说话 / 有转写时图让位。

**不打字、不做选择题、App 不判**（2026-10-02 起 App 会「听」——语音转文字给用户自己对照，见 §1.9；仍然不判对错）。选择题练的是认出来（正确率接近百分之百、没有难度），
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
  （上次用的词记在 `talk_reviews.filler` 里）。
- 学过的一组都没有时，**只在最容易的那一档里挑**：一组的难度 = 组内 wordId 里最难的 JLPT 等级（没有 wordId 的组算 N3）。
  2026-10-01 以新用户身份实测，原来「全部随机」让第一张卡就抽到 N2 的 領収書。
- FSRS 按公式记忆（key 是 `f:F02`，不按「公式 + 词」），所以每次练的都是新句子，但调度的是公式本身。
- 有的公式有两个槽位（F11 `[A]と[B]は、どう違いますか`）——候选按组给（`fillers` 里一项就是一组完整替换）。

### 1.4 场景图

30 个场景各一张（`frontend/src/assets/talk-scenes/S01.jpg` … `S30.jpg`；S16–S30 是 2026-10-02 加的旅行 / 生活场景），由 Codex 用图像生成（image2.5）出。
⚠️ **不放 `public/`**：Vite 会把 `public/` 整个拷进产物，开关关着也会带上这 1.2 MB；由 `lib/talk/image-src.ts` 引用，
只有开口练习的代码块用到它们。小程序预览版由 Taro 的 copy 规则（只在开关打开时）拷进 `study/talk/scenes/`。
**图里不许有任何文字**（生成的日文是乱码，而且会把答案露出来）。风格跟品牌贴纸（`frontend/public/brand/sheet/`）走：
暖色、奶油底、扁平插画，「我」是那只水豚，**对方（店员、厨师、站务员、医生、朋友）全是鳄鱼**（作者 2026-10-01 定的：角色围绕鳄鱼和水豚；
鳄鱼和柚子商店的鳄鱼皮肤是同一个形象）。打电话的场景用画面一角的圆形小窗画对方。公式卡如果能挂到某个场景就显示那张图，挂不上就只有中文。
另有两张透明底插画 `frontend/src/assets/talk-art/`：`talk-hero.png`（聊天，欢迎卡用）、`talk-done.png`（击掌，完成页用）。
翻面后场景图收起：答案和「下一张」要在 375×812 的一屏里。

### 1.5 隔离

- 不进每日计划、圆环、混合学习、自动选词、备考额度、成就、柚子、周报。只有自己一个入口（主页「学习工具」里一格，同样包在 `__EXP_TALK__` 里）。
- ~~每天新卡 `TALK_NEW_PER_DAY = 5`（常量，实验期不做设置项），复习到期全出。~~ 2026-10-02 起作废：场景由用户自己挑，见 §1.0。
  新卡顺序按场景走：场景 1 里自己要说的话用到的公式先出公式卡、再出这个场景的接话卡，然后场景 2……
- 音频见 §1.8。

### 1.6 欢迎卡、场景图鉴、再练 5 张（2026-10-02 起图鉴弹层和再练 5 张作废，见 §1.0；收集判据仍有效）

- **欢迎卡**：从没答过任何一张（`talkEverAnswered()`）时，先给一张卡：聊天插画 + 「看场景，开口说一句」+ 两行说明 + 开始。只出现这一次。
- **场景图鉴**（「收集日」的收集）：一个场景里所有接话卡都至少答过一次 = 收集到。全部从 `talk_memory` 现算（`talkSceneCollection()`），不建表。
  页头「图鉴 n/15」打开底部弹层：3 列缩略图，没收集到的灰度 + 「还差 n 句」。完成页把这一场新收集到的场景排成横卡放在最下面。
- **再练 5 张**：完成页的次要按钮。`extendTalkTasks(day, 5)` 先补没见过的（按新卡顺序），不够再补到期最早的；分母跟着任务表变。
  加餐的旧卡可能还没到期——判「今天做完」的口径是**今天答过且已毕业**（`talkTaskStates`），不改共享 card-log 的判据。
- 「上一张」只在今天有可撤的作答时出现（`canUndoTalk(day)`）。

### 1.7 注音

- 构建期生成：`frontend/scripts/build-talk-furigana.mjs` 用 kuromoji 给所有会出现在界面上的句子（场景 60 句 + 公式×候选，去重 541 句；2026-10-02 扩到 168 句场景台词，注音表连提示前缀共 1156 条，
  句子清单在 `lib/talk/sentences.ts`，音频脚本共用）预先算 `FuriganaAnnotation`，写 `frontend/src/data/talk_furigana.json`（`{ 句子: annotations }`），运行时查表。
- ⚠️ kuromoji 在**数字 + 量词**和复合词上几乎一定错（十分 → じゅうぶん、一日 → いちにち、替え玉、素泊まり、試着…），
  人工覆盖表 `frontend/scripts/talk-furigana-overrides.json` 先于 kuromoji 生效（2026-10-01 共 38 处，282 种读音 Claude 逐条核过）。
  改了内容一定要重跑脚本：`furigana.test.ts` 和 `verify-talk-content.mjs` 会因为句子对不上而红。
- 渲染：页面里一个小的 `TalkRuby`，按 annotations 切成文字 / `JapaneseRubyText`。**不用 `JapaneseRuby`**（那个带语法弹层，太重）。

### 1.8 音频

- 预生成：`frontend/scripts/build-talk-audio.mjs`，句子清单同 §1.7（329 句会出声的；2026-10-02 起 453 句、3.3 MB），**照搬例句管线**（`voicevox-synth.mjs` 是从
  `build-example-audio.mjs` 抽出来的共享部分）：读音按 `talk_furigana` 校对、拍数一致锁回明确假名、句调迁移、speaker 8（春日部つむぎ，
  和单词 / 例句同一个声音）、ADTS AAC-LC 24 kbps。字母（M サイズ、ATM、A/B セット）注音盖不住，人判过的放
  `talk-audio-review.json` 的 `accepted`。
- 放 `frontend/src/assets/talk-audio/voicevox-8/`（2.5 MB，**不放 public/**，理由同场景图），`lib/talk/audio.ts` 用 glob 引用；
  一次只播一句，换卡 / 离页停掉，文件放不出来退回系统语音。
- 小程序：分包放不下（每包 2 MB），`audio.weapp.ts` 一律「放不出来」，接话卡直接显示对方原文。上线前要把音频传云端（§7）。

### 1.9 语音转文字（2026-10-02）

- **只给用户看，不打分、不标红差异、不显示相似度、不影响评分、不存库**，换卡就清。评分仍然只看提示次数和「没说对」。
  理由同 §6：学习者的发音机器识别不准，被误判比没反馈更打击人；把字摆出来让用户自己对照，判断权在用户手里。
- 卡片上翻面前一颗「说一句」（lucide `Mic`），点了开始听、再点停；边说边出字，摆在「你说的」inset 块里，翻面后留在标准说法上面。
  开始听之前先停掉对方的音频（不然把音箱的声音录进去）。键盘 `M`。
- 接口：`lib/talk/speech-input(.weapp).ts` 导出 `speechInputAvailable()` 和 `listen(onText, onEnd, onError[, onStatus]) → stop()`。
  错误码和文案在 `TalkPage` 的 `PracticeCard` 里一处：`not-allowed`「没有麦克风权限，直接出声说也可以」（**这一页里按钮不再出现**——
  拒了权限之后每点必败）、`no-speech`「没听到，再说一次」，其它静默结束。
- 网页：浏览器自带的 `SpeechRecognition` / `webkitSpeechRecognition`，`ja-JP`、`interimResults`。
  ⚠️ **iOS App（Capacitor）里一律不显示**：WKWebView 暴露了这个对象但权限框永远不弹（WebKit bug 225298），要原生插件，留到上线（§7）。
- 小程序：微信「同声传译」插件**不支持日语**，作者选了**腾讯云一句话识别**（`16k_ja`）：录音 → 云函数 `talk-asr` → 文字，
  停止后有「识别中…」。云函数部署和密钥要作者自己做（`wechat-miniprogram/README.md` 那一节）；没部署时报「语音识别还没开通」并隐藏按钮。

## 2. 内容格式（`frontend/src/data/talk_content.json`，懒加载）

```ts
interface TalkContent {
  version: string;                // 内容版本，改内容就改
  groups?: Array<{ id: string; title: string }>;  // 2026-10-02：首页场景格子的分组小标题（吃喝 / 购物 / 出行……），按这个顺序
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
  group?: string;                 // 属于哪个 groups[].id；verify 要求每个场景都有、每组都不空
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

## 5.5 已知限制（2026-10-01）

- 落盘：答完一张不到 2 秒就关页面，最后那张可能没存下（增量 2 秒一次，CLAUDE.md 落盘那节写过这是有意接受的窗口）。
- 小程序预览版没有声音（见 §1.8）。
- ~~每天新卡数是常量 5，没有设置项；想多练用「再练 5 张」。~~（2026-10-02 起改成自己挑场景，见 §1.0）
- 小程序预览版的场景图是构建时压的 480×360（`taro-spike-2/scripts/talk-scenes-weapp.cjs`，用 macOS 的 `sips`）：study 分包上限 2 MiB，
  30 张 800×600 原图自己就 2.2 MB。网页仍用原图。没有 `sips` 的机器原样拷，超了由 `verify-package-gates` 拦。
- 网页语音转文字靠浏览器：Chrome / Edge / Safari 有，Firefox 没有（按钮不出现）。Chrome 的识别把声音送到 Google 的服务，没网就报错（静默结束）。

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
7. （2026-10-02 加）**iOS 的语音转文字要原生插件**（WKWebView 里网页识别用不了，见 §1.9）：选型、麦克风 / 语音识别两条 `Info.plist` 权限说明，
   会把原生代码带进发布包，所以和第 5 条一起做。
8. （2026-10-02 加）**小程序录音**：小程序后台「用户隐私保护指引」补「录音」用途；云函数 `talk-asr` 部署 + 腾讯云子账号密钥只放云函数环境变量；
   上线前把 480×360 的预览图换成云存储的原图（同第 3 条），删 `talk-scenes-weapp.cjs`。
   ⚠️ `talk-asr` 现在**没有按用户限次**：只要有 OPENID 就能反复调，腾讯云按次计费。上线前加每个 OPENID 每天的上限
   （云数据库计数，或者挪到 Worker 走现有的 D1 限速），超了返回 `too_many`、页面说「今天说得够多了」。

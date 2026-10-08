# 单词拼写（Spelling）规格

> 2026-10-02 作者提出：给单词加一种「拼写」学法。**技术功能先做全，落地方式之后再定**
> （混进今日计划 / 用户自己打开 / 每词一天最后一次见到时出一次，答对就放走 / 每日上限——见 §6）。
> 判定要求原话：「罗马音、日语假名、或者假名混合和式汉字都可以是正确答案，但必须是正确的混合形式」。
>
> 这份文档是实现的唯一依据；类型契约在 `frontend/src/lib/spelling/types.ts`。
> ⚠️ **实验功能，不进任何发布包**（§7），上线前 `cloud:false`、编译期开关都不许动。

## 0. 一张拼写卡是什么

题面：中文释义 + 词性 + 拍数（正向卡同一套口径，`questionMeaning` / `moraCount`）。
用户键入答案，系统判对错、给诊断、折算成 FSRS 的一次评分。
**每个词的拼写卡有自己的一份 FSRS 状态**（和正向 / 反向 / 汉字读音是平级的第四张卡），
新建时从正向状态播种（同 `ensureDirectionCardIds`，稳定度折半起步）。

不做的事（想清楚了再加）：听写（音频 → 写）、挖空例句。题面类型留给之后，`SpellingCard` 里没有预留字段。

## 1. 什么算对

### 1.0 总原则：只标出和答案不同的字，评分用户自己选（2026-10-03 作者定，2026-10-06 作者再次强调要更简单）

作者原话（10-06）：「我希望的就是很简单的和答案不同的标红，然后用户自己选 FSRS 这几个档位，没有什么可反馈的，不要给用户一个差一点的答案，用户自己判断。」

- 提交（或点「看答案」）之后，界面只做两件事：**把用户写的和答案逐字对照，不一样的字标红**（用户写的那行标多写 / 写错的字，答案那行标漏掉 / 该写的字）；然后摆出和单词学习同一副档位（忘记 / 模糊 / 认识 / 熟知），**由用户自己选**。
- 我们**不**说「答对了 / 差一点 / 读音不对第 N 拍 / 长音写法不一样」，**不**限制提交次数（一轮只有一次提交），**不**替用户判定、也不给默认档位或推荐档位。
- 因此引擎的判定（`checkSpelling`、problem codes）只剩两个用途：① 决定要不要标红（引擎认为写对了——罗马音各种拼法、假名代替汉字等——就一个字都不标，免得 `si` / `shi` 这类都被接受的拼法被标成「错」）；② 写进流水（`spelling_reviews.problem`）当诊断。**界面不显示它**，也没有 nearMiss 这个概念了。
- 简体中文字形、繁体 / 旧字体、交ぜ書き、平 / 片假名用错：都不是被接受的写法，所以都会标红；要不要当成「认识」由用户自己选。
- 提示（拍数 / 读音 / 书写）仍可在提交前使用，只记进流水，不影响评分。

### 1.1 输入先分流（`classifyInput`）

先 NFKC 归一（全角字母 / 假名半角片假名都收进来）、去首尾空白；目标和输入里的 `〜 ～ ~ ・` 一律去掉（词库有 130 个〜开头的词缀 / 量词）。

| 字符构成 | form | 走哪条判据 |
|---|---|---|
| 空 | empty | problem `empty` |
| 只有 ASCII 字母、长音符 āīūēō âîûêô、`'` `-` 空格 | romaji | §1.3 |
| 只有假名和 ー | kana | §1.4 |
| 含汉字、没有假名 | kanji | §1.5 |
| 汉字和假名都有 | mixed | §1.5 |
| 其它（罗马音夹假名、数字标点…） | other | problem `mixed_scripts` |

**输入归一的两处有意取舍**（2026-10-03 A10 审查提出，作者睡觉期间 Claude 定）：
- 假名 / 汉字路径去掉**全部**空白（宽松）：「し んぶん」「食 べ る」按没有空格算。用户不会故意在假名里敲空格，严格拒绝只会让人莫名其妙地「差一点」。
- NFKC 会把 CJK 兼容汉字（神 U+FA19 → 神）归一成标准字形，所以这类旧字形输入判对、不报 `traditional_form`。
  兼容汉字几乎只能靠复制粘贴或特殊输入法得到，不是学习者的常见错误；要严格区分得放弃 NFKC，而 NFKC 对全角字母 / 半角片假名 / 全角数字（２日）更有用。
- 输入超过 `MAX_INPUT_LENGTH`（120 字符）直接报 `too_long`，不进匹配（罗马音 DP 对分隔符逐个递归，万级长度会栈溢出）。

### 1.2 三条判据的共同原则

1. **三类写法都算对，对错只看「是不是这个词的合法写法」**，不看用户选了哪一类；
   评分也不看（§3），只记录下来给统计（想看「你更常用哪种」）。
2. 判不对时记下**哪里不对**（`problems`，只进流水做诊断，界面不说，见 §1.0）。
3. 判据全是**目标驱动**：从目标词的读音 / 合法写法出发去匹配用户输入，**不**把用户输入反解成读音再比
   （反解有歧义：ō = おう 还是 おお？づ / ず？），目标驱动没有这些问题，还能指出第一处对不上的拍。

### 1.3 罗马音（`romaji.ts`）

目标读音切成拍（`splitMoras`），用动态规划把输入逐拍对上，每拍有一组可接受的写法。接受：

| 拍 | 可接受 |
|---|---|
| し ち つ ふ じ ぢ づ | shi si / chi ti / tsu tu / fu hu / ji zi / ji di dji zi / zu du（づ）；ず 只收 zu |
| しゃ ちゃ じゃ… | sha sya / cha tya cya / ja jya zya（ぢゃ：dya） |
| ん | n、nn、n'、词尾 n；b m p 前也收 m（shimbun）；「ん + 母音 / や行」必须是 nn 或 n'（n 后接母音会被读成 な行） |
| っ | 重复下一个辅音（kka）；っち 收 tch / cch；也收 xtu ltu xtsu ltsu |
| 長音 | おう：ou ō ô oh；おお：oo ō ô；ええ：ee ē ê；えい：ei ē ê；ああ aa ā â；いい ii ī î；うう uu ū û。**おう 不收 oo、おお 不收 ou**——那是两种写法，分得清正是考点，报 `long_vowel`（会标红，由用户自己选档位）。 |
| ー（片假名长音） | 前一拍母音重复、对应的长音符、`-`。**ー 对 o 列同时收 oo 和 ou、对 e 列同时收 ee 和 ei**（ー 本身不携带「う / お」信息） |
| を | o / wo |
| 外来音 ティ ファ ウィ ヴ シェ ジェ チェ ツァ フォ ディ デュ… | 常见的 Hepburn 和输入法写法都收（thi ti / fa fwa / wi / vu / she sye / je zye / che tye / tsa / fo / di dhi / dyu）；ティ 也收 ti（ち 的 kunrei 写法同形，没有冲突，因为是目标驱动） |

- 大小写不分；ASCII 空格、`'`、`-`（非ー位置）视为可有可无的分隔符。
- 助词读法：词库里以は / へ结尾的助词性词（こんにちは、こんばんは、では、には…）读 wa / e：
  A1 先扫词库把这类词列全，只对列出的词开 は→wa、へ→e，不做通用规则。
- **失败要给位置和分类**：第一处对不上的拍下标；整体去掉长音标记后若相同 → `long_vowel`；
  去掉促音相同 → `sokuon`；ん 的有无 → `hatsuon`；其它 `wrong_reading`；前缀对但输入短 / 长 → `too_short` / `too_long`。
- `kanaToRomaji(kana)`：给 UI 的「看答案」和提示用。**按假名如实写**（きょう → kyou、とおり → toori、がっこう → gakkou），因为展示的目的是告诉用户「怎么敲」；ー 没有假名可依，才用长音符（ラーメン → rāmen）；ん 后接母音 / や行时写 n'，促音重复辅音。

### 1.4 假名（`kana.ts` 的 `compareKana`）

严格逐拍相等，只在这几处放宽：

- 平 / 片假名先统一再比读音；**之后单独检查文字是否用对**：平假名词写成片假名、片假名词（外来语）写成平假名，
  都是「读音对、`script` 问题」→ **不算对**（外来语必须写片假名是拼写要学的东西）。
- ー 的互通：目标含 ー（片假名词）时，输入的 ー 与「前一拍母音的假名」互通（らーめん = らあめん = ラーメン 的读音）；
  目标不含 ー 时输入的 ー 不收（おとーさん ≠ おとうさん）。
- 其余一律严格：おお / おう、づ / ず、ぢ / じ、を / お、小假名（ゃ ゅ ょ っ）都要对；错在拨音 / 促音 / 长音分别报 `hatsuon` / `sokuon` / `long_vowel`（假名版，同罗马音）。
- `altReadings`：输入是目标的另一个合法读音（あす / あした）→ `other_reading`（不算对）。

### 1.5 书写：汉字 / 汉字假名混合（`forms.ts` + `check.ts`）

**唯一权威 = 这个词的「被接受写法」集合**：词库主表记 + orthography 首选 + JMdict 同条目里的合法 k_ele。
集合外的混合写法一律不收，包括「把某个汉字换成假名」（交ぜ書き）——JMdict 把这类（出きる、喰べる…）标 sK（搜索用），不是标准写法。

| 例（目标） | 判定 |
|---|---|
| 食べる ← 食べる | ✓ standard |
| 食べる ← たべる / taberu | ✓（假名 / 罗马音） |
| 行う ← 行なう | ✓ variant（许容的送り仮名；提示首选写法） |
| 申し込み ← 申込み / 申込 | ✓ variant（送り仮名省略，JMdict 都列了） |
| 明後日（词库写 あさって）← 明後日 | ✓ variant（词库选了假名，但汉字写法是合法的，只在 JMdict 里**唯一**对上该读音时收，见下） |
| 食べ物 ← たべ物 | ✗ `partial_kana`（汉字被换成了假名，不是标准写法）；← 食べもの ✗ 同。换进来的假名必须是这个词读音里的假名（子序列），「食べカ」是普通错误 `wrong_kanji` |
| 食べる ← 食る | ✗ `okurigana` |
| 食べる ← 食べ / 食べた / 食べるな | ✗ `conjugated`（词尾被截短、替换、延长都算活用形问题，不猜是哪种活用） |
| 経済 ← 经济 | ✗ `chinese_form`（带上 expectedChar 経） |
| 経済 ← 經濟 / 旧字体 | ✗ `traditional_form` |
| 経済 ← 軽済 | ✗ `wrong_kanji` |
| 橋 ← 箸 | ✗ `homophone`（词库里有 箸 的话带上 other） |
| カメラ ← camera | ✗ `source_language` |
| 警察 ← 警察官（词库里另有这个词，题面也相同） | `peer_word`（写成了题面相同的另一个词） |

- **和式汉字**：用户是中文母语者，最常见的错是中文字形，**简体直接判错**（§1.0）。`kanji-form.ts` 把输入里的每个字分成
  日文字形 / 中文简体 / 繁体·旧字体，简体和繁体各自映回日文字形（用 `kanji_variants.json`，同 `lib` 里现有的那份）。
  先把输入映回日文字形再去命中集合：命中 → 报 `chinese_form` / `traditional_form`（**不算对**，标红）。
- **JMdict 取数规则（`scripts/build-spelling-forms.mjs`，数据 `src/data/spelling_forms.json`）**：
  - 词库词（汉字 + 读音）去注音 / 空白后，在 JMdict 里找 **keb 与读音都对得上**的条目；
  - 纳入该条目的 k_ele，排除 `sK`（搜索用）、`iK`（不规范汉字）、`oK`（过时汉字）、`io`（不规则送り仮名：引受る、日変り…，不是「正确的混合形式」）、`ik`；
    标 `rK` → tag `rare`；标 `ateji` → tag `ateji`；其余 → `variant`；
  - 纳入 r_ele 里能配该 keb（尊重 re_restr）、且不带 `ok ik sk` 的其它读音 → `altReadings`；
  - 词库里只有假名 / 外来语（没有汉字）的词：只在**读音在 JMdict 里恰好对上一个条目**时才收它的 k_ele
    （同音词太多，不唯一就宁可不收），外来语的 k_ele 多是当て字（tag `ateji`，如 煙草）；
  - 找不到条目的词：集合 = 词库主表记 + orthography 的首选表记，别无其它。
  - 数据按 `"汉字|读音"` 为键（同 `kanji_orthography.json` 的口径），**只存和词库表记不同的那部分**，不存全表。
  - 构建脚本只读 `frontend/.local/JMdict_e.gz`（不进仓库），输出稳定排序，重复运行 diff 为空。
  - JMdict © EDRDG, CC BY-SA 4.0：`docs/CONTENT_RIGHTS.md` 里登记（已有 JMdict 条目则补一句用途）。

### 1.6 其它

- 目标是外来语（片假名词，kanji 列是英文等原词）：`source_language` = 输入等于原词（忽略大小写和空格），
  而不是它的罗马音（camera ✗，kamera ✓）。比较时只忽略大小写和空白，连字符等标点保留（cam-era 不算原词）。
- 汉字输入用不着读音，所以 `readingOk = null`。
- `homophone` / `peer_word` 要查词库，由调用方传 `SpellingLookup`；不传就不报这两条（退成 `wrong_kanji`）。

## 2. 判定结果

见 `types.ts` 的 `SpellingVerdict`：`correct`、`form`、`readingOk`、`problems`。引擎只回答「这是不是被接受的写法」，**界面不对用户说它的结论**（§1.0）；标红由 `diff.ts` 的 `markDifferences` 做（§2.1）。
**问题的排序**（第一个进流水的 `problem` 列）：`peer_word` > `other_reading` > `chinese_form` / `traditional_form` >
`script` > `long_vowel` > `okurigana` > `partial_kana` > `conjugated` > `homophone` > `wrong_kanji` > `sokuon` / `hatsuon` / `wrong_reading` > `too_short` / `too_long` > `source_language` > `mixed_scripts`。

### 2.1 标红（`diff.ts` 的 `markDifferences(target, typed, matched)`）

- 引擎认为写对了（`matched = true`）→ 一个字都不标；答案那行直接显示原答案。
- 否则按输入的种类选一条对照答案：写罗马音 → 读音的罗马音（长音符展开成双写、忽略大小写 / 空格 / 撇号 / 连字符；另一个合法读音也参与）；写假名 → 假名读音（含另一个合法读音）；其余 → 卡面写法和所有被接受的书写。多条候选取**逐字重合最多**的一条（一样多取更短的）。
- 逐字最长公共子序列：用户写的那行里不在公共子序列的字标红（多写 / 写错），对照答案里不在的字标红（漏写 / 该写的）。输入先走 NFKC、去空白，最多比较 200 字。
- 标红是红字 + 浅红底 + 下划线（不只靠颜色）。没写东西（直接看答案）没有对照，不标。

## 3. 评分：用户自己选的档位

一张卡一轮：（可选）用提示 → 提交一次或点「看答案」→ 露出答案和标红 → 用户选一个档位，**那就是这一轮的评分**。
档位和单词学习是同一副（`answerOptions`：忘记 / 模糊 / 认识 / 熟知，键盘 V / B / N / M）：忘记 / 认识摆宽、模糊 / 熟知摆窄，没有默认选中。

- 引擎判定、用了几级提示、写的是罗马音还是假名还是汉字，**都不影响评分**，只记进流水（`typed` / `form` / `hints` / `problem`）。
- 评分只产生 `WordAnswer`，之后走统一的 `createCardLog.record`（FSRS）。`known_forever`（熟知）= 这个词的拼写卡退出拼写队列（撤销会恢复）。
- 选档位 = 结算：写流水、换下一张（插播则关闭覆盖层）。选了就不能「改判」，要改走页面上的「撤销」（撤掉最后一条流水，同一张卡重来）。
- 流水里的 `tries` 列是改版前「一轮最多两次提交」的次数，现在不再写（保留列只是不值得为它动表）；`override` 列已删（它只在这个版本的开发期存在过，没发布）。

## 4. 提示阶梯（`hints.ts`）

按顺序逐级给，每次点「提示」多一级（只记流水，不影响评分，§3）：

1. 拍数 + 首拍（如「4 拍 · た」）
2. 完整读音（假名）
3. 揭晓书写（卡面首选写法）

`hintsFor(card)` 返回 3 级的内容，UI 逐级展示，**提示本身不判对错**。

## 5. 存储

三张表（建在 `local-schema.sql`，**别在模块里懒建**，原因见 CLAUDE.md「结构指纹」那条）：

- `spelling_memory(word_id PK, seen_count, right_count, fuzzy_count, forgot_count, mistake_streak, known_forever, last_seen_on, fsrs_*)` ——本机检查点（LWW 登记）。
- `spelling_reviews(id, word_id, answer, reviewed_on, reviewed_at, scheduler_mode, fsrs_params_version, created_at, typed, form, hints, tries, ms, problem)` ——唯一事实，append，`sync_uid`。
  `typed` = 最后一次提交的原文，`form` = 它的 SpellingInputForm，`problem` = 最后一次的第一个 problem code（空 = 对）。
- `spelling_tasks(reviewed_on, word_id, order_index)` ——当天投影。

全部 `cloud: false`（照 `talk_*`：开发版不许把新表推上云，否则作者手机上已发布的版本同步会被拒）。
实现用 `card-log.ts` 的 `createCardLog`（`entity.idColumn = "word_id"`），不另写调度。

`store.ts` 对外（只管存取，不依赖 forms / check / grade；评分由调用方先算好）：

```ts
export const SPELLING_FSRS: FsrsEntity;
export const ensureSpellingTables(): void;              // 只确认表在 + 补 fsrs 列，不建表
export const seedSpellingCards(limit: number): number;  // 给「正向学过、拼写还没卡」的词建卡，稳定度取正向的一半，返回新建数。**顽固词（lapses ≥ LEECH_LAPSE_THRESHOLD）不播种**，同 ensureDirectionCardIds：连「认」都认不下来的卡，不拿来考拼写
export const createSpellingTasks(quota: { fresh: number; review: number }, day?: string): { review: number; fresh: number };
export const pickSpellingNext(day?: string, excluded?: Set<string>): number | null;
export const spellingProgress(day?: string): { total: number; done: number; remaining: number };
export interface SpellingAnswerDetail { typed: string; form: string; hints: number; tries: number; ms: number; problem: string }
export const recordSpellingAnswer(wordId: number, answer: WordAnswer, detail: SpellingAnswerDetail, now?: Date): void;  // FSRS + 写流水（带 detail）
export const undoLastSpelling(): number | null;
export const clearSpellingTasks(day?: string): void;
export const lastEncounterToday(wordId: number, day?: string): boolean;  // 这个词的正向卡今天是否已毕业（= 今天最后一次见到它）。落地方式之一「当天最后一次见到时出拼写」要用
```

`session.ts`（依赖 forms / check / grade / store，最后写）对外：`spellingCard(wordId): SpellingCard | null`、
`recordSpellingRound(wordId, round: SpellingRound, now?): WordAnswer`（`gradeRound` → `recordSpellingAnswer`）。

## 6. 落地方式：开放问题（作者说之后再定，引擎对任一种都成立）

- 混进今日计划（每日量圆环多一段）/ 用户自己打开一个入口 / 正向卡当天毕业时顺手出一次拼写（答对就放走）。
- 「每个词都拼」太累：可选的度——只拼已熟的词（stability ≥ N 天）、每天最多 N 个、每词每 N 天最多一次。
- 引擎提供：`seedSpellingCards`（建卡）、`createSpellingTasks`（带额度的当天清单）、`lastEncounterToday`（毕业钩子）。
  度的选择是调用方的事，别写进引擎。

## 8. 题面形式（`SpellingMode`）

一张拼写卡有三种题面，标红（§2.1）和评分（§3）完全一样，只换「用户看到什么」：

| mode | 题面 | 备注 |
|---|---|---|
| `meaning`（默认） | 中文释义 + 词性 + 拍数 | 已实现 |
| `audio`（听写） | 进卡**自动播读音**（`speech.playPronunciation`，不看「自动播放」偏好），有「再听一次」按钮；释义默认隐藏 | 提示阶梯变成 0 级「意思」→ 1 级拍数和首拍 → 2 级读音 → 3 级书写；偏好 `showMeaningInAudio` 为真时释义直接显示。**同音词**：听写时用户不可能知道是哪个词；界面只做标红对照，同音异字的汉字会被标红，用户自己选档位 |
| `cloze`（挖空例句） | 例句里目标词被挖掉（`____`），下面是例句中文译文 | 用户要写的是目标词**在句中的实际写法**（可能是活用形：食べた），所以 `SpellingCard.target` 是按句中形态构造的（`cloze.surface` / `cloze.reading`），不是词典形 |

- **挖空**：`cloze.ts` 的 `clozeFor(word)`：在 `words.example_jp` 里找目标词出现的位置。优先用 `example_tokens` / `example_lemmas`（词典形匹配 → 取该 token 的实际表层），再退到按词形 / 读音的字符串匹配；找不到唯一位置就返回 null（该词没有挖空题，调用方退回 meaning）。
  句中读音从 `example_furigana` 取（汉字部分的注音 + 句中原样的假名）。**活用形的 target 没有 JMdict 变体**：`forms = [{ surface: 句中写法, tag: "standard" }]`，`altReadings = []`；句中形态恰好等于词典形时，直接用词典形的 `spellingTargetForWord`（带 JMdict 变体）。
- **选哪种**：偏好 `modes`（默认 `["meaning"]`）里开了几种就在这几种里选；`modeStrategy` = `"random"`（默认）或 `"rotate"`（按词 id 轮换，同一天同一个词总是同一种）；选中的形式对这个词不可用（没有可挖空的例句）就退回 `meaning`。
- 流水 `spelling_reviews.mode` 记实际用的形式。

## 9. 偏好、插播

- **偏好**：设备本地（localStorage，键 `shushugo-spelling-prefs`，try/catch 包裹，读不到取默认；**不进 `app_state`**，免得实验开关的字段推给旧版本）。字段：
  `modes`、`modeStrategy`、`dailyCap`（独立页面 + 插播合计每天最多几张新拼写，默认 30，0 = 不限）、`minStabilityDays`（「度」：只拼正向稳定度 ≥ N 天的词，默认 0）、
  `inlineAfterGraduation`（默认 **false**）、`inlineDailyCap`（插播每天最多几张，默认 5）、`showMeaningInAudio`（默认 false）、`clozeShowTranslation`（默认 true）。
- **插播（落地方式之一）**：单词学习里，一个词的**正向卡今天毕业**（`lastEncounterToday(wordId)`，也就是「今天最后一次见到它」）、且开了 `inlineAfterGraduation`、
  今天的插播数没到 `inlineDailyCap`、这个词过得了 `minStabilityDays`、今天没为它插播过 → 弹出一张拼写卡（`SpellingCardView`，流水 `source = 'inline'`）。
  用户提交（或看答案）、选完档位，覆盖层就关；也可随时「跳过」：跳过不写任何流水，但记下「今天问过这个词」不再催。
  这个词还没有拼写卡就当场播种（`seedSpellingCardFor(wordId)`，规则同 `seedSpellingCards`，但不要求 due 排序）。
  插播不改正向卡的任何状态，也不进今日计划的数字。
- **独立页面**：保留（`SpellingPage`），多一个设置面板（上面的偏好）。
- **没有错误统计**：10-03 做过「最近常错的类型」和「你推翻过我们 N 次」，10-06 作者要求界面只标红、不反馈，已删（`stats.ts` / `SpellingStats` / `messages.ts` 都没了；诊断码仍在流水里，要看自己 SQL 聚合 `spelling_reviews.problem`）。
- **不做**：把拼写塞进每日量圆环（四个滑钮的圆环是单词 / 语法 / 汉字 / 辨析的容量分配，拼写是「毕业后的确认」，不占额度）。

### 9.1 落地口径（2026-10-03；10-06 去掉统计和裁决）

- 设置面板使用页内展开的 `ds-card`，控件全是按钮 / `ds-chip` + `aria-pressed`；设置按钮用小程序已预生成的 `SlidersHorizontal`。
  `modes = ["meaning"]`、`modeStrategy = "random"`；至少保留一种题面，多选时显示随机 / 轮换。
  每天上限可选 `10 / 20 / 30 / 50 / 0`，度可选 `0 / 7 / 21 / 60`，插播上限可选 `3 / 5 / 10`。
  保存字段逐个校验；未知题面丢弃、重复题面合并，题面顺序统一为释义 / 听写 / 挖空；没有合法题面时回默认释义。
  其它非法字段只回退该字段的默认值，不牵连合法字段。读写与事件派发异常不阻塞学习。
- `SPELLING_PREFS_EVENT = "shushugo-spelling-prefs-changed"`：当前卡保留出题时的题面与提示设置，下一张起应用新设置。
  只有总上限 / 度变化才在下一张前重建当天投影；单改题面、显示偏好不重排任务。完成页改上限 / 度会立即尝试重新出卡。
- 每日总上限的计数按任务书指定的 `spellingDoneToday()`：学习日内写过流水的**不同词数**，页面与插播合计，重复提交 / 同词复习不重复计数，跳过不计数。
  独立页面请求的新学量是 `min(本组新学量, cap - spellingDoneToday())`，不限时使用本组新学量；到上限后不再出尚未练过的新卡。
  已有拼写记忆且到期的复习不受总上限或度影响，仍可练。插播另受 `spellingInlineToday()` 与插播上限约束，且总上限用完后不再插播。
  因为该计数也包括复习词，它是保守的「今日已拼词数」限制，并非只数第一次拼写的词；严格的新卡计数需要另定口径。
- 度读的是**正向** `progress.fsrs_stability`，不是播种后折半的拼写稳定度。播种仍排除未学词、顽固词和永久认识词。
  `seedSpellingCardFor` 对已有拼写卡返回 true；插播在调用前仍检查当前正向资格，防止已有卡绕过度 / 顽固词限制。
- WordStudy 仅在 `stage1` 正向作答入库后检查毕业；反向、汉字读音、错题回顾、压轴都不触发。
  实验开关关时不导入拼写模块；偏好关时不查拼写表并保留单词的延后记账快路径。偏好开时毕业判断改走已入库的同步路径。
  拼写覆盖层优先于已经排好的混合语法 / 汉字 / 辨析卡；关闭只清覆盖层，随后原卡继续，不调用单词换卡、不增单词统计、不进撤销栈。
  显示期间全局翻面 / 评分键让开，撤销入口禁用且撤销函数也有保护。
- 跳过与结算时记下 `shushugo-spelling-asked-<学习日>`；读写时清理旧学习日的同前缀键，保留其它本地数据。
  选完档位就关闭覆盖层（不再有「答对自动关 / 答错留着改」）。


## 7. 实验开关与上线清单

- 编译期常量 `__EXP_SPELLING__`：vite dev / vitest 为 true，`vite build` 和 `taro build` 默认 false，
  只有 `SHUSHUGO_EXP_SPELLING=1` 才开。页面和入口都包在里面；`lib/spelling/` 只许被 `index.ts` 对外（`isolation.test.ts` 钉着，抄 `lib/talk/isolation.test.ts`）。
- `check:release`（taro）和 `scripts/build-ios.sh` 拦它的指纹字符串 `__SHUSHUGO_EXP_SPELLING__`，同开口练习。
- 上线前：落地方式定下来、三张表的 `cloud` 从 false 改上云（按 `docs/DAILY_TALK_SPEC.md` §7 的发版顺序）、去掉开关和拦截、小程序跟上（同一份 TSX，Taro）。

# 单词拼写 A10 找茬式代码审查

审查对象为拼写实现、页面及其存储 / 同步依赖（只读审查，Codex gpt-6-luna max）。复现基于现有代码或临时 Vitest 探针（已删除）。
**每条的处理结果是 2026-10-03 Claude 补写的**（报告原文在删 worktree 时丢了未提交的文件，按当时读到的内容重建，措辞略有压缩，复现和位置保留）。

## 发现与处理

### 1. 中 — 旧字形经 NFKC 后会作为标准汉字判对（`kana.ts` normalizeInput、`check.ts` 书写精确命中）
NFKC 把 CJK 兼容汉字（神 U+FA19）改成标准字形，用户输入旧字形反而判对，不报 `traditional_form`。
**处理：保留，写进规格 §1.1。** 兼容汉字几乎只能靠复制粘贴得到，不是学习者的常见错误；要严格区分就得放弃 NFKC，而 NFKC 对全角字母 / 半角片假名 / 全角数字（２日）更有用。

### 2. 中 — 内部空格被删掉并按正确答案计分
假名 / 汉字路径在分流前删掉全部空白：「し んぶん」「食 べ る」判对，规格只写了去首尾空白。
**处理：保留（宽松），写进规格 §1.1。** 用户不会故意在假名里敲空格，严格拒绝只会让人莫名其妙地「差一点」。

### 3. 中 — 任意假名都可能触发 `partial_kana` nearMiss（`check.ts` partial 判据）
复现：目标 食べ物，输入「食べカ」→ `partial_kana`、nearMiss。
**处理：已修。** 换进来的假名必须是目标读音里的假名（子序列），否则按普通错误（`wrong_kanji`）。`check.test.ts` 有回归。

### 4. 中 — 长罗马音输入会触发递归栈溢出（`romaji.ts` DP）
复现：`matchRomaji("あ", "a" + " ".repeat(10000) + "x")` 抛 `RangeError`；页面输入没有长度上限。
**处理：已修。** `checkSpelling` 超过 `MAX_INPUT_LENGTH`（120）直接报 `too_long`；`matchRomaji` 自己也在 200 字符处设防。

### 5. 中 — `seedSpellingCards` 在引擎内部排除高遗忘次数的已学词（`store.ts`）
**处理：保留，写进规格 §5。** 同 `ensureDirectionCardIds`：lapses ≥ `LEECH_LAPSE_THRESHOLD` 的顽固词连「认」都认不下来，不拿来考拼写。

### 6. 低 — 片假名目标的文字提示反过来要求写平假名（`messages.ts`）
词库有 74 条「读音含片假名、但没有英文词源」的目标（如 ラーメン），`isLoanword` 为 false，输入平假名时提示「这个词写平假名」。
**处理：已修。** `problemMessage` 的目标参数加了 `kana`，按目标读音的假名种类决定方向。

### 7. 低 — 原词诊断把连字符等标点也当成可忽略字符（`check.ts` squash）
**处理：已修。** 只忽略大小写和空白；规格 §1.6 补了这句。

### 8. 低 — 送り仮名缺失被标成活用形（`食べ` → `conjugated`，规格示例写 `okurigana`）
**处理：改规格。** 词尾被截短 / 替换 / 延长都算活用形问题，不猜是哪种活用；规格 §1.5 的表已改成「食る → okurigana；食べ / 食べた / 食べるな → conjugated」。

### 9. 低 — 会话层重复结算同一轮会追加两条流水（`session.ts` recordSpellingRound）
**处理：不改。** 契约是「一轮结束后调用一次」；页面入口有 `busy` / 同步更新的 `current` / 结束态三层保护，StrictMode 路径不会调两次（审查已确认）。绕过页面直接重复调用才会重复，要加幂等得给一轮一个稳定身份，等落地方式定了再说。

## 查过、无发现的类别

- **同步登记 / 旧版本兼容**：三张表都在 `sync/tables.ts` 标成 `cloud: false`；`user-data-tables.mjs`、`local-schema.sql` 齐全；`snapshot.ts` 通过公共清单排除表和墓碑，并为 `spelling_tasks` 配 14 天保留。
- **流水搬迁 / 墓碑**：`migrateAppendRows` 与旧 `reviews` 语句都排除 `id` / `sync_updated_at` / `sync_origin_device` / `sync_uid`，保留其余业务列并改写 `word_id`；先删旧同步身份（触发墓碑）再插新行。（`legacy-word-migrations.test.ts` 只验证行数 / 迁移结果，没有逐列回归断言，覆盖偏弱。）
- **`card-log.ts` 的旧卡行为**：`startingState` 是可选配置，只有 spelling 传入；开口练习、汉字卡、辨析卡仍走原基线 / 清空分支，没有状态变化。
- **评分有效路径**：第一次正确、提示、重试、放弃、耗尽次数和一次 `peer_word` 豁免均符合 §3；未结束轮在 `gradeRound` 抛错、写盘前就停。
- **页面双结算 / StrictMode**：`finish` 不在 effect 或 state updater 中；`busy`、`current`、结束态阻止重复事件。
- **焦点 / IME / 音频**：两个 timer 卸载时清理；确认键排除组合输入、229 和重复按键；输入与反馈有 label / aria；自动播放 promise 有 catch（失败目前静默）。
- **提示拍数**：全库 10,919 词的 `moraCount` 与 `splitMoras` 结果没有不一致。

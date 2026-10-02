# JLPT 刷题只读审查（2026-10-03）

范围：题库规格、数据层、界面、导入/校验脚本、N1–N5 题库抽样；另检查同步表与发布闸门。没有改源码或题库。

## 发现

### 高 — iOS 构建脚本有未闭合的条件块

文件：scripts/build-ios.sh:64-70

单词拼写开关在第 64 行打开 if 后没有对应的 fi；第 70 行只关闭 JLPT 的内层条件，因此整个脚本在 EOF 前仍有一个未闭合的 if，iOS 发版脚本无法解析执行。

复现：运行 bash -n scripts/build-ios.sh 会报未闭合条件。

建议：在拼写开关提示后补齐 fi，再保留独立的 JLPT 开关拦截；为该脚本加语法检查。

### 中 — Taro 运行路径直接调用旧 JSCore 可能没有的内建方法

文件：frontend/src/lib/jlpt-practice/practice.ts:14,54,138；frontend/src/pages/JlptPracticePage.tsx:63；frontend/src/features/jlpt-practice/Sessions.tsx:106

题干解析依赖 String.matchAll，考试排序依赖 Array.flat，统计和模拟卷则调用 Array.flatMap；项目的小程序 polyfill 中没有这些方法的垫片。特别是题库加载后首页立即调用 jlptKindStats，在缺少 flatMap 的 JSCore 上会直接抛错。

复现：在不提供 Array.prototype.flatMap 的小程序 JSCore 进入刷题列表，题库加载完成后 jlptKindStats 抛 TypeError；解析题目时也会调用 matchAll。

建议：用循环/累加替代 flat、flatMap，并用 RegExp.exec 循环解析题干，或明确为支持的最低运行时加入并验证所需垫片。

### 中 — 默认网页发布包仍含 JLPT 表结构和同步登记

文件：frontend/src/lib/database/local-schema.sql:465-480；frontend/src/lib/sync/tables.ts:58；taro-spike-2/scripts/check-release.mjs:50-52；scripts/build-ios.sh:82-85

关闭 __EXP_JLPT__ 后页面名和实验指纹已从网页包摇掉，但实测压缩产物仍包含 jlpt_answers 的建表 SQL、索引和同步表登记；现有发版闸门只查页面路径/实验指纹，不会发现这段残留。它仍是 cloud:false，所以没有证据表明作答行会上传云端或破坏旧版同步；残留的是表结构和通用同步元数据代码。

复现：执行 SHUSHUGO_EXP_JLPT= npx vite build --outDir /private/tmp/jlpt-review-20261003-dist，再搜 __SHUSHUGO_EXP_JLPT__|JlptPracticePage|jlpt_answers；命中仅为 assets/index-F7XoUDRO.js 中的 DDL/表登记，页面名和指纹未命中。

建议：若“实验功能不进任何发布包”包含数据库结构，则连同 DDL/同步登记一起隔离并让发布闸门检查；若 schema-only 是有意保留，应在规格中明确允许范围并把发布检查改成检查页面、题库与运行逻辑。

### 中 — 导入脚本在结构校验前覆盖题库文件

文件：frontend/scripts/build-jlpt-bank.mjs:202-230

脚本先逐级 writeFileSync，之后才打开数据库调用 verifyJlptBank；若目标 id 不存在、选项格式错误或题目 id 重复，校验会返回错误码，但 N1–N5 文件已经覆盖成无效题库。

复现：只在临时副本中，把一个题目的 target.id 改成数据库不存在的值后导入；校验报告错误并退出码为 1，但对应的 n*.json 已写入。

建议：先在内存中合并并校验五级题库，全部通过后再写临时文件并原子替换。

### 低 — 题库校验器没有检查每卷各题型应有题数

文件：frontend/scripts/verify-jlpt-bank.mjs:246-256

校验器末尾只检查答案位置分布和重复 target 警告，没有把规格的每级题型数量作为错误条件；漏导一题仍可通过结构校验，模拟卷会静默变短。

复现（临时 Vitest 已验证）：从 N3 bank 移除 n3-v-trial1-01 后调用 verifyJlptBank(bank, db, "N3")，错误数组仍为空。

建议：按 level、setId、kind 校验规格题数；本批当前题数正确，但校验器未钉住这个保证。

### 低 — 模拟卷到时与退出确认存在最多 250ms 的竞态

文件：frontend/src/features/jlpt-practice/Sessions.tsx:118-125,145,152

计时器每 250ms 检查一次截止时间，但“退出”点击处理器不检查 deadline；若用户在截止时间已过、下一次 tick 尚未运行时快速点“退出”并确认，onBack 会卸载会话，绕过该部分的自动交卷。

复现：把当前时间推进到 deadline + 1ms，在下一次 interval tick 前点击“退出”并立即确认；会话退出且未调用 recordJlptAnswers。

建议：退出处理器先检查 deadline；已到时直接走 submitPart，其余情况再显示放弃确认。

### 低 — 倒计时变化没有屏幕阅读器公告

文件：frontend/src/features/jlpt-practice/Sessions.tsx:143-145

剩余时间只是普通文本 span，没有计时器语义或关键时点公告；屏幕阅读器用户不会获知时间正在减少或已经到时。

复现：用屏幕阅读器进入模拟卷并等待一分钟，代码没有会触发倒计时/到时公告的 live region。

建议：以礼貌公告只播报关键阈值和到时事件，避免每秒播报。

## 查过，无

- **同步与清除数据**：jlpt_answers 已登记在 frontend/src/lib/sync/tables.ts（append、cloud:false）、frontend/scripts/user-data-tables.mjs 和 frontend/src/lib/database/local-schema.sql。它不在 snapshot.ts 的保留天数表中，但本来就从云快照和墓碑中排除，因此没有云快照裁剪问题。legacy-word-migrations.ts 不迁它，因为该表保存 question_id 而非 word_id。clear-local-data.ts 只负责本机键值偏好；调用链随后由 clearStorage 删除整库和本地增量，整张作答表随库清除。
- **已发布版本云同步**：cloud:false 表从云表清单和导出快照中排除；现有测试也断言快照中没有 jlpt_answers。没有发现会把这张新表推给旧版客户端的路径。
- **批量事务**：frontend/src/lib/jlpt-practice/practice.test.ts:158-161 建立触发器，让第二条 INSERT 中途失败，再断言表中没有任何记录；实际测试通过。SAVEPOINT 回滚也覆盖插入触发器写入的同步元数据。
- **选题、错题本、统计、整卷**：新题优先、错题其次、最久没答优先；错题本按当前题库的最近一次答案；统计按题去重、最近一次作答计算。文章题按 passageId 成组且按空号排序。三种模式的空题型和空题库都有空态/空结果处理；校验器会拒绝重复题 id。
- **当前题量与计时**：当前每级一套，N1 44题（文字・語彙25、文法19）、N2 52（30、22）、N3 58（35、23）、N4 49（28、21）、N5 38（21、17），与规格题量一致。组卷顺序为文字・語彙后文法，每题一分钟；提前交卷和空答记 0 的逻辑符合规格。
- **标记解析**：解析保留普通文字、不吞换行；未配对括号按普通文字显示。现有用例覆盖空串、换行、异常括号和排序题独立星号，未发现输入导致解析卡死或丢失相邻文本。
- **键盘、计时器清理与刷新**：选项和导航均为原生 button，键盘可用 Tab/Enter，选项带 aria-pressed。计时 interval 在 effect 清理函数中 clearInterval。刷新不会恢复内存中的页面 session；按题练已逐题写库，模拟卷在整卷提交前不写库，刷新丢弃未交模拟卷符合规格“中途退出不记”。
- **题库导入量**：当前数据共 241 题，题型分布与规格相符；这只是一个试做批，每级一套，规格要求每级至少三套后再考虑上线。
- **题干奇怪输入/重复 id**：临时 Vitest 对 N1–N5 当前题库调用 verifyJlptBank，五级错误数组均为空；重复 id 夹具被拒绝。题干标记解析的边界用例由 practice.test 覆盖。内容语义正确性仍需人工盲做，自动校验不能替代。

## 题库内容抽查

每级随机抽 3 道文字・語彙、2 道文法；先只看题干和选项独立作答，再查看 answer、explanation 和 distractors。抽到的 25 题全部与标准答案一致，未发现双解、错读或明显不自然例句。

| 题目 id | 盲做 → 标答 | 理由 |
|---|---:|---|
| n1-v-trial1-17 | 3 → 3 | うやむやにした等于没有说清；其余选项分别是调查、公布时间和谨慎程度。 |
| n1-v-trial1-09 | 3 → 3 | もっぱら符合一周集中整理仓库的语境。 |
| n1-v-trial1-20 | 1 → 1 | 河水阻止救援队进入现场，阻む搭配自然。 |
| n1-g-trial1-14 | 1 → 1 | 顺序为「企画書の作成から／当日の受付／に至るまでの／準備」，★处对应第1项。 |
| n1-g-trial1-19 | 2 → 2 | てしかるべきだ表达道义上理应告知，符合保护照片捐赠意愿的上下文。 |
| n2-v-trial1-12 | 4 → 4 | 「無関係」是“与施工无关”的自然构词。 |
| n2-v-trial1-10 | 2 → 2 | 抽选对象应写「対象」，选项没有第二个可表示资格范围的词。 |
| n2-v-trial1-05 | 1 → 1 | 効率读作こうりつ，干扰项分别错长音或率的读音。 |
| n2-g-trial1-02 | 2 → 2 | だけに表达正因为店主亲手烤面包，熟客更加不舍。 |
| n2-g-trial1-21 | 4 → 4 | 「調べないことには」表达查明原因是选安全修理方法的必要条件。 |
| n3-v-trial1-34 | 1 → 1 | 飼う用于饲养牛；其余宾语是花、米、番茄。 |
| n3-v-trial1-08 | 4 → 4 | 医学读作いがく，四个选项只有第4项正确。 |
| n3-v-trial1-06 | 2 → 2 | 翻訳读作ほんやく，干扰项分别错辅音或浊音。 |
| n3-g-trial1-21 | 1 → 1 | 「安心して本を選べるようになった」表达放置样本后产生的状态变化。 |
| n3-g-trial1-12 | 4 → 4 | 截止日期较晚，所以今天不必写回信；ことはない符合语境。 |
| n4-v-trial1-23 | 3 → 3 | 気に入る与好きになる在该句中意义相近。 |
| n4-v-trial1-19 | 3 → 3 | 告知使用方法是説明，不是问题、回答或个人意见。 |
| n4-v-trial1-21 | 1 → 1 | 片づける在此为收起书，棚にしまう最贴切。 |
| n4-g-trial1-02 | 1 → 1 | 一遍已足够，読まなくてもいい表达无需重读。 |
| n4-g-trial1-09 | 3 → 3 | 天色变暗后推测可能下雨，かもしれません与不确定语气一致。 |
| n5-v-trial1-05 | 1 → 1 | 会社读かいしゃ，读音唯一。 |
| n5-v-trial1-01 | 1 → 1 | 学生读がくせい，干扰项分别错清浊音或漏长音。 |
| n5-v-trial1-10 | 3 → 3 | がっこう写作学校，其他字形不是该词。 |
| n5-g-trial1-05 | 3 → 3 | 来年指将来，年龄自然增长用なります。 |
| n5-g-trial1-06 | 1 → 1 | 「置いてあります」表示他人事先放好、现在可用的状态。 |

**总体质量判断：**本轮 25 题抽查表现良好，可继续封闭试用；不能据此认定 241 题全量无误，而且目前每级只有一套，未达到规格的上线门槛。

## 实际检查

- npx vitest run src/lib/jlpt-practice/practice.test.ts src/lib/jlpt-practice/bank.test.ts src/lib/jlpt-practice/isolation.test.ts src/lib/sync/user-data-tables.test.ts src/lib/legacy-word-migrations.test.ts src/lib/clear-local-data.test.ts：6 个文件、28 项通过；含中途失败的整批回滚复现。
- 临时 npx vitest run src/lib/jlpt-practice/audit-2026-10-03.test.ts：1 个文件、2 项通过，验证五级题库、重复 id 和漏题题数校验缺口；临时文件已删除。
- npx tsc --noEmit：通过。
- npx eslint src/lib/jlpt-practice/types.ts src/lib/jlpt-practice/practice.ts src/lib/jlpt-practice/bank.ts src/lib/jlpt-practice/index.ts src/lib/jlpt-practice/practice.test.ts src/lib/jlpt-practice/bank.test.ts src/lib/jlpt-practice/isolation.test.ts src/features/jlpt-practice/Question.tsx src/features/jlpt-practice/Sessions.tsx src/features/jlpt-practice/Result.tsx src/pages/JlptPracticePage.tsx scripts/build-jlpt-bank.mjs scripts/verify-jlpt-bank.mjs：通过。
- SHUSHUGO_EXP_JLPT= npx vite build --outDir /private/tmp/jlpt-review-20261003-dist：构建通过；同次构建另有动态/静态导入及大 chunk 警告，与 JLPT 代码无关。临时产物已删除。
- 对临时产物搜索 __SHUSHUGO_EXP_JLPT__|JlptPracticePage|jlpt_answers：仅命中 jlpt_answers DDL/同步登记，指纹与页面名未命中。
- 未跑 Taro build 或开发者工具；小程序兼容发现依据源码与 polyfill 检查，不代表运行时或设备验收。

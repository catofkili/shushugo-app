# 实验功能与发布隔离

## ⚠️ 开口练习（日常会话）是实验功能，不许进任何发布包（2026-09-30）

用户原话：「这个功能初期肯定上不了，要备注好，不要把断头工作上传到要发布的小程序 / App 上」。
规格和上线清单在 [`docs/DAILY_TALK_SPEC.md`](docs/DAILY_TALK_SPEC.md)，内容源是 `docs/DAILY_CONVERSATION_CORPUS.md`。

- **唯一开关是编译期常量 `__EXP_TALK__`**：vite dev / vitest 为 true；`vite build`（网页、iOS）和 `taro build` 默认 false，
  只有 `SHUSHUGO_EXP_TALK=1` 才开（只给自测 / 小程序预览码）。小程序页面登记在 `route-table.cjs` 里也挂着同一个开关。
- **`lib/talk/` 只许被三个入口引用**（路由表、主页入口、小程序 route-table），每处包在 `__EXP_TALK__` 里；
  `lib/talk/isolation.test.ts` 钉着。别的模块一 import，关着开关也摇不掉。
- 三道拦截：`taro-spike-2` 的 `check:release` 拦 app.json 里的 talk 页和 `__SHUSHUGO_EXP_TALK__` 指纹；
  `scripts/build-ios.sh` 见到 `SHUSHUGO_EXP_TALK` 就退出、构建完再搜指纹。**带开关构建的小程序包永远不许上传。**
- ⚠️ **`talk_*` 三张表是 `cloud: false`（只在本机）**：合并前 `assertSnapshotWritable` 见到不认识的表会整次拒绝同步，
  作者的 5173 开发版打开了这个功能，只要把 `talk_*` 推上云，作者手机上的已发布版本就再也同步不了。
  `cloud: false` = 照常盖章 / 留墓碑 / 进本地增量，但不进云快照（墓碑也不带）、合并不碰、收到带它的快照整次拒绝。
  上线时先发「认得但仍 false」的版本给所有端，全部更新后再改成上云（规格 §7）。
- 上线前谁也不许把 `__EXP_TALK__` 的默认值改成 true。
- **现状（2026-10-01，作者旅行期间 Claude 全权做完）**：网页 / iOS 开发版和小程序预览版都能完整走通——
  欢迎卡、公式卡（每次换词，新用户只挑 N5/N4 的词）、接话卡（先听对方再接话）、提示折算评分、注音（541 句，读音人工核过）、
  VOICEVOX 音频（329 句，网页 / iOS；小程序预览版没有声音、直接显示原文（10-08 起改为从云存储拉，上传前仍无声））、场景图鉴（15 张水豚 × 鳄鱼场景图）、再练 5 张。
  上线还差的列在规格 §7（音频上云、`cloud: false` 改上云的发版顺序、去掉开关和三道拦截、Pro / 成就是否挂钩问作者）。
- **2026-10-02 改版（作者要的三件事）**：① 场景自己挑（首页 30 个场景格子 + 「复习 n 张」，不再每天推 5 张）；
  ② 「说一句」语音转文字——**只给用户看、不打分、不存库**（网页用浏览器识别；iOS App 的 WKWebView 用不了，上线前要原生插件；
  小程序走腾讯云一句话识别，云函数 `talk-asr` 部署和密钥要作者做）；③ 接话卡对方那句「看字 / 只听」用户自己选。
  **2026-10-08 iOS 现状增补**：上述 iOS 说法保留作历史；原生 App 已接入 `@capacitor-community/speech-recognition@6.0.1` 和双权限说明，代码已做、待作者同步 Pods 后真机验证；原生插件与 Info.plist 权限说明会进发布包，实验开关关闭时 JS 侧整个 `lib/talk/` 被摇掉、没有入口会调用插件，开关和发布拦截保持原样（规格 §1.9 / §7 第 7 条）。
  场景从 15 个扩到 30 个（新增旅行 / 生活：酒店、出租车、新干线、药店、居酒屋、免税、失物……），168 句、453 句音频。
  细节和判据见规格 §1.0 / §1.9。
  小程序预览版的验收记录：`docs/DAILY_TALK_WEAPP_PREVIEW.md`。

### 2026-10-12 作者决定上线（本节现状，优先于上面的实验期规则）

作者决定「把刷题、开口都放到学习功能里」；开口练习现在转正式入口，JLPT 等题库返修后再上线。
已删除开口的编译期开关、环境变量、发布指纹、Taro 两条发布拦截和 iOS 构建拦截；网页 / iOS / 小程序共用主页「学习工具」格子。
JLPT 格子仍包在 `__EXP_JLPT__` 里，关闭时不显示；JLPT 开关与发布拦截不变。开口不挂 Pro，不进成就 / 柚子 / 每日计划。
场景支持多张随机图，命名、生成清单、云存储失败回退见规格 §1.4。
作者生成的 90 张变体已纳入源码（30 场景各 4 张，共 120 张）；这 90 张尚未由本任务上传云存储，小程序失败时回退已上传的首图。

仍未做：三张 `talk_*` 表继续 `cloud: false`；先让所有端更新到「认得但仍 false」版本，之后才可改上云并接重放，本次不做上云。
小程序 `talk-asr` 已部署但腾讯云密钥仍待作者配置；「说一句」沿用未开通时隐藏的行为。iOS 原生语音插件不改，仍待真机验双权限、停止清理和随后音频音量 / 路由；
小程序场景图真机加载也待验。本记录说明源码状态，不代表已经发布。上面的实验期说明和未完成项保留供追溯，以本节与规格 §7 的日期增补判断现状。

**2026-10-12 续跑验收增补**：类型检查、完整 Vitest（1231 通过、27 跳过）、lint（0 错误、44 警告）、正式网页构建和本地 CI 全过；
Vitest 默认并发触发多项 5 秒超时，复跑及 CI 用 `VITEST_MAX_WORKERS=2`，没有放宽超时或测试断言。
Taro Doctor 阶段 panic，按作者要求用 `--no-check` 编译，并按 package.json 顺序各跑一次后处理；分包、API、发布检查与 Taro 回归全过。
微信开发者工具实际走过网格入口 → 场景 → 公式 / 接话 → 翻面 → 9/9 完成 → 撤销 9 条本次验收作答；窄屏控件和图片未见遮挡，换卡、完成与撤销仍用同一场景图。
**验收仍有边界**：当前沙箱不能监听独立网页端口（`listen EPERM`），浏览器又拒绝访问 5284，因此未做这版网页视觉检查；
小程序操作时记录到 SDK 渲染层 `undefined is not iterable` 错误（堆栈为 `WAWebview.js`），返回主页时还有一次 `mic-ink.svg` 加载报错。
它们未阻断上述流程，但原因尚未定位，不能据此宣布运行无错误或真机已通过；本轮未上传、提审或发布。

## ⚠️ 单词拼写（Spelling）是实验功能，不进任何发布包（2026-10-02 起，作者睡觉期间 Claude 全权做完）

作者原话：「给我开发一个单词拼写学法，我还没想好怎么落地（混在里面还是用户自行打开……每个词都拼写吗那也太累了，设一个度，或者每天最后一次见到这个词的时候出拼写，对了就离开？），先把完整技术功能做好」「罗马音、日语假名、或者假名混合和式汉字都可以是正确答案，但必须是正确的混合形式」。
**规格和全部判定口径在 [`docs/SPELLING_SPEC.md`](docs/SPELLING_SPEC.md)，类型契约在 `frontend/src/lib/spelling/types.ts`；改判据先改规格。**

- **开关**：编译期常量 `__EXP_SPELLING__`（`SHUSHUGO_EXP_SPELLING=1` 才在 build 里打开，dev / vitest 默认开），和 `__EXP_TALK__` / `__EXP_JLPT__` **互相独立**；
  `check:release`（taro）和 `scripts/build-ios.sh` 各拦页面和指纹 `__SHUSHUGO_EXP_SPELLING__`；`lib/spelling/isolation.test.ts` 钉着只有页面 / `features/spelling/` / 路由 / Taro 页面能引用它。**落地方式没定之前，谁也不许把默认值改成 true。**
- **三张表 `spelling_memory / spelling_reviews / spelling_tasks` 都是 `cloud: false`**（理由同 `talk_*`：开发版把新表推上云，作者手机上已发布的版本同步会被整次拒绝）。上线先发「认得但仍 false」的版本，全部更新后再改上云。
- **落地方式是开放的**，引擎对任一种都成立：`seedSpellingCards`（给正向学过的词建拼写卡，稳定度取正向的一半）、`createSpellingTasks`（带额度的当天清单）、`lastEncounterToday(wordId)`（正向卡今天是否已毕业 = 「当天最后一次见到它」的钩子）。度的选择是调用方的事，别写进引擎。
- **什么算对**（`check.ts`，纯函数 `checkSpelling(target, input, lookup?)`）：罗马音 / 假名 / 汉字假名混合三类都算对，**评分不区分用了哪种**，只在流水里记 `form`。
  - 罗马音：`romaji.ts` 目标驱动 DP 逐拍匹配（不把输入反解成假名——ō 是おう还是おお、づ / ず 都会有歧义），Hepburn / 日本式 / 输入法式都收；おう 不收 oo、おお 不收 ou（那是考点，报 `long_vowel`，nearMiss）；ー 对 o 列 oo / ou 都收。
  - 假名：严格逐拍；平 / 片假名用错（外来语写平假名）是 `script`（**不算对**，会标红）；ー 在判文字种类时不算任何一种。
  - **混合 / 汉字写法：唯一权威 = 词库表记 + JMdict 同条目的合法 k_ele**（`scripts/build-spelling-forms.mjs` → `src/data/spelling_forms.json`，只读 `frontend/.local/JMdict_e.gz`）。排除 JMdict 标 `sK iK oK io ik` 的写法（`io` = 不规则送り仮名，不是「正确的混合形式」）；`rK` 罕用写法和 `ateji` 收下（标非首选）。
    **交ぜ書き（把一部分汉字换成假名，食べ物 → たべ物）不收**，报 `partial_kana`（会标红）；`出きる` 这类 JMdict 只当搜索用的写法同样不收。
  - **中文简体 / 繁体 / 旧字体不算对**，映回日文字形报 `chinese_form` / `traditional_form`（只进流水做诊断，界面只会把不同的字标红）。⚠️ **这一步必须排在「词库表记 / 非罕用写法精确命中」之后、「罕用写法精确命中」之前**：JMdict 里偶有把简体字形当罕用写法收录的（烟草），先精确命中就把中文字形判对了；反过来若排在最前，又会把本来就合法的标准写法（着る、暗い）误报成简体。简体映射是目标驱动的（`kanji_variants.json`，只看目标里的字）。
  - 书写比较走 NFKC（JMdict 有「２日」，用户输入 2日 是同一写法）；`classifyInput` 认数字。
  - 同音词 / 同题面词要查词库：调用方传 `SpellingLookup`（`session.ts` 的 `spellingLookup(wordId)`）；不传就退成 `wrong_kanji`。`peer_word`（写成题面完全相同的另一个词）不占提交次数。
- **界面只标红、评分用户自己选**（作者 2026-10-06 原话：「我希望的就是很简单的和答案不同的标红，然后用户自己选 FSRS 这几个档位，没有什么可反馈的，不要给用户一个差一点的答案，用户自己判断」）。
  提交一次（或点「看答案」）后，`diff.ts` 的 `markDifferences` 把用户写的和答案逐字对照、不同的字标红（引擎认为写对了就一个字都不标），然后摆出和单词学习同一副档位（忘记 / 模糊 / 认识 / 熟知，V B N M），**没有默认档位、没有推荐、没有「答对了 / 差一点 / 读音不对」这类话**，也没有重试次数、提示扣分、「算我对 / 算我错」。
  `SpellingRound` 就是 `{ typed, verdict, hintsUsed, grade, mode, elapsedMs }`，评分就是 `grade`；引擎判定（`checkSpelling` 的 `problems`）只进流水 `spelling_reviews.problem` 当诊断，**界面不说**。⚠️ 别再加回 nearMiss / override / amend / problemMessage / 错误统计面板：它们都做过（10-03），作者看不懂、要求拆掉（10-06）。
  选档位 = 结算（写流水 + 换卡），改错了走页面「撤销」。`spelling_reviews.tries` 列不再写，`override` 列已删（开发期才有过）。
- **题面形式（`modes.ts`）**：`meaning`（中文释义 → 写）/ `audio`（听写）/ `cloze`（挖空例句，94.2% 的词能出；挖掉的就是目标词，不能挖的词退回释义）。**三种都是 3 级提示**；听写把「意思」并进第 1 级而不是多加一级（`MAX_HINTS = 3`，按钮上限 3）。听写时同音异字的汉字照常标红，用户自己选档位。挖空题面的译文是否显示、听写是否显示释义由偏好决定。
- **偏好**：`prefs.ts`（localStorage `shushugo-spelling-prefs`，设备偏好、不同步；默认：只出释义题、随机、每天 30、度不限、插播关、插播每天 5）：题面形式多选、选择方式（随机 / 轮换）、每天上限、度（稳定度下限，`minStabilityDays`）、学习时插播、两个题面提示开关。没有统计页（拆了，见上）。
- **学习时插播（`features/spelling/SpellingInline.tsx`，默认关）**：对应作者提的「每天最后一次见到这个词时拼一次，对了就离开」。`WordStudy.tsx` 里 7 处接入，**全部包在 `__EXP_SPELLING__` 里**；钩子是 `lastEncounterToday`（正向卡今天已毕业）+ `spellingInlineToday` / `spellingDoneToday` 防止同一个词一天插两次。没有拼写卡的词用 `seedSpellingCardFor` 当场补一张（顽固词不补）。
- **存储**：`store.ts` 用 `card-log.ts` 的 `createCardLog`（流水为事实、memory 是检查点、tasks 是当天投影），**不另写调度**；`reviews` 主表**不**写入，所以不影响每日统计 / 柚子 / 成就。
  `card-log` 为此加了可选的 `startingState` 钩子：播种卡的 FSRS 起点存在 `spelling_memory.seed_fsrs_state`，撤销重放时要先恢复它，否则撤销会把播种卡变成全新卡。`mergeWordInto` 合并重复词条时也搬 `spelling_*`（流水先删后插，留墓碑）。
- **数据口径的取舍记录在 `docs/audits/2026-10-02-spelling-forms.md`**（取数规则、统计、各标签样本）；构建脚本两次运行产物 diff 为空，改规则后重跑并提交产物。
- **页面**：`pages/SpellingPage.tsx`（队列：seed → 清单 → 逐张）+ `features/spelling/SpellingCardView.tsx`（一张卡的完整交互，不知道队列、不碰库，将来能嵌进学习流程）+ `round-state.ts`（纯函数的一轮状态机）。同一份 TSX 经 Taro 编译成小程序。
  独立端口预览要往 IndexedDB 灌学习库副本（见下「往预览里灌库」的姿势），空库里没有学过的词，`seedSpellingCards` 返回 0、页面只显示「先去背几个词」。
- **还没做 / 上线前清单**（2026-10-03 更新：听写、挖空、每日上限、度、插播都已做完并默认可配；剩下的是作者拍板和真机验收）：落地方式的默认值（插播默认关，度默认不限）；`cloud:false` 改上云的发版顺序；去掉开关和拦截；小程序在微信开发者工具里的真机运行验收（只在网页独立端口看过视觉，没跑过小程序）。下面是改版前的旧清单，保留作历史：落地方式（作者定）；每日上限和「度」；`cloud:false` 改上云的发版顺序；去掉开关和拦截；小程序在微信开发者工具里的真机运行验收；听写（音频 → 写）和挖空例句两种题面（规格 §0 说明了为什么先不做）。

### 2026-10-12 作者决定上线

作者原话：「拼写作为学习模式的一个小开关，开了的话就最后一次见面的时候要求拼写，判正确与否依然用户自己判，如果填的不认识就持续（非重复出现，题出的顺序和正常情况一样只是题本身改答题方式）要求拼写，不再回到非拼写模式」。以上实验、独立页面、偏好和插播记录保留为历史；**现行实现以 `SPELLING_SPEC.md` 的「2026-10-12 落地方式：学习模式开关」节为准**。

拼写已并入正常正向学习卡：默认关闭的设备偏好、答前用正式「认识」预算预测今日毕业、meaning 题面、逐字标红和用户四档评分；评分写正常 reviews / FSRS / 统计 / 柚子 / 撤销，不另插卡。拼写选忘记设置本机 always_spell，撤销恢复旧标记，重复词合并保留任一标记。主页 / 独立路由 / 插播 / 独立偏好面板及拼写实验开关、发布拦截已删除；开口练习与 JLPT 保持独立隔离。代码与无实验开关构建可供作者审查，并不代表已经部署、上传、审核或公开发布。

**仍未做**：`spelling_memory / spelling_reviews / spelling_tasks` 仍是 cloud:false，标记不同步到别的设备；未来先给所有端发布认得这些表及 always_spell 列、但仍 false 的版本，确认全部更新后才允许改上云。微信开发者工具运行与真机验收须按当次实测另记，构建 / 自动测试不能代替真机通过。

**续跑验收记录（2026-10-12）**：前端 typecheck / lint / build 通过（lint 0 错误、44 警告）；全量测试 1200 通过、26 跳过，使用 `VITEST_MAX_WORKERS=1` 避免默认并发下的 5 秒超时。顺序一致性测试走实际今日计划和排片，而非不参与排片的自选清单。无实验开关的 Taro 构建在 Doctor 阶段 panic，按作者指定改用 `taro build --type weapp --no-check`，随后依 package.json 顺序各执行一次后处理；分包、重复模块、API、异步内容、发布检查及 Taro 测试均通过，主包 1,885,041 B。`ci-local.sh` 全部通过（含原生小程序 32 个脚本、共享层新鲜度、页面配对和后端检查）。网页视觉、小程序运行 / 视觉及真机验收仍未完成；未提交、未部署、未上传或提审。

**报告边界**：本任务按作者要求还原了 `taro-spike-2/reports/`，因此工作区里保留的是 HEAD 的旧构建报告，上述 Taro 通过结果对应还原前的本次构建。单独 `taro-spike-2/npm test` 会读取这份旧统计；下次验收须先完整构建生成新报告，再跑闸门，不能根据旧统计把已不再重复的 `DailyPlanSlider.weapp.tsx` 加回允许清单。

## ⚠️ JLPT 刷题也是实验功能，开关单独一个（2026-10-02）

规格 `docs/JLPT_PRACTICE_SPEC.md`。作者原话「我要做一个 jlpt 刷题功能」；题库还在攒（每级至少 3 套卷再考虑上线），照开口练习的规矩不进任何发布包。

- **开关 `__EXP_JLPT__`，和 `__EXP_TALK__` 互相独立**：开口练习上线那天会去掉它自己的开关和拦截，刷题挂在同一个开关上就会被一起带上线。
  拦截照开口练习各有一份：`check:release` 拦 `jlpt-practice` 页面和 `__SHUSHUGO_EXP_JLPT__` 指纹，`build-ios.sh` 见到 `SHUSHUGO_EXP_JLPT` 退出。
  `lib/jlpt-practice/` 只许被路由、页面、`features/jlpt-practice/`、小程序页面文件引用（`isolation.test.ts`）；备考计划页的入口只做 `navigate`。
- **作答表 `jlpt_answers` 是 `cloud: false`**，理由和 `talk_*` 一样（已发布的版本见到不认识的表会整次拒绝同步）。
- **不写 FSRS、不进今日计划、不出「预计得分」**：四选一能蒙对；JLPT 分数是等化分，复刻不了，只给各大题正确率。
- ⚠️ **真题不能用**：新 JLPT 不公开真题，北京日本文化中心声明不授权任何人用；市面上 2010 年以后的「历年真题」（华侨出版社等）查不到授权，
  多半是回忆版。**题目全部原创**：Codex 照规则手写 → 另开 Codex 会话盲做审校 → Claude 逐题验收。作者原话「不要脚本，规则给 luna max，它手写」——
  试过从词库自动出题，言い換え和文法两类的干扰项经常不通，别再回到自动出题。
  作者手里的红蓝宝书只给 Claude 看来总结题型和干扰项套路，**原题一道都不给 Codex**（和语法说明重写「不读原书」同一个口径）。
- 出题流水线在 `~/Documents/shushugo-wt/_codex/jlpt-trial/`：`rules.md`（出题规则）、`review.md`（审校规则，含卷 1 验收时改掉 20 题的那几类毛病）、
  `run-job.sh`（一份题：出题 → 审校；`OUT=…/setN` 写第 N 套，提示里自动列出前几套用过的考点）、`gen-sets.sh`（按批出卷）。
  题库导入 `frontend/scripts/build-jlpt-bank.mjs --src <setN 目录> --set trialN --title "试做卷 N"`，校验 `npm run verify:jlpt-bank`（挂在 prebuild）。
- ⚠️ **并行的 Codex 一次别超过 5 个左右**：2026-10-02 一口气开了 13 个（max 推理 + fast），25 分钟把整个账号额度用光、要等一天半，审校一份都没跑成。
- ⚠️ **审校压缩题干时会删掉空后面的词**（卷 1 的语形成「（　）可能」「（　）関係」），排序题会有第二种排法让 ★ 位置的答案变掉——验收时专门看这两类。
- ⚠️ 小程序里题库在 `lazy` 分包：卷 1（241 题）占 312 KB，lazy 分包合计 916 KB，上限 2 MB；约 1,000 题以上要给题库单独开分包。
- 网页的滚动容器是外层 `<main class="app-landscape-main">`，不是 window：`lib/touch-adapter` 的 `scrollPageToTop` 原来只滚 window，
  在网页上什么都不动（2026-10-02 修，刷题页是第一个真正依赖它的页面）。


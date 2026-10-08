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
  场景从 15 个扩到 30 个（新增旅行 / 生活：酒店、出租车、新干线、药店、居酒屋、免税、失物……），168 句、453 句音频。
  细节和判据见规格 §1.0 / §1.9。
  小程序预览版的验收记录：`docs/DAILY_TALK_WEAPP_PREVIEW.md`。

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


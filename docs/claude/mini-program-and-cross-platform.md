# 网页与微信小程序协同

## 2026-11-07 T1 Round 2：退回复修与本轮验收（真实 Git 合并仍阻塞）

本节记录退回后的现状，旧测量和失败记录全部保留。两项代码问题已先用测试复现为 4 项失败，再修复：

- `mixedCardDataLoaded` 同时检查汉字索引、用法和 **distinctionReviews**，不再把汉字就绪当成 mixed 就绪；
  `loadMixedCardData` 也实际加载三份资格，网页静态数据/小程序按需 shim 保持相同后置条件。
  classic 首页仅打开过一字多音后升级/恢复强度，仍会清今日投影，但不会越过辨析 ready 闸门。
  复现与回归为 `frontend/src/lib/home-mixed-ready.test.ts`，具体原因见每日计划专题同日 Round 2 节。
- 自选等待在开始时就参加网页/小程序同一个导航序号，ready 成功后先判取消才写队列和取首卡；
  返回、新请求或新导航取代旧请求，旧成功不跳页、旧失败不提示。两端普通导航的 catch 也拒绝迟到提示。
  `app/navigation-ready.test.ts` 执行真实 App / WeappPage 回调，未复制另一套导航；详见界面专题同日节。

### 实际分支与 T2/T3 保留证据

本轮按要求在真实 worktree 尝试 `git add -A && git commit -m "wip(perf): T1 首页懒装半成品" && git merge claude/perf-motion-web`，
第一步即失败：`Unable to create '/Users/lsc/Documents/shushugo/.git/worktrees/perf-home-lazy/index.lock': Operation not permitted`。
**实际 HEAD 仍为 e8a3569d，claude/perf-motion-web 的 f1462c2c 仍非其祖先；没有真实 WIP/合并提交。**
当前环境只能写本 worktree，无法改共享 Git 元数据，也不能提权。本轮未另建临时 Git 历史、未执行 finish-merge.sh，
已有 merge.git/bundle 仅为历史材料，不能当作要求已完成；真实提交/合并仍是未解决项。

工作文件中保留上一轮已经结合的 T2/T3，不回退重做。用 `git diff-tree e8a3569d f1462c2c` 列出其改动后，
逐文件将工作字节与 `git show f1462c2c:<路径>` 比较：排除文档和 reports 的 65 个文件全部存在，61 个逐字节相同，
另外 4 个是 T1 适配的 App.tsx / AppContext.tsx / ZooHome.tsx / shared/web.js；证据为
`tmp/perf/t1-round2-t2-t3-files.json`。动效、路由懒加载/idle 预取、预烧出厂库继续保留；reports 已 fresh 重建。
这个内容检查不替代 Git 祖先关系验收。

### 同机配对计时：当前代码与 f1462c2c 的原全量 getter

在 worktree 根目录依次执行（不与 Vitest/构建并跑）：

```sh
node tmp/perf/build-harness.mjs --before
node tmp/perf/build-harness.mjs
node tmp/perf/trace-home.cjs
node tmp/perf/onboarding.cjs
node tmp/perf/bench.cjs
```

Node v24.16.0；两臂使用相同当前出厂库和内容生成物，before 从 **f1462c2c（已审 T2/T3，未做 T1）**
读取原 stats、mixed 和 shims，其余业务图相同。不是两个完整 checkout，也没有把 T3 预烧收益算成 T1。
采用真实 Taro 内容 loader/shims、原生生成内容及 vendored sql.js/WASM；只替换 DB 实例、持久化、网络和平台 API。
这轮 harness 已将辨析 shim 的内容请求接到真实 Taro loader，不能用旧的空 loader 替身伪造 ready。
首装从当前 public/nihongo.db 新开，冷开从原 getter 初始化并导出的 prepared.db **第一次重开**，不是成熟用户存档。
当前库 SHA-256 仍为 `b3e303b3adf95a1020a9171a3a03274aa0caa56b8e5d931a738ca452c731af6b`。

每个场景交替 before/after，各 11 个独立进程，丢前 2 个、余 9 个取中位数，计时时关闭消费 trace；
原始 88 个样本在 node-bench-raw.json，汇总在 node-bench.json，同时记录实际 HEAD、种子摘要及源码/脚本指纹。
各行独立取中位数，不应再将行中位数相加当作合计。下表 classic，单位 ms；数据路径合计包括首页前内容求值和结构/迁移，
排除业务图求值、WASM、开库与首页后概览/预热。是离线函数链的 CPU 工作量，不是 React/Taro 的首帧墙钟。

| 阶段 | 冷开前 | 冷开后 | 首装前 | 首装后 |
| --- | ---: | ---: | ---: | ---: |
| 业务模块求值 | 64.59 | 63.31 | 63.21 | 62.28 |
| vendored WASM 初始化 | 7.24 | 7.63 | 7.04 | 7.03 |
| 内存开库 | 3.42 | 3.35 | 3.37 | 3.35 |
| 首页前内容 JS 求值 | 54.98 | 0.02 | 54.90 | 0.02 |
| 用户表结构 | 23.03 | 23.46 | 28.45 | 29.14 |
| 同步结构 | 106.75 | 106.70 | 164.08 | 165.66 |
| 固定搭配迁移入口 | 0.10 | 0.10 | 148.78 | 143.25 |
| 汉字索引解码 | 12.93 | 0.02 | 10.28 | 0.02 |
| 首屏前概览（含初始化） | 48.93 | 0.00 | 93.85 | 0.00 |
| 周报提示 | 0.32 | 0.39 | 0.27 | 0.29 |
| getWordStats 立即部分 | 6.75 | 19.77 | 69.81 | 127.40 |
| 角标（前全量／后 classic） | 152.83 | 0.02 | 393.64 | 0.02 |
| 备考状态 | 21.10 | 21.93 | 18.98 | 19.48 |
| 升级提示 | 4.78 | 4.71 | 4.13 | 5.15 |
| 小时刻 | 0.24 | 0.26 | 0.23 | 0.27 |
| 连胜 | 0.78 | 0.89 | 0.73 | 0.83 |
| 首页数据路径 CPU 合计 | **433.60** | **179.73** | **990.58** | **492.66** |
| 首屏后概览 | — | 35.17 | — | 34.01 |
| 首屏后学习页内容准备 | 0.33 | 36.51 | 0.39 | 34.92 |
| stage1 预热 | 69.65 | 77.17 | 57.04 | 58.93 |
| 辨析关系预热 | 1.02 | 85.33 | 0.91 | 81.01 |
| 干扰候选预热 | 72.45 | 75.46 | 69.60 | 74.17 |
| 音频计划 | 0.35 | 0.33 | 0.33 | 0.37 |

概览移后，初始化会转由 getWordStats 承担，不能把立即部分的上升误判为新增算法。
classic 省掉的是首屏前的全模式计算与内容等待；概览、内容和辨析关系构建在后续仍有成本，没有消失。
当前首页前内容求值字节 **2,205,486 → 0 B**；mixed 的三份资格为 **988,248 B**，仍必须加载。
字节是模块求值范围，不是微信实际分包下载流量。mixed 冷开角标 **148.86→150.65 ms**（没有测出下降）、
数据路径 **438.32→366.77 ms**；首装角标 **395.54→235.63 ms**、数据路径 **998.13→767.49 ms**。
不得拿旧节不同宿主负载的绝对毫秒相减，也不将本次 Node 毫秒乘 17 冒充真机收益。

### 计数、未 ready 与首装首卡

bench 重新执行原全量 getter 并校验基线夹具；当前工厂库和重开快照的七模式均逐项相等：
classic 18 / mixed 33 / mistakes 0 / quick 18 / reverse 0 / kanji 30 / picked 0。
classic 首页 mixedCardCounts 与 materializeConfusionCards 的 spy/trace 均 **0 次**；八份未 ready 的真实内容访问继续抛错，
活引用加载后可用。五个 T1 文件共 14 项定向回归通过，包含新增 mixed 部分就绪和两端自选取消检查。

`onboarding.cjs` 在两个独立进程里，以空 localStorage、无真实作答的工厂库，调用真实首次设定预览/保存/强度/完成、
首页读取、readyForRoute('word') 和 continueTodayPlanStudy；分别覆盖未等预热即点击及预热之后进入。
两次设定保存都只加载三份资格，完整题面/读音/音高仍未装；入口 await 内容并 prime 后，首卡的
kanji/kana/questionMeaning/meaning 非空，音高表 ready、lookupAccent 非 null、逐拍 pitchPattern 非空。
本轮首卡分别为「待つ／等待」与「出る／（人）出去…」，重音均为 1；0 仍是合法重音，不作为空值。
证据为 onboarding.json / home-content-reads.json，日志为 t1-round2-onboarding.log / t1-round2-content-trace.log。
这是数据时序验证，不等于已在模拟器或真机走过 UI。

### 本轮机器闸门与未解决项

check、lint（0 error / 52 warnings）、Web 完整生产构建、原生小程序 32 脚本、Taro 完整 build:weapp 与 npm test 均通过。
全量 frontend npm test **实际已跑，exit 1**：199 文件通过、5 跳过、1 失败；**1,640 项通过、30 跳过、1 todo**。
唯一失败是 brief 允许的 fsrs-store 顽固词 5,000 ms 超时（本次 6,152 ms）；未改超时、断言或跳过该例。
Taro 使用已自测的临时离线 Doctor 内置 schema 适配，不使用 --no-check；13 包和所有后处理闸门通过，
fresh 主包 **1,897,472 / 1,900,000 B**，余 **2,528 B**，未许可重复及过期许可均为 0。详情见发布专题同日 Round 2 节。
本轮日志统一为 tmp/perf/t1-round2-*.log，reports 与共享生成物由本轮实际命令重建，预算/允许清单未改。
**真实 WIP/合并仍未完成**，原因与实际分支证据见本节上方；用户禁止服务、开发者工具和 GUI，故未做视觉/设备验收。
没有联网、部署、发布、推送、刷新 5173 或写主目录源码，也没有为绕开权限重造一份“已合并”的临时历史。

## 2026-11-07 T1 第三次续做：合并 T2/T3 后的最终复核

本节补充并更新下文 T1 首次测量记录；旧数字、失败记录和解释全部保留。源码保留了 T2 的即时动效交互、
非首页路由懒加载和首页 idle 路由预取，也保留了 T3 的出厂库预烧及旧库兼容。没有改学习配额、FSRS、
挑卡或内容算法；Taro 仍直接编译同一份网页 TSX，原生共享包由网页 lib 重新生成。

### 合并后的两个额外回归

- **未加载 mixed 时也要撤销旧计划投影**：classic 冷开后用户可能改每日量、考后强度或升一级。
  `refreshMixedCardTasks` 不能因资格内容尚未加载就连清理旧任务也跳过，否则稍后进入 mixed 时可能沿用
  旧额度。现在始终清掉当天汉字/辨析任务，资格 ready 才立刻重排；未 ready 时由下次合法的 mixed 入口
  按同一算法重建。只动今日投影，不删历史/记忆，不为 classic 加载内容；新增工厂库回归检查这些边界。
- **导航异步化后，目标参数必须和页面一起提交**：原来 Web 语法气泡先调用导航、再写 ruleId；导航改为
  await 内容后，迟到的默认重置会把指定条目清空。现在 routeParams 在 ready、并确认导航未取消后才写入，
  基础语法只有没有显式 ruleId 的普通入口才清空选中项；与 Taro 已有判据一致。真实 App 回调的离线测试
  覆盖指定条目、普通入口、返回取消和读取失败，防止早改当前页模式/参数。没有复制另一份导航实现。

### 复现与测量边界

从当前 worktree 根目录运行，均不联网、不启动服务或 GUI：

```sh
node tmp/perf/build-harness.mjs --before
node tmp/perf/build-harness.mjs
node tmp/perf/trace-home.cjs
node tmp/perf/onboarding.cjs
node tmp/perf/bench.cjs
```

这次 before 改用 **f1462c2c（已审 T2/T3，尚无 T1）** 的原 `word-api/stats.ts`、`mixed-cards.ts`
和内容 shim；其余复用当前业务图。两侧都开当前 `frontend/public/nihongo.db`，SHA-256 为
`b3e303b3adf95a1020a9171a3a03274aa0caa56b8e5d931a738ca452c731af6b`，因此没有把 T3 的预烧收益
重复计入 T1。它是同源函数链重放，不是两个完整旧 checkout，也不执行 React/Taro 外壳。DB/持久化/网络/
平台 API 用离线替身，内容用实际 Taro shims、实际生成的分包模块和小程序 vendored sql.js/WASM。

冷开仍是该工厂库完成初始化和今日计划后导出的 prepared.db **第一次重开**，不是用户学习存档，也不是
已补齐同步元数据的成熟冷开。Node **v24.16.0**；每场景交替前后顺序，各跑 11 个独立进程，丢弃前 2 个，
余下 9 次取中位数，计时时关闭访问 trace。当前没有与构建或 Vitest 并跑。不要拿旧报告 4dcc89dc 或下文
e8a3569d/旧宿主负载的绝对毫秒来相减。数据为 `tmp/perf/node-bench.json`，88 个完整计时样本在
`node-bench-raw.json`；`home-content-reads.json` 单独记录消费。表的合计排除业务模块求值、WASM、开库、
首屏后概览和预热；各行独立取中位数，所以行中位数之和不一定等于合计。

| 阶段（classic，ms） | 冷开前 | 冷开后 | 首装前 | 首装后 |
| --- | ---: | ---: | ---: | ---: |
| 业务模块求值 | 25.73 | 25.66 | 25.48 | 25.43 |
| vendored WASM 初始化 | 3.17 | 3.17 | 3.13 | 3.13 |
| 内存开库 | 1.50 | 1.50 | 1.45 | 1.46 |
| 首页前内容 JS 求值 | 22.46 | 0.01 | 22.10 | 0.01 |
| 用户表结构 | 9.91 | 9.89 | 12.22 | 12.16 |
| 同步结构 | 45.23 | 45.51 | 66.08 | 65.83 |
| 固定搭配迁移入口 | 0.04 | 0.04 | 60.44 | 57.39 |
| 汉字索引解码 | 5.22 | 0.01 | 4.59 | 0.01 |
| 首屏前概览（含首次初始化） | 19.90 | 0.00 | 38.47 | 0.00 |
| 周报提示 | 0.13 | 0.16 | 0.11 | 0.12 |
| getWordStats 立即部分 | 2.68 | 8.51 | 28.06 | 51.72 |
| 角标读取（前全量／后当前模式） | 63.42 | 0.01 | 160.16 | 0.01 |
| 备考状态 | 8.68 | 8.84 | 8.04 | 8.20 |
| 升级提示 | 2.01 | 2.14 | 1.79 | 1.91 |
| 小时刻 | 0.11 | 0.12 | 0.09 | 0.10 |
| 连胜 | 0.34 | 0.37 | 0.28 | 0.32 |
| 首页数据路径 CPU 合计 | 180.59 | 75.46 | 404.76 | 198.81 |
| 首屏后概览 | — | 13.99 | — | 13.39 |
| 首屏后学习页内容准备（加载并 prime） | 0.15 | 14.92 | 0.16 | 14.36 |
| stage1 预热 | 27.50 | 31.36 | 21.99 | 23.25 |
| 辨析关系预热 | 0.40 | 35.92 | 0.41 | 33.47 |
| 干扰候选预热 | 27.73 | 30.19 | 27.02 | 29.39 |
| 音频计划 | 0.15 | 0.15 | 0.14 | 0.15 |

classic 数据路径 CPU：**冷开 180.59 → 75.46 ms，首装 404.76 → 198.81 ms**；当前角标分别为
**63.42 → 0.01 ms、160.16 → 0.01 ms**（未四舍五入原值见 JSON）。概览移后使初始化转由
getWordStats 承担，不能把立即部分的上升单独认成新增工作；概览本身移到了可绘制之后，并没有消失。
Web 启动那次紧挨着的重复刷新已删，不在这份小程序函数链的合计内。

mixed 必须保留真实的三份资格数据：冷开角标 **63.77 → 61.15 ms**、数据路径 **180.09 → 150.93 ms**；
首装角标 **162.13 → 97.30 ms**、数据路径 **406.52 → 309.16 ms**。classic 首页前八份内容模块求值
**2,205,295 → 0 B**；mixed 求值三份 **988,057 B**。这是模块求值字节，不是微信分包下载字节。
移出的辨析关系成本会在后续预热/学习时发生；没有将 Node 毫秒乘 17 声称真机收益，没有测微信网络、存档 I/O、
渲染桥接或真实首帧/点击响应。内容消费清单、各页 ready 边界继续见下文原 T1 表。

### 新增验收的首装链路

`onboarding.cjs` 在两个独立 Node 进程中，从空 localStorage、无真实作答的出厂库走真实
previewCurrentLevelPlan → saveLevelPlanSettings → applyStudyIntensity → completeLevelSetup → 首页数据
→ readyForRoute('word') → continueTodayPlanStudy。分别覆盖 **未等 2.5 秒预热即点击** 和预热后的进入。
保存前后验证 shouldShowLevelSetup true→false；保存仅装三份 mixed 资格，完整读音、题面和音高仍未装。
学习入口必须先完成 ready/prime，随后首卡的 kanji/kana/questionMeaning/meaning 都须非空，
pitchAccentLoaded 必须为 true，lookupAccent 非 null，逐拍 pitchPattern 非空；**平板重音 0 是有效结果**。
本次早点击例为「空港／机场」、重音 0；完整证据在 `tmp/perf/onboarding.json`。它验证数据与内容时序，
不等于模拟器或真机 UI 已走通。另有 trace 的 classic/mixed/kanji/首次设定五场景，classic 首页真实内容消费
为 0（允许模块初始化保存活引用），mixedCardCounts/materializeConfusionCards 的首页调用均为 0。

三类要求均有 Vitest：classic spy=0；当前工厂库和重开快照的七个模式与原全量 getter 基线逐项相等
（18/33/0/18/0/30/0，bench 会重新执行原 getter 校验夹具）；八份未 ready 代理的真实读取/枚举/in 访问抛错。
加上绘制时序、重排及异步导航，T1 共四文件 **9 项**。原生小程序的真实 shared graph smoke 同时通过。

### 最终闸门与未执行项

- `frontend npm run check`、`npm run lint` 通过（0 error / 52 warning）；全量
  `VITEST_MAX_WORKERS=2 npm test` 已运行：**199 文件通过、5 跳过；1,636 项通过、30 跳过、1 todo**。
  题目提到的 fsrs-store 顽固词闸超时本次没有复现，没有改超时、断言或跳过该例。
  `npm run build`（含完整 prebuild/发布数据库校验）也通过。
- `wechat-miniprogram npm test` 的 **32 个脚本全部通过**，含重新生成后的 check-shared/check-parity。
- Taro 执行原 `npm run build:weapp` 全链，唯一环境适配是用临时 `tmp/perf/offline-doctor.cjs`
  把 Doctor 切到同一原生 binding 的内置 schema，未使用 --no-check、未返回写死的成功；
  `check-doctor.cjs` 验证合法配置通过、错误类型/缺失必填项被拒绝。本次实际配置验证通过，结果在
  `t1-final-doctor-offline.json`；完整构建和 `npm test` 都退出 0。
  fresh 主包 **1,896,994 / 1,900,000 B**，余 **3,006 B**；13 包均通过，未许可/过期核心及页面重复均为 0，
  异步目标、资产、CSS/字体、正文恢复、API、referral 闸门全部通过，reports 由这次构建生成。
- 最终日志为 `tmp/perf/t1-final-{check,lint,frontend-test,web-build,shared-build,wechat-test,taro-build,taro-test}.log`。
  用户明确禁止服务、开发者工具和任何 GUI，故没有视觉、窄屏或真机验收；没有触碰/刷新 5173，没有联网、
  上传、部署或发布。本 worktree 的忽略 iOS 出厂副本不存在，不能将合入 T3 的历史 Web/iOS 比对当成本次比对。

### Git 元数据权限阻塞的交接

原 worktree 的 `git add -A` 被文件系统拒绝：index.lock 位于主目录共享 .git/worktrees/perf-home-lazy，
本会话只获准写当前 worktree，且不能提权。没有为此改权限或写主目录源码。临时元数据
`tmp/perf/merge.git` 中保存了 WIP **1471435d**，并把 claude/perf-motion-web 合成 **09482216**；
App 两边功能保留，shared/reports 在合并时重建。该历史另存为 `tmp/perf/t1-merged.bundle` 并已校验。
**这不是原分支已成功前进的证明**：原分支仍停 e8a3569d，原索引未改，工作文件已是合并结果及后续修正。
合并后的本次修正、测试和文档均未再 commit。

具备 Git 元数据写权限的后续会话可先审阅 `tmp/perf/finish-merge.sh` 再执行它：它严格校验当前分支和旧 HEAD，
仅从本地 bundle fetch，再 mixed reset 到已保存的合并提交；不 checkout/stash/覆盖工作文件，保留所有本次后续
未提交改动，不新建提交，也不推送。当前受限会话没有执行此脚本，分支写回仍是未完成项。
`tmp/perf/t1-change-files.txt` 提供相对原 HEAD 的完整文件清单，`t1-after-merge.patch` 保存合并后的未提交修正；
这些差异与机器闸门供后续审查使用，不代替 CLAUDE.md 指定的新 Claude 会话全量文档对照。

## 2026-11-07 T1：首页按消费加载内容（接替 10-19 / 11-05 的整包启动等待）

这次基线是 `e8a3569d`，包含首次设定静默下载的 `c97e9cc5`；不是旧性能报告的
`4dcc89dc`。`ensureDatabase` 只负责开库、结构和内容迁移，不再顺带等待 word-study。
首页等库和外壳后即可渲染；角标独立等待当前模式。Taro 继续直接编译网页的
`ZooHome` / `SquirrelTrail`，数据层继续由网页源码生成 `wechat-miniprogram/src/shared/web.js`。

### 内容消费清单与等待边界

下表说的是模块实际求值/内容消费，不代表微信无需下载包含该模块的整个分包。
classic 首页首次渲染前不等待下列八份内容；lazy/core 外壳仍需加载。

| 内容 | 首页角标 | 首次设定 | 2.5 秒预热及后续消费者 |
| --- | --- | --- | --- |
| questionMeanings | 不读 | 预览、先验、收尾均不读 | `warmStage1SelectionCache` / 干扰候选索引会读；必须在预热之前就绪，不能和预热并行 |
| distinctionReviews | mixed 的 `matchable` 会读，classic 不读 | 保存先验物化辨析、生成任务时读；选日期/拖熟悉度不读 | 辨析题面、混合学习匹配卡读 |
| kanjiUnitRuntime | mixed、汉字读音角标读 | 保存先验物化汉字时读 | 汉字单位/字卡用 |
| kanjiReadingUsage | mixed 资格读；汉字单位角标不读 | 保存先验/重排资格时读 | 一字多音页、混合字卡用 |
| kanjiVariants | 不读 | 不读 | 取第一张单词卡的汉字组件时读 |
| kanjiReadings | 不读 | 不读 | 单词/汉字卡、语法振假名用 |
| grammarKeyPoints | 不读 | 不读 | 语法题及混合语法插播翻面用 |
| pitchAccent | 不读 | 不读 | 学习卡音高线用；预热先把学习页声明的内容装齐 |

`readyForHomeMode` 的 mixed 集合只有 **unit runtime + usage + distinction reviews**，
汉字读音只有 unit runtime，其余模式无内容等待。网页的区别只是静态内容本来就可用，
两份动态汉字索引仍遵守同一个 ready 边界。

`readyForRoute` 在两端导航提交之前等待，Taro 的 `WeappPage` 还为原生 tab/直达冷开
单独等待，不能假定用户来过首页。word/quick-study 等 word-study 六份完整内容；
word 根据模式追加角标资格；vocab-test 等题面/变体/读音；confusion 和 distinction-quiz
等题面/辨析/变体/读音；kanji-readings 等两份汉字数据和读音；grammar/detail/
grammar-foundation/favorites 等语法正文、抓手和读音；jlpt-plan/settings 先备好 mixed 资格。
自选清单在导航前就会取第一张卡，所以 `startPickedStudy` 也必须先等 word 内容。
2.5 秒预热先 await 当前学习页内容，再构建只读缓存/音频计划；组件卸载或切换模式后取消旧预热工作。
小程序 tab 只隐藏时不会卸载，已开始的内容预取可继续完成并供学习页复用。

首次设定的静态矩阵和 `remainingPlanWords` 不消费这些代理。保存先验在主包入口
`level-plan.applyLevelStartingPoint` 先 await mixed 资格，再 import 先验块。
**重排只能生成任务与进度，不能顺带取卡**：旧 `refreshMixedCardTasks` 调两个 session，
会在设定收尾生成汉字卡、读取尚未加载的完整读音表；现改成同源 `mixedCardCounts`，
保留原配额、级别、任务和先验限速判据，题面到学习页才生成。

### 未 ready 必须可发现，不能静默算空

八份代理均拒绝未 ready 的真实消费（发布构建也保留），错误说明缺的内容和 ready 入口。
模块初始化可以捕获 `readings` / `japanese_to_simplified` / `points` 等一层活引用，
其子键、枚举、`in`、数组长度都必须 ready。**不能直接把根对象枚举退化成空列表**：
JSON shim 改用普通 ESM 元数据外壳，供 esbuild/webpack 枚举导出名，内容代理本身严格断言。
esbuild 的 Node 默认导入可能再包一层 default，外壳的字段 getter 和 default 都要转到
同一个代理；只提供 default 会把 `kanji-char-cards` 模块初始化捕获的 readings 固定成 undefined。
`modes-smoke` 的真实混合卡流程曾抓到这点。

动态 Web loader 失败后清空 rejected promise，允许重新预取；否则一次失败会让之后
内容已装好的重试仍永远失败。mixed 物化也显式检查索引 ready，不返回零占位。
新增 `home-content.test.ts` 覆盖八份未就绪访问、加载后的活引用和各入口内容声明。
离线 `trace-home.cjs` 还从 classic 的八份内容全未就绪状态执行首次设定的真实预览、保存、
强度设置与收尾，确认保存前等待后仅有三份资格数据；完整题面/读音仍未装，预热后才取首卡。

内容 loader 要留在主包：`WeappPage` 显式引用 `taro-content.cjs`，先验块只读已就绪内容。
若 webpack 把带 `require.async('./content/...')` 的 loader 复制到 lazy 块，相对路径会错位；
必须看 fresh build 的 `verify-async-content`，不能只测 Node 的同步 require 回退。

概览与首页统计首轮用 `afterPaint`（rAF 后再 setTimeout）让出绘制机会；Promise.resolve
或只在 effect/rAF 里同步计算都不够。首次设定开着时暂不计算概览，面板显示「读取中…」。
启动同步仍须在 `ensureProgressInitialized` 之后发起：占位初始化会 persistSoon，
若晚于同步开始的 flush/revision 采样，就会把老用户首次找回误判为「本机又有新记录」。


### T1 同机前后复测（2026-11-07，Node 毫秒）

复现从仓库根目录执行：

```sh
node tmp/perf/build-harness.mjs --before
node tmp/perf/build-harness.mjs
node tmp/perf/trace-home.cjs
node tmp/perf/bench.cjs
```

`before` 读取 `git show e8a3569d:<文件>` 的原统计、混合卡和 shim 实现；其余业务代码复用当前
同源图。它重放改前「先装八份内容、先算概览、再读完整 modeCounts」和改后按当前模式的路径，
不执行 React/Taro 外壳。实际小程序 vendored sql.js/WASM、出厂 `frontend/public/nihongo.db`；
冷开为同一出厂库初始化并排计划后导出的 `tmp/perf/prepared.db` 首次重开，不是作者学习存档，
也不是同步元数据已补齐的稳定重开。数据库模块、磁盘持久化、网络和平台 API 用离线替身；
八份内容使用实际 Taro shim，读访问另开 trace，不把逐次访问钩子开销混入计时。
每个场景前后交替顺序各跑 11 个独立 Node 进程，丢弃前 2 个进程样本，余 9 次取中位数；
独立进程保证业务缓存清空，丢弃不代表跨进程 V8 JIT 预热。Node v24.16.0，不与旧报告
`4dcc89dc` 或上轮宿主负载下的绝对毫秒直接相减。原始样本为 `node-bench-raw.json`，
汇总为 `node-bench.json`。脚本还重新计算原 getter 的全部模式并断言提交的基线夹具一致。

下表为 classic。数据路径 CPU 合计包括结构/迁移、原来的首屏前概览与首页统计，
不包括模块加载、WASM、开库和后置概览/预热；它是工作量统计，**不是首帧或可操作墙钟**。
各行独立取中位数，行中位数之和不必等于合计中位数。

| 阶段 | 冷开前 | 冷开后 | 首装前 | 首装后 |
| --- | ---: | ---: | ---: | ---: |
| 内容 JS 求值 | 63.44 | 0.03 | 69.26 | 0.03 |
| 用户表结构 | 25.27 | 26.36 | 69.59 | 74.82 |
| 同步结构 | 125.41 | 128.71 | 193.71 | 191.58 |
| 固定搭配迁移 | 0.11 | 0.11 | 182.37 | 180.30 |
| 汉字索引解码 | 14.23 | 0.02 | 11.90 | 0.02 |
| ready 前概览（含首次初始化） | 56.58 | 0.00 | 229.27 | 0.00 |
| 周报提示 | 0.39 | 0.41 | 0.32 | 0.37 |
| getWordStats 立即部分 | 8.14 | 23.58 | 83.02 | 273.15 |
| 当前角标读取 | 174.40 | 0.02 | 510.92 | 0.03 |
| 备考状态 | 25.54 | 26.96 | 26.42 | 27.02 |
| 升级提示 | 6.13 | 6.66 | 5.65 | 5.65 |
| 小时刻 | 0.34 | 0.36 | 0.33 | 0.35 |
| 连胜 | 0.95 | 1.09 | 0.84 | 1.01 |
| 上述数据路径 CPU 合计 | 505.65 | 214.86 | 1387.51 | 750.76 |
| 首屏后概览 | — | 40.56 | — | 42.42 |
| 2.5 秒后内容求值 | 0.04 | 45.17 | 0.04 | 46.69 |
| stage1 预热 | 80.35 | 87.24 | 69.39 | 76.48 |
| 辨析关系预热 | 1.20 | 99.10 | 1.25 | 111.23 |
| 干扰候选预热 | 83.35 | 83.09 | 84.35 | 90.60 |
| 音频计划 | 0.39 | 0.43 | 0.41 | 0.44 |

概览后置使首装初始化可能转由 getWordStats 承担，因此不能把其立即部分的增加单独判为新增工作；
应同时看概览与数据路径合计。小程序实际 afterPaint 中仍先完成进度占位，再发启动同步，避免
本机占位写入抬 revision 打断老用户首次找回。网页取消的重复概览不在这份小程序路径合计中。

| mixed（仍须算真实混合角标） | 冷开前 | 冷开后 | 首装前 | 首装后 |
| --- | ---: | ---: | ---: | ---: |
| 当前角标读取 | 181.06 | 173.87 | 551.77 | 342.04 |
| 数据路径 CPU 合计 | 533.24 | 432.08 | 1615.38 | 1216.23 |

classic 首页八份内容求值字节由 **2,205,295 B → 0 B**；mixed 只求值三份资格数据 **988,057 B**，
汉字角标只需 unit runtime。这是模块求值字节，不是微信分包下载字节：mixed 若未缓存，仍会
下载容纳这些模块的 content/features 分包。classic 的预热在首屏之后装 word-study 六份；
预热构建辨析关系原本在 mixed 物化中付过成本，移出 mixed 后该成本会转到预热，不能称被消除。
网络、文件 I/O、真机求值、首帧/输入响应和渲染桥接未测；不把本次 Node 时间乘 17 冒充真机收益。

### T1 构建与运行边界

原始 `npm run build:weapp` 仍在本机 Taro Doctor 的 Rust `system-configuration` NULL object panic
处停止；从 package.json 取同一命令链，仅将 Taro 编译改为 `taro build --type weapp --no-check`
后执行全部资产、CSS/字体、正文恢复、语法分包、async 路径、API、包体、重复模块和 referral 闸门。
fresh 主包 **1,896,982 / 1,900,000 B**，余量 **3,018 B**；全部 13 包通过，未许可核心/页面重复
均为 0，25 个 require.async 目标全部存在。reports 由真实构建生成，没有放宽预算或许可清单。
`frontend && npm run check && npm run lint` 通过（0 error、52 warning）；新增的三文件六项
Vitest 用例通过。全量 `VITEST_MAX_WORKERS=2 npm test` 实际执行 199 文件，193 文件通过、
5 跳过、1 失败；1,613 项通过、30 跳过、1 todo，仅 `fsrs-store.test.ts:204` 的已知
「顽固词闸永远生效」在全量负载下超过原有 5,000 ms。没有延长超时、跳过该例或改断言。
`wechat-miniprogram && npm test` 的 32 个脚本全部通过，含 check-shared 新鲜度和 check-parity；
`taro-spike-2 && npm test` 全部通过。离线消费 trace 的 classic/mixed/kanji/classicSetup 四场景均通过。
本次禁止服务/GUI，因此没有网页/窄屏截图、微信开发者工具运行或真机验收；这些不能以构建代替。


## ⚠️ 改页面 = 网页和小程序一起改（2026-09-25）

用户只对着网页提要求，小程序必须在**同一个对话、同一个提交**里跟上，不许再让用户开第二、第三个对话去改另一端、去监督两边是否一样。
怎么做、闸门和禁止事项见 [`docs/MINIPROGRAM_SYNC_PLAN.md`](docs/MINIPROGRAM_SYNC_PLAN.md)（路线 A：同一份 TSX 用 Taro 编译成小程序，待 spike 验证；
路线 B：原生小程序 + 设计变量自动生成 + 页面对照表提交闸门 + 截图对比）。Codex 读的是根目录 `AGENTS.md`，它指回这里。

## ⚠️ 新项目必须编译并运行小程序版；前端必须做视觉检查（2026-09-25）

**每个新项目都必须产出微信小程序版**：完成后先按项目实际技术栈编译小程序，再在微信开发者工具中打开运行，并把核心流程实际走一遍。还要运行 `wechat-miniprogram` 的 `npm test`；不能拿网页构建、网页测试或共享逻辑测试代替小程序编译和运行验收。没有完成这几步就不能报项目完成；遇到构建或运行阻塞，必须写明阻塞和未完成的验收项。

**只要改了前端，就要主动做视觉检查**：在独立端口打开实际页面并查看运行画面或截图，至少检查目标页面和窄屏布局，确认没有遮挡、溢出、裁切、错位或不可见/不可点的控件；小程序界面有改动时也要在微信开发者工具里检查对应页面。按检查结果修正后再看一次。5173 是用户正在学习的页面，不得用它验证、刷新或触发热更新；遵守上面的同提交双端要求，并参照 [`docs/MINIPROGRAM_SYNC_PLAN.md`](docs/MINIPROGRAM_SYNC_PLAN.md) 做小程序运行和两端截图检查。

## ⚠️ 微信小程序付费 / 登录上线闸门（2026-09-21 核实，尚未完成）

**支付代码写完不等于虚拟支付已经开通。** 截至 2026-09-21，微信后台的虚拟支付尚未开通，
`cloudflare-sync/wrangler.jsonc` 的 `WECHAT_OFFER_ID` 仍为空，Worker secrets 也没有
`WECHAT_PAY_APP_KEY` / `WECHAT_MSG_TOKEN`。线上 `/api/health` 因此明确返回
`wechatPayConfigured: false`、`wechatPushConfigured: false`、`productionReady: false`。
开发版可以上传，但只要小程序里还保留「购买 Pro」入口，**这三项为 false 时就不能提交审核，
更不能把它写成“上线后再开通”**；否则审核员和用户都会遇到一个必定失败的购买按钮。

提审前必须闭环：

1. 小程序后台「支付与交易 → 虚拟支付」完成主体实名、结算资料和协议签署，取得 OfferID / 当前 AppKey。
2. 后台创建并发布客户端实际使用的商品。当前购买页只调用永久商品
   `shushugo_pro_lifetime`，价格必须和 Worker 的 `29800` 分一致；月付 / 年付虽然服务端已有价格，
   当前客户端没有入口，不要误报为已经可售。
3. `wrangler.jsonc` 写 OfferID；AppKey 只能用 `wrangler secret put WECHAT_PAY_APP_KEY` 保存，
   不写进仓库、不贴在聊天里；重新部署 Worker。
4. 后台「开发 → 消息推送」配置
   `https://api.shushugo.com/api/purchases/wechat-notifications`，数据格式 JSON、明文；Token 与
   `wrangler secret put WECHAT_MSG_TOKEN` 保存的值一致，并通过微信的 GET 握手。
5. `/api/health` 必须同时看到 `wechatPayConfigured: true`、`wechatPushConfigured: true`、
   `migrationsApplied: true`、`productionReady: true`。
6. 先用沙箱（`WECHAT_PAY_ENV=1`）和真机验证：取消支付不发权益、支付成功发权益、重复 verify 幂等、
   另一账号不能领单、发货通知能补单、退款通知撤销权益、重新登录 / 重装后可恢复。全部通过后再切
   正式环境（`WECHAT_PAY_ENV=0`）并做一笔最小范围真金白银验收。

如果决定本版暂不卖 Pro，必须先隐藏购买入口再提审，不能留下已知必失败按钮。

**2026-09-25 增补：首版定为「只送不卖」**（`0fa41f4`，合并 `codex/w23-launch-mode`）。
Taro 微信版的 `taro-spike-2/src/platform/release-config.weapp.cjs` 里 `release.purchase: false`：
只呈现首月赠送（未登录先走微信登录，登录后自动领取），购买方案、恢复购买、兑换码入口都隐藏；
`purchaseProduct` 在调支付前就拒绝。所以上面 1–6 步不是首版提审的前置条件，**是将来打开 `purchase` 之前的前置条件**——
改成 `true` 前必须全部闭环。首月赠送不受这个开关保护（领取截止见 Worker `17dc24a`）。细节见 `docs/MINIPROGRAM_TARO_SUBMIT_AUDIT.md`。

### 2026-09-24 增补：四档微信道具与词汇量页面同步

上面的“只售永久版”是 2026-09-21 的旧状态。本轮代码接入月卡、季卡、年卡、永久版四个普通虚拟道具，
价格分别为 ¥10 / ¥24 / ¥68 / ¥298；WeChat ID 用 `pro_monthly` / `pro_quarterly` / `pro_yearly` /
`pro_lifetime`，内部权益 ID 保持 `shushugo_pro_*`。期限按北京时间的 1 / 3 / 12 个自然月计算，
到期后手动续购。服务端拒绝有效期内重复购买期限卡，允许升级永久版；客户端在调用支付前校验服务端返回的商品和分价。
改动只在本地，未部署或上传；后台四档已填写来自用户本轮报告，仍需真机支付、补查、发货和退款验收。
（2026-09-25 更正：同一会话后来**已部署** Worker 版本 `1077c5ff`（`api.shushugo.com`，`WECHAT_PAY_ENV=1` 沙箱，绑的是共用正式 D1）
并上传了小程序开发版 `0.2.2`，但代码一直没提交，直到 2026-09-25 才补进 `main`。真机支付 / 退款仍未验收。）

词汇量共用逻辑仍从 `frontend/src/lib/vocab-test.ts` 生成到 `wechat-miniprogram/src/shared/web.js`，
本轮 `npm run check-shared` 通过。原生 WXML 不会随网页 React 视觉改版自动变化；当前把网页“答题少于 15 题不算最近成绩、历史显示未出数”
的判据同步到小程序页。好友分享继续使用微信原生结果卡；网页 Canvas 图片和网页分享弹层不是小程序现成能力。
新测验答对 +1、答错 −1.15、不认识或超时 0；未完成的旧会话沿用 −1/3，历史 `levels_json` 继续区分 `version=2`，网页和小程序都会标记旧成绩。
用户学习时不打开或刷新 5173；需要看网页结果时用独立端口，学习页只允许在所有改动完成后热更新一次。

登录目前能完成 `wx.login` → Worker 换取 openid/session_key → 本地保存会话，支付签名所需的微信会话
也会记入 KV；但以下三项仍是**可以延期、不可遗忘**的待办：

1. 给 `POST /api/auth/wechat` 增加直接路由自动化测试；现有检查主要是静态约束和传输 smoke，
   不能替代登录接口的端到端回归。
2. 增加 `linkWechat` 账号绑定流程，把微信身份绑定到已有邮箱 / Apple / iOS 账号；否则老用户首次微信登录
   可能得到第二个账号，学习数据和权益会分家。
3. 同时保存并识别 openid 与 unionid 两个别名。当前 subject 有 unionid 就用 unionid、否则用 openid；
   如果用户第一次登录只有 openid，后来才获得 unionid，同一个人可能被当成新账号，需要别名表或迁移逻辑。

**2026-09-23 进度**：第 2、3 条服务端已做（Codex 9-22 在 `wechat-app-login` 隔离目录里写的，
今天才合进来）。`auth_identities` 里一个人可以有 `openid:`（小程序）、`mobile-openid:`（App）、
`unionid:` 三种别名，都指向同一个 user_id；老小程序账号第一次拿到 unionid 时自动补别名；
几种别名已经分别落到两个账号时返回 `WECHAT_IDENTITY_CONFLICT` 停下，**不自动合并学习数据**。
App 端有 `/api/auth/wechat-app`、`/api/auth/link-wechat-app` 和账号安全页的「关联微信」，
判据在 `cloudflare-sync/scripts/worker-wechat-auth-route.test.mjs`。
⚠️ 当时 level-plan 那边也各写了一份别名逻辑（`wechat-identity.ts`），合并时删掉了，
只留这一套 —— 两套各管一半的登录路由，迟早有一边改了格式另一边没跟上。
App 真正能拉起微信还差 iOS 那一半（开放平台移动应用、Universal Link、OpenSDK 桥接），
清单在 `docs/WECHAT_APP_LOGIN.md`；原生插件不存在时按钮不显示。

**2026-09-24 小程序已有账号关联补齐**：小程序的 `POST /api/auth/wechat` 现在只登录已有微信身份；
遇到未关联的微信身份会返回 `WECHAT_ACCOUNT_NOT_FOUND`，只有用户在设置页或组队页明确选择新建时，
才接受 `create_account: true` 并创建账号。已有邮箱账号和 Apple 账号可在「我的」输入登记邮箱，
通过一次性邮件验证码把当前小程序 OpenID / UnionID 关联到原 `user_id`；验证码经 Resend 发送，
路由按 IP、邮箱哈希和账号限速，不存在的邮箱也返回相同的发送结果，避免枚举账号。
关联前须同意当前用户协议和隐私政策；隐私政策已增补邮箱验证用途并升到 `2026-09-24`，
小程序 `config.js` 与 Worker 共用版本。若该微信身份已属于另一个 `user_id`，仍返回冲突并停止，
这次没有合并历史账号或学习数据；历史双账号要另做用户确认与数据合并方案。
本次只改了源码和文档，未部署 Worker、未上传小程序，也未做微信开发者工具/真机验收。

### 2026-09-26 Taro 版付费链路（`taro/main` 的 `202a773`，服务端同一份在 `main` 的 `c83cb3a`，**Worker 未部署**）

- **iOS 可以卖**：微信已全面支持 iOS 小程序虚拟支付（手续费 15%），并要求 2026-04-01 起各端都接虚拟支付，
  所以 Pro 页在 iPhone 上照常显示购买，不用做「iOS 不可购买」分支。
- **防重复扣款在服务端**：付完款、验单还没回来时再点购买，权益还没写，`PRO_ALREADY_ACTIVE` 挡不住。
  `createWechatPayOrder` 下新单前先把这个账号近两小时 `status='created'` 的订单向微信查一遍，付了的当场结算；
  查不通（断网 / 微信 `errcode -1` 系统繁忙）就 503 `PREVIOUS_ORDER_UNCONFIRMED`，不下新单。
  ⚠️ 别把这件事挪到客户端：换设备、清缓存之后客户端根本不知道还有一张没结清的单。
- **待确认订单只查一次**（`payment.js` 的 `verifyPendingPayment`）：有明确结果（付了 / 402 没付 / 其他 4xx）就清掉，
  只有断网、5xx 才留到下次。原来取消掉的订单每次启动连查 4 次而且永远不清。真付了却漏查的那一单，
  微信发货推送和上一条「下新单前先结算」两条路都会补上。判据在 `payment-price-smoke.cjs`。
- **文案是期限卡，不是订阅**：月卡 / 季卡 / 年卡「到期不自动续费」，永久版一次买断。写「按月订阅」是在误导付费用户。
  四档分价三处必须一致：`purchases.weapp.ts`、Worker `WECHAT_PAY_PRICES`、虚拟支付后台道具价。
- **付费小窗只有一个**：删掉了 `Paywall.weapp.tsx`（整屏深色遮罩、赠送期间藏掉购买、没登录也能点买），
  小程序用网页 `Paywall.tsx`。平台差异只有三处：期限卡说明代替 Apple 条款、领首月会员、先登录再买
  （`PurchaseResult.needsAuth` → `onRequireAuth` → `requireAccount`）。网页 Paywall 里的 DOM 调用必须一路可选链
  （Taro 元素没有 `querySelector` / `focus`）。
- 首发赠送记成 `source: "trial"`，永远弱于付费。赠送期间买期限卡**从赠送到期日起算**（用户 2026-09-26 定），
  按 `launch_gift_grants` 的固定到期日算——同一单会结算不止一次，按「当前权益是不是赠送」算，第二次会把到期日往回缩。
- `release-config.weapp.cjs` 的 `purchase` 仍是 `false`。开之前：部署含 `c83cb3a` 的 Worker、`/api/health` 的
  `wechatPayConfigured: true`、四档道具已发布、沙箱真机把取消 / 成功 / 重复购买 / 恢复 / 退款走一遍。

详细支付路由、密钥和消息推送约定见 `wechat-miniprogram/README.md`；每次提审按
`wechat-miniprogram/docs-submit.md` 的硬门槛逐项验收。

### ⚠️ 小程序上传包不得夹带开发诊断界面（2026-09-22 修）

2026-09-21 上传的 `0.1.0` 开发版曾把设置页里的「原子写盘」「冷启动恢复」「查看到期数量」、
内部用户 ID、权益来源、数据库文件路径和原始异常详情一起带进用户界面。它尚未提交审核，
2026-09-22 已从发布界面删除；真正给用户的更新、同步、备份功能保留。

`scripts/check-source.mjs` 现在会拦截这些诊断控件和数据库路径重新出现，并要求
`project.config.json` 保持 `uploadWithSourceMap=false`、`urlCheck=true`。每次上传前必须跑
`npm test`；再扫描 `src/`，确认没有 localhost / mock / vConsole / 私钥 / AppSecret / 硬编码密钥。
测试脚本、README、提审文档、云函数源码和 `project.private.config.json` 都在 `miniprogramRoot: src/`
之外，不进入小程序代码包；`src/config.js` 里的云环境 ID、云存储 fileID 和公开 API 地址是客户端
运行所需的公开标识，不是密钥。开发者工具上传日志只能证明工具成功打包上传，不能代替这道源码检查。

### 组队是云端真实数据，不准再退回示例队友（2026-09-22）

组队页已从 SAMPLE_TEAM / SAMPLE_PLAZA 占位改成网页与微信小程序共用的 Worker + D1 实现。
首页也不再显示「还没开放」。后续改版不得塞回假队友、NPC 或硬编码队伍来制造热闹；广场没人时就
明确显示没人。

数据和规则：

- D1 迁移是 0014_teams.sql：teams / team_members / team_daily_activity / team_cheers /
  team_reports。同一账号只能加入一支队伍，默认 6 人；容量由数据库 trigger 兜底，不能只信客户端。
- 公开队伍能从广场加入，邀请队伍只能用 8 位邀请码；邀请码只用于入队，不是登录凭据。
- 队长退出且还有成员时，移交给最早加入的人；最后一人退出时解散。删除账号必须先走同一条退队 /
  移交流程，否则队伍会留下一个已删除的队长。
- 每日学习量由各设备上报，只用于组内展示；服务端只允许同日附近日期、0–5000，并用 MAX 合并，
  避免旧设备把新进度覆盖小。它不发 Pro、排名奖励或其他权益；柚子例外，按 `docs/TEAM_STREAK_AND_DUEL_SPEC.md`（2026-10-09 作者撤销了『绝不发柚子』）。
- 成员接口只返回随机成员 ID、昵称和确定性 emoji，不返回邮箱、OpenID、内部 user id 或原始学习流水。
- 加油每个发送者对同一队友每天最多一次；公开广场支持举报，举报后该队伍对举报者立即隐藏。

用户生成内容不能靠仓库里维护“敏感词大全”。链接、联系方式和长号码只做便宜的结构校验；微信账号
提交队名 / 昵称时，Worker 必须再调用微信官方 wxa/msg_sec_check（v2，结果只有 pass 才发布），
review / risky 一律拒绝，接口异常时也不能放行。它复用 WECHAT_APP_ID / WECHAT_APP_SECRET 和
现有 access_token KV 缓存；/api/health 的 wechatContentSecurityConfigured 必须为 true。
邮箱 / Apple 账号没有小程序 OpenID，官方接口无法替它做这一步，目前只允许结构校验并保留举报；
以后若要让网页版公开组队成为主要入口，应接腾讯云 TMS 这类不依赖 OpenID 的服务，不能扩写本地词表。

发布依赖顺序：先远程应用 0014，再部署 Worker，再上传小程序。旧 Worker 没有 /api/teams/*，
旧 D1 没有新表，任何一个漏掉都会让组队页真实报错；网页生产构建和小程序静态检查通过不等于线上
迁移已完成。微信分享路径固定为 /pages/team/index?invite=邀请码，从分享进入只预填邀请码，
必须由用户主动点加入，禁止自动入队。

组队打卡 / 对战新增迁移 `0018_team_streak_and_duels.sql` 和 Worker 接口：`GET /api/teams/rewards`、`POST /api/teams/leaves`、`POST /api/duels`、`GET /api/duels/me`、`GET /api/duels/:id`、`POST /api/duels/:id/submit`、`POST /api/duels/:id/claim`。发布顺序仍是远程迁移 → 部署 Worker → 发布前端 / 上传小程序。

## ⚠️ 小程序整个数据层都从网页源码打包，不许再手抄一份（2026-09-22 定的）

`wechat-miniprogram/src/shared/web.js` = `scripts/build-shared.mjs` 用 esbuild 把 `frontend/src/lib`
里的纯数据层模块**原样**打出来的（入口清单 `scripts/shared/entry.ts`，平台能力在 `scripts/shared/shims/`
替换）。现在收了收藏夹、备考计划、周报、柚子、查词汇量、成就、studyPreferences。

起因是 2026-09-22 审查 Codex 那批「小程序 UI 合并」：它把这些功能**照着网页重写了一份**，
而它们的表全是跨端同步的，漂移直接出现在对端，而且每一处单看都像「差不多」：

| 漂移 | 后果 |
|---|---|
| 成就表叫 `achievement_unlocked`（网页 `achievements`） | 两端各解各的，谁也看不到对方的；柚子按成就发钱也各发各的 |
| 语法收藏存 `grammar_points.id`（网页存 grammar.ts 的 `pdf-n5-041-2`） | 同一张 `content_favorites`，互相看不懂 |
| 词汇量：没有 −错/3 猜测修正、可信度 = 正确率 | 小程序的成绩混进网页历史，口径不同但长得一样 |
| 周报 `content_json` 是另一种形状，却写 `schema_version = 3` | 网页按 v3 解析会拿到垃圾 |
| 周报无条件上云 | 网页 `syncedTablesForCloud` 只给 Pro 带周报 |

用户定的规则（原话：「除了通知付费之类确实微信小程序机制不一样的部分和小程序已经做好的组队模式之外，
其他的全部按网页端合并」）：**凡是网页有的逻辑，小程序一律用网页那份**；例外只有微信自己的机制
（登录、虚拟支付、消息推送）和已经做好的组队。

### 2026-09-24 最高优先级规则：小程序与其他版本的主要功能一致

用户最新确认：小程序与其他版本的主要功能必须完全一致；任何有意保留的产品差异都必须先得到用户明确同意。此规则优先于旧的分支记录、页面现状、工期便利和个人实现偏好，适用于功能入口、流程、文案、视觉、权限、数据格式、状态、计算结果和同步行为。

默认把发现的差异视为需要修复的问题，并按其他版本的现行产品定义补齐。只有技术或微信官方要求确实使一致性无法实现时，才提交差异说明，列明对比版本、具体差异、官方依据、用户影响、建议处理方式和代码位置；在用户明确点头前，不得把该差异作为设计决定实现、保留、延期或发布。意外差异属于未完成项，不需要逐个等待批准才修复。

目前事先允许的差异仅为微信支付所需流程，以及完成同一功能所必需、范围最小的少数微信平台适配。平台适配可以更换底层 API 和原生控件；若它改变任何用户可见的功能、步骤、权限、内容或结果，仍按上面的差异审批规则办理。适配必须能指向具体官方要求，不能把“微信用户习惯”“实现方便”或已存在于某个旧版本当成授权。

### 2026-09-24 补充：小程序与 5173 对齐期间的单一业务源

上句保留的是当时的历史决定。当前网页已经有组队页；按用户 2026-09-24 最新确认的多端对齐目标，
组队也不是独立的小程序业务例外。所有网页与小程序共有的功能都以 `frontend/src/lib` 的业务逻辑、
数据格式和产品规则为唯一来源，通过 `scripts/shared/entry.ts` / `src/shared/web.js` 接入；
小程序页面可用原生 WXML/WXSS 重做呈现，但不得另算计划、FSRS、成绩、权益或同步规则。

小程序可保留独立代码的范围限于微信平台明确要求的薄适配，例如 `wx.login`、原生控件与事件桥接、
虚拟支付调用及微信回调、订阅消息、系统分享、云存储/文件 API、音频和生命周期桥接；这些例子不是
对所有相关产品差异的概括授权，具体实现应缩到完成同一功能所必需的最小范围。支付界面和签名字段
可以遵循微信接口；商品/价格判定、服务端验单、订单归属、权益授予与撤销仍走共同服务端与权益模型。
组队等两端共有功能继续遵循相同接口契约、校验和用户可见结果。适配若造成用户可见差异，按上面的
最高优先级审批规则处理，并记录对应的官方 API / 审核依据及适配文件位置。

### ⚠️ 2026-09-25 复盘：小程序「对齐网页」耗了二十来个小时却看不出变化，原因和该怎么做

用户看到的小程序从 8 月 24 日第一版（`fdc44a2`）起就是 Codex 自己手写的一套蓝色卡片 WXML/WXSS，
从没接过 `design/` 和网页的样子。之后每一轮「合并」都只做了两件事里的一件，从没做过第三件：

| 轮次 | 做了什么 | 结果 |
|---|---|---|
| 09-22 Codex 约 6.5 h（`miniprogram-ui-merge` worktree） | 给旧页面换暖色 + 照网页**重写**八个功能 | 同一天被 Claude 做的共享数据层（`build-shared.mjs` → `web.js`）整体取代，从没合入 |
| 09-22/23 Claude | 把 `frontend/src/lib` 整个数据层打进小程序 | 数据两端一致了，**页面长相一个没变** |
| 09-23 Codex 约 4 h（HANDOFF / level-plan） | 小程序的起点设定、备考页 | 已合入 `1c7e35a` |
| 09-24 Codex 约 1.7 h | 四档付费、词汇量新计分、上传修复，部署 Worker 并传 0.2.2 | 有价值，但没提交；09-25 补提交 |
| 09-24 Codex 约 5 h（`miniprogram-parity-20260924`） | 又一次**逐页手写**首页、语法、辨析、快速复习、个人资料、帮助、关于、隐私 | 仍是它自己理解的样子；用户叫停。见下 |

时间主要耗在：① 每页先读网页 React 源码、再按自己的理解重写 WXML，而不是拿网页渲染出来的样子去搬；
② 主包 2 MiB 上限（每加一页都要挪分包、压缩共享包，反复重跑）；③ 每页新写一个 smoke 脚本、每次改动重跑 25–31 个脚本；
④ 把范围扩到截图里没有的页面（个人资料 / 帮助 / 关于 / 隐私）。它自己估的「一人全职 20–40 个工作日」就是按「逐页重写」算的。

**该怎么做（用户 09-24 提出、Codex 也承认顺序错了）**：页面层直接移植网页。网页在手机宽度下渲染出来的
DOM + 编译后的 CSS（Tailwind 产物 + `app.css` / `design.css` / `styles.css`）就是规格：
`div→view`、`span/p→text`、`img→image`、`className→class`、`{cond && …}→wx:if`、`.map→wx:for`、`onClick→bindtap`，
状态从 React state 挪到 `setData`，数据仍调 `web.js` 里的同一份函数。先搬、再在模拟器里按报错修。
已知要手改的只有 WXSS 不认的选择器（`:has()`、挂在 `html` 上的 `[data-theme]` / `[data-skin]` 要改挂页面根节点）、
`position:fixed` 与原生 tabBar 的关系、`<canvas>` 画的东西（分享图、圆环）。**不要再「照网页的意思重写一版」**。

下一步怎么做见 `docs/MINIPROGRAM_SYNC_PLAN.md`（Codex 写的 `WECHAT_WEB_PARITY_PLAN.md` 按「逐页重写」估了 20–40 个工作日，
2026-09-25 删掉了；其中「主要功能一致」那条规则上面已有，parity 分支里还能取用的东西列在新计划的路线 B 里）。

### 旧工作目录和分支都归档在 `refs/archive/*`（2026-09-25）

那天把 21 个 worktree（`~/.codex/worktrees/*`、`.claude/worktrees/*`、`~/Documents/日语学习/开发中/shushugo-data-sync-fix-20260917`）
全部删了：每个先把未提交的改动连同未跟踪文件提交成一个快照，挂在 `refs/archive/worktree/<名字>` 上再删。
这些 ref **不出现在 `git branch` 里，但随时能取回**：

```bash
git for-each-ref refs/archive                       # 列出全部
git show refs/archive/worktree/level-plan --stat     # 看某一个快照改了什么
git worktree add /tmp/x refs/archive/worktree/level-plan   # 需要时再展开成目录
```

绝大多数是已经合进 main 的旧副本（main 上是更新的版本），归档只是为了「万一有漏的」能找回。
⚠️ 以后**不要再从这些快照里整份拷文件回 main** —— 它们基于旧提交，整份拷回等于回退。要用就按文件看差异、只取缺的那一处。

- 新功能进小程序：先看能不能加进 `entry.ts`。不能（碰 DOM、带出厂内容 JSON）才 shim，shim 只做
  平台替换，不改判据。
- ⚠️ **`word-api/stage1` 必须 shim 成只读**（`shims/stage1.js`）：网页的 `stage1ProgressCounts` 会先
  `ensureStage1Tasks()`——按网页的排计划器往 `stage1_tasks` 写行、按 `stage1_plan_version` 删没答的行。
  小程序今天的计划由自己的 `createTodayPlan` 排，直接接上等于每次结算柚子把当天计划重排一遍。
  同理 `word-api/bootstrap` / `grammar-api` 也 shim 掉（那里面是 FSRS 回填迁移）。
- 小程序**没有**网页那套同步触发器：`runtime/extended-features.js` 在每次写收藏 / 夹子后自己盖
  `sync_updated_at`、自己补 / 撤墓碑。lww 表不盖时间戳 = 本机改动输给对端旧行。
- 同一天顺手查出的老小程序删除路径**没有一条留墓碑**：`undoLastAnswer` 删作答、`setConfusionMastered(false)`
  删掌握标记，推上云之后下一次合并原样回来（撤销等于没撤）。而且网页的作答墓碑键是 `sync_uid`，
  小程序 `applyTombstone` 只认三列自然键，网页那边撤销的作答在小程序上永远删不掉。都修了
  （`sync-snapshot-smoke` 里两个方向各钉一条）。**小程序任何 DELETE 同步表的地方都要自己写墓碑**，
  它没有触发器。
- 仍不一致、暂时接受的：小程序 `progress` 合并是「计数取大、FSRS 看 last_review 新」，不是网页的 lww ——
  撤销后本机 progress 回退了，云上那份没回退的会在下一次合并时赢回来（流水已删、进度没退）。
  疑难辨析组的 key 出厂库上 1,881 组里 1,880 组两端一致，差的一组（网页 `homophone:ロック` / 小程序
  `stem:開`）等 confusion-groups 进共享层一并解决。
- 产物提交进仓库；`npm run check-shared` 会重新构建比对。**网页那边改了 lib 要在这里重跑
  `node scripts/build-shared.mjs`**，否则小程序 CI 红。构建读的是**同一个 checkout 里的** frontend
  源码——在没有那些改动的 worktree（比如 Codex 的）里跑会解析不到模块。
- `wechat-miniprogram/data/*.json` 是数据模块的源，故意放在 `src/` 外：放里面会整个打进主包。
  `data/grammar_ids.json`（数字 id ↔ 字符串 id，`grammar_points.id == bookOrder`）由 build-shared
  从 grammar.ts 抽。

**第二轮（2026-09-22 当天做完）：连调度和同步一起换成网页的。** 用户原话
「除了通知付费之类确实微信小程序机制不一样的部分和小程序已经做好的组队模式之外，
其他的全部按网页端」。现在 `src/shared/web.js`（706 KiB，进主包）收的是整个数据层：
建表 + **同步触发器**（study-core / sync-schema）、单词三方向的调度与作答（word-api）、
语法考题（grammar-quiz）、词库、辨析分组与辨析题、收藏、成就、柚子、周报、词汇量、备考、偏好、
**云同步的导出与合并**（sync/snapshot + sync/merge）。小程序侧只剩薄适配：

| 小程序文件 | 现在是什么 |
|---|---|
| `core/study-core.js` | 1,048 行手抄调度器 → 160 行「db-first 调用惯例 → 网页的隐式当前库」 |
| `runtime/learning.js` | 出卡 / 作答 / 撤销全走 word-api；减负卡、压轴卡按网页学习页那条顺序插 |
| `runtime/card-view.js` | **纯展示映射**（WordCard → WXML 字段）：词形、题面、遮读音、音高、词典条目全部取网页模块 |
| `runtime/word-library.js` `confusion.js` `analytics.js` | 转发到网页的 word-library / confusion-groups / word-api + progress-api |
| `runtime/sync-snapshot.js` | 678 行自研合并器 → 转发到 `mergeDatabaseBytes`，外加老快照的墓碑列名翻译 |
| `runtime/legacy-migrations.js` | 新增：0.1.x 的库升上来（墓碑换列名、透传表放回真表、`achievement_unlocked` → `achievements`、删掉自创的 `direction_tasks` / `mode_tasks`） |

⚠️ **删掉的不止是重复代码，是一批真实的跨端 bug**：小程序以前没有同步触发器，所以
撤销作答、取消收藏、取消已掌握**都不留墓碑**（对端下一次合并原样复活）；
语法列表的「熟悉」直接 UPDATE `grammar_progress` 而不写 `grammar_reviews`、不动 FSRS；
导入整库备份走的是只认三张表的 JSON envelope（收藏 / 成就 / 柚子 / 周报全丢）。

⚠️ **出厂内容数据进了两个分包**，主包放不下（微信每包 2 MiB）：
`content`（题面层 599 KiB、汉字单元索引 390 KiB、一字多音 190 KiB、音高重音 266 KiB
+ 一字多音页和辨析题页）、`features`（辨析审校 340 KiB、简繁对照、汉字读音表、语法抓手
+ 其余功能页）。主包 1.80 / features 0.71 / content 1.42 MiB。
装载器是 `src/shared/content.js`（`require.async`），**顺序是硬要求**：
`database-store.ensureContentLoaded()` 在库就绪前先把它们灌好，再点一下网页那几个
`loadXxx()` 的缓存。⚠️ 网页那几个 loader 是 `loading ??= import(...)`，**失败一次就永久失败**
（rejected promise 被缓存），所以绝不能让页面在内容到位之前先触发它们。
⚠️ 模块初始化时就取一层属性的那几份（`kanji_variants.japanese_to_simplified`、
`kanji_readings.readings`、`grammar_key_points.points`）必须用 `shims/lazy-json.js` 的**活代理**，
返回 undefined 的话 `?? {}` 会把空表永久固定下来，加载完也永远查不到。
自他动词对（`verb_pair_hints`）相反：网页在 init 时 `Object.entries()` 就展开了，**只能同步**，
所以它留在主包。

**还没按网页合并的（下一步，按这个顺序）**：① 混合学习的插播卡面（语法 / 单独汉字 /
辨析连线三种卡在小程序里还没有 WXML，所以模式列表里先隐藏 `mixed`；数据层的
`grammar-quiz` / `kanji-char-cards` / `confusion-cards` 已经在包里了）；
② 每日量圆环（`daily-plan.ts` 已在包里，缺的是 canvas 那套交互）；
③ 学习页的翻卡动效、甩卡、连击音效这些纯 UI。这三样都不影响跨端数据一致。

⚠️ **顺手修了一条网页自己的同步 bug**（`sync/schema.ts` 的 `withoutSyncStamp`）：
`ensureProgressInitialized` / `ensureGrammarProgressInitialized` 给每个词补的**空占位行**
会被 insert 触发器盖上「现在」的 `sync_updated_at`，而 progress 的合并是 LWW ——
今天刚装上的设备，它那堆空行的时间戳比云端那条真学过的行新，合并之后**云端的学习状态
被一行空记录静默盖掉**（现象：换台设备打开，学过的词变回未学）。现在占位行在
`applying_remote` 下写、时间戳留空（= 纪元），任何真实记录都赢得过它。
同类的占位行（`materializeKanjiChars` / `materializeConfusionCards` 的 `kanji_char_memory`、
`confusion_progress`）一起改了 —— 后者连 `level_rank` 回填也不盖章：那个值每台设备自己
从出厂内容算得出同一个，不需要靠同步传播，盖章只会让「刚重算过等级」的设备赢掉对端的进度。
判据在 `frontend/src/lib/sync/merge.test.ts` 的「占位行不参与 LWW」两条。

## 小程序不是「能收 v2」就等于双向无损（2026-09-09 修）

⚠️ **Worker 不做按表合并**：它把每次上传当成这个账号新的**完整备份**。
所以任何一端少导出一张表，云端最新那一代就缺那张表；攒够三代之后，
最后一份完整的快照退出保留范围，全新设备再也恢复不出来。
**「老设备本地还有一份」不是云备份完整。**

两处已修：

1. **作答流水的身份是 `sync_uid`，不是 `(word_id, created_at, direction)`。**
   `created_at` 只到秒，前端同一秒答两次会产生两条自然键完全相同的作答；
   把前端**实际导出器**产生的这两条交给小程序**实际合并器**，2 条只进来 **1 条**。
   小程序的 `reviews` 现在也有 `sync_uid` 列（`ensureStudySchema` 里加列 + 回填
   `设备号:本机行号`，格式和 iOS 一致），导出协议版本随之抬到 **2**。
   ⚠️ **抬版本号和补那一列必须一起做** —— 写着 v2 却没有那一列比拒绝导入更难查。
2. **小程序看不懂的表原样存下来、原样回传**（`sync_passthrough`）。
   收快照时把不在 `SNAPSHOT_TABLES` 里的表（`grammar_progress`、语法流水、收藏、
   汉字单元……）连建表 SQL 和行一起存进本地一张表，导出时重放。
   每次收到新快照整个换掉那一份 —— 和前端本地增量同一个道理：
   后一条完整覆盖前一条，不需要序号也不会有「回放了一半」。
   小程序后来真的认识了某张表，本地那份才是真相，透传里那条会被删掉。

判据在 `wechat-miniprogram/scripts/sync-snapshot-smoke.mjs` 末尾那段**真实往返**
（前端形态的快照 → 小程序合并 → 小程序导出），CI 里跑。

### ⚠️ 透传只保护「小程序不写的表」（2026-09-10 修）

上面第 2 条对**小程序只读的表**成立，对**小程序自己会写的表**是假的：
透传送回去的是「上次收到的远端副本」，本机新写的一个字都出不去。

`grammar_progress` / `grammar_state` 正是这种：`markGrammar` 和
`toggleGrammarFavorite` 会写它们，而它们当时不在 `SNAPSHOT_TABLES` 里 ——
**小程序上背的语法进度、点的语法收藏，一次都没同步出去过**。
现在两张表都进了正式协议，各自有合并规则（`mergeGrammarProgress` 和 progress
同一套口径：计数取大、FSRS 看谁的 `fsrs_last_review` 新）。

⚠️ **进了 `SNAPSHOT_TABLES` 就等于退出了透传的保护**，于是多出两条硬约束：

1. **表必须无条件建出来**（`ensureStudySchema` 里调 `ensureGrammarSchema`），
   不能等语法页第一次打开。表不存在时导出和合并都会静默跳过 ——
   对端的语法进度会在小程序推上去的那一代快照里凭空消失。
2. **列必须和 iOS 的 `grammar_progress` 逐列对齐**（`GRAMMAR_PROGRESS_COLUMNS`）。
   导出只写本机有的列、合并只收两边都有的列，**少一列就等于每次推快照都把
   iOS 那一列从云端最新那一代里抹掉**。smoke 里逐列断言。

⚠️ **`grammar_state.dataset_version` 不进快照**（`LOCAL_GRAMMAR_STATE_KEYS`）：
和 iOS 端 `isDeviceLocalStateKey` 是同一条判据，理由见下面「本机内容迁到哪一版」那节。

### ⚠️ 语法收藏的读和写曾经不在同一张表（2026-09-10 修）

`toggleGrammarFavorite` 用 `core.setState` 写 **app_state**，而 `grammarRows` 的
JOIN 读的是 **grammar_state** —— **点了收藏永远显示不出来**，一次都没成功过。
现在读写都走 `grammar_state`，并把已经误写进 app_state 的
`favorite:*` 迁过来（`migrateFavoritesFromAppState`）。


## ⚠️ 小程序视觉验收看 Taro 版（`taro-spike-2`），原生 `wechat-miniprogram` 的页面是淘汰界面（2026-10-11）

10-11 混合学习队列重构时，我在开发者工具里打开的是原生 `wechat-miniprogram/` 的隔离副本，截了半天图，
作者一眼指出「这不是已经被淘汰了的界面吗」。**现行小程序是 `taro-spike-2/`**：它的学习页直接编译
`frontend/src/pages/WordStudy.tsx`（`frontend/src/routes/word.tsx` → `taro-spike-2/src/pages/word/index.tsx`），
所以改网页页面 = 改小程序页面，验收必须在 Taro 版上看。原生版的 `npm test`（`shared/web.js` 新鲜度、`modes-smoke` 等）
仍然要跑、仍是 CI 闸门，但它的 WXML 截图不能当视觉验收。

在开发者工具里跑 Taro 版的做法（10-11 实测可行）：

1. worktree 里 `cd taro-spike-2 && npm run build:weapp`（几分钟；会改 `reports/` 三份闸门报告 —— 改了 `frontend/src`
   就该一起提交，见 `release-and-deployment.md`；`src/package-assets/**`、`lucide-packages.cjs` 的改动按那里说的还原）。
2. `cli open --project <worktree>/taro-spike-2 --port <服务端口>`，再 `cli auto --project ... --auto-port 9431 --port <服务端口>`。
   出厂库走项目配置里的微信云存储，用真实 appid（`touristappid` 已被拒「不存在此 AppID」）。
3. **`miniprogram-automator` 对 Taro 项目能用**（`pageStack` / `evaluate` 正常；同一版开发者工具 2.02.2609231 下，
   原生项目的 `pageStack` 是空的）。Taro 页面是 React，`page.data` 里没有业务状态：用 `(await page.$('page')).outerWxml()`
   拿 WXML，按文字找元素 `id` 再 `page.$('#id').tap()`；「上一个」是含 `rotateccw` 图标的那个 button，看它的 `aria-disabled`。
4. **后台 computer-use 点不到模拟器里的元素**：坐标点击会以缺 `touches` 的事件进到渲染层，报
   `[渲染层错误] undefined is not iterable`（是点击方式的伪错误，不是应用的错），AX 索引也会被拒。别在这上面耗时间，直接用第 3 条。
   控制台敲长代码也不可靠（自动补全会吞字）。
5. 混合学习在会员门后面（`App.tsx` 的 `mixedStudy`）。验收时临时把 `taro-spike-2/src/platform/entitlements.weapp.cjs`
   的 `cachedEntitlement` 改成直接返回 `active: true` 再构建一次，**跑完立刻 `git checkout` 还原，闸门报告用干净构建那份**。
   `cli open` / `cli auto` 重开项目会清掉模拟器 storage，所以偏好 / 学习模式要在重开**之后**设，模式经「学习模式」页点进去
   （`startStudyMode` 才会过付费闸并带上 `launchStudyMode`）。
6. ⚠️ 模拟器 `wx.env.USER_DATA_PATH` 有 200 MB 上限，历次验收的隔离库目录（每个 25–30 MB，如 `shushugo-countdown-visual`、
   `w15-visual`、`shushugo-post-exam-vqa`）会堆在那里。满了以后学习页弹「学习记录没能保存到本机」—— 是模拟器空间，不是代码坏了。
   验收前先看一眼占用，用完删掉自己建的目录。

## ⚠️ 给 `*.weapp.ts` 替身加 / 改导出之前先想一件事：`ci-local.sh` 不跑 `build:weapp`（2026-10-13）

网页文件被 `*.weapp.ts` 替身替换时（`taro-spike-2/config/platform-adapters.cjs`），**网页新增一个导出、替身没有同名导出**，真机上就是 `x is not a function`。
`npm run build:weapp` 的第一道闸门 `verify-shim-exports` 会拦这个，但 `scripts/ci-local.sh` 和 GitHub CI 都不跑它——10-13 推 main 时
`audio-pack-platform.ts` 加了 `PUBLIC_WEB_WITHOUT_PACKS`、替身没跟，`build:weapp` 在 main 上红了一天没人知道（预览包是推之前编的）。
**判据**：改了 `frontend/src/lib/*.ts` 里有 `.weapp.ts` 兄弟文件的模块，推 main 前顺手跑一次 `cd taro-spike-2 && npm run build:weapp`。
同一天还有一条：小程序里 `wx.request` 访问云存储的临时下载地址，真机要在微信后台配「request 合法域名」，开发者工具不校验、测不出来；
能用云 SDK（`wx.cloud.downloadFile`）的地方不要用 `wx.request`（读音包的单条兜底因此改成整包走 SDK）。

## ⚠️ 小程序的全屏弹窗盖不住原生底栏：一律用 `useStudyBreakTabBar`，别各写各的 `hideTabBar`（2026-10-19）

网页上弹窗（`z-index` 10001）能盖住自建底栏（9999）；小程序的 `tabBar` 是原生的，在页面渲染树之外，任何层级都盖不住。
首次设定（`LevelSetup`）原来没处理：设定还开着，用户点底栏「单词学习」就进了学习页，在**没有计划、没有起点先验**的状态下开始出新词
（作者 10-19 撞到：「先验的时候点到单词学习界面，为什么会有词开始学习」）。
- 现在 `LevelSetup` 和 `AuthDialog.weapp` 都调 `hooks/useStudyActivity` 的 `useStudyBreakTabBar(open)`（网页是空操作，小程序替身在
  `taro-spike-2/src/platform/use-study-activity.weapp.ts`）。⚠️ 它**带计数**：领首月会员要先登录，登录框叠在设定弹窗上，
  各自 hide/show 的话登录框一关底栏就冒出来。判据在 `scripts/study-activity-smoke.cjs`（叠加场景）。
- 新增任何全屏弹窗/遮罩，只要可能出现在 `home/word/grammar/profile` 四个 tab 页上，都要调这个 hook。
- 设定期间已经出现在今天队列里、**没答**的词，保存时会被 `refreshTodayWordPlan` 删掉按新额度重抽；**答过**的词有 `reviews` 流水，
  起点先验（`applyLevelStartingPoint`）不会碰它，按真实记录走。
- 10-19 在开发者工具里实测过：新用户状态下设定弹窗一出来底栏就没了（automator 的 `mp.screenshot` 能截到原生底栏，可直接对比）。
  ⚠️ 想看「新用户」这一屏：**模拟器存储按 appid 分，不按项目目录**——把 `dist` 复制到别的目录再打开，读到的还是同一份学习库
  （`~/Library/Application Support/微信开发者工具/<hash>/WeappSimulator/WeappFileSystem/<openid>/<appid>/usr/masternihongo/`）。
  做法：`cli close` → 备份该目录并记 `shasum` → 挪开 → `cli auto` 重开（出厂库会重新拉）→ 看完再 `cli close` → 放回、`shasum` 对一遍。
  别在项目开着时挪文件：落盘会把内存里的库写回去。

## 小程序启动：开库和内容分包并行，首次整库写盘不挡页面，根节点不听每帧事件（2026-10-19）

作者 10-19：「小程序实机测试还是很卡顿，尤其是第一次进入」。同样的改法 09-30 就做过（`weapp/startup-fast-a` `f88c5f39`、
`weapp/startup-fast-b` `d8388373`），卡在「开发者工具视觉验收」上三周没人合，main 也一直是串行加载。这次按当时的 main 重做后合入。
**教训：性能分支做完当场在开发者工具里验收并合回，不要留一句「等验收」——留下就等于没做。**

现在的启动链路（`taro-spike-2/src/platform/WeappPage.tsx` + `database-runtime.weapp.ts`）：
- `WeappPage` 里**开库、AppShell 外壳、汉字内容（`readyForKanji`）、语法内容（语法页才要）四件事同时开始**，原来是「开库 → 外壳」与「汉字 / 语法」两段串行。
- `ensureDatabase` 里**页面内容分包（`readyForPage`，word-study 那套约 1.5 MB JS）和开库同时开始**，原来是内容分包全部装完才开始读本机库 / 下出厂库。
  判据：开库这条路（`loadDatabase` / `importDatabase` / `ensureUserTables` / `ensureSyncSchema`）不 import 任何内容缓存模块；
  `readyForKanji` / 语法内容的 web loader 只灌内容缓存、不碰数据库。⚠️ 以后往开库路径里加用到 `content-store` 的迁移，就得把它挪到 `Promise.all` 之后。
- **首次装机的整库写盘推迟 3 秒，不再挡页面**。安全性靠 `storage.ts` 的快照基准：导入出厂库后 `snapshotDb` 为空，推迟期间任何落盘都**必定整库**，
  不会出现「只有增量、没有整库」。而首页 `getProgressOverview` → `initProgress` 每次启动都 `persistSoon()`，首次安装那次就是整库；
  所以推迟的那次在 `getLocalDataRevision()` 变了时跳过——不跳的话首次安装会连写两遍十几 MB（开发者工具里看得出来：磁盘上多一份 `nihongo.db.prev`）。
- 加载画面 `StartupLoading.tsx`：走路水豚 + 「下载词库 N%」+ 进度条，下完转「正在加载…」。只有发起开库的那个页面拿得到下载进度，其他标签页显示「正在加载…」。
- **页面根节点只听 `onTouchStart` / `onClick`，不听 `onTouchMove`，主 ScrollView 不绑 `onScroll`**。这两个每帧都从渲染层跨到逻辑层，
  背词页上每一帧还经 `notifyStudyInteraction` → `WordStudy` 的 `onInteraction` → `buddySession.send({type:'interaction'})` 生成一份新的陪伴水豚状态、整组件重渲染。
  学习时长按 60 秒没操作算走神（`study-clock.ts`），每次手指按下记一笔就够。⚠️ 别为了「更准」把这两个加回来；真要更细，先在 `notifyStudyInteraction` 里节流。

开发者工具实测（10-19，Mac 上有 JIT，数字不代表 iPhone）：清库首次安装从首帧到首页约 1.7–2.8 秒，首次设定照常弹出、底栏照常藏；普通冷启动正常；四个标签页切换无报错。
**真机计时还没测**——要测就 `npm run build:preview:weapp`（计时版，首页 / 单词页有分段浮层），推到手机后冷启动截图。

**2026-10-19 增补：计时版加了「卡住」记录。** 作者扫了上面那版仍说「开始的时候卡，点考试日期很卡无比」，而设定弹窗本身的查库在 Node 里只有 1–2 ms。
怀疑是同一时刻后台的重活（首次整库落盘、保存计划）占着逻辑线程，所以 `perf-marks.ts` 在计时版里每 100 ms 打一次点，
两次之间多出 250 ms 以上就记一笔 `卡住 · <最近开始的那一段>`；`storage.ts` 给整库导出 / 整库写文件 / 收集增量 / 写增量、
`LevelSetup` 给估算查库 / 保存起点 / 排每日量 / 生成今天的任务都打了标签。浮层（`preview-timing.weapp.tsx`）把「卡住」排最前、整行显示。
普通构建里这些都是直接执行原操作。标签是「最近开始的一段」，不一定就是罪魁——看到「卡住 · X」要回头核对 X 之后紧跟着跑了什么。

⚠️ **开发者工具里模拟「首次安装」的坑**（这次踩到）：模拟器文件按 appid 共享。`cli close` 关掉主目录项目后，它的模拟器实例并没有马上死，
打开另一个项目的那一刻把内存里的旧库**写回了磁盘**（同一秒写出 `nihongo.db` 和 `.prev`），于是那一轮测的根本不是首次安装。
做法：`cli quit` 之后**等 `wechatwebdevtools.app/Contents/MacOS/Electron` 进程真的退出**（`quit` 打勾后主进程还会挂十几秒到几十秒），
再挪走 / 删掉 `usr/masternihongo`，再 `cli auto`。判据：首次安装那轮开头必须出现「下载词库 N%」。恢复时同样先等进程退出，放回备份后逐个 `shasum` 对。

未做、可以接着做的：
- `weapp/startup-fast-b` 的思路——**一判断出没有本机存档就先弹首次设定，词库在后台下**——没移植（它改了 `LevelSetup` 和弹层挂载点，和 10-19 的底栏规则、
  首月赠送页都有冲突，要按现在的代码重做）。那两条旧分支已归档到 `refs/archive/weapp/startup-fast-a|b`。
- 首页每次冷启动仍要装 word-study 那套内容（`question-meanings` 613 KB、`pitch-accent` 273 KB、`distinction-reviews` 255 KB……）和汉字那两份（约 730 KB），
  全是 JS 对象字面量，iOS 上解释执行。首页本身是否用得到这些没核实（懒代理在未加载时返回代理而不是报错，用错了是静默的），要动先真机计时再逐个核对。

### 2026-11-05 增补：首次安装先弹首次设定，出厂库在后面静默下（上面「未做」第一条做了）

作者原则（2026-11-05，见记忆 lazy-load-library-on-demand）：加载尽量静默，首次打开的词库下载挪到先验期间做，不让人盯着进度条。

- `WeappPage.tsx`：`ensureDatabase` 的 `onDownload` 只有首次安装（本机没有存档）才会被调用，**第一次被调用就是「确定是首次安装」的信号**——
  这时 `setLevelSetupOpen(true)` 并置 `levelSetupChecked = firstRunSetup = true`（对战直达 / 邀请页除外，判据 `setupExempt`）。
  外壳（`loadShell()`）改成一加载完就 `setShell`，不再等开库；渲染闸门从「`!ready` 就整页加载画面」改成「`!shell`，或 `!ready` 且不是首次下载」，
  首次下载时 AppShell 照常渲染，路由根节点里主 ScrollView 换成 `StartupLoading`，**portal 宿主 `<View ref={portalHost} />` 留在原位不动**（弹层挂的目标不变）。
- `AppShell` / `LevelSetup` 新增可选 `dbReady`（默认 true，网页 / App 不传）：库没好之前不查库（`existing` 取 null、估算 `remainingWords` 为 0 且不出 `preview`），
  选项照常可点；保存按钮灰着写「词库准备中…」，库好了才亮。已登录的首次设定那一页「正在找回学习进度」的 8 秒计时也等 `dbReady` 才开始。
- `sync-api.ts` 的 `autoSyncCloudDatabase`：`getDatabase()` 还没库就返回 `skipped`、不发请求。首次设定第一页的微信登录发生在库下完之前，
  登录触发的那次同步会被跳过，库好后 `WeappPage` 的 `requestCloudAutoSync('startup')` 再补一次（`startupSynced` 只发一次，已从「首次设定判断」那段里提出来）。
- ⚠️ 没做的、要知道的：
  - **「内容分包用到才装」没做**：`ensureDatabase` 仍 `Promise.all([readyForPage('word-study'), 开库])`，`readyForKanji()` 也还挡 `ready`。现在只是它们和首次设定**重叠**了，没有变成按需。
    要做先逐个核实首页 / 角标读不读这些懒代理（未加载时返回代理而不是报错，用错了是静默的）。
  - 库好的那一刻 `setOverview(getProgressOverview())` 仍同步算一遍首页数据（首装几百毫秒到几秒），正好落在用户还在填首次设定的时候，可能有一下顿。要消掉：首次设定开着时先不算，等设定完成走已有的刷新。
  - 弹层 `createPortal` 在宿主登记之前是原地渲染，登记后换成真 portal：首次设定的第一次渲染和宿主同一帧出现，所以会在下一次重渲染（下载进度事件几乎马上就有）时换一次、子树重挂一次。
    此时用户还没来得及点；真机上若看到首次设定闪一下就是它。
  - **主包体积**：这一版加上云同步启动，第一次构建主包 1,900,325 B（上限 1,900,000，改前余量只有 113 B）。腾法同 10-14 那次：删全仓库零引用的样式——
    脚本找「类名在 `frontend/src`、`taro-spike-2/src`、`index.html` 里一次都不出现、而且「前缀-」这个字符串也不出现（防拼接）」的 40 个类
    （`zoo-tile-hero-*` / `zoo-tile-team-*` / `zoo-tile-modes-*` / `zoo-tile-mistakes-*` / `zoo-tile-jlpt-*` / `zoo-tile-strip-*`、`zoo-panel-*`、`zoo-goal-sheet|chips`、`daily-tail-*`、
    `vocab-fb-*`、`vocab-prompt-panel`、`help-faq-*`、`jq-list-row`、`zoo-face-label`、`zoo-mood-*`、`stat-label`、`bg-stone-950`、`body.keyboard-open` 空规则），
    postcss 摘掉含这些类的选择器 / 规则（`app.css`、`styles.css`、`design.css`），结果主包 1,894,700 B，**余量 5,300 B**。
    还有 84 个「字面零引用但前缀出现过」的类没动（`zoo-confetti-*`、`rate-*`、`quick-study-rating-*`、`ds-say-*` 等，多半是拼出来的），下次要腾空间先核这批。
    ⚠️ 这三份 CSS 当时被别的会话改着（`pointer:coarse` 的媒体查询那几行不是我的），提交时按 hunk 挑。
  - **开发者工具实测（2026-11-05，Mac 模拟器，独立工作树构建；清库方法照上一节）**：automator 每 0.3 秒记一次首屏——2.7 s 时 WXML 里**同时**有「下载词库」（加载画面在底下）和
    「先登录微信 / 微信登录 / 先不登录」（首次设定登录页盖在上面，水豚居中、两个按钮在底，截图正常）；3.4 s 控制台「Database imported」；点「先不登录」后进「先定个小目标」，
    库已好，保存按钮在没选考试日期时是浅绿禁用（「选好考试日期后显示每日计划估算」），无异常、无报错。⚠️ **没看到「词库准备中…」那一态**：Mac 上下载 + 导入只有约 1 秒，
    手点来不及；这一态靠代码保证（`dbReady` 为假时不查库、不出 `preview`、按钮禁用），要眼见得用真机或限速网络。登录 → 云端有旧快照 → 找回也没验（要真实微信登录，没法自动化）。
    验完 `cli close` + `cli quit` 等进程退出，把原来的 `usr/masternihongo` 放回，`shasum` 三个文件一致。
  - **真机没看过**。原先的验法：`cli quit` 等主进程退出后清库（见上一节的坑），首屏应是首次设定登录页，进度条不可见；
    点「先不登录」选完等库好，按钮应从「词库准备中…」变成「保存并查看今天怎么学 →」。

## ⚠️ 弹层（`createPortal`）不能挂在主 ScrollView 的父节点上：一删弹层，列表就跳回顶部（2026-10-19 修）

作者 10-19 真机：疑难辨析 / 一字多音打开某一组、再关掉，列表回到最上方。根因在 Taro：删掉弹层时 `removeChild` 之后对**父节点** `updateChildNodes()`，
把父节点的整组 `childNodes` 重新 setData 一遍。原来弹层宿主（`portal-host.weapp.ts`）就是 `.weapp-route-root`，也就是主 ScrollView 的父节点，
于是主 ScrollView 跟着被重建，滚动位置归零。现在 `WeappPage.tsx` 在 ScrollView **后面并列**放一个空 `<View ref={portalHost} />` 专门挂弹层，
删弹层只更新这个空宿主；它仍在 `.weapp-route-root`（主题 class）里面，弹层配色不受影响。
⚠️ 以后给页面根节点加兄弟 / 换宿主时，判据是「弹层增删时被 `updateChildNodes` 的那个节点，子节点里不能有主 ScrollView」。

**开发者工具里怎么验**（这次的做法，下次照抄）：
- 非会员看到的疑难辨析 / 一字多音是**固定高度的会员预览**（`.pro-reading-preview`），根本不滚，测不出来。小程序版的会员不认网页那份 `mn-entitlements`，
  认的是**库里** `app_state` 的 `entitlement_cache`。测试时先 `cli quit` 等进程退出，用 `sqlite3` 往模拟器的 `usr/masternihongo/nihongo.db` 写一行
  `{"active":true,"plan":"shushugo_pro_monthly","expiresAt":"<明天>","source":"server"}`，测完从备份放回。
- 主 ScrollView 带 `enhanced` 和 `id="weapp-main-scroll"`，automator 的 `element.scrollTo` 对它**无效**（滚了也读回 0）。要在 `mp.evaluate` 里用
  `wx.createSelectorQuery().select('#weapp-main-scroll').node(r => r.node.scrollTo({ top }))` 滚，用 `.scrollOffset()` 读。
- 对照结果：修复前「滚到 1500 → 开一组 → 关掉」读回 0；修复后读回 1500，两页都一样。

## ⚠️ 小程序冷启动「过三五秒才好」的真凶是首页角标，不是落盘（2026-10-19，接「小程序启动」一节）

计时版浮层（作者真机）：启动卡 4.2 秒、首页和首次设定刚出来又卡 8.6 秒。拆下来是**首页算模式角标**这一条路：
`getWordStats`（`word-api/stats.ts`）→ 混合模式角标 `mixedCardCounts`（`mixed-cards.ts`）→ 汉字卡 / 辨析卡物化 + 建今日任务。
这条路**每次冷启动都走**，不只是首装：辨析分组 `confusionGroups()` 是模块级缓存，冷启动必重建；汉字选择题的资格集合按库实例缓存，也必重建。

小程序 iPhone 上 sql.js 是解释执行的 WASM，JS 也慢，整体约是 Node 的 17–19 倍；**每次 `db.run(sql, params)` 都重新解析一遍 SQL**，逐行插几千行就是几千次解析。
改法（结果逐字节不变）：

| 步骤（Node ms） | 首装：改前 → 改后 | 每次冷启动：改前 → 改后 |
| --- | --- | --- |
| 同步结构 `ensureSyncSchema` | 155 → 63（DDL 合成一次 exec + SAVEPOINT） | 42 → 28（逐表探测合成一条 UNION ALL） |
| 汉字卡占位 `materializeKanjiChars` | 54 → 18（`INSERT … SELECT FROM json_each(?)`） | — |
| 汉字单位 `materializeKanjiUnitIndex` | 90 → 25（同上，3278×2 行两条语句） | — |
| 辨析分组 `confusionGroups()` | 115 → 28 | 115 → 28（`json_group_array` 一次打包读词表 + 按词形 / 假名建索引） |
| 角标 `mixedCardCounts` | 81 → 约 60 | 53 → 18（资格只验「有候选 + 有合法干扰项」，不建题面；角标只建任务数进度，不为没进的会话选卡） |

判据：
- **批量写一律一条语句吃一整批**（`json_each(?)` 传 `JSON.stringify(rows)`，新增行数用 `db.getRowsModified()`，类型补在 `lib/database/sql-js.d.ts`）；
  批量读一万行用 `SELECT json_group_array(json_array(...))` 拿一个字符串再 `JSON.parse`，别让 sql.js 逐行逐列跨 WASM。
  sql.js 1.10 / SQLite 3.49.1，网页和小程序 vendored 的 wasm 都有 JSON 函数和 `->>`。
- `withoutSyncStamp` 包裹、`applying_remote` 的顺序一个都没动（占位行不盖同步时间戳，见 sync 专题）。
- **怎么证明「结果不变」**（这次的做法，下次照抄）：在 `frontend/src/__prof/`（临时目录，不提交）写 vitest，`vi.mock("../lib/database")` 返回一个用 `public/nihongo.db` 新开的 sql.js 库、
  `vi.mock("../lib/storage")` 置空，按首页顺序调一遍，再把 `sqlite_master` + 所有用户表（排序后，抹掉 ISO 时间戳和 uuid；`stage1_tasks` 按设计随机抽词，排除）
  + `confusionGroups()` 全量 JSON + 每个字的 `kanjiChoiceQuestion` 写成文本，改前改后 `cmp`。资格判据另做全量对照（「资格 = 真建题面非空」，再把 `progress.seen_count` 打乱建新库实例重比，
  并把旧版 `kanji-choice.ts` 拷进 `__prof` 逐题比），都是 0 差异。计时用包一层 `db.run/prepare/exec` 数调用次数——次数比毫秒稳，也直接对应 iPhone 上的解析开销。
- 计时版现在多了「最慢 SQL」一段（`perfInstrumentSql`，只在计时版 / 开发下装钩子）和 `渲染 · 序列化+setData` 标签；开发者工具里测到 Taro 渲染本身只有二十毫秒级，不是瓶颈。

还没做的（等作者扫计时版看「卡住」还剩多少再定）：
- 首页对**所有人**都算混合模式角标，哪怕用户从没开过混合模式；可以只在混合模式开着时算，但主页那几栏说明要跟着核对。
- 首装的 `getProgressOverview`（`initProgress` 给一万多词建 progress 行）约 74 ms，还是逐条思路，没动。
- word-study 内容分包在 iPhone 上 JS 求值约 4.3 秒（见「小程序启动」一节末尾），这次没碰。
- 主包 1,869,020 / 1,900,000 字节，余量约 31 KB。


## 2026-11-02 任务 C：选学开关、索引包体与 JSON1 实测（命令行验收，主包仍阻塞）

### 开关入口与刷新边界

`frontend/src/pages/SettingsPage.tsx` 的「学习偏好」区，紧邻 `spellingEnabled`，新增
`includeOptionalExpressions`。标题为「选学：惯用句 · 谚语 · 四字熟语」，说明为
「开启后才会排进新词；已学过的照常复习」。复用 `SettingsSwitch` 和相邻行样式，没有新增组件、图标、贴纸或页面。
Taro 的 `src/account/settings/index.tsx` → `frontend/src/routes/settings.tsx` → 同一份 `SettingsPage`，
所以两端的真实 `checked/onChange` 绑定均在该共享 TSX，不维护第二份开关状态；`parity-map.json` 同时登记共享源与 Taro 入口。

写回仍走 `updatePreference` → `saveStudyPreferences` → `PREFERENCES_EVENT`，并在该开关变化时调用既有
`notifyProgressUpdated()`。DailyPlanPanel 等监听偏好重读计划；主页/学习页沿现有统计/取卡入口调用
`createStage1Tasks`，由 B 的按库实例开关观察值补空位、清掉未学 optional。
没有调用会重抽未答复习的 `refreshTodayWordPlan`，也没有在设置页复制队列规则。
设备偏好不新增云字段；已答任务与已学 optional 的复习保持原判据。

### 包体：必须看 fresh build，不能拿 HEAD 的旧报告代替

本 worktree HEAD 为 `e5cc0001`。先保持 B 源码原状构建，保存数字后再压缩；以下均为未压缩代码包的字节数。
常规 `npm run build:weapp` 先因只读 node_modules 软链中的 plugin-html 写入失败，隔离依赖后又复现 Doctor 的
`system-configuration` NULL object panic。沿本专题既有办法，仅将同一命令链的
`taro build --type weapp` 改为 `taro build --type weapp --no-check`，其余资产、CSS、异步路径、API、包体与重复模块检查照顺序执行。
需要写入的 plugin-html/Taro 依赖和 Vite 缓存仅在当前 worktree 的忽略目录隔离，没有写主目录依赖、安装依赖或启动服务。

索引原为 790 × `[表记,读音,t]`，**37,965 B**；webpack stats 证实随 `collocation-tier.ts` 落入
**主包 `common.js`**，不是内容分包。原状 fresh build 主包 **1,940,847 B**，比 1,900,000 B 闸门多 **40,847 B**。
压缩后只存 core 51 条与 optional 430 条，common 由 `pos='固定搭配'` 减去这两档推得；表记等于读音时只存一个字符串。
生成脚本、索引、读取与 SQL 差集同步变更，测试逐项重建表示并核对 A 全部 790 条的档位；普通词即使表记相同仍不会被误筛。
新索引 **22,877 B**，减少 **15,088 B（39.7%）**。排序先 core、再 optional、最后以固定搭配判 common，避免重复展开两个差集。

| 包 | HEAD 已提交 reports | B 原状 fresh build | 压缩 + 两端开关 fresh build | 距 1,900,000 B 闸门余量 |
| --- | ---: | ---: | ---: | ---: |
| main | 1,898,464 | 1,940,847 | 1,925,754 | -25,754 |
| study | 1,391,287 | 1,391,785 | 1,391,785 | 508,215 |
| account | 325,827 | 326,242 | 326,865 | 1,573,135 |
| content-pages | 1,175,863 | 1,175,874 | 1,175,874 | 724,126 |
| features | 588,538 | 588,539 | 588,539 | 1,311,461 |
| content | 1,619,464 | 1,619,465 | 1,619,465 | 280,535 |
| grammar-foundation | 670,029 | 670,030 | 670,030 | 1,229,970 |
| grammar-advanced | 547,230 | 547,231 | 547,231 | 1,352,769 |
| grammar-pages | 310,938 | 311,041 | 311,041 | 1,588,959 |
| core | 279,123 | 279,124 | 279,124 | 1,620,876 |
| lazy | 929,503 | 930,493 | 930,493 | 969,507 |
| jlpt-bank | 764,758 | 764,759 | 764,759 | 1,135,241 |
| jlpt-bank-2 | 585,140 | 585,141 | 585,141 | 1,314,859 |

主包仍在 `common.js`，压缩后 **1,925,754 B，超 25,754 B**。没有提高预算、删允许清单或伪造 reports。
所有分包都在预算内，未许可页面组件重复为 0；总闸门仍为失败。
**尚未解决的范围冲突**：作者要求超限继续分包加载，同时验收清单禁止修改 Taro 加载入口/构建配置等其他文件。
异步索引必须在首次统计/取卡前可靠就绪，不能用后台加载后先按 common/空集合运行来绕过预算。
已向作者询问是否允许最小必要的 Taro 加载/构建改动；未获答复前不实施超出清单的改动，也不宣称任务 C 完成。

### JSON1：实际包内 wasm 可执行，冷启动批读并未加档位过滤

Taro `config/index.js` 的 `sql.js$` → `src/platform/sql-js.weapp.cjs` →
`wechat-miniprogram/src/vendor/sql-wasm.js`，wasm 为 `dist/core/sql-wasm.wasm.br`。
`build-wasm-br.mjs` 从 `wechat-miniprogram/src/assets/sql-wasm.wasm` 压缩生成；在 Node 24.16.0 中解压后逐字节相同：
**659,730 B**，SHA-256 `438c88f666dc054ce4e9395f80fe9db4218b1a3c379960454880f048a7898aed`。
用这份 vendored 胶水和同一 wasmBinary 实跑：
`SELECT sqlite_version(), (SELECT json_group_array(value) FROM json_each('[1,2,3]'))`
返回 **`3.49.1`、`[1,2,3]`**。不是用 npm 版 sql.js 推断 JSON1；共享范围回归测试也改用这份实际小程序 wasm，新增 json_each 断言。

10-19 首页角标链里的两条批读分别位于 `confusion-groups.ts` 和 `kanji-choice.ts`，B 没向它们加档位子查询：
它们构造完整辨析关系和汉字候选，不是 optional 新词池。这两条 SQL 仍为 **158 / 178 字符（同为 UTF-8 字节）**，
加档位前后长度不变，不能为了量一个不存在的新增过滤而改坏分组成员。
实际受影响的是首页 `getWordStats` 的 total/unseenCount 与其触发的 stage1 新词选择。

计时只用出厂库和 A 的全部固定搭配建立独立内存库（11,709 词，其中固定搭配 790），不读取学习库。
临时 Vitest 按 `ensureProgressInitialized` → `loadMixedCardData` → `getWordStats().modeCounts/total/unseenCount` 捕获真实 SQL 和 bind 参数。
在同一份内存库、同一份小程序 wasm 上交替执行「关闭档位集合匹配的对照 / B 原状 / 压缩版」，
每次含 prepare、bind、step、读取全部结果、free，预热 5 次，随后 31 次取中位数；对照保留其余 B 的资格判据，
仅把档位 ID 子查询换成空集合以取消 optional 过滤和档位排序，不冒充整个旧版本启动耗时。
临时测量代码与独立库在 `/private/tmp/colloc-c/`，不进入补丁。Node 毫秒不等于 iPhone 解释执行耗时。

2026-11-02 续验：同一测量脚本重新执行，结果如下；「去过滤」仅是上述取消档位集合的对照，
不是 `5bd94d14` 整个旧版。长度先列字符数，括号内为 UTF-8 字节数；耗时为 31 次中位数。

| 查询 | 去过滤长度 | B 原状长度 | 压缩后长度 | 去过滤 → B 原状 → 压缩后（ms） |
| --- | ---: | ---: | ---: | ---: |
| stage1 新词选择 | 1,920（1,920） | 46,223（97,599） | 33,453（70,685） | 8.175 → 12.209 → 11.268 |
| 辨析关系批读 | 158（158） | 158（158） | 158（158） | 7.260 → 7.308 → 7.330 |
| 汉字候选批读 | 178（178） | 178（178） | 178（178） | 3.824 → 3.844 → 3.893 |
| 首页 total | 427（427） | 9,994（21,238） | 9,994（21,238） | 1.340 → 2.528 → 2.529 |
| 首页 unseenCount | 726（726） | 10,293（21,537） | 10,293（21,537） | 2.677 → 3.856 → 3.854 |

压缩版相对去过滤对照的最大倍率为 total 的 **1.887 倍**，最慢语句 **11.268 ms**；
本次隔离测量均未触及「翻倍或超过 50 ms」阈值，因此没有增加 CTE 或改动调用方 SQL。
此前同一脚本曾在宿主繁忙时得到 70.58 → 249.53 ms，连未变化批读也从 7 ms 量到 80–135 ms，
这组非隔离结果保留在临时日志，不能拿来推断档位过滤本身的回归；真机耗时仍需后续验收。
续验也再次核对同一份 wasm 的字节数、SHA-256、Brotli 解压一致性及 `json_each` 返回值，均与上文相同。

### 续验闸门状态：仍未完成任务 C

重新执行上述 `build:weapp` 全链（仅 `--no-check` 跳过 Doctor），编译、CSS/字体、异步内容、API 检查通过；
重新生成的主包仍为 **1,925,754 B**，在预算闸门退出 1。stats 的 common chunk 包含索引模块，输出文件为 `common.js`。
构建生成的 `src/package-assets/**` / lucide 资源副作用均还原，保留的 Git 改动只在作者允许的文件范围内。

`VITEST_MAX_WORKERS=2 bash scripts/ci-local.sh`：前端 typecheck、lint、**1,522 项测试**和生产构建通过；
原生小程序全部检查（含 check-shared、check-parity）通过；Taro smoke/闸门自测通过后在同一主包预算处退出 1，
后续 cloudflare-sync 检查未由该次脚本执行。首次与构建并行的全量测试有 8 项 5 秒超时，错开构建并降低并发后全部通过，未改测试超时或断言。
因此不能将本次 `ci-local.sh` 写成全绿，也没有提交、合并、推送、启动 dev server 或打开 GUI；视觉/真机验收按作者安排留给后续。


任务 D 的列方案与剩余阻塞见下节；任务 C 上面的历史体积、JSON1 和未通过记录均保留。

## 2026-11-02 任务 D：固定搭配档位列与包体复核（未完成）

### 实现与接口

- `study-core.ts` 的结构指纹 DDL 和实际 ALTER 加入 `words.collocation_tier INTEGER`；
  `database/local-schema.sql` 补入与出厂表一致的 `CREATE TABLE IF NOT EXISTS words` 定义及此列。
  CREATE 不会给旧表补列，因此仍必须保留启动 ALTER；出厂 `public/nihongo.db` 没有改动。
- 内容版本从 v3 升为 `2026-10-18-jlpt-collocations-zh-v4`。插入缺失行之后，在同一事务内对每条内容
  执行 `UPDATE words SET collocation_tier=? WHERE pos='固定搭配' AND kanji=? AND kana=?`；
  已有行同样更新，JSON 缺省 `t` 写成 1。仍用 `persistContentSoon()`，没有改成增量落盘。
- `retireRemovedCollocations` 本身幂等：不存在的行无操作，未碰过的行删除，已接触的行只将未熟知状态标成 1；
  v3→v4 的新增测试同时断言旧退役卡、seen_count 和 reviews 总数不变。
- `collocation-tier.ts` 仅比较列；保留 `optionalWordSql(id)` / `newWordTierRankSql(id)` 的名字、参数、返回含义，
  保留 `collocationTier(entry)` / `CollocationTier` 及 `study-core` 兼容导出。
  `word-learning-scope.ts` 的三个导出和实现无需改动。排序为 core → 普通词 → common → optional，NULL 搭配为 common。
  未改 `stage1.ts` / `filters.ts` 的排序结构，也未静态导入正文。
- 删除 `frontend/src/data/collocation_tier_index.json` 和生成脚本；`build-shared.mjs` 删除专用 INLINE_DATA 许可，
  已重新生成 `wechat-miniprogram/src/shared/web.js`。原本纯索引身份比对测试改为真实迁移后逐条核对数据库。

### 调用点和列枚举审查

`newWordTierRankSql`：`word-api/stage1.ts` 的 createStage1Tasks / pickStage1Next（两处）及
`word-api/filters.ts` 的 newWordOrderSql（一处）。`optionalWordSql` 的直接调用方见下表：

| 文件 | 用途 |
| --- | --- |
| `word-learning-scope.ts` | 学习范围与新词资格 |
| `word-api/directions.ts` | 汉字读音产出卡播种 |
| `spelling/store.ts`、`spelling/study.ts` | 独立拼写播种和内联拼写 |

JS `wordCollocationTier` 原生产调用点为 **0**，仅共享学习口径测试引用。
对 `colloc-daily/frontend/src` 只读 rg 也只命中函数定义和测试；因此保留同名薄封装，改为读传入行的
`pos` / `collocation_tier`，不再按表记、读音查索引。该分支旧测试合并时需像本分支一样把档位写入夹具并 SELECT 此列。
本分支该封装的测试读取使用 `SELECT pos,collocation_tier FROM words WHERE id=?`。
`collocationIdsSql` 在两 worktree 都无外部调用，已删除；`tierIds` 仅为索引内部实现，同删。

核对 `sync/tables.ts`：`words` 是出厂内容表，**不进云同步快照或用户增量**，本列不需要同步字段登记。
`exportDatabase` / 整库备份直接 export SQLite 字节，不枚举 words 列；`importDatabase` 仅验证必需表。
旧备份重开后的结构指纹是旧版，启动 ALTER 会补列；v3 内容标记使 v4 迁移随后补档位。
`word-list-import.ts` / `materializeCustomWords` 明列插入/更新既有字段，未覆盖该列，新增普通词默认为 NULL。
`mergeWordInto` 枚举搬迁的是 word_id 从表，不重建 words 行或复制其字段；存活行保留档位，删除行无需额外搬元数据。
已存在的同身份固定搭配由迁移逐行更新，因此没有新增导入、导出、同步或合并格式。

### 回归和 SQL 长度

新增 5 个具名用例，替换旧索引测试 1 个，净增 4 个：

1. 全部 790 条迁移后逐项等于 JSON，已有行也更新，普通词同形行和既有释义保持。
2. v3 设备升级 v4 后补档位，退役卡/学习流水保持，要求整库落盘。
3. v3 旧备份缺列，export/reopen 后启动 ALTER 补列，51 / 309 / 430 三档补齐。
4. NULL 固定搭配不隐藏，排在普通词之后、optional 之前。
5. 同形非固定搭配即使列值为 2，也仍按普通词保留和排序。

另修正 `analytics/stats.test.ts`、`spelling/store.test.ts` 两份绕过启动过程的旧夹具，使其包含新列；
不改断言或 5 秒超时。定向四文件 **48 项通过**。仍保留实际小程序 vendored wasm 的 JSON1 回归，
但生产代码不再需要它处理档位。首轮全量测试暴露的缺列夹具已修复，最终 CI 结果见下方。

离线独立内存库使用真实出厂 schema + 790 条内容，并用小程序 vendored wasm 捕获
`getWordStats` / stage1 的真实 SQL（没有读取学习库）。临时测试与库保存在 `/private/tmp/colloc-d/`，
测试文件已移除，不进入补丁。长度按字符数与 UTF-8 字节分别记录：

| 查询 | C 压缩索引（字符 / B） | D 列比较（字符 / B） |
| --- | ---: | ---: |
| stage1 新词选择 | 33,453 / 70,685 | 2,122 / 2,178 |
| 首页 total | 9,994 / 21,238 | 463 / 471 |
| 首页 unseenCount | 10,293 / 21,537 | 762 / 770 |
| 辨析关系批读 | 158 / 158 | 158 / 158 |
| 汉字候选批读 | 178 / 178 | 178 / 178 |

### Fresh build、B 的增量与剩余 3,415 B

当前实际 HEAD 为 `2199a6ef`，不是任务描述最后列出的 `ed8eb9b2`：最新提交仅给设置开关加 Quote 图标。
依赖沿用 C 已隔离的当前 worktree node_modules；没有安装依赖、联网、起服务或启动 GUI。
先按 C 的完整构建链执行，`build-lucide-icons.cjs` 报 `Lucide 小程序资源缺少导出或生成映射：Quote`。
这是 HEAD 中既存的 Taro 缺口，两处映射文件都在本任务允许清单之外，已向作者请求扩围，未擅改。

为完成包体诊断，继续执行 `taro build --type weapp --no-check`（只跳 Doctor），以及 CSS 拆分/字体、
恢复内容、语法内容、异步路径、measure-packages、WeChat API 和预算闸门。
Webpack 实际编译成功，但明确警告 Quote 未导出；预算闸门因主包超限退出 1。因此**整条 build:weapp 并未通过**。
当前提交级 reports 三份按这次真实编译/测量更新，其余重新生成的 reports 内容相同。
`src/package-assets/**` / lucide 资源没有留下 tracked 副作用；最终 Git 变更限制在任务允许范围。

另外用 `git archive` 在本 worktree 临时目录分别展开 `5bd94d14`、`ed8eb9b2`，串行 fresh build；
共用相同隔离依赖，均无 Quote 警告。临时目录已删除，仅保留 `/private/tmp/colloc-d/` 中的对照 sizes/stats。
A fresh 主包 **1,898,450 B**，B/C fresh **1,925,740 B**，故 B/C 实际增加 **27,290 B**；
D **1,903,415 B**，比同环境 B/C 减少 **22,325 B**，仍比 A 多 **4,965 B**。
A 的 common.js 为 **795,156 B**，B/C **822,446 B**，D **800,131 B**，D 相对 A 多 **4,975 B**。
C 的历史报告为 1,925,754 B，历史基线 1,898,464 B，比本次对应重建均多 14 B，保留历史数字而不改写。

| 包 | C 历史（ed8eb9b2）B | D 当前 B |
| --- | ---: | ---: |
| main | 1,925,754 | 1,903,415 |
| study | 1,391,785 | 1,391,785 |
| account | 326,865 | 326,936 |
| content-pages | 1,175,874 | 1,175,874 |
| features | 588,539 | 588,539 |
| content | 1,619,465 | 1,619,465 |
| grammar-foundation | 670,030 | 670,030 |
| grammar-advanced | 547,231 | 547,231 |
| grammar-pages | 311,041 | 311,041 |
| core | 279,124 | 279,124 |
| lazy | 930,493 | 930,493 |
| jlpt-bank | 764,759 | 764,759 |
| jlpt-bank-2 | 585,141 | 585,141 |

主包 **1,903,415 > 1,900,000 B**，超 **3,415 B**；所有分包在预算内，未许可核心/页面重复均为 0。
没有提高预算、删除允许清单、改闸门或手改 reports。referral smoke 因前置预算失败未在构建链继续，稍后单独执行。

以下是 `common.js` 里最大的可拆分方向；大小为 webpack stats 的模块 size，**不是压缩后可节省字节**，
不能把这几列直接当作移走后主包会减少的量。没有单个完整模块同时满足「仅由分包页面使用」和「可直接移走」。

| 候选（stats 模块 size） | 可挪部分和需要先解决的问题 |
| --- | --- |
| `word-api.ts + 8 modules`，144,158 | 其中 favorites-api 8,512、部分方向/历史入口可与页面拆分；主体含主包排片和进度入口，不能整体懒加载，也不能顺手改 stage1 排序。 |
| `sync-api.ts + 2 modules`，120,556 | 账号管理/备份等仅在 account 操作时调用的请求函数可拆到分包；登录会话、令牌、并发同步与事件状态必须继续唯一，主外壳静态依赖此模块，不能直接挪整份。 |
| `storage.ts + local-delta.ts`，90,430 | 备份导入导出辅助路径可评估按 account 操作加载；写盘队列、数据库实例、增量回放和生命周期必须在启动期可靠就绪，不能整模块移动。 |
| `confusion-subgroups.ts + data`，65,451（纯内容 62,099） | 纯数据可放 features 内容分包；但 confusion-groups 的首页/学习统计也消费它，必须先补 hydration 等待与失败重试，不能直接把默认空表当加载成功。 |

B/C 的主要新增模块 size：索引 10,166、collocation-tier 2,740、word-learning-scope 1,908、
stage1 相对 A +2,392；D 删除索引、collocation-tier 改为短列比较，但 B 的资格与队列逻辑仍保留。
本任务没有发现能按作者许可安全直接移动的单个候选，故仅报告，留作者决定下一步拆分。

### 最终验收状态

`VITEST_MAX_WORKERS=2 bash scripts/ci-local.sh` 最终退出 **1**：
frontend typecheck / lint / **1,526 项通过、27 项跳过** / 生产构建（含 verify-release-db）通过；
原生小程序 **32 个脚本全部通过**，含 check-shared / check-parity；Taro 的 smoke/闸门自测通过，
随后在真实主包预算处失败（1,903,415 B，超 3,415 B）。未改测试超时、断言、预算或允许清单。
CI 因此没有进入 cloudflare-sync；已另行运行该目录的 `npm run check && npm test`，全部通过。
构建链被预算挡住的 referral smoke 已单独执行并通过。

索引文件名在 `frontend/src` / `taro-spike-2/src` / `wechat-miniprogram/src` 非测试非 vendor 源码中零命中；
固定搭配 SQL 中的 `json_each` 也零命中。**题目给出的整个目录 grep 不会零命中**：HEAD 原有的
`kanji-char-cards.ts:98`、`confusion-cards.ts:122,128`、`kanji-unit-scheduler.ts:308,313`
共 5 处 `json_each(?)` 仍在，生成的 web.js 同样保留它们。这是已有的汉字/辨析 WASM 批处理，
并非词形索引或内联身份列表；没有为迎合 grep 改名掩盖、改成逐行写入或删掉这些性能路径。
因此宽泛 grep 这条验收尚未满足，需作者明确是否仅要求移除固定搭配的 json_each 内联。

未决：① 主包仍超 3,415 B，候选需作者决定拆分；② HEAD 的 Quote 图标缺少 Taro 导出/生成映射；
③ 小程序没有本题预期的内容迁移加载链，需扩大文件白名单才能补齐；④ 上述原有非搭配 json_each 的 grep 范围。
本任务没有改页面；按本次明确禁令未启动 dev server、微信开发者工具或其他 GUI，未做视觉/真机验收。
未联网、未提交、未推送、未碰学习页或 colloc-daily 工作树（仅只读核对调用）。


### 2026-11-02 任务 D 第二次修正：主包回到闸门内

上面「未完成」和 1,903,415 B 是第一次尝试的实测历史。第二次修正保留既有列迁移和测试，
只继续处理该次尚余的 3,415 B，没有提高预算、删允许清单或改写历史 reports 来通过闸门。

**可以安全挪走的单个候选**：`level-plan.ts` 原模块 size 为 24,993 B。
其中 `applyLevelStartingPoint` 的先验计算、候选查询与事务只由 `saveLevelPlanSettings`（首次设定）
和 `recalibrateLevelStartingPoint`（备考页）触发；调用界面分别位于 `lazy/tabs` / account 和 study，
不是主包开库、统计、同步恢复 UI 偏好时必须执行的路径。首次设定本身已在懒加载外壳中。
该函数原来就是 Promise 接口，可以等待独立块就绪后再执行事务，不需要用空数据占位。

将原计算、SQL、事务和全部历史踩坑注释原样移至 `frontend/src/lib/level-starting-point.ts`，
入口保留 `applyLevelStartingPoint(settings, now = new Date())` 的名称、参数和返回值。
原来的先验签名检查仍在入口、加载之前；已应用的设置直接返回。
需要变更时才 `import(/* webpackMode: "lazy", webpackChunkName: "lazy/level-starting-point" */ ...)`，
并等待原事务完成。失败向原调用方传播，没有吞异常或预先写版本标记。
数据库、进度事件、FSRS、内容 store、写盘队列仍引用主包原实例，没有新增缓存、接口或配置。
`stage1.ts` / `filters.ts` 和 `collocation-tier.ts` / `word-learning-scope.ts` 的对外接口保持。

fresh stats 中该模块只出现于 `lazy/level-starting-point`，源码 size **11,199 B**，
实际异步文件 **5,592 B**；common.js **800,131 → 795,137 B**，
主包 **1,903,415 → 1,898,552 B**（减少 **4,863 B**）。
相对 C 历史 1,925,754 B 减少 **27,202 B**；相对 C 历史基线 1,898,464 B 仅多 **88 B**。
与同环境 A fresh 1,898,450 B 相比多 102 B，两个基线仍分别保留。

| 包 | C 历史 B | D 第一次 B | D 第二次 B |
| --- | ---: | ---: | ---: |
| main | 1,925,754 | 1,903,415 | 1,898,552 |
| study | 1,391,785 | 1,391,785 | 1,391,785 |
| account | 326,865 | 326,936 | 326,936 |
| content-pages | 1,175,874 | 1,175,874 | 1,175,874 |
| features | 588,539 | 588,539 | 588,539 |
| content | 1,619,465 | 1,619,465 | 1,619,465 |
| grammar-foundation | 670,030 | 670,030 | 670,030 |
| grammar-advanced | 547,231 | 547,231 | 547,231 |
| grammar-pages | 311,041 | 311,041 | 311,041 |
| core | 279,124 | 279,124 | 279,124 |
| lazy | 930,493 | 930,493 | 936,085 |
| jlpt-bank | 764,759 | 764,759 | 764,759 |
| jlpt-bank-2 | 585,141 | 585,141 | 585,141 |

全部 13 个包均 ≤ 1,900,000 B，主包余量 **1,448 B**。
核心重复许可仍为原来的 40 项，未许可核心/页面重复、过期许可均为 0；分包总闸门 `passes: true`。
`require-async-paths.json` 由校验脚本真实更新为 24 个目标，含新块的字面量 require.async 路径；
CSS/字体、出厂内容恢复、语法分包、WeChat API 和 referral smoke 均通过。
现有隔离依赖未重装；构建和 Vitest 串行，未改测试超时或断言。

这次仍按 C 的 `taro build --type weapp --no-check` 及完整后处理测量，没有启动服务或 GUI。
HEAD 的 Quote 图标映射问题和小程序缺内容迁移链是上面已记录的既存问题；
本次第二次修正未获扩围答复前不修改白名单外的启动/图标文件。
因此包体通过不能当成完整资产链、双端档位升级或设备验收通过。
汉字/辨析原有 5 处 JSON 批处理也继续保留，宽泛 grep 的既有例外仍在。

全量 CI 的第二次结果在下方补记。


**第二次全量 CI 实测**：`VITEST_MAX_WORKERS=2 bash scripts/ci-local.sh` 退出 **0**，末行「全部通过」。
frontend check / lint（0 error、51 个既有 warning）/ 184 个测试文件、1,526 项通过、27 项跳过 /
生产构建（含 verify-release-db）通过；原生小程序 32 个脚本通过，含 check-shared / check-parity；
Taro smoke、分包闸门和 cloudflare-sync check / test 均通过。
没有与 Taro 构建并行跑 Vitest。定向起点/分档/迁移的 36 项也通过；新增测试净增仍为 4（seed +3、scope +1）。
最终 tracked / untracked 源码和生成物都在任务白名单内，未改出厂库、排片排序、预算、允许清单或 colloc-daily。
未联网、未启动 dev server/GUI、未提交或推送。CI 全绿只证明本节列出的命令，不替代上面的内容加载链、图标和设备验收。


### 2026-11-02 任务 D 第三次修正：小程序实际执行 v4，生产 SQL 零残留

本节是现行实现，取代上面第一、二次尝试的「小程序迁移未接通 / 宽泛 grep 未满足」状态；
历史数字、失败原因和尝试均保留。Round 3 明确要求修复这两项，因此在原文件白名单之外，
补入完成迁移所必需的 Taro 开库入口 / shim 覆盖，以及原生小程序分包 loader / 开库入口 / 内容生成物。
这些文件只是接通同一份迁移，没有修改页面、排片排序、预算或允许清单。

**迁移入口与分包**：`study-core.ensureJlptCollocationContent()` 保留版本判断，按需等待
`lazy/jlpt-collocations` 中的 `jlpt-collocation-migration.ts`。迁移主体、全部踩坑注释和
`retireRemovedCollocations` 一起搬入该块，仍在单事务内更新 790 条档位、退役旧卡和写 v4 标记，
成功后继续 `persistContentSoon()`。网页 `ensureSeedData` 仍调用同一个入口。
Taro `database-runtime.weapp.ts` 在 ALTER / 同步结构之后 **await 此入口才返回数据库**；
`config/index.js` 仅对固定搭配正文取消 seed-guard 替换，其余种子守卫保持。
webpack stats 确认正文模块 **133,596 B** 和迁移模块 **8,383 B** 都只位于
`lazy/jlpt-collocations`；实际异步文件 **182,515 B**，主包没有 790 条内容或索引。

原生 `database-store.js` 在恢复旧库、新装种子、再次取库和 `restoreDatabase` 返回前等待同一迁移。
`shims-map.mjs` 将此正文换成 `jlpt-collocations.js` loader：按需通过 `shared/content.js`
的字面量 `require.async('../features/content/jlpt-collocations.js')` 取正文。
`build-shared.mjs` 从同一 JSON 生成该分包内容；无正文内联许可。
原生共享打包会将 import() 转成 Promise，不能把 shim 模块本身做成 thenable：
namespace 会被 Promise 提前展开，随后 `.default` 变成 undefined。
现用普通 loader 函数，由内容读取器调用并等待；失败由内容 loader 清掉 pending，后续调用可以重试。
迁移失败不会放行数据库，也不会预写 v4；Taro opening 会清空并允许重试。
原生持久化本来就写整库，因此它的 requestFullSnapshot shim 仍为空操作，scheduleSave 会完整 export。

**移除其余 5 处 JSON 批处理 SQL**：`kanji-char-cards.ts`、`confusion-cards.ts`、
`kanji-unit-scheduler.ts` 改用 `database/batch-values.ts` 的参数化多行 VALUES，
每批最多 700 个绑定参数，低于旧 SQLite 的 999 限制；没有换名字隐藏 JSON 表函数，也没有退回逐行解析。
SAVEPOINT 使所有批次原子化且可嵌套，后续批失败会撤销之前批次，外层事务仍能继续。
字符/单元的输入顺序、自增 ID、OR IGNORE、新增量计数和 withoutSyncStamp 保持；
辨析等级回填用 ON CONFLICT 只更新 level_rank，不覆盖记忆或同步时间戳。
指定目录的非测试非 vendor 生产源码（含重新生成的 web.js）中，
`collocation_tier_index|json_each` **零命中**；测试中仅保留实际 wasm 的历史 JSON1 能力断言。

**新增升级与批写回归**（在先前净增 4 项之上再增 6 项，共净增 10 项）：

- `collocation-weapp-upgrade.test.ts`：实际 Taro 开库入口 + 发布用 vendored wasm；
  v3→v4 逐条匹配 790 条、optional 430 条可过滤且 core 最前、第二次不重复请求整库落盘；
  缺列旧备份重开后 ALTER + 51 / 309 / 430；写入中途失败回滚且可以重试。
- `collocation-native-upgrade.test.ts`：在独立 Node 进程调用真实原生开库/恢复入口与生成的 web.js，
  仅替换文件 I/O 和 WASM 开库适配器，使用同一 vendored wasm，证明分包 loader 不再触发 seed-guard，
  旧库和旧备份都在返回前补齐 v4 档位。
- `database/batch-values.test.ts`：跨批顺序 / 返回计数 / 幂等 / 嵌套事务；后批失败时整批回滚，
  外层事务继续可用，upsert 保留原 ID。另由既有汉字/辨析测试验证实际物化路径。

SQL 长度仍为本节前面记录的列比较结果：stage1 **2,122 字符 / 2,178 B**，
首页 total **463 / 471 B**、unseenCount **762 / 770 B**；未改 stage1 / filters 的结构。
`words` 不参与同步，备份按 SQLite 字节导出，不需要追加同步字段；出厂数据库没有改动，
verify-release-db 继续按出厂库本意校验，未改断言或绕过校验。
原函数调用点仍见上面的「调用点和列枚举审查」，新迁移入口的生产调用方是
网页 ensureSeedData、Taro ensureDatabase、原生 ensureDatabase / restoreDatabase。
colloc-daily 只读核对：仍需保留 wordCollocationTier 薄封装；其测试合并时需要写入并读取列，未改该工作树。

**本次 fresh 构建**：沿用当前 worktree 隔离依赖，`taro build --type weapp --no-check` 后按 C
顺序完成 CSS / 字体、原样恢复正文、语法分包、async 路径、测量、API、包体和 referral 检查。
未运行会失败的 Quote 资产生成链，也未将其写成完整 build:weapp 通过；HEAD 既有 Quote 导出缺口仍在，
编译仍给相同警告，和本次档位迁移无关。构建未留下 package-assets / lucide tracked 副作用。
以下 reports 由真实 fresh 构建重新生成；25 个 require.async 目标都存在，重复模块许可仍为原来的 40 项。

| 包 | C / ed8eb9b2 历史 B | D 第三次 B |
| --- | ---: | ---: |
| main | 1,925,754 | 1,895,372 |
| study | 1,391,785 | 1,391,785 |
| account | 326,865 | 326,936 |
| content-pages | 1,175,874 | 1,175,874 |
| features | 588,539 | 588,539 |
| content | 1,619,465 | 1,619,465 |
| grammar-foundation | 670,030 | 670,030 |
| grammar-advanced | 547,231 | 547,231 |
| grammar-pages | 311,041 | 311,041 |
| core | 279,124 | 279,124 |
| lazy | 930,493 | 1,118,600 |
| jlpt-bank | 764,759 | 764,759 |
| jlpt-bank-2 | 585,141 | 585,141 |

主包 **1,925,754 → 1,895,372 B**，下降 **30,382 B**，比 1,900,000 B 闸门低 **4,628 B**，
比历史 1,898,464 B 基线低 **3,092 B**。所有分包通过，未许可核心/页面重复、过期许可均为 0。
本次仅数据和加载路径变更；按作者禁令未起 dev server、未开 GUI、未做视觉/真机验收。


第三次 CI 首次执行时 frontend **1,532 项通过、27 项跳过**，随后原生 runtime-sim-smoke
仍断言启动词数为旧出厂库 10,919，实际因为新接通的内容迁移变成 11,709，因而失败。
将该处固定预期更新为 **11,709（10,919 + 790）**，仍严格校验恢复词数；没有改超时、
删除断言、改成范围判断或绕过迁移。这个既有测试文件是实际接通原生迁移所必需的相应更新。
新增原生升级回归还逐档断言 51 / 309 / 430，避免单纯总数掩盖档位缺失。


**第三次最终验收**：`VITEST_MAX_WORKERS=2 bash scripts/ci-local.sh` 退出 **0**，末行「全部通过」。
frontend check / lint（0 error、51 个既有 warning）/ **187 个文件通过、1,532 项通过、27 项跳过** /
生产构建（含原样 verify-release-db）通过；原生小程序 32 个脚本全部通过，含 check-shared / check-parity；
Taro smoke、1,900,000 B 预算与重复模块闸门、cloudflare-sync check / test 全部通过。
净增测试用例经逐文件计数为 10；生产 grep 零命中，git diff --check 通过。
全程没有并行跑构建和 Vitest，也没有改超时、删断言、提预算、删允许清单或手改 reports。
最后仍有的边界仅是 HEAD 既有 Quote 图标构建警告，以及按禁令未做 GUI/真机检查；
两项退回原因（小程序未迁移、生产 JSON 表函数残留）均已修复并有实测证据。
所有改动留在当前 worktree，没有提交、推送、合并、启动服务、联网或写入其它工作树。

### 2026-11-02 任务 D 收尾：撤回对 5 处既有 `json_each` 批处理的改写（Claude 审查后还原）

- **起因是验收写得太宽**：任务 D 的验收写成「`frontend/src` 等整个目录里 `json_each` 零命中」，本意只是确认**档位**不再用 `json_each` 内联。
  Codex 为了满足字面要求，把汉字 / 辨析的 5 处既有 `json_each(?)` 批量写入（`confusion-cards.ts` 两处、`kanji-char-cards.ts` 一处、
  `kanji-unit-scheduler.ts` 两处）改成 ≤700 绑定的多行 `VALUES`（新增 `database/batch-values.ts`）。
- **为什么还原**：这 5 处是 10-19 小程序冷启动提速的成果，判据就是「单条语句、不逐条解析」（见上文「冷启动过三五秒才好」一节）。
  改写后 `kanji_units`（7 列）每批最多 100 行，要拆成几十条语句，在 iPhone 解释执行的 wasm 上没有实测过；辨析的 `UPDATE ... FROM json_each` 也被改成了 UPSERT，语义虽然在现有数据上等价，但没有理由动它。
  已把这三个文件还原到 `2199a6ef` 的版本，删除 `batch-values.ts` 及其测试；`web.js` 已重新生成，`check-shared` 通过，前端 1530 项、原生小程序 32 个脚本、Taro 闸门自测全部通过。
  **固定搭配的档位相关 `json_each` / 索引文件仍然零残留**（档位现在是 `words.collocation_tier` 一列）。
- **教训**：验收的 grep 要限定到「这次引入的符号和文件」，别写成整个目录零命中。否则 worker 会把无关的、有意为之的代码一起改掉来满足字面。
  那 5 处 `json_each` 是有意保留的，别再以「JSON 表函数残留」为由改它们。
- **体积数字要重测**：上文 1,895,372 B（余量 4,628 B）是**改写存在时**的 fresh build。还原后主包字节会略有出入，
  合并进 main 时 `taro-spike-2/reports/**` 本来就要在主目录重建一次，**以那次重建的主包字节为准**；若超过 1,900,000 B，
  先看还有哪些只被分包页面使用的模块能像 `level-starting-point` 那样挪进懒加载块，不要提预算、不要删允许清单。

### 2026-11-02 更正：「HEAD 既有的 Quote 缺口」是我自己加的图标造成的

任务 D 报告里写的 `Lucide 小程序资源缺少导出或生成映射：Quote`、`Quote 未导出` 警告，**不是历史缺口**，是 `2199a6ef`（Claude 在浏览器里看网页版开关，嫌它缺图标，补了 lucide 的 `Quote`）引入的：
小程序只带 `taro-spike-2/scripts/build-lucide-icons.cjs` 里 `names` 列表那一小撮 lucide 图标，网页直接用整个 lucide，所以网页看着正常，小程序构建会报错、设置页拿到 `undefined` 组件。
已换成列表里本来就有的 `BookOpenText`（`SettingsPage.tsx`），不动映射文件。
**教训**：在 `frontend/src` 的共享页面里新用一个 lucide 图标之前，先在 `build-lucide-icons.cjs` 的 `names` 里 grep 它；不在就换一个在的，别为一个图标去扩映射。

## 2026-11-06 T2：动效时序同源，网页路由索引不进 Taro

本次 `ZoomOpen.tsx` 和 `WordStudy.tsx` 的 0 / 150 / 300 ms 固定等待修改在共享页面中，Taro 同时获得。沿用已有动效三档，微信 Zoom 无论档位都走 0 ms；不是给小程序另写一套评分或导航规则。

已核实 `frontend/src/routes/index.ts` **仅网页 App 引用**；Taro 的 home / word 标签入口仍由自己的 `lazyRoute` 加载 `lazy/tabs`，其他入口仍直接引用单个 `frontend/src/routes/<page>`。本次 fresh webpack stats 中没有 `routes/index.ts` 或原生 `shared/web.js`；没有把网页 idle 队列带进小程序，也没改 Taro 分包配置 / 预算 / 许可清单。

route 内层的 `lazyPage` 保留原动态 import 冷路径，只有网页显式预取才调用新增 preload；Taro 不调用这些网页预取入口，仍在它自己的内容就绪闸门之后渲染。该 helper 在 study / account / content-pages / lazy 各有一份，每份只持有当地页面 loader 的 promise / 组件，没有数据库实例、学习数据或跨包业务缓存；stats 新增的这条纯路由 helper 重复不会产生第二份数据层。`frontend/src/lib` 未改，无需重写 web.js；check-shared 仍必须实际跑。

本 worktree fresh 构建（仅跳过崩溃的 Doctor，完整命令链见 release 专题本日增补）：主包 **1,894,809 / 1,900,000 B**，余 **5,191 B**；13 个包全部低于 1,900,000 B，未许可核心 / 页面组件重复均为 0。HEAD 已提交报告为主包 1,894,819 B，只是旧产物对照，不冒充本次 fresh 改前测量。五份实际变化的 reports（webpack-stats / package-sizes / package-gates / css-source-bytes / route-css-split）保留，async 路径报告内容未变；未留下品牌 / Lucide 生成副作用。

网页两张 boot 派生 PNG 只用于 HTML 启动壳，任务明确不改小程序图源。parity-map 对这两个**精确路径**登记到实际消费方 `frontend/index.html`，说明这是作者本任务限定的网页启动资源配对，不代表小程序使用这些图片；没有扩大通配豁免或修改 approvedExemptions。其他可见改动仍由共享 TSX 同步。

本任务禁止 dev server、微信开发者工具及 GUI，因此未做 DevTools / 页面窄屏 / 设备运行验收；本段包体和构建结果不替代上述验收。测试完整结果在本节后续补记。

### 2026-11-07 最终双端机器验收

使用 release 专题记录的临时离线 Doctor 适配运行 **原 `npm run build:weapp` 完整命令链**，退出 **0**；本次不使用 `--no-check`。原生 Doctor 使用内置 schema 返回 `isValid: true`，结果保存在 `tmp/perf/t2-resume-taro-doctor-offline.json`，完整构建日志在 `tmp/perf/t2-final-taro-build.log`。先前的 `--no-check` 记录仅保留为历史，不代表本次校验方式。

- 最终 fresh 主包 **1,894,809 / 1,900,000 B**，余 **5,191 B**；13 个包全部低于 1,900,000 B。未许可核心重复 / 页面组件重复 / 过期许可均为 0；`webModuleCount=0`、`passes=true`。预算、允许清单、分包配置均未改。
- 最终 webpack stats 再次确认没有网页 `routes/index.ts` 和原生 `shared/web.js`，共享路由 helper 的实例仍只持有页面 loader。五份变化的 reports 由完整构建真实生成；`taro-spike-2/src` 没有品牌 / Lucide 生成副作用，async 路径报告内容未变。
- `cd taro-spike-2 && npm test` 退出 **0**，包含分包提取回归、页面 / API / CSS smoke 和实际包体闸门；日志在 `tmp/perf/t2-final-taro-test.log`。
- `cd wechat-miniprogram && npm test` 退出 **0**，**32 个脚本全部通过**，含 check-shared（web.js 580 KiB，内容新鲜）与 check-parity；日志在 `tmp/perf/t2-final-wechat-test.log`。构建链重新生成共享文件后字节未变，`frontend/src/lib` / 原生生产源码均无 diff。
- 网页 check / lint / build 和 1,627 项全量测试通过；字节与测试口径分别见 release、interface 专题的 2026-11-07 最终记录。`git diff --check` 通过。

这次只在指定 worktree 构建与测试，没有联网、启动服务或 GUI、刷新学习页、提交 / 推送 / 合并。静态 PNG 与母版已实际看图；页面布局、放大进门的连续画面、冷点击 Suspense 帧数、微信开发者工具运行与真机行为仍未验，不能用上述绿灯代替。

## 2026-11-07 T3：预建出厂结构后的旧小程序夹具与共享包

出厂库预建了 `achievements` 等空用户表，原生 `scripts/sync-snapshot-smoke.mjs` 的 0.1.x 回归曾在
`CREATE TABLE achievements` 报 already exists，尚未走到升级断言。夹具现在先显式 DROP 再建旧版结构，
继续验证旧墓碑换列、透传行放回真表、旧自创表删除及真实跨端往返；没有把 CREATE 改为忽略来混用新旧结构。
快照的本机键清单还增加 `content_marker_repair` 断言：认证只属于下载到这份内容的设备，不能认证对端旧库。

已从本 worktree 的网页数据层重新生成 `src/shared/web.js`，`check-shared` 与原生 `npm test` **32 个脚本全通过**。
Taro fresh 构建主包 **1,894,761 B**，低于 **1,900,000 B**；没有调预算、改允许清单或留下资产生成的 src 副作用。
普通构建的 Doctor panic 与 `--no-check` 全部后处理的证据边界、用户需要运行的云库上传命令见发布专题同日 T3 节。
本任务仅改变制库/校验及本机同步标记过滤，没有页面改动；按作者明确禁令未开 GUI，不把构建当开发者工具或真机通过。

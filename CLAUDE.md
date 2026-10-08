# 收集日（ShuShuGo）— Claude 工作须知

> **本文件只是索引。** 开始动手前，先按下面「专题索引」找出这次任务会触发的所有专题文档并读完；拿不准算不算触发，就读。专题文档里的内容和本文件同等效力。

> **新增踩坑记录**：写进对应的 `docs/claude/*.md`（没有合适的就新建一个，并在索引表加一行），不要再往本文件正文堆内容。本文件正文控制在 15000 字符以内。合并旧分支时若 CLAUDE.md 冲突：分支里新增的 `## ` 节原样放进对应专题文档、索引补一行，不要直接接受分支版本的整份 CLAUDE.md。

> **交工前全量对照（每个大项目一次，且只一次）**：项目接近宣告完成时，由 Claude 开一个干净的新会话，通读本文件和 `docs/claude/` 全部文档，逐条对照这次交付（`git diff main...<分支>`）是否违反任何一条，列出清单后再宣告完成。这一步是裁判工作，不交给 Codex；Codex 可以先帮忙收集 diff 文件清单、跑全部闸门。平时只读索引触发的专题，不做全量通读。

## ⚠️ 硬约束一览

- ## ⚠️ 改页面 = 网页和小程序一起改（2026-09-25） → `docs/claude/mini-program-and-cross-platform.md`
- ## ⚠️ 新项目必须编译并运行小程序版；前端必须做视觉检查（2026-09-25） → `docs/claude/mini-program-and-cross-platform.md`
- ## ⚠️ 开口练习（日常会话）是实验功能，不许进任何发布包（2026-09-30） → `docs/claude/experimental-features.md`
- ## ⚠️ 单词拼写（Spelling）是实验功能，不进任何发布包（2026-10-02 起，作者睡觉期间 Claude 全权做完） → `docs/claude/experimental-features.md`
- ## ⚠️ JLPT 刷题也是实验功能，开关单独一个（2026-10-02） → `docs/claude/experimental-features.md`
- ## ⚠️ 查我的真实学习数据：`cd frontend && npm run db -- <词>` → `docs/claude/real-learning-data.md`
- ## ⚠️ 推 main 之前先跑 `scripts/ci-local.sh`（2026-10-03） → `CLAUDE.md`
- ## ⚠️ 分支约定：只有一条主线 `main`（2026-09-23 用户定的） → `CLAUDE.md`
- ### ⚠️ 收据有两种结构，只认一种就等于收了钱不发货 → `docs/claude/accounts-and-purchases.md`
- ### ⚠️ 一笔 Apple 交易只能给一个应用账号（`apple_transaction_owners`） → `docs/claude/accounts-and-purchases.md`
- ### ⚠️ 权益不许被更弱的交易覆盖（`entitlement-rules.ts`） → `docs/claude/accounts-and-purchases.md`
- ## ⚠️ Apple 登录：算法要跟着 Apple 的公钥走，写死 ES256 是登不上的（2026-09-09 修） → `docs/claude/accounts-and-purchases.md`
- ## ⚠️ 微信小程序付费 / 登录上线闸门（2026-09-21 核实，尚未完成） → `docs/claude/mini-program-and-cross-platform.md`
- ### ⚠️ 小程序上传包不得夹带开发诊断界面（2026-09-22 修） → `docs/claude/mini-program-and-cross-platform.md`
- ## ⚠️ 小程序整个数据层都从网页源码打包，不许再手抄一份（2026-09-22 定的） → `docs/claude/mini-program-and-cross-platform.md`
- ### ⚠️ 2026-09-25 复盘：小程序「对齐网页」耗了二十来个小时却看不出变化，原因和该怎么做 → `docs/claude/mini-program-and-cross-platform.md`
- ### ⚠️ 透传只保护「小程序不写的表」（2026-09-10 修） → `docs/claude/mini-program-and-cross-platform.md`
- ### ⚠️ 语法收藏的读和写曾经不在同一张表（2026-09-10 修） → `docs/claude/mini-program-and-cross-platform.md`
- ## ⚠️ 自定义词条的 id 由内容算，不用自增（2026-09-09 修） → `docs/claude/sync-and-cloud-data.md`
- ## ⚠️ 「本机内容迁到哪一版」的标记绝不能跨设备同步（2026-09-09 修） → `docs/claude/sync-and-cloud-data.md`
- ## ⚠️ 快照容量有一个具体的死线：2026-11-03（2026-09-09 实测） → `docs/claude/sync-and-cloud-data.md`
- ### ⚠️ 最低支持系统是 iOS 16.4，三处必须一起说同一个数 → `docs/claude/release-and-deployment.md`
- ### ⚠️ `scripts/package-preview.sh`：清单漏文件是静默的 → `docs/claude/release-and-deployment.md`
- ### ⚠️ `scripts/build-ios.sh` 是发版那条路，不许绕过门禁 → `docs/claude/release-and-deployment.md`
- ### ⚠️ 网页版默认没有预生成读音音频 → `docs/claude/release-and-deployment.md`
- ### ⚠️ 小程序的 CI 入口只有 `npm test`，别在 workflow 里抄脚本名单 → `docs/claude/release-and-deployment.md`
- ## ⚠️ 落盘的四条不变量（2026-09-10 审查后补齐） → `docs/claude/storage-and-persistence.md`
- ### ⚠️ 内容迁移必须喊 `persistContentSoon()`，不是 `persistSoon()` → `docs/claude/storage-and-persistence.md`
- ### ⚠️ 导入整库备份必须换设备号（`restoreDatabaseBackup`） → `docs/claude/storage-and-persistence.md`
- ### ⚠️ `importDatabase` 换库之后要关掉旧实例 → `docs/claude/storage-and-persistence.md`
- ## ⚠️ 写盘失败的提示挂在常驻层（`App.tsx` 的 `PersistenceBanner`，2026-09-10） → `docs/claude/storage-and-persistence.md`
- ### ⚠️ 待办（2026-09-18 定下、还没做）：参考引擎从 Kyoko 换成 AivisSpeech，然后上 R2 → `docs/claude/audio-pronunciation-and-content.md`
- ### ⚠️ 外部 AI 的内容审计不许直接落库（2026-09-19 查明并回退） → `docs/claude/audio-pronunciation-and-content.md`
- ### ⚠️ 用时是「答题用的时间」，不是墙上时间 → `docs/claude/interface-and-design-system.md`
- ### ⚠️ 续测要说清楚「什么时候开的、隔了多久」 → `docs/claude/interface-and-design-system.md`
- ### ⚠️ 它从上线起一次都没成功过（2026-08-23 查明并修复） → `docs/claude/storage-and-persistence.md`
- ### ⚠️ 顺手查出：重建出来的 grammar_id 从来没和新装用户对上过 → `docs/claude/fsrs-and-review-scheduling.md`
- ### ⚠️⚠️ 用户 dev server 开着的时候，工作区里的任何「回退」都是一次降级重建（2026-09-18 踩到） → `docs/claude/fsrs-and-review-scheduling.md`
- ## ⚠️ 语法种子升版本会走一条从没跑过的代码路径（2026-08-23 踩到） → `docs/claude/fsrs-and-review-scheduling.md`
- ### ⚠️ seed 和出厂库曾经用两套重名消歧写法（2026-09-08 修） → `docs/claude/fsrs-and-review-scheduling.md`
- ### ⚠️ 发布校验比对的是 12 个字段,不是 7 个（2026-09-10 补） → `docs/claude/fsrs-and-review-scheduling.md`
- ### ⚠️ 语法收藏从来就没在收藏页显示过（2026-09-01 查明并修复） → `docs/claude/learning-progress-and-rewards.md`
- ### ⚠️ 优先级按「有多陌生」排，不按「欠了多久」（2026-09-17 改） → `docs/claude/fsrs-and-review-scheduling.md`
- ### ⚠️ 上限装不下时选词是纯随机，不按任何推词逻辑（2026-09-18，用户定的；顽固词闸 09-20 补回） → `docs/claude/fsrs-and-review-scheduling.md`
- ### ⚠️ 微信：没有 OpenSDK，所谓「一键」是这两条 → `docs/claude/interface-and-design-system.md`

## 专题索引

| 什么时候必须先读（触发条件：会改到的目录/文件路径、功能名、关键词，要具体） | 文件 | 包含的节（原标题，可截短） |
| --- | --- | --- |
| 改 wechat-miniprogram/**、frontend/src/lib/** 中由小程序共享的逻辑、scripts/shared/**、scripts/build-shared.mjs、src/shared/web.js、WXML/WXSS 或小程序路由；处理网页/小程序功能一致、视觉验收、登录、虚拟支付、快照收发或 check-shared 时。 | `docs/claude/mini-program-and-cross-platform.md` | ## ⚠️ 改页面 = 网页和小程序一起改（2026-09-25）<br>## ⚠️ 新项目必须编译并运行小程序版；前端必须做视觉检查（2026-09-25）<br>## ⚠️ 微信小程序付费 / 登录上线闸门（2026-09-21 核实，尚未完成）<br>## ⚠️ 小程序整个数据层都从网页源码打包，不许再手抄一份（2026-09-22 定的）<br>## 小程序不是「能收 v2」就等于双向无损（2026-09-09 修） |
| 改 frontend/src/lib/talk/**、frontend/src/lib/spelling/**、frontend/src/lib/jlpt-practice/**、相关页面和 route-table；改 __EXP_TALK__、__EXP_SPELLING__、__EXP_JLPT__、实验开关、发布包隔离或实验内容题库时。 | `docs/claude/experimental-features.md` | ## ⚠️ 开口练习（日常会话）是实验功能，不许进任何发布包（2026-09-30）<br>## ⚠️ 单词拼写（Spelling）是实验功能，不进任何发布包（2026-10-02 起，作者睡觉期间 Claude 全权做完）<br>## ⚠️ JLPT 刷题也是实验功能，开关单独一个（2026-10-02） |
| 改 frontend/src/lib/purchases.ts、cloudflare-sync/src/index.ts 的 Apple 交易/权益逻辑、身份验证、Apple 登录、StoreKit、Offer Codes、Pro 授权、订阅、退款或账号归属时。 | `docs/claude/accounts-and-purchases.md` | ## 内购：收据长什么样、权益归谁、退款怎么回来（2026-09-09 修）<br>## 兑换码：只走 Apple Offer Codes，码永远不进仓库（2026-09-20 定的）<br>## ⚠️ Apple 登录：算法要跟着 Apple 的公钥走，写死 ES256 是登不上的（2026-09-09 修） |
| 改 frontend/src/lib/sync/**、sync/tables.ts、sync/snapshot.ts、sync/merge.ts、local-schema.sql、cloudflare-sync/**、Worker/D1/R2/KV、sync_uid、快照容量/协议、本机数据迁移标记、内容 ID 或旧名称兼容时。 | `docs/claude/sync-and-cloud-data.md` | ## ⚠️ 自定义词条的 id 由内容算，不用自增（2026-09-09 修）<br>## ⚠️ 「本机内容迁到哪一版」的标记绝不能跨设备同步（2026-09-09 修）<br>## ⚠️ 快照容量有一个具体的死线：2026-11-03（2026-09-09 实测）<br>## 快照容量：上限卡的是压缩前的字节数（2026-09-09）<br>## 请求体、限速与配置降级（2026-09-09）<br>## 云同步：花钱的是请求次数和快照体积，不是表的数量<br>## ShuShuGo 命名与兼容边界（2026-09-10） |
| 读取真实学习记录、执行 cd frontend && npm run db、访问 frontend/.local/live.db、IndexedDB 的 master-nihongo-storage/study-database、5173 快照或真实 Chrome 学习标签页时。 | `docs/claude/real-learning-data.md` | ## ⚠️ 查我的真实学习数据：`cd frontend && npm run db -- <词>` |
| 改 scripts/build-ios.sh、scripts/package-preview.sh、构建配置、最低支持系统、/api/health、Vite/Taro 构建、Worker/Pages 部署或发布验收步骤时。 | `docs/claude/release-and-deployment.md` | ## 部署自检：`GET /api/health`（2026-09-09）<br>## 构建与发布：三条闸门和一个最低系统版本（2026-09-10） |
| 改 frontend/src/lib/storage.ts、database.ts、落盘队列/增量回放、persistContentSoon、persistSoon、enqueueWrite、restoreDatabaseBackup、importDatabase、mergeWordInto 或重复词条迁移时。 | `docs/claude/storage-and-persistence.md` | ## 落盘：整库最多 5 分钟一次，中间只写改过的行（2026-09-06）<br>## ⚠️ 落盘的四条不变量（2026-09-10 审查后补齐）<br>## ⚠️ 写盘失败的提示挂在常驻层（`App.tsx` 的 `PersistenceBanner`，2026-09-10）<br>## 老库重复词条：先搬记录，再删行 |
| 改 FSRS、frontend/src/lib/scheduler/**、frontend/src/lib/word-api/**、frontend/src/lib/grammar-quiz/**、card-log.ts、复习上限/新词配额/顽固词/选词优先级/排片、语法题、错题本或压轴卡时。 | `docs/claude/fsrs-and-review-scheduling.md` | ## 答一次题该做多少事（2026-09-06 大修）<br>## 复习算法：只有 FSRS（2026-08-01 起）<br>## 语法考题：和单词同一套 FSRS（2026-08-27 改）<br>## 语法考题：「A／B」两个写法不能互相推出来的，拆成两条（2026-09-18）<br>## ⚠️ 语法种子升版本会走一条从没跑过的代码路径（2026-08-23 踩到）<br>## 错题本的阈值必须踩用户自己那条分布的尾巴（2026-08-23 重调）<br>## 压轴卡：按「记得牢」挑，不是按「此刻回忆概率高」挑（2026-09-01 修）<br>## 选词 = 优先级 + 排片，两件事 |
| 改 daily-plan.ts、DailyPlanPanel、studyPreferences、混合学习/自选清单、学习模式、起点水平评估、备考计划或计划推荐量时。 | `docs/claude/daily-plans-and-study-modes.md` | ## 自选清单 = 第六个模式，但藏起来<br>## 混合学习：四种卡、一份每日量、三个入口（2026-09-20，设计在 docs/MIXED_STUDY_PLAN.md）<br>## 起点水平 → 备考计划：定了的方向 + 待办（2026-09-22）<br>## 起点水平计划：2026-09-23 的用户澄清与实现判据 |
| 改读音/音高/长音/一字多音、前端或小程序音频、scripts/*audio*、confusion-groups.ts、辨析题/词义审校、读音题、题面改写或学习内容审计时。 | `docs/claude/audio-pronunciation-and-content.md` | ## 认识音：Shepard 音阶，听感一直升但频率原地转圈<br>## 读音音频：长音该压，语素边界不该（2026-09-07）<br>## 例句音频：预生成、放 R2 按需拉，不进包也不在端上合成（2026-09-17）<br>## 辨析只有一份：`confusion-groups.ts`<br>## 汉字读音模式：考的是读音，不是写法<br>## 一字多音：说明表只有一份，判据说不清才轮到人写（2026-08-24）<br>## 题面拍数提示：给正向题消歧，不是给记不住的词发拐杖<br>## 题面可以由用户自己改写（2026-08-23）<br>## 读音题：只问看不见的那部分（2026-09-01 修）<br>## 疑难辨析：按类分节 + 搜索（2026-09-01） |
| 改柚子余额/奖励、成就、progress 统计、完成页学习日历、收藏夹、顽固词加餐或历史进度判据时。 | `docs/claude/learning-progress-and-rewards.md` | ## 柚子：免费货币，只奖「做完了」，绝不奖「答得好」（2026-09-19）<br>## 成就：判据现算，不攒计数器<br>## 完成页日历的「学习 N 项」= 减负 + 单词 + 语法，和小路同一口径（2026-09-19）<br>## 收藏夹：夹名就是行身份；完成页给当天顽固词一个出口（2026-09-01） |
| 改 frontend/src/pages/**、组件、Tailwind/design.css/styles.css、交互与学习时长显示、图标/主页/词库页/词汇量页、设计系统、首次设定、柚子商店、完成页、组队页或周报视觉时。 | `docs/claude/interface-and-design-system.md` | ## 学习时长 = 有在操作的时间，不是页面开着的时间<br>## 交互上的三条（2026-09-10 审查）<br>## 图标：功能位一律 lucide，角色位一律留 emoji（2026-09-01）<br>## 主页：入口一个不删，靠层级和收纳分主次<br>## 查词汇量：估计怎么算的，以及为什么先摸底再压题（2026-09-01）<br>## 查词汇量：先给一张「第二主页」，测验是它上面的一个按钮（2026-09-01）<br>## 词库页（主页那个「选词」按钮）：颜色说的是记忆强度，不是排期<br>## UI 收口：一套尺度、一个外壳、卡里只有一层框（2026-09-23，分支 claude/ui-refresh）<br>## 设计系统重做：三种面、两种控件、吉祥物说话（2026-09-23 夜，分支 claude/redesign）<br>## 查词汇量 / 首次设定 / 两张分享图：接进设计系统（2026-09-24，分支 claude/onboard-vocab）<br>## 柚子商店接进设计系统（2026-09-24）<br>## 单词完成页接进设计系统（2026-09-24）<br>## 组队页（网页）接进设计系统（2026-09-24）<br>## 周报：三套版式并排，等用户选（2026-09-24）<br>## 周报三套版式、一张分享面板，微信只能做到「系统分享 + 存图开微信」（2026-09-24） |

## ⚠️ 推 main 之前先跑 `scripts/ci-local.sh`（2026-10-03）

仓库是**公开**的，`git push origin main` 同时触发 CI（frontend / worker / miniprogram 三个任务）和 Pages 部署。
`scripts/ci-local.sh` 在本机跑一遍同样的闸门。那天一次推送连踩三个红灯：改了 `local-schema.sql` 没重新生成 `wechat-miniprogram/src/shared/web.js`；
出厂词库改了没跑 `npm run build:kanji-unit-index`（prebuild 校验会让 CI / 部署失败）；推送范围里的旧提交没有 `Parity-Exempt`（`check-parity` 对整段范围逐个提交检查，
路线 A 之后的处理是在 `parity-map.json` 给这些 web 文件登记自身；这条检查是否整体退休留给作者定）。
**合并冲突别用「两边取并集」脚本一把梭**：那天这样合并 `scripts/build-ios.sh` 弄丢了一个 `exit 1` / `fi`，整个发版脚本语法错误，是只读审查才发现的；shell 脚本合完要 `bash -n`。

## 仓库速记

- 主应用：`frontend/`（React 19 + TS + Vite + Tailwind，SQLite 走 sql.js/WASM，Capacitor 打 iOS）
- 云同步：`cloudflare-sync/`（Worker + D1 + R2；快照进 R2，版本/幂等记录进 D1，限速用 KV）。
  客户端按行合并，不是整库覆盖（`lib/sync/merge.ts`）

## ⚠️ 分支约定：只有一条主线 `main`（2026-09-23 用户定的）

用户原话：基本不会在不同分支干不同的工作，希望所有分支自动同步，除非是微信小程序 / 安卓 /
App Store 特定的东西或刻意提及的。落地成下面三条：

1. **主线只有 `main`。** 用户开 5173 dev server 的主目录就停在 `main` 上。
   不再有「长期功能分支」（`feat/fsrs-sync-accounts` 当时和 main 只差一个提交，就是主线换了个名字）。
2. **平台差异放目录和开关，不开分支。** `frontend/` / `wechat-miniprogram/` / `ios/` / `cloudflare-sync/`
   本来就分开；提审相关的差异（比如「这版小程序先隐藏购买入口」）用配置开关，不拉「审核分支」。
   ⚠️ 「只要不碰前端，放在别的分支也没事」**在这个仓库不成立**：小程序的 `src/shared/web.js`
   是从 `frontend/src/lib` 打出来的，小程序分支落后前端一次，`check-shared` 就红、两端数据层就漂。
3. **会话开的 worktree 分支是短命的：从 main 起、做完当场合回 main、删掉。**
   - 开工前先同步 main（在 app 管的 worktree 里用「同步基础分支」工具）；
   - 做完**当场提交并合回 main**，合完删分支和 worktree。怕打断正在学习的 5173 就挑空档合，
     不许留一句「等你说合入我再写回去」—— 2026-09-22 Codex 的会员斜角预览就是这样放了一天多没人管；
   - 2026-09-23 盘点时有 17 个本地分支、11 个 worktree，其中 7 个 worktree 带着没提交的改动
     （最多 200 个文件），这就是「分支不收尾」的样子。

**不做后台定时自动合并。** 三个原因：① 会在用户背单词时改主目录文件，触发热更新 ——
2026-09-18 一次 stash 就让语法种子按旧版重建、删掉了当天的作答（见语法考题那节）；
② 冲突会停在一半，没人在场时工作区一直是编译不过的状态；③ 会把别的会话没提交的改动一起卷走。
同步发生在**会话开始和结束**，由会话自己做。

⚠️ 在 dev server 开着的主目录里切分支：只有**目标分支和当前 HEAD 是同一个提交**时才不碰文件
（未提交改动原样带过去）。先把 main 快进到当前 HEAD 再切；反过来先切到落后的 main 等于一次回退。


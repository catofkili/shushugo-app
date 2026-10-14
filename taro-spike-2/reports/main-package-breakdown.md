# W1 主包拆解与安全腾挪（2026-10-14）

分支 `codex/v3-w1`；只在指定 worktree 改动，未提交、未合并、未部署、未打开 5173。

## 基线与计量边界

背景数字 1,897,803 B；检出报告 1,898,041 B；本 worktree 默认重建退出 0，基线 **1897947 B**。以同一 checkout 的重建数作收益基准。

## common.js：前 40 大源模块

`common.js` 产物 914,102 B。下表来自基线 webpack stats 的叶子模块 `size`（loader 后、压缩前），不是压缩产物字节的可加总归属；模块合并容器已展开，避免重复计数。导入链按当前源码 AST 与实际平台替换表追到主包入口；跳过类型导入和显式 lazy 边。stats 的 issuerPath 只给首次使用者，常为分包，不能把它误认成主包原因。

|源模块|源码模块 B|主包同步导入链 / 保留原因|
|---|---:|---|
|`frontend/src/lib/sync-api.ts`|113250|`taro-spike-2/src/pages/home/index.tsx` → `taro-spike-2/src/platform/WeappPage.tsx` → `frontend/src/lib/sync-api.ts`|
|`wechat-miniprogram/src/vendor/sql-wasm.js`|91308|`taro-spike-2/src/pages/home/index.tsx` → `taro-spike-2/src/platform/WeappPage.tsx` → `frontend/src/lib/grammarHighlights.ts` → `wechat-miniprogram/scripts/shared/shims/database.js` → `wechat-miniprogram/src/runtime/database-store.js` → `wechat-miniprogram/src/runtime/sqlite.js` → `wechat-miniprogram/src/vendor/sql-wasm.js`|
|`frontend/src/lib/storage.ts`|76873|`taro-spike-2/src/pages/home/index.tsx` → `taro-spike-2/src/platform/WeappPage.tsx` → `taro-spike-2/src/platform/database-runtime.weapp.ts` → `frontend/src/lib/storage.ts`；启动恢复和持久化单例|
|`frontend/src/lib/word-api.ts`|66853|`taro-spike-2/src/pages/home/index.tsx` → `taro-spike-2/src/platform/WeappPage.tsx` → `frontend/src/lib/api.ts` → `frontend/src/lib/word-api.ts`|
|`frontend/src/lib/study-core.ts`|60930|`taro-spike-2/src/pages/home/index.tsx` → `taro-spike-2/src/platform/WeappPage.tsx` → `frontend/src/lib/grammarHighlights.ts` → `frontend/src/lib/study-core.ts`|
|`wechat-miniprogram/src/data/verb_pair_hints.js`|36002|`taro-spike-2/src/pages/home/index.tsx` → `taro-spike-2/src/platform/WeappPage.tsx` → `frontend/src/lib/level-plan.ts` → `frontend/src/lib/confusion-cards.ts` → `wechat-miniprogram/scripts/shared/shims/verb-pair-hints.js` → `wechat-miniprogram/src/data/verb_pair_hints.js`|
|`frontend/src/lib/confusion-groups.ts`|31433|`taro-spike-2/src/pages/home/index.tsx` → `taro-spike-2/src/platform/WeappPage.tsx` → `frontend/src/app/actions.ts` → `frontend/src/lib/duplicate-merge.ts` → `frontend/src/lib/confusion-groups.ts`|
|`frontend/src/lib/sync/merge.ts`|30730|`taro-spike-2/src/pages/home/index.tsx` → `taro-spike-2/src/platform/WeappPage.tsx` → `frontend/src/lib/sync-api.ts` → `frontend/src/lib/sync/merge.ts`|
|`frontend/src/lib/grammar-quiz.ts`|29898|`taro-spike-2/src/pages/home/index.tsx` → `taro-spike-2/src/platform/WeappPage.tsx` → `frontend/src/lib/api.ts` → `frontend/src/lib/word-api.ts` → `frontend/src/lib/word-api/stats.ts` → `frontend/src/lib/grammar-quiz.ts`|
|`frontend/src/lib/kanji-unit-scheduler.ts`|28307|`taro-spike-2/src/pages/home/index.tsx` → `taro-spike-2/src/platform/WeappPage.tsx` → `frontend/src/lib/api.ts` → `frontend/src/lib/word-api.ts` → `frontend/src/lib/kanji-unit-scheduler.ts`|
|`frontend/src/lib/word-list-import.ts`|27824|`taro-spike-2/src/pages/home/index.tsx` → `taro-spike-2/src/platform/WeappPage.tsx` → `frontend/src/lib/sync-api.ts` → `frontend/src/lib/sync/merge.ts` → `frontend/src/lib/word-list-import.ts`|
|`frontend/src/lib/fsrs-store.ts`|27472|`taro-spike-2/src/pages/home/index.tsx` → `taro-spike-2/src/platform/WeappPage.tsx` → `frontend/src/lib/api.ts` → `frontend/src/lib/word-api.ts` → `frontend/src/lib/fsrs-store.ts`|
|`frontend/src/lib/word-api/stage1.ts`|26160|`taro-spike-2/src/pages/home/index.tsx` → `taro-spike-2/src/platform/WeappPage.tsx` → `frontend/src/lib/yuzu.ts` → `frontend/src/lib/word-api/stage1.ts`|
|`frontend/src/lib/database/local-schema.sql`|25915|`taro-spike-2/src/pages/home/index.tsx` → `taro-spike-2/src/platform/WeappPage.tsx` → `frontend/src/lib/grammarHighlights.ts` → `frontend/src/lib/study-core.ts` → `frontend/src/lib/database/schema.ts` → `frontend/src/lib/database/local-schema.sql`|
|`frontend/src/components/LevelSetup.tsx`|24640|`taro-spike-2/src/pages/home/index.tsx` → `taro-spike-2/src/platform/WeappPage.tsx` → `frontend/src/app/AppShell.tsx` → `frontend/src/components/LevelSetup.tsx`|
|`frontend/src/components/AuthDialog.weapp.tsx`|24462|`taro-spike-2/src/pages/home/index.tsx` → `taro-spike-2/src/platform/WeappPage.tsx` → `frontend/src/app/AppShell.tsx` → `frontend/src/components/AuthDialog.weapp.tsx`|
|`taro-spike-2/src/platform/WeappPage.tsx`|24068|`taro-spike-2/src/pages/home/index.tsx` → `taro-spike-2/src/platform/WeappPage.tsx`|
|`frontend/src/lib/level-plan.ts`|23866|`taro-spike-2/src/pages/home/index.tsx` → `taro-spike-2/src/platform/WeappPage.tsx` → `frontend/src/lib/level-plan.ts`|
|`frontend/src/lib/sync/schema.ts`|21075|`taro-spike-2/src/pages/home/index.tsx` → `taro-spike-2/src/platform/WeappPage.tsx` → `frontend/src/lib/sync-api.ts` → `frontend/src/lib/sync/schema.ts`|
|`frontend/src/lib/word-library.ts`|20275|`taro-spike-2/src/pages/home/index.tsx` → `taro-spike-2/src/platform/WeappPage.tsx` → `frontend/src/app/actions.ts` → `frontend/src/lib/duplicate-merge.ts` → `frontend/src/lib/word-library.ts`|
|`frontend/src/lib/daily-plan.ts`|20140|`taro-spike-2/src/pages/home/index.tsx` → `taro-spike-2/src/platform/WeappPage.tsx` → `frontend/src/app/AppShell.tsx` → `frontend/src/components/LevelSetup.tsx` → `frontend/src/lib/daily-plan.ts`|
|`frontend/src/lib/models/word-card.ts`|19706|`taro-spike-2/src/pages/home/index.tsx` → `taro-spike-2/src/platform/WeappPage.tsx` → `frontend/src/lib/api.ts` → `frontend/src/lib/word-api.ts` → `frontend/src/lib/models/word-card.ts`|
|`frontend/src/lib/sync/snapshot.ts`|19263|`taro-spike-2/src/pages/home/index.tsx` → `taro-spike-2/src/platform/WeappPage.tsx` → `frontend/src/lib/sync-api.ts` → `frontend/src/lib/sync/snapshot.ts`|
|`frontend/src/lib/word-api/stats.ts`|19142|`taro-spike-2/src/pages/home/index.tsx` → `taro-spike-2/src/platform/WeappPage.tsx` → `frontend/src/lib/api.ts` → `frontend/src/lib/word-api.ts` → `frontend/src/lib/word-api/stats.ts`|
|`frontend/src/lib/studyPreferences.ts`|18403|`taro-spike-2/src/pages/home/index.tsx` → `taro-spike-2/src/platform/WeappPage.tsx` → `frontend/src/lib/studyPreferences.ts`|
|`wechat-miniprogram/src/runtime/wx-promise.js`|17780|`taro-spike-2/src/app.tsx` → `taro-spike-2/src/platform/app-polyfills.weapp.ts` → `taro-spike-2/src/platform/fetch.weapp.cjs` → `wechat-miniprogram/src/runtime/wx-promise.js`|
|`frontend/src/data/similar_meaning_groups.ts`|16802|`taro-spike-2/src/pages/home/index.tsx` → `taro-spike-2/src/platform/WeappPage.tsx` → `frontend/src/lib/api.ts` → `frontend/src/lib/word-api.ts` → `frontend/src/data/similar_meaning_groups.ts`|
|`frontend/src/lib/card-log.ts`|16378|`taro-spike-2/src/pages/home/index.tsx` → `taro-spike-2/src/platform/WeappPage.tsx` → `frontend/src/lib/level-plan.ts` → `frontend/src/lib/kanji-char-cards.ts` → `frontend/src/lib/card-log.ts`|
|`frontend/src/lib/legacy-word-migrations.ts`|16243|`taro-spike-2/src/pages/home/index.tsx` → `taro-spike-2/src/platform/WeappPage.tsx` → `frontend/src/lib/grammarHighlights.ts` → `frontend/src/lib/study-core.ts` → `frontend/src/lib/legacy-word-migrations.ts`|
|`frontend/src/components/Paywall.tsx`|15963|`taro-spike-2/src/pages/home/index.tsx` → `taro-spike-2/src/platform/WeappPage.tsx` → `frontend/src/app/AppShell.tsx` → `frontend/src/components/Paywall.tsx`|
|`frontend/src/lib/grammarHighlights.ts`|14955|`taro-spike-2/src/pages/home/index.tsx` → `taro-spike-2/src/platform/WeappPage.tsx` → `frontend/src/lib/grammarHighlights.ts`|
|`frontend/src/lib/kanji-char-cards.ts`|14936|`taro-spike-2/src/pages/home/index.tsx` → `taro-spike-2/src/platform/WeappPage.tsx` → `frontend/src/lib/level-plan.ts` → `frontend/src/lib/kanji-char-cards.ts`|
|`frontend/src/lib/analytics/stats.ts`|14704|`taro-spike-2/src/pages/home/index.tsx` → `taro-spike-2/src/platform/WeappPage.tsx` → `frontend/src/lib/api.ts` → `frontend/src/lib/word-api.ts` → `frontend/src/lib/analytics/stats.ts`|
|`frontend/src/lib/word-api/direction-plan.ts`|14307|`taro-spike-2/src/pages/home/index.tsx` → `taro-spike-2/src/platform/WeappPage.tsx` → `frontend/src/lib/api.ts` → `frontend/src/lib/word-api.ts` → `frontend/src/lib/word-api/direction-plan.ts`|
|`frontend/src/lib/local-delta.ts`|13374|`taro-spike-2/src/pages/home/index.tsx` → `taro-spike-2/src/platform/WeappPage.tsx` → `taro-spike-2/src/platform/database-runtime.weapp.ts` → `frontend/src/lib/storage.ts` → `frontend/src/lib/local-delta.ts`；持久化增量账本|
|`frontend/src/lib/yuzu.ts`|12840|`taro-spike-2/src/pages/home/index.tsx` → `taro-spike-2/src/platform/WeappPage.tsx` → `frontend/src/lib/yuzu.ts`|
|`frontend/src/lib/confusion-cards.ts`|12455|`taro-spike-2/src/pages/home/index.tsx` → `taro-spike-2/src/platform/WeappPage.tsx` → `frontend/src/lib/level-plan.ts` → `frontend/src/lib/confusion-cards.ts`|
|`frontend/src/lib/kanji-choice.ts`|12291|`taro-spike-2/src/pages/home/index.tsx` → `taro-spike-2/src/platform/WeappPage.tsx` → `frontend/src/lib/level-plan.ts` → `frontend/src/lib/kanji-char-cards.ts` → `frontend/src/lib/kanji-choice.ts`|
|`wechat-miniprogram/src/runtime/payment.js`|12227|`taro-spike-2/src/pages/home/index.tsx` → `taro-spike-2/src/platform/WeappPage.tsx` → `frontend/src/app/AppShell.tsx` → `frontend/src/components/LevelSetup.tsx` → `frontend/src/lib/purchases.weapp.ts` → `wechat-miniprogram/src/runtime/payment.js`|
|`frontend/src/lib/sync/tables.ts`|12097|`taro-spike-2/src/pages/home/index.tsx` → `taro-spike-2/src/platform/WeappPage.tsx` → `frontend/src/lib/grammarHighlights.ts` → `frontend/src/lib/study-core.ts` → `frontend/src/lib/sync/tables.ts`|

## app.wxss：按来源拆解

基线最终 `app.wxss` 216,307 B。`css-source-bytes.json` 记录原始源码字节；Tailwind 展开、平台过滤、压缩与路由拆分使其不能直接加总为最终 app.wxss。下表补充 stats 中 CSS 所属 chunk，已知全局四份 CSS 经 app 入口加载；lazy/tabs 样式在拆分之后合入 app，当前前缀迁移管不到它。

|来源|源码 B|入口 / 产物归属|
|---|---:|---|
|`frontend/src/app.css`|146853|app.wxss|
|`frontend/src/styles.css`|133879|app.wxss|
|`frontend/src/design.css`|75131|app.wxss|
|`frontend/src/pages/weekly-report.css`|39998|content-pages/weekly-report/index.wxss|
|`frontend/src/pages/weekly/film.css`|20749|content-pages/weekly-report/index.wxss|
|`frontend/src/pages/weekly/star-atlas.css`|16152|content-pages/weekly-report/index.wxss|
|`frontend/src/components/streak/streak.css`|16022|sub-common/b0c926e6a891c18bd2379d65040c13a7.wxss、lazy/tabs.wxss|
|`frontend/src/skins.css`|11333|app.wxss|
|`taro-spike-2/src/platform/mini-overrides.weapp.css`|8965|按模块导入随所属页面生成；最终归属见 route-css-split.json|
|`frontend/src/pages/talk.css`|8294|study/talk/index.wxss|
|`frontend/src/pages/team-duel.css`|7471|study/sub-vendors.wxss|
|`frontend/src/components/streak/StreakPageView.css`|6163|content-pages/streak/index.wxss|
|`frontend/src/pages/spelling.css`|4017|lazy/tabs.wxss|
|`taro-spike-2/src/content-pages/weekly-report/weekly-layout.weapp.css`|3415|按模块导入随所属页面生成；最终归属见 route-css-split.json|
|`taro-spike-2/src/app.css`|1113|按模块导入随所属页面生成；最终归属见 route-css-split.json|
|`frontend/src/components/ZooHome.css`|1011|lazy/tabs.wxss|
|`taro-spike-2/src/study/study-modes/study-modes.weapp.css`|955|按模块导入随所属页面生成；最终归属见 route-css-split.json|
|`taro-spike-2/src/content-pages/favorites/favorites-layout.weapp.css`|582|按模块导入随所属页面生成；最终归属见 route-css-split.json|
|`taro-spike-2/src/account/personal-info/personal-info.weapp.css`|309|按模块导入随所属页面生成；最终归属见 route-css-split.json|
|`taro-spike-2/src/content-pages/yuzu-shop/yuzu-layout.weapp.css`|304|按模块导入随所属页面生成；最终归属见 route-css-split.json|

## assets/brand：每张图片与主包使用者

主包资源的使用范围包括主包四个 Tab 渲染的 lazy/tabs 界面以及全局弹层；JS 在 lazy 不等于图片可放 lazy。以下沿 Tab / app 入口走包含 lazy 的依赖图，记录贴纸字面量及动态状态备选值。`shushugo-icon*` 是 BrandIcon 默认兜底，`walk-strip` 是 CapybaraWalk。保守计入疑似/动态引用；未充分证明无主包用户的图不迁走。

|图片|基线 B|像素尺寸|主包使用依据|
|---|---:|---|---|
|walk-strip.png|27934|525×144|`taro-spike-2/src/platform/mascot.weapp.tsx:112`|
|scene-team.png|26786|347×192|`frontend/src/components/ZooHome.tsx:401`|
|mood-yay.png|17892|356×240|`frontend/src/components/ZooHome.tsx:84`、`frontend/src/pages/GrammarQuiz.tsx:188`、`frontend/src/components/LevelSetup.tsx:152`、`frontend/src/components/ReportPrompt.tsx:70`、`frontend/src/components/FeedbackComposer.tsx:45`|
|mood-dizzy.png|17657|256×240|`frontend/src/components/LevelSetup.tsx:216`、`frontend/src/components/ReportPrompt.tsx:74`|
|scene-laptop.png|16346|266×184|`frontend/src/components/ZooHome.tsx:88`|
|mood-hungry.png|16118|230×220|`frontend/src/components/ZooHome.tsx:87`|
|mood-default.png|15491|269×192|`frontend/src/components/ZooHome.tsx:239`、`taro-spike-2/src/platform/mascot.weapp.tsx:100`、`frontend/src/components/MascotSay.tsx:16`|
|mood-fired-up.png|15367|269×192|`frontend/src/components/ZooHome.tsx:242`、`frontend/src/components/LevelSetup.tsx:208`、`frontend/src/components/streak/StreakCelebration.tsx:114`|
|mood-sleep.png|15154|297×224|`frontend/src/components/ZooHome.tsx:85`、`frontend/src/features/word-study/WordStudyPanels.tsx:566`|
|scene-music.png|13653|207×156|`frontend/src/components/ZooHome.tsx:89`|
|mood-wave.png|13282|235×168|`frontend/src/pages/ProfilePage.tsx:107`、`frontend/src/components/LevelSetup.tsx:152`、`frontend/src/components/FeedbackComposer.tsx:46`、`frontend/src/components/streak/StreakCelebration.tsx:114`|
|scene-stretch.png|11927|237×156|`frontend/src/components/ZooHome.tsx:86`|
|empty-box.png|10348|195×144|`frontend/src/features/word-study/stubborn-history.tsx:182`|
|empty-bye.png|9946|150×128|`frontend/src/features/word-study/WordStudyPanels.tsx:766`|
|mood-cheer.png|8620|165×136|`frontend/src/components/ZooHome.tsx:241`、`frontend/src/features/word-study/WordStudyPanels.tsx:447`、`frontend/src/components/streak/StreakCelebration.tsx:114`|
|mood-shy.png|7429|181×128|`frontend/src/components/ProReadingPreview.tsx:59`、`frontend/src/components/Paywall.tsx:176`|
|scene-book.png|6313|135×112|`frontend/src/components/ZooHome.tsx:243`|
|icon-kanji-readings.png|6224|134×72|`frontend/src/components/ZooHome.tsx:439`|
|shushugo-icon-dark.png|6168|113×112|`taro-spike-2/src/platform/mascot.weapp.tsx:124`、`frontend/src/components/CrossPlatformImage.weapp.tsx:52`|
|icon-shop.png|5394|102×72|`frontend/src/components/ZooHome.tsx:451`|
|icon-vocab.png|5380|126×72|`frontend/src/components/ZooHome.tsx:423`|
|mood-puzzled.png|5117|140×104|`frontend/src/components/ZooHome.tsx:240`、`frontend/src/components/LevelSetup.tsx:169`、`frontend/src/components/ReportPrompt.tsx:70`、`frontend/src/components/FeedbackComposer.tsx:47`、`frontend/src/features/word-study/WordStudyPanels.tsx:548`|
|icon-study-modes.png|3874|78×72|`frontend/src/components/ZooHome.tsx:415`|
|shushugo-icon.png|3671|112×112|`taro-spike-2/src/platform/mascot.weapp.tsx:106`、`taro-spike-2/src/platform/mascot.weapp.tsx:124`、`frontend/src/components/CrossPlatformImage.weapp.tsx:50`、`frontend/src/components/CrossPlatformImage.weapp.tsx:52`|
|icon-favorites.png|3244|75×72|`frontend/src/components/ZooHome.tsx:443`|
|icon-stats.png|2541|68×72|`frontend/src/components/ZooHome.tsx:447`|
|icon-grammar.png|2394|69×72|`frontend/src/components/ZooHome.tsx:419`、`frontend/src/components/ZooHome.tsx:435`|
|icon-practice.png|2362|66×72|`frontend/src/components/ZooHome.tsx:427`、`frontend/src/components/ZooHome.tsx:431`|
|mood-ask.png|1464|57×48|`frontend/src/pages/ProfilePage.tsx:144`|
|mood-surprised.png|1197|37×34|`frontend/src/app/AppShell.tsx:198`|

## 收益排序与实施边界

|候选|预计主包收益|决定与安全依据|
|---|---:|---|
|Taro 默认 ASCII 转义改为 Terser 原生 UTF-8 输出|基线预计 86,979 B，当前约 60–80 KB|本机 Taro MiniBaseConfig 明确设置 ascii_only:true；Terser 默认 false。仅改变字符串/正则的源码编码，保留 ECMA5 与全部压缩/混淆选项；先做编码语义测试，再在开发者工具验证。|
|全局外壳仅渲染用的 AppShell / 弹层组件随 lazy 加载|约 40–70 KB|保持数据层和缓存单例在主包；在原有数据载入期间并行预加载外壳，全部就绪后显示原界面。构建和运行验证后决定保留。|
|sync-api 的合并器及自定义词表导入按原 async 流程加载|约 20–40 KB|合并函数本来返回 Promise；保留错误传播、数据库身份与缓存。需共享层重建及合并器测试。|
|对合入 app 的 lazy CSS 再执行现有前缀拆分|约 4–10 KB|维持选择器、祖先 at-rule、声明和原顺序；主包 word CSS 只挪到主包页面，不算总主包收益。|
|已有主包贴纸再次压缩|预计很少|现已 pngquant 60–85；不降低尺寸或质量。仅考虑逐像素无损 IDAT 压缩，三张并排自查。|
|移动主包贴纸到 lazy|不实施|Tab 仍是主包页面，禁止引用 lazy 私有图片。|
|整个数据层 / 全局 CSS / Taro runtime 搬走|不实施|涉及数据库、同步事件和用户缓存单例，或全页级联 / 原生模板；未验证方案留给主管。|

## 最终收益与验收

### 构建与字节账

最终默认 `cd taro-spike-2 && npm run build:weapp` 退出 **0**，主包 **1,675,763 B**，距自定 1,900,000 B 上限余 **224,237 B**（约 219.0 KiB），距验收阈值 1,750,000 B 还低 74,237 B。所有分包也通过原有预算，未改任何预算数字、未删原允许项。

|改动|主包净收益 B|证据与边界|
|---|---:|---|
|AppShell/弹层、合并器、自定义词表回放、重复词合并异步化；协议版本号与正文分离|118,122|同次 JS 导入图调整的联合净收益；保留反馈订阅、支付运行态、词性缓存、grammarHighlights 的主包唯一实例。webpack 会联合改变提取关系和压缩名，不能把异步块大小冒充每个模块的独立净收益。|
|登录后的 profile-sync 沿原 Promise 流程异步加载|3,520|从 1,775,182 B 到扣除 PNG 后的对应构建反推；账号标记、头像签名逐次读取共享 Preferences，无内存会话副本。|
|Terser UTF-8 输出|75,448|对比改前/后全部主包 JS 文件总和：1,101,057 → 1,025,609 B；没有改变压缩/混淆算法或 ECMA5 目标。API 闸门仅兼容两处说明字符串的等价编码，计数和调用上下文仍限制。|
|主包 PNG 无损重压|16,369|30 张、299,293 → 282,924 B；维持原尺寸、RGBA 每个像素。已有 pngquant 60–85 质量档位没有再降低。|
|lazy CSS 先合入再走路由前缀；ach- 给成就/个人资料两页|4,643|sp- 转到主包 word WXSS 不产生主包总收益；ach- 分别放 content-pages/achievements 和 account/personal-info，保留原规则及嵌套外壳。|
|过滤只有网页 AppNavigation 才渲染的导航 CSS|4,082|AppNavigation.tsx 在本次全部 webpack chunks 中不存在；只去掉 app-mobile-topbar/tabbar、app-landscape-topbar/rail、app-tab 家族，保留小程序实际使用的 app-landscape-main。逗号选择器逐支过滤，有回归测试。|
|合计|**222,184**|1,897,947 → 1,675,763 B，按同一 checkout 基线与最终构建对比。|

六份报告均由最终默认构建生成并保留：webpack-stats.json、package-sizes.json、package-gates.json、css-source-bytes.json、require-async-paths.json、route-css-split.json。额外更新 brand-asset-sizes.json / css-removed.json；30 张 src/assets/brand PNG 是有意保留的重压产物。src/package-assets/** 和 lucide-packages.cjs 最终无 diff，不夹带实验开关副作用。

### 图片重压、构建复现与自查

一次性使用本 worktree `tmp/w1/venv` 的 Pillow + zopfli 对原始构建 PNG 重压（num_iterations=15、filter_strategies=01234mepb，未启用 lossy_transparent / lossy_8bit），每张都用 Pillow 解码比较 RGBA 和尺寸。重压算法比第一组默认滤镜结果多省 187 B；随后从原 PNG 补回逐字节相同的 sRGB/gAMA 色彩标记（30 张合计 870 B），最终净省 16,369 B。全部 RGBA、尺寸和色彩解释标记保持原样。构建不需要安装这些 Python 依赖。

sync-brand-assets.mjs 在删目录前读入现有产物，仅在报告记录的原图 SHA256、输出 SHA256、尺寸、scale、显示尺寸档位、quality 全部匹配时保留已验证的无损文件；任何条件变化均重新执行原有 sips/pngquant 流程。最终构建确实保留 30 张 losslessOptimized；再次比较 src、dist、报告 SHA256 及基线 RGBA 全部通过。因此“手工重压后下一次 build 又覆盖回去”的问题已处理。

三张 scene-team / mood-yay / walk-strip 的并排自查当时做过一张对比图（未入库）：肉眼一致，且所有 30 张的像素证据强于肉眼判据。主包图片均仍在主包，不引用 lazy 私有图片。

### 没做的大头与原因

|大头|最终 B / 状态|保留原因 / 留给主管的方案|
|---|---:|---|
|common.js|717,178|仍含 DB、FSRS、同步、单词调度和缓存；拆同步状态或缓存单例不能只按 size 决定。下一步可拆“只读摘要/事件名”与修改器，但须重新验明所有消费者。|
|assets/brand|282,924|30 张全部有主包使用者；不降低尺寸或再量化，不把主包页面图片搬进 lazy。|
|app.wxss|204,515|主页、单词、语法、我的及全局弹层都实际使用；通用设计/主题/Tailwind 规则不能按文件整份搬走。可另做按完整渲染依赖图的精确剪枝，本次不猜动态类。|
|vendors.js / taro.js / base.wxml|145,636 / 144,763 / 65,814|React/Taro 运行时和原生模板。未换 renderer、未改模板深度、未替换运行时。|
|整份 level-plan 异步化|已回退|把 sync-api 的原 import 边标成 lazy/tabs 会新增 app 入口的异步父图，复制 renderer，并让试验主包涨至 1,837,001 B；API 闸门也拦到额外 scheduler 能力访问。不能为了净移走一个模块接受状态/renderer 副本。|

### 测试与开发者工具

测试和运行证据补录中；此处只列已经实测的项，不用构建/模拟器代替真机验收。

- 最终 build:weapp：退出 0，预算/模块重复/API/字体/异步内容闸门全部通过。
- taro-spike-2 npm test：退出 0（包含新增编码语义与导航 CSS 过滤测试，以及原路由样式回归测试）。
- wechat-miniprogram check-shared：退出 0；共享层和 build-data 已按要求重建，生成内容无源码漂移。
- wechat-miniprogram npm test：32 个脚本全部通过、退出 0。修正版本检查/开发账号脚本到 legal-versions.ts；基线 tokens.wxss 仅源码摘要过期，按既有生成器更新，所有样式声明完全不变。
- frontend check / npm test：退出 0；默认 npm test 166 个文件通过、2 个既有跳过，1,255 项通过、26 项既有跳过。首轮与构建并行时 14 项报 5000 ms 超时；等构建结束单独跑原命令后全过，没有放宽超时或修改断言。
- DevTools：待最终逐页验证与关闭指定项目。


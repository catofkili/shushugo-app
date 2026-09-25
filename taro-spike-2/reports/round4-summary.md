# 路线 A 第四轮实测记录（2026-09-25）

## 范围与基线

- 在独立 worktree `/private/tmp/shushugo-taro-spike-4-r4` 继续，先提交检查点 `ae31527`，再合并最新 `main`（`282b9bf`），冲突时保留 `main` 的网页页面源码，并重套 TimerRing / KanjiPairLines 抽取。第四轮代码不合入 `main`，提交后归档到 `refs/archive/worktree/taro-spike-5`。
- 未打开或刷新 5173，未读取或写入 `.local/live.db`。网页视觉回归跑在 5196；Taro 与原生预览都只生成微信预览版二维码，没有上传体验版/正式版本，没有提审。
- 第三轮“做不到出厂内容跨分包按需加载”的阻塞结论已推翻：第三轮只试了 Taro `import()`，它会编译成同步 `require()`；没有试微信原生的 `require.async`。第四轮产物含微信可识别的字面量 `require.async(...)`，能从 quiz/study 分包异步读独立 `content` 分包。

## 主题根因与修复

微信官方 [WXSS 文档](https://developers.weixin.qq.com/miniprogram/dev/framework/view/wxss.html)列明属性名选择器不生效。源码中 `[data-theme]` / `[data-skin]` 的祖先规则因此不能作为 WXSS 主题入口。实测 Taro App 的 `data-theme="light"` 在 App 外壳上，但它不是目标页面的祖先；WordStudy 页上 `.theme-light` 数量为 0，旧深灰卡仍显示。

`weapp-tailwindcss` 将 `bg-[#464949]` 输出成 `.bg-_h464949_`。`design.css` 手写的 `.bg-\[\#464949\]` 经同一构建处理也成为 `.bg-_h464949_`；类名转义一致，原先不匹配的原因是主题祖先规则和页面根节点没有接上，不是 Tailwind 与手写类的转义不同。

新增构建时 PostCSS 改写：`[data-theme="light"]` → `.theme-light`、`[data-theme="dark"]` → `.theme-dark`、无值 `[data-theme]` → light/dark 两种类；`[data-skin="x"]` → `.skin-x`。实际 Taro 路由的 loading/error/ready 根节点挂 `.theme-light`。最新 `dist/app.wxss` 中 `[data-theme]` 和 `[data-skin]` 选择器计数均为 **0**，`.theme-light` 有 **515** 条、`.skin-theme-paper` 有 **20** 条；`.theme-light .bg-_h464949_` 可查到。开发者工具页上 `.theme-light` 命中 **1** 次，浅色卡片与绿色主按钮已出现。网页 CSS 源文件没有为小程序作迁就修改。

## 被剥离 CSS 审计

`reports/css-removed.json` 有 **100** 条选择器记录。按 PostCSS 解析后与手写源码 selector 精确匹配：`design.css` 命中 **15** 条（其中 **5** 条同时存在于 `styles.css`，故 design 独有 **10** 条）；`skins.css` **9** 条；`app.css` **14** 条；`styles.css` **41** 条（其中 **5** 条与 design 重复）。共 **74** 条有手写源码匹配、**26** 条是 reset/Tailwind 生成规则而无精确源码匹配。

目标页实际用到且看得出间距差别的两条是 VocabTest 的 `space-y-3`（页面源码第 226、368 行）和 `space-y-2.5`（第 403 行）。`taro-spike-2/src/app.css` 分别补为 `.space-y-3 > view + view { margin-top: 12px }`、`.space-y-2\.5 > view + view { margin-top: 10px }`；构建后是 **24rpx**、**20rpx**。其余 **98** 条在本轮六个页面状态截图中未见可辨差异：包括不在这两页使用的其他 `space-y-*`、未触发的 focus/peer/form 规则、滚动条伪元素和当前页面没有的 Yuzu mini 控件；本轮网页 `data-skin` 为 null，皮肤控件规则也未激活。

## SVG 与小程序替代

目标页直接用到的非 Lucide 内联 SVG 有两种：

- 查词汇量倒计时圈：`TimerRing.tsx` 的轨道和进度 **2 个 circle**；小程序由 `TimerRing.weapp.tsx` canvas 绘制。
- WordStudy 的汉字连线题：`KanjiPairLines.tsx` 的尝试/错误/正确连线；小程序由 `KanjiPairLines.weapp.tsx` canvas 绘制。

两者仍保留网页 SVG 实现。前后对照图 `web-component-before-after-375x812.png` 中圆环和连线一致，没有删功能。页面使用的 Lucide 图标由小程序替身输出为静态图标资源；构建器生成 **90** 个 SVG 图标资源。

`TokenDictionaryPopover.weapp.tsx` 保留：网页版 `TokenDictionaryPopover.tsx:148-199` 使用 `createPortal(..., document.body)`，而 `:129-134` 注册 `document` 的 pointer/keyboard listener，这些 DOM API 不能在小程序运行。小程序版改用固定 `View` sheet；两端弹层见六屏对照图第 3 行，奶油底、白卡、绿色操作按钮已对齐。没有 `WordStudyBoundary` 等仅为抓错新增的组件；捕获错误用的临时截图已清理。

## 内容加载、构建与包体

`taro-spike-2/scripts/taro-content.cjs` 保留原生加载顺序：先异步加载模块并写入 `content-store`，再由 `readyForKanji()` 调 `primeWebLoaders()`；`ready()` / `readyForKanji()` 使用 `Promise.all`；加载失败会删除 `loading[name]`，失败 Promise 不缓存。八份出厂内容为 `kanjiUnitRuntime`、`distinctionReviews`、`kanjiReadingUsage`、`kanjiVariants`、`kanjiReadings`、`grammarKeyPoints`、`pitchAccent`、`questionMeanings`。生产构建后的校验为 **16 次 `require.async` 调用、8 个独立目标，8/8 目标存在**；路径均按调用它的产物文件解析。

`lazy-json.js` 的未加载哨兵经核对是 `null`（`content-store.js` 初值），不是 `undefined`。把检查字面改成 `stores[name] === undefined` 会在早期模块初始化时返回 `undefined`，原生 `core-smoke` 随即失败，完整错误为 `TypeError: Cannot read properties of undefined (reading '出')`，栈从 `kanjiCharCard` → `getKanjiCardSession` → `mixedCardCounts` → `runtime/learning.js`。因此保留 null-aware 检查：数据未加载时继续返回代理以保住早期引用；数据加载后缺键返回 `undefined`，避免代理参与字符串转换。更新共享产物后原生 `npm test` **28 个脚本全部通过**。Taro 24 词 fixture 的开发者工具翻面、查词、评分、下一张、撤销均走通，没有再出现 `Cannot convert object to primitive value`。

最新 `npm run build:weapp` 成功；测量脚本按 `dist` 文件原始字节求和（上限 **2,097,152 B**）：

| 包 | 字节 | MiB | 结果 |
|---|---:|---:|---|
| main | 1,479,998 | 1.411 | 通过 |
| quiz | 1,551,835 | 1.480 | 通过 |
| study | 2,025,567 | 1.932 | 通过，余 71,585 B |
| features | 661,707 | 0.631 | 通过 |
| content | 1,619,455 | 1.544 | 通过 |
| 合计 | 7,338,562 | 6.999 | — |

study 的 `sub-common/3ae043a1b5b3006bb1d0724915f10689.js` 在 quiz 和 study 包各 **548,921 B**，两份字节完全相同。拆分办法是用 Webpack `splitChunks.cacheGroups` 将该共用的 `web.js` chunk 统一放进 main；按当前字节测算 main 变成 **2,028,919 B**（余 **68,233 B**），quiz 变 **1,002,914 B**，study 变 **1,476,646 B**。这是未实施的预算方案，须再跑微信构建确认分包引用路径。

34 页面全迁的首阶估算方法：主页代码量先固定为当前 main **1,479,998 B**；从两个已编译页面取 route entry 样本，Vocab **37,464 B**、WordStudy **511,196 B**，均值 **274,330 B/页**。当前 quiz/study 各自扣除页面 entry 后的共同支出为 **1,514,371 B/包**。若 34 页全塞一包，估为 **10,841,591 B**，超过 2 MiB；按每包两页均值，需要约 **17 个页面包**，每包约 **2,063,031 B**，再加当前 content **1,619,455 B**、features **661,707 B**、main **1,479,998 B**，总计约 **38,832,687 B**。若先把重复的 548,921 B 共用 chunk 放进 main，则页面包首阶估为每包 **1,514,110 B**，总计约 **30,049,951 B**。这是依据两页样本外推，不是 34 页实编结果；样本 route entry 相差 **473,732 B**，重页面仍需单独分包或继续拆共享代码。

微信预览 CLI 对最终预览包的独立统计也记录如下，和上述 `dist` 原始文件求和口径不同，不混用：Taro 预览总计 **6,630,296 B**（main 1,329,490；content 1,562,316；features 478,594；quiz 1,451,228；study 1,808,668）；原生预览总计 **3,849,298 B**（main 1,646,222；content 1,570,232；features 632,844）。

## 页面流程与截图

- Taro WordStudy：24 词 fixture；出卡 → 翻面 → 打开安心词典弹层 → 关闭 → 评分「认识」→ 下一张 → 撤销，**7 个状态步骤**完成。模拟器仍输出两条通用 `routeDone` / `{}` console error 和 `getSystemInfoSync` 弃用警告；没有 `EXCEPTION` 事件，也没有目标 TypeError。
- Taro 查词汇量：落地 → 开始 → **15 题**逐题反馈 → 结果页；`EXCEPTIONS []`。
- 网页截图在隔离的 **5196**，视口 **375×812**；页面错误 **0**。六屏左右对照是 `round4-web-weapp-comparison.png`（HTML 版 `round4-web-weapp-comparison.html`）：WordStudy 翻面前/后/词典弹层，查词落地/答题/结果。颜色、主卡背景和主按钮状态已对齐；系统导航栏、网页底部导航和样例词条不同仍可见，所以不是像素级相同截图。
- 最新 main 的 `frontend`：`npm run check` 通过；`npm test` 为 **112 个文件通过、2 个跳过；790 项通过、26 项跳过**。`wechat-miniprogram`：`npm test` **28 个脚本通过**（含 `check-shared`）。

## 六条过关条件

| # | 结果 | 数字与证据 |
|---|---|---|
| 1 | 通过（有平台适配） | `VocabTestPage.tsx` 和 `WordStudy.tsx` 由 Taro 直接 import；页面源码没有为小程序重写。平台差异在 `.weapp.*` 适配文件。 |
| 2 | 当前包体通过；全量估算风险高 | 当前五包均低于 **2,097,152 B**；最大 study **2,025,567 B**。34 页首阶方案约 **17 页面包**、聚合约 **30,049,951 B**（先拆重复 chunk 的假设；估算依据见上）。 |
| 3 | 通过 | 查词汇量 **15/15** 题到结果，`EXCEPTIONS []`；WordStudy **7 个状态步骤**全通。 |
| 4 | 等真机 | Taro 与原生预览二维码均已生成。真机样本目前 **0/20**；请同一台手机分别测 Taro 和原生的两个操作，各 **20 次**：① WordStudy 点「认识」到下一张题面出现；② 查词汇量点任一选项到反馈文案出现。每次记录毫秒数；四组各算中位数和 p90，并记录手机型号、微信版本。 |
| 5 | 部分通过 | 六屏 **6 对**、每侧 375×812。配色/卡片/按钮已对齐；系统壳和底部导航仍不同，示例词条也未统一，所以不报像素一致。 |
| 6 | 通过 | frontend check 通过；**790** 项测试通过、**26** 项跳过；原生小程序 **28/28** 脚本通过。 |

### 扫码操作

- Taro 预览码：`reports/preview-qr-taro.png`。打开 WordStudy 测评分到下一张；打开查词汇量测选项到反馈。
- 原生预览码：`reports/preview-qr-native.png`。在同一台手机重复同样操作。
- 每个操作、每个版本各测 **20 次**；记录 80 个毫秒值（两版本 × 两操作 × 20），计算每组中位数与 p90。真机计时是唯一等待用户扫码的验收项。

# 主包 study 页面 CSS 迁移验收（2026-10-02）

工作目录 `/Users/lsc/Documents/shushugo-wt/mainpkg-css`，分支 `codex/mainpkg-css`。
改前 HEAD 和 main 均为 `5823ade44776b52ad89eb729c0466fe1ccbccd8d`，工作区干净；在这一快照上先执行默认 `npm run build:weapp`。
未提交；保留真实构建报告给 Claude 审查。所有构建、临时依赖和截图均在本 worktree；只操作本项目开发者工具，自动化端口 9651。

## 改动与使用方核查

- `scripts/split-route-css.mjs`：以一组前缀对应多个目标页；`cf-` 同时复制到 confusion、kanji-readings。逗号组合选择器按分支分配，原有跨不同前缀族的选择器继续留在全局。
- 原有按父级逐层克隆的处理保持不变，保留 `@media` / `@supports` 等外壳；目标 `index.wxss` 缺失时自动创建。
- `scripts/split-route-css.test.mjs` + `package.json`：加入 npm test，覆盖双目标、混合选择器、嵌套外壳、原始顺序、全局例外、缺失页面样式文件和 weekly-report/wr 同属一页。
- 根 `.gitignore` 忽略 `/taro-spike-2/reports/mainpkg-css/`；截图、辅助脚本、临时依赖及详细日志保留在本地。
- 保留更新的 `package-gates.json`、`package-sizes.json`、`webpack-stats.json`、`route-css-split.json`。
- `frontend/` 无源码改动，网页 CSS 无改动，业务逻辑无改动，`ach-` 未迁移。

搜索：`rg -n 'cf-|kr-|wl-|quick-' --glob '*.tsx' --glob '*.ts' --glob '*.css'`，包含模板字符串、选择器查询以及 CSS 组合选择器，原始结果在 [prefix-audit.txt](mainpkg-css/prefix-audit.txt)。逐一核查渲染类名和调用方：

| 前缀 | 实际类名使用方 | 目标 |
| --- | --- | --- |
| wl- | WordLibraryPage.tsx；mini-overrides.weapp.css 的 `.wl-sheet` 覆盖 | study/word-list |
| quick- | QuickStudyPanel.tsx（仅 QuickStudyPage 引用）、QuickStudyPage.tsx；useRowSelection 通过传入的 quick-study-row 查询 | study/quick-study |
| cf- | ConfusionPage.tsx、KanjiReadingUsagePage.tsx | study/confusion + study/kanji-readings |
| kr- | KanjiReadingUsagePage.tsx | study/kanji-readings |

`app.css`、`design.css` 的目标规则和深色重映射全部跟随；`styles.css` 的 cf-sheet 提及是注释。
路由、业务和测试里的 quick-study 字符串不是其他页面的 quick- 样式使用方。
`grammar-pages/compile/index.tsx` 导入 ConfusionPage 模块，仅验证加载并输出文字，不渲染该组件。
没有发现表外实际渲染使用方，四个前缀均可迁移。

## 包体

`reports/package-gates.json` 当前结构是 `packages.main.bytes`。

| 项目 | 改前 B | 改后 B | 变化 B |
| --- | ---: | ---: | ---: |
| main | 1,894,988 | 1,858,484 | -36,504 |
| dist/app.wxss | 244,542 | 208,038 | -36,504 |
| study/word-list/index.wxss | 0（不存在） | 14,048 | +14,048 |
| study/quick-study/index.wxss | 0（不存在） | 11,133 | +11,133 |
| study/confusion/index.wxss | 0（不存在） | 8,459 | +8,459 |
| study/kanji-readings/index.wxss | 0（不存在） | 12,032 | +12,032 |

1,900,000 B 闸门余量由 5,012 B 增至 41,516 B；所有包的 gate 通过。
改前报告在 [before-package-gates.json](mainpkg-css/before-package-gates.json)，数字汇总在 [summary.json](mainpkg-css/summary.json)。

## 八组视觉对照

词库显示出厂词条；快速复习首条“安心”答案已展开；疑难辨析打开“振り向く / 振り向ける”；一字多音打开“悪”。
每页浅色和深色均确认根节点 `theme-light` / `theme-dark`。模拟器临时测试会员状态用于打开详情，捕获结束恢复原权益和偏好；未提交答题、领取会员、登录或调用支付。

| 页面 / 主题 | before | after | 结论 |
| --- | --- | --- | --- |
| 词库 / 浅 | [PNG](mainpkg-css/before-word-list-light.png) | [PNG](mainpkg-css/after-word-list-light.png) | 应用内容逐像素一致 |
| 词库 / 深 | [PNG](mainpkg-css/before-word-list-dark.png) | [PNG](mainpkg-css/after-word-list-dark.png) | 应用内容逐像素一致 |
| 快速复习 / 浅 | [PNG](mainpkg-css/before-quick-study-light.png) | [PNG](mainpkg-css/after-quick-study-light.png) | 应用内容逐像素一致 |
| 快速复习 / 深 | [PNG](mainpkg-css/before-quick-study-dark.png) | [PNG](mainpkg-css/after-quick-study-dark.png) | 应用内容逐像素一致 |
| 疑难辨析 / 浅 | [PNG](mainpkg-css/before-confusion-light.png) | [PNG](mainpkg-css/after-confusion-light.png) | 应用内容逐像素一致 |
| 疑难辨析 / 深 | [PNG](mainpkg-css/before-confusion-dark.png) | [PNG](mainpkg-css/after-confusion-dark.png) | 应用内容逐像素一致 |
| 一字多音 / 浅 | [PNG](mainpkg-css/before-kanji-readings-light.png) | [PNG](mainpkg-css/after-kanji-readings-light.png) | 肉眼一致；仅 ≤3/255 的渲染波动，见下 |
| 一字多音 / 深 | [PNG](mainpkg-css/before-kanji-readings-dark.png) | [PNG](mainpkg-css/after-kanji-readings-dark.png) | 应用内容逐像素一致 |

逐张看过 before / after，并生成 [pixel-comparison.json](mainpkg-css/pixel-comparison.json) 与 `diff-*.png`。
比较时仅排除模拟器时钟（x=13..45、y=23..38）和截图最顶两行边缘。
一字多音浅色首张对比有 601 个内容像素差异，最大 RGB 差 3/255；重截后 603 个，最大仍为 3/255，集中在文字抗锯齿和边缘。
用**同一份改前 CSS**再截，仍有 539 个内容像素差异，最大 3/255（[same-baseline-comparison.json](mainpkg-css/same-baseline-comparison.json)），因此是渲染波动而非此次层叠变化。
8 组超出 3/255 的应用内容差异均为 0，没有需要追加的外观修正，也未修改网页 CSS。

另将实际迁移产物与保存的改前 app.wxss 逐规则比对：word-list 125 条、quick-study 90 条、confusion 78 条、kanji-readings 112 条；声明、选择器分组、所有祖先外壳及源顺序完全一致。
输出在 [rule-order-check.log](mainpkg-css/rule-order-check.log)。

## 命令与输出

以下命令均退出 0：

```text
cd taro-spike-2 && npm run build:weapp
  maxBytes: 1900000
  overBudget: []
  unapprovedCoreDuplicateCount: 0
  staleCoreAllowlistCount: 0
  grammarHighlightsPinned: true
  unapprovedPageComponentCount: 0
  stalePageComponentAllowlistCount: 0
  webModuleCount: 0
  passes: true
cd taro-spike-2 && npm run check:release
  16 项检查通过；上传前检查通过（只检查，未上传）
cd taro-spike-2 && npm test
  Route CSS split passed: shared cf- pages, mixed selectors, nested wrappers,
  source order, global exceptions, missing page WXSS.
  既有 smoke checks 全部通过；package gate passes: true
cd frontend && npm run check
  tsc --noEmit（无错误）
cd frontend && npx vitest run
  Test Files 134 passed | 2 skipped (136)
  Tests 954 passed | 26 skipped (980)
```

完整输出：[改前构建](mainpkg-css/before-build.log)、[改后构建](mainpkg-css/after-build.log)、[发布检查](mainpkg-css/check-release.log)、[小程序测试](mainpkg-css/taro-test.log)、[网页类型检查](mainpkg-css/frontend-check.log)、[网页测试](mainpkg-css/frontend-vitest.log)。

指定脚本：在本 worktree 内临时安装了 miniprogram-automator 的目录执行：

```text
AUTO_PORT=9651 node /Users/lsc/Documents/shushugo/tmp/devtools-route-sweep.cjs
26 OK / 0 BAD / 0 ERR / 0 FAILED
```

完整逐路由输出在 [route-sweep.log](mainpkg-css/route-sweep.log)。

## 验收范围与未完成项

指定脚本只有 26 个路由，而当前 app.json 登记 37 个。因此另外补扫 11 个，包含账号、个人资料、周报和分包占位页。
占位页按照源码本来的空 View / null 判断，不把有意的空白当成回归；补扫 11 页导航均成功。
**完整 37 路由“0 ERR”未达成**：脚本漏掉的周报页存在 `TypeError: e.getContext is not a function`。
诊断时恢复保存的改前 app.wxss、暂时移走四个新页面 wxss，只在本项目开发者工具重新运行；改前状态同样复现周报错误。
诊断结束已恢复改后生成 CSS；[baseline-proof.log](mainpkg-css/baseline-proof.log)、[baseline-weekly-errors.json](mainpkg-css/baseline-weekly-errors.json) 保存基线证据。
这属于现有 Canvas 平台逻辑问题，按本次“不改业务逻辑”的明确限制未修复。不能将指定 26 页脚本通过写成全部 37 页零错误。

没有提交、合并、上传或发布；没有打开 / 刷新 5173，没有改主目录源码或其他系统设置、关闭 IDE 或别人的项目窗口。

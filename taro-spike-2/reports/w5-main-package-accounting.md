# W5 主包体积核算与 common.js 依赖链

构建目录：`taro-spike-2/dist`。本报告按合并 `taro/main` 后的 Webpack 产物统计；文件大小使用字节。Webpack 模块列的 `size` 是模块源码统计值，分组项含其子模块，不能直接相加当作压缩后的 `common.js` 字节数。实际 `common.js` 产物为 1,249,403 B。

## 体积变化

| 项目 | 合并前/拆分前 | 当前/拆分后 | 差值与结果 |
| --- | ---: | ---: | --- |
| 主包总量（检查点报告 → 合并后构建） | 2,629,850 | 2,628,665 | −1,185；仍比 1,900,000 B 闸门高 728,665 B，比微信 2,097,152 B 硬上限高 531,513 B |
| `common.js` | 1,251,202 | 1,249,403 | −1,799 |
| `assets/sql-wasm.wasm.br` | 278,641 | 278,641 | 未挪包；开发者工具试验报错 `TypeError: wx.loadSubpackage is not a function`，已回滚；真机未测 |
| `app.wxss`（路由 CSS 后处理前 → 后） | 300,464 | 268,798 | −31,666；规则源码共移出 31,871 B，差额来自空媒体规则清理 |
| 主包 `assets/brand`（W5 前基线 → 当前） | 169,278 | 273,058 | +103,780 |
| 主包 `assets/tabs` | 40,227 | 40,227 | 不变，原生 tabBar 图标保留 |
| 主包 `assets/lucide`（W5 前基线 → 当前） | 42,140 | 46,728 | +4,588；按构建路由引用生成，Send 图标现位于 study 分包 |
| `vendors.js` + `taro.js` | 285,591 | 285,626 | +35；当前分别为 146,010 B、139,616 B；检查点分别为 146,010 B、139,581 B |
| `base.wxml` | 64,682 | 65,237 | +555 |

主包检查点行使用已提交检查点中的 `reports/package-sizes.json`，其报告值为 2,629,850 B；检查点提交说明按任务原文保留了 `2,627,744 B`。后续构建实测当前值为 2,628,665 B。这里保留两份原始证据，不把提交说明里的数字当作构建报告值。

路由 CSS 本次迁移：`content-pages/weekly-report/index.wxss` 719 B、`content-pages/yuzu-shop/index.wxss` 16,646 B、`study/team/index.wxss` 11,231 B、`study/vocab-test/index.wxss` 3,275 B。四项合计 31,871 B。

当前子包体积（均低于 1,900,000 B）：study 219,606 B；account 196,016 B；content-pages 476,320 B；features 661,707 B；content 1,619,455 B；grammar-foundation 668,450 B；grammar-advanced 547,378 B；grammar-pages 124,919 B。总体 7,142,516 B。`reports/package-gates.json` 记录：重复核心模块 0、重复页面组件 89,902 B（限额 100,000 B）、禁止的 `shared/web.js` 0；唯一超限包是 main。

## `common.js` 最大 30 个模块

“入口链”来自 Webpack `issuerPath`。只有标为“主包页”的链能证明由四个 tab 主包页引入；account/study/grammar-pages 等链明确属于其他页面。多个大模块目前落在主包 `common.js` 中，但统计没有证明它们被主包 tab 引用；交 Claude 判断是否属于公共 chunk 放置问题。模块源码统计值不等同于其压缩后在 `common.js` 中的独立字节数。

| # | 模块（Webpack 名称） | 模块源码 B | 页面入口与依赖链 |
| ---: | --- | ---: | --- |
| 1 | `frontend/src/lib/sync-api.ts + 3 modules` | 160,513 | account/login → sync-api |
| 2 | `frontend/src/lib/word-api.ts + 9 modules` | 142,434 | **主包·单词** → WeappPage → api.ts |
| 3 | `wechat-miniprogram/src/vendor/sql-wasm.js` | 91,182 | account/login → sync-api → database.ts → sql-js.weapp.cjs |
| 4 | `frontend/src/components/JapaneseRuby.tsx + 6 modules` | 87,165 | grammar-pages/compile → Library.tsx |
| 5 | `frontend/src/features/word-study/WordStudyPanels.tsx + 6 modules` | 85,028 | **主包·单词** → routes/word.tsx → WordStudy.tsx |
| 6 | `frontend/src/lib/storage.ts + 1 modules` | 83,837 | account/login → sync-api |
| 7 | `frontend/src/lib/study-core.ts + 2 modules` | 79,311 | account/login → sync-api |
| 8 | `taro-spike-2/src/platform/WeappPage.tsx + 8 modules` | 57,842 | **主包·单词** → WeappPage |
| 9 | `frontend/src/lib/vocab-test.ts` | 49,967 | study/vocab-test → VocabTestPage.tsx |
| 10 | `frontend/src/lib/confusion-groups.ts + 1 modules` | 41,262 | grammar-pages/compile → ConfusionPage.tsx |
| 11 | `frontend/src/data/verb_transitivity.json` | 37,782 | **主包·单词** → WordStudy → WordStudyPanels → transitivity.ts |
| 12 | `wechat-miniprogram/src/data/verb_pair_hints.js` | 36,002 | grammar-pages/compile → ConfusionPage → confusion-groups.ts → shim |
| 13 | `frontend/src/lib/grammar-title-furigana.ts + 1 modules` | 33,342 | grammar-pages/compile → Library.tsx |
| 14 | `frontend/src/lib/analytics/weekly.ts` | 32,850 | **主包·主页** → routes/home.tsx → ZooHome → weekly-reports.ts |
| 15 | `frontend/src/pages/Library.tsx` | 32,671 | grammar-pages/compile → Library.tsx |
| 16 | `frontend/src/lib/grammar-quiz.ts + 1 modules` | 31,488 | **主包·单词** → routes/word.tsx → WordStudy.tsx |
| 17 | `frontend/src/components/GrammarHighlightProvider.tsx + 1 modules` | 29,498 | **主包·语法** → routes/grammar.tsx |
| 18 | `frontend/src/lib/kanji-unit-scheduler.ts` | 28,265 | account/login → sync-api → sync/merge.ts |
| 19 | `frontend/src/lib/word-list-import.ts` | 27,977 | account/settings → routes/settings.tsx → SettingsPage.tsx |
| 20 | `frontend/src/lib/fsrs-store.ts` | 27,430 | account/login → sync-api → sync/merge.ts |
| 21 | `frontend/src/lib/achievements/index.ts + 2 modules` | 27,177 | **主包·单词** → WeappPage → userProfile.ts |
| 22 | `frontend/src/lib/analytics/stats.ts + 1 modules` | 23,079 | **主包·单词** → WeappPage → api.ts → word-api.ts |
| 23 | `frontend/src/lib/level-plan.ts` | 22,643 | **主包·单词** → WeappPage |
| 24 | `frontend/src/components/AuthDialog.weapp.tsx` | 21,190 | account/login |
| 25 | `frontend/src/lib/word-api/stage1.ts` | 20,829 | **主包·单词** → WeappPage → yuzu.ts |
| 26 | `frontend/src/lib/word-library.ts` | 20,233 | study/word-list → WordLibraryPage.tsx |
| 27 | `frontend/src/components/GrammarTermHint.tsx + 1 modules` | 19,801 | grammar-pages/compile → Library.tsx |
| 28 | `frontend/src/lib/models/word-card.ts + 1 modules` | 19,585 | **主包·单词** → WeappPage → api.ts → word-api.ts |
| 29 | `frontend/src/lib/sync/schema.ts` | 18,848 | account/login → sync-api.ts |
| 30 | `frontend/src/components/LevelSetup.tsx` | 18,692 | **主包·单词** → WeappPage → AppShell.tsx |

## 尚未通过的闸门

- 合并后构建的 Taro 编译、内容构建、字体与 WXSS 检查通过；`verify-weapp-apis.mjs` 在 package gate 前失败。该 W6 API 检查器的路径/次数 allowlist 与 W5 路由切分后的产物形状不匹配，且列出若干新分包 API 引用；需 Claude 判断如何处理，未放宽 allowlist。
- `wechat-miniprogram` 的 `npm test` 在 `check-parity` 失败，报告 W6 前端界面改动尚无对应小程序页面映射/实现；没有添加 parity exemption。
- `npm run check:release` 与 release smoke 检查通过。
- 开发者工具验证来自合并前 W5 构建：本地数据库可读，单词卡可显示；有 `tmpl_0_summary` WXML 警告。合并后只确认编译输出，没有新的完整模拟器验收；iPhone 真机验收未做。

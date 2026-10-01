# 开口练习：微信开发者工具预览验收（2026-10-01）

工作目录 `/Users/lsc/Documents/shushugo-wt/talk-weapp`，分支 `codex/talk-weapp`。
只修改本 worktree；未提交、未合并、未上传、未提审。没有打开或刷新 5173，没有改主目录源码或系统设置，没有关闭其它项目窗口。

## ① 文件与发布影响

| 文件 | 改动 |
| --- | --- |
| `frontend/src/pages/TalkPage.tsx` | 图鉴复用现有 ScrollArea；小程序跳过浏览器焦点/锁滚动；无音频时提示台词只出现一次 |
| `frontend/src/pages/talk.css` | 遮罩使用等值 RGBA；原生 ScrollView 的高度和内容内边距 |
| `taro-spike-2/src/study/talk/index.tsx` | 整理现有一行入口，显式 React import、单引号、import 后空行，消除该入口的三条 Doctor lint 错误 |
| `wechat-miniprogram/parity-map.json` | 登记两个开口练习共享源码与 Taro 的对应关系 |
| `.gitignore` | 忽略 `/taro-spike-2/reports/talk-weapp/` 的截图、运行日志和本地 HTML |
| 本报告 | 验收依据与未解决边界 |

**没有改 `frontend/src/components/*`，也没有改任何开口练习以外的业务逻辑。** ScrollArea、touch-adapter、JapaneseRubyText、CrossPlatformImage、portal-host 均复用现有实现。
配对表的 `mini` 包含同一个源码路径，原因是路线 A 的小程序直接编译这份源码；没有第二份页面/样式需要手工同步，也没有使用 `Parity-Exempt` 或修改检查脚本。

网页常规有音频时的题面、提示、评分均保持原样；网页同样遇到无音频时也会避免重复台词。
提示次数、FSRS、撤销、每日五张、加餐、图鉴收集判据均未改。实验页仍被编译期开关隔离，默认值未改；无开关发布检查实际通过。

## ② 发现与修复

| 现象 / 证据 | 原因 | 改法 |
| --- | --- | --- |
| 原始完整构建失败：`Unsupported Taro document.activeElement in study/talk/index.js` | 图鉴直接读取 DOM 焦点；小程序不提供该成员 | 使用已有 `getActiveElement`，小程序通过 `touchEventsEnabled()` 跳过整个 DOM 焦点/锁滚动 effect；网页继续保留 Tab、Escape、焦点返回；focus 调用可选链到底 |
| 图鉴源样式是 `overflow-y:auto`；旧区域不是原生可滚动节点（`node:false`）；内滚动检查会拒绝 | 普通 HTML section 在 Taro 下是 view，不能把浏览器滚动能力当作原生 ScrollView | 换为现有 ScrollArea，原生区固定 80vh，内边距放内容层，catchMove；实测 `node:true`，能滚到 S13–S15 再回顶部关闭 |
| 实验 WXSS 仍残留 `color-mix(...)` | 微信 WXSS 不保证该语法可用；IDE 的 Chromium 恰能显示，不能据此证明真机支持 | 浅色 `rgba(43,36,28,.35)`，深色 `rgba(242,239,232,.35)`；等于现有两种 `--ds-ink` 的 35% 透明混合；不改网页颜色 |
| 小程序接话卡第一次提示显示两遍对方台词，页面被重复段落拉长 | 无音频退路先显示 partner；第一条 hint 又含同一句日文和中文 | 未用提示时仍直接显示 partner；用了提示后由已有提示区域显示同一句；翻面仍显示对方和我；不改提示计数和评分 |
| `wechat-miniprogram npm test` 在 check-parity 停止，包括最近提交 `fa1b1f51` | 新实验页及其 CSS 没登记在配对表 | 只补开口练习的同源 Taro 映射，重新跑全套 31 个脚本通过 |
| Doctor 报 talk 入口三条 lint 错误 | 与旧一行入口写法相同：双引号、缺 import 空行、经典 React JSX lint 要求 React 在作用域 | 仅整理 talk 入口；其它页面的存量诊断不越界修 |

`createPortal(..., document.body)` 保留：现有 `react-dom.weapp.ts` 已将 portal 挂到当前页面的带主题外壳。
实测图鉴浅深色均可打开、滚动和关闭，未另造 portal 或焦点垫片。
`JapaneseRubyText.weapp.tsx` 已由构建替换，实测「箸」「弁当」「温」「願」「伺」等注音显示；未修改共享注音组件。
场景路径由已有 `image-src.weapp.ts` 映射到 `/study/talk/scenes/Sxx.jpg`；欢迎和完成插画位于 `/study/talk/art/`，两张均显示。

## ③ 实际流程与截图

网页使用本 worktree 的 `http://localhost:5221`，375×812；微信 CLI 复用 IDE，自动化端口固定 9631，没有传 `--port`。
切页使用 `mp.evaluate(() => wx.navigateTo(...))`。不使用已知超时的 `mp.reLaunch` / `page.$`。
按钮通过页面数据中的实际 Taro sid 调用 `eh`，按祖先链派发冒泡事件；这是运行真实 React handler 和数据库记账，没有设置假的 UI 结果。
滚动使用开发者工具中实际 enhanced ScrollView 的原生 `node.scrollTo`；页面文字来自 `getCurrentPages().pop().data.root`。
截图由开发者工具 `mp.screenshot` 与独立 Chromium / Playwright 生成，并实际查看。

完整并排图和三联对照：[`report.html`](../taro-spike-2/reports/talk-weapp/report.html)。
截图索引：[`screenshot-index.json`](../taro-spike-2/reports/talk-weapp/screenshot-index.json)。
逐步状态：[`flow.json`](../taro-spike-2/reports/talk-weapp/flow.json)。
全部位于 `taro-spike-2/reports/talk-weapp/`，已 gitignore，**不要提交截图或日志**。
自动化辅助脚本/依赖位于忽略的 `tmp/talk-*`；没有修改软链接指向的依赖目录。

| 流程 | 截图前缀 | 结果 |
| --- | --- | --- |
| 主页学习工具入口 → 欢迎 → 开始 | `00-entry`、`01-welcome`、`02-formula` | 入口可进入，欢迎插画正常，开始显示题面与场景图 |
| 公式提示累加 → 翻面 → 没说对 → 上一张 | `03-hint-one`、`04-hints-two`、`05-formula-answer`、`06-gave-up`、`10-undo` | 提示点数 1→2，注音/答案显示；撤销回到原题及原替换词，提示重置 |
| 接话 → 提示 → 翻面 → 下一张 → 撤销 | `11-reply`～`15-reply-undo` | 小程序直接显示对方原文，提示不重复，答案/提醒正常，撤销回原接话卡 |
| 图鉴打开 → 滚到底 → 回顶部关闭 | `07-collection`～`09-collection-closed` | 15 场景可查看；返回原卡，无空白、遮挡或图片缺失 |
| 首轮完成 → 新收集横卡 → 图鉴 | `16-done`、`17-collected-scene` | 5/5，图鉴 1/15；完成插画、便利店横卡正常 |
| 再练五张 → 做完第二轮 | `18-extra-round`、`19-extra-done` | 5/10 → 10/10，图鉴 2/15；两张新场景横卡正常 |
| 深色完成/图鉴/真实接话/翻面/公式 | `20-dark-done`、`21-dark-collection`、`22-dark-reply`、`23-dark-answer`、`25-dark-formula`、`26-dark-formula-answer` | 内容、图像、注音和遮罩显示正常；撤销验证后再次完成至 10/10 |
| 最终实验构建重新进入 | `28-final-build-resume` | 10/10、图鉴 2/15 恢复；不再出现首次欢迎，新收集横卡不重复庆祝 |

每组有 `*-web.png` / `*-mini.png`；报告包含 28 组并排图、3 组「网页 / 修改前小程序 / 修改后小程序」。
原始小程序 PNG 为 466×1008（IDE 显示缩放）；`wx.getWindowInfo()` 的逻辑 screen 为 375×812，window 为 375×639。没有裁剪或篡改截图，HTML 仅等比例展示。

控制台：最初两轮流程及第一次浅深色检查没有小程序 error / warning / exception。补拍真正的深色接话时额外记录了 **1 条异常**，已保存在 [`console-mini.json`](../taro-spike-2/reports/talk-weapp/console-mini.json) 与最后追加的 flow 状态中：`Cannot destructure property 'data' of 'r' as it is undefined.`
堆栈全部位于微信 `WAServiceMainContext.js?v=2.32.3` 的 `operateWXData success callback` 和 `ide:///extensions/appservice/index.js`，没有仓库文件；仓库开口练习和平台代码也没有直接调用 operateWXData。它未导致空白、卡住、记账失败，补拍后仍完成 10/10。**触发 API 尚未定位，不把堆栈来源推断写成已修复。** 无开关构建已使该临时 SDK 服务端口失效，无法从栈内 URL 继续读取源码；没有为此更改共享 IDE / 基础库设置。
网页未出现 JS 异常；首次初始化留下两条 HTTP 404（当时未记录 URL），后续流程没有新增；[`web-network-probe.json`](../taro-spike-2/reports/talk-weapp/web-network-probe.json) 二次完整页面请求检查为 `[]`。不把无法定位的瞬时 404 写成已修复。
网页焦点回归：[`web-focus.json`](../taro-spike-2/reports/talk-weapp/web-focus.json) 证实打开后聚焦「关闭」、Tab 留在「关闭」、Escape 关闭后回到图鉴入口且 body overflow 恢复。

仍不一致：

- 用户已明确的实验限制：小程序没有音频，直接显示对方台词，且没有「再听一遍」；网页有音频，因此该按钮及相关高度不同。
- 小程序使用原生导航栏和安全区，分包页没有网页底栏；深色内容区上方仍是浅色原生栏（现有 `src/app.config.js` 固定 `#FBF6EC`），图鉴的可视起点也因此不同。本任务未改全局外壳。
- 注音实现为现有原生 View/Text，细小字距、换行与浏览器 ruby 有差别；未发现消失、覆盖正文或不可读。
- 两端独立随机选替换词，因此少数同状态截图题目词不同；这不是另写了一份内容或规则。

## ④ 验收命令与输出

四组原样运行，退出码均为 0。完整原始输出保存在对应日志；下面是关键输出，非凭静态源码推断。

```text
cd taro-spike-2 && SHUSHUGO_EXP_TALK=1 npm run build:weapp && (node scripts/check-release.mjs; test $? -ne 0)
Compiled successfully
WeChat API gate passed: 30 unguarded matches across 174 JavaScript files.
Taro object member gate passed: 357 accesses across 174 JavaScript files.
maxBytes: 1900000, overBudget: [], passes: true
main: 1895053 B; study: 1846282 B
❌ 没有实验功能的页面（开口练习）：app.json
❌ 没有实验功能的代码（开口练习）：study/talk/index.js
上传前检查没过（2 项），别上传。
→ 发布检查按预期非零，反向断言通过。

cd taro-spike-2 && npm run build:weapp && npm run check:release && npm test
Compiled successfully
WeChat API gate passed: 30 unguarded matches across 172 JavaScript files.
Taro object member gate passed: 349 accesses across 172 JavaScript files.
上传前检查通过
Inner-scroll gate passed; 5 documented exceptions remain.
require.async 路径校验通过：14 次调用，14 个独立目标；12 个目标模块均存在。
Study activity / mascot / html text / textarea / Blob-FileReader / cloud fetch / release smoke passed
maxBytes: 1900000, overBudget: [], passes: true
main: 1894988 B; study: 308840 B

cd frontend && npm run check && npm run lint && npx vitest run src/lib/talk
tsc --noEmit: 通过
eslint: 45 problems (0 errors, 45 warnings)
Test Files 6 passed (6)
Tests 61 passed (61)

cd wechat-miniprogram && npm test
网页/小程序改动配对检查通过
✅ 31 个脚本全部通过
```

日志：[`accept-experimental.log`](../taro-spike-2/reports/talk-weapp/accept-experimental.log)、[`accept-release.log`](../taro-spike-2/reports/talk-weapp/accept-release.log)、[`frontend-validation.log`](../taro-spike-2/reports/talk-weapp/frontend-validation.log)、[`native-mini-tests-final.log`](../taro-spike-2/reports/talk-weapp/native-mini-tests-final.log)。

补跑 `npx taro doctor`：Node、config、全部 Taro 4.2.1 版本匹配检查通过。预置依赖缺 Doctor 所需 eslint-config-taro / 可选插件；只在 `tmp/talk-tools` 安装诊断依赖，使用 `NODE_PATH` 后完整检查到 lint。
结果 `224 problems (221 errors, 3 warnings)`，均在其它现有入口/平台文件；talk 入口三条已消除。**Doctor 返回 0 也不代表这些 lint 错误消失**，报告保留原始诊断：[`taro-doctor-final.log`](../taro-spike-2/reports/talk-weapp/taro-doctor-final.log)。
Webpack 仍给大资源的建议性 size warning，实际包体硬闸门通过；未关闭 Doctor、API、包体或发布检查。

收尾：最终 `dist/` 为无实验开关构建，app.json 无 talk 页，study/talk 目录与指纹均不存在。
运行 `git checkout -- taro-spike-2/reports` 恢复所有已跟踪发布构建报告；本次截图和日志属于忽略的新目录，保留在本机。

## ⑤ 未完成与边界

- 指定流程和四组验收均完成。没有生成预览二维码（本任务要求的是开发者工具流程；未执行任何上传或发布动作），没有真机扫码验收。
- Doctor 的其它文件 221 条存量 lint 错误未修：用户明确禁止改开口练习以外的逻辑，不为了清空全仓诊断扩展修改。
- 原生深色导航栏与网页的差异尚在：它属于共用 app 外壳配置，已截图列明，未擅自改全局导航或其它页面。
- 桌面原生 UI 读取工具连接超时；这里的交互证据是微信开发者工具自动化事件链和原生滚动节点，不声称做过真人鼠标点击或手机验收。
- 首次网页初始化两条 HTTP 404 未定位；复查网络和后续流程未重现，原始日志保留。
- 补拍时微信基础库 `operateWXData` 的 1 条内部异常未定位；未中断流程，但不能称全部运行日志零异常。

请 Claude 审阅本报告和未提交 diff 后按自己的流程提交；本任务没有 commit。

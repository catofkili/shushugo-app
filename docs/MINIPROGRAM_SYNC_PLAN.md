# 小程序跟着网页走：开发计划（2026-09-25）

> 写给之后接手的所有 AI（Claude / Codex / 任何人）。**动任何用户能看见的页面之前先读完这份。**
> 背景复盘见 CLAUDE.md「2026-09-25 复盘：小程序「对齐网页」耗了二十来个小时」。

## 用户要的是什么

用户原话：「我只希望我对着网页端提出要求，小程序能尽可能同步，而不是以后要改个什么都要开三个对话：
两个讲小程序和网页分别怎么改，一个还要监督有没有改得一模一样。」

翻译成验收标准：

1. **用户只描述网页上的改动**。一次对话、一个提交里，网页和小程序一起改完。
2. **「两端一样」由机器检查，不由用户检查。** 不能再出现用户自己截图对比、再开一个对话去查的情况。
3. 例外只有 CLAUDE.md 里那条最高优先级规则允许的：微信支付流程、少数有官方依据的平台适配，其余差异要用户点头。

## 现在卡在哪

| 层 | 两端是不是一份 | 说明 |
|---|---|---|
| 业务逻辑（FSRS、计划、同步、成绩、权益） | ✅ 一份 | `frontend/src/lib` 经 `wechat-miniprogram/scripts/build-shared.mjs` 打成 `src/shared/web.js`，`npm run check-shared` 钉着 |
| iOS / Android App | ✅ 一份 | Capacitor 直接用网页构建产物，天然同步 |
| **页面（结构、样式、交互）** | ❌ 两份 | 网页是 React + Tailwind + `design.css`，小程序是手写 WXML/WXSS。**所有「不一样」都出在这一层** |

所以要解决的只有页面这一层。三条路，按推荐顺序：

## 路线 A（首选，先花 1–2 天验证）：同一份 TSX 编译成小程序

用 [Taro](https://docs.taro.zone/docs/) 的 React 运行时 + [`@tarojs/plugin-html`](https://docs.taro.zone/docs/use-h5)：
网页现有的 `div / span / img` 组件可以直接在小程序里跑，**页面源码只有一份**，改网页就是改小程序。
小程序专用的部分用 Taro 的平台文件后缀（`Xxx.weapp.tsx` 覆盖 `Xxx.tsx`），支付、`wx.login` 这些薄适配放在那里，
数据层继续用现在的 `frontend/src/lib`。

已知障碍（2026-09-25 查的）：

| 障碍 | 实情 | 怎么处理 |
|---|---|---|
| Taro 4 的 React 渲染器只支持 React 18，网页是 React 19 | grep 过，网页**没用** `use()` / `useActionState` / `useOptimistic` / `useFormStatus` 这些 19 独有的 API | 网页退回 React 18。iOS 包同步退，属于同一份构建 |
| `span` 在 plugin-html 里映射成 `View`，默认块级 | 官方文档写明 | 给 `span` 补 `display:inline` 基础样式 |
| 13 个文件用了 `createPortal`，28 个文件碰 `document.* / getBoundingClientRect / <canvas>` | 小程序没有 DOM，尺寸查询是异步的 | 包一层 `lib/platform/*`（弹层、量尺寸、画布），网页实现照旧，`.weapp.ts` 给小程序实现。**这是路线 A 的主要工作量** |
| Tailwind 任意值类名（`bg-[#464949]`）、`:has()`（`app.css` / `styles.css` 在用）、挂在 `html` 上的 `[data-theme]` / `[data-skin]` | WXSS 不认这些 | Tailwind 走 `weapp-tailwindcss` 一类的转义插件；`:has()` 改写；主题属性改挂页面根节点 |
| 主包 2 MiB | 现在主包约 1.97 MiB，`web.js` 634 KB | Taro 运行时 + React 要进主包，**这是最可能不过的一关**，spike 第一件事就量它。页面尽量进分包 |
| sql.js | 小程序已经在用 `WXWebAssembly` 跑 sql.js（`src/runtime/sqlite.js`） | 沿用，不动 |

### Spike 怎么做、什么算过

在独立 worktree（`claude/taro-spike` 或 `codex/taro-spike`）里做，**不碰 5173 所在的主目录**：

1. 建一个 Taro 4 + React 18 + plugin-html 的小程序壳，数据层 require 现有 `frontend/src/lib`。
2. 选**一个真页面**直接编译进去，不许改写：建议 `VocabTestPage`（有答题、倒计时、结果、分享），
   或组队页（网页和小程序都有，方便对比）。
3. 在微信开发者工具里打开，和 5173 手机宽度（375×812）截图对比。

**过关条件，四条都要满足：**

- 同一个 `.tsx` 文件同时是网页和小程序的源码，小程序侧只多了 `.weapp.*` 适配文件；
- 主包 ≤ 2 MiB（含 Taro 运行时、React、`web.js`），并估出全部页面迁完后的主包 / 分包体积；
- 答题点击到换卡的延迟在真机上不比现有原生版明显慢（量一下，写数字）；
- 截图和网页肉眼看是同一个页面。

过了就按页迁移，原生 WXML 页面迁完一页删一页。**没过就写清楚卡在哪一条、有什么数字，走路线 B**，不要硬撑。

## 路线 B（A 不过时）：保留原生小程序，但把「同步」变成机械活 + 机器检查

页面还是两份，但做三件事，让「一个对话改完两端」成立：

1. **能自动生成的都自动生成，不许手抄**
   - 颜色、圆角、字号这些设计变量：构建脚本从 `frontend/src/design.css` 的 `:root` / 主题段落生成
     `wechat-miniprogram/src/styles/tokens.wxss`，小程序页面只引用变量。改网页配色 = 改小程序配色。
   - 贴纸、图标：构建脚本从 `frontend/public/brand/` 压缩拷贝到小程序（参考 parity 分支 `3480ac0` 里的 `src/assets/home/*.webp`）。
   - 业务逻辑：已经是 `web.js`，保持。

2. **页面对照表 + 提交闸门**
   - `wechat-miniprogram/parity-map.json`：网页文件 → 小程序页面文件（如 `frontend/src/pages/VocabTestPage.tsx` →
     `wechat-miniprogram/src/features/vocab-test/index.{wxml,wxss,js}`）。
   - `scripts/check-parity.mjs`（进 `npm test` 和 CI）：一个提交里改了对照表左边的文件、右边一个没动，就失败；
     除非提交信息里写了 `Parity-Exempt: <原因>`，而原因必须是用户在对话里批准过的。
   - 这一条的意义是：**AI 不可能「只改了网页就说做完了」**。

3. **截图对比代替人工监督**
   - `scripts/parity-screenshots.mjs`：用同一份种子库，Playwright 按 375×812 截网页，
     `miniprogram-automator` 截开发者工具里的同一页，拼成左右对照的 HTML 报告。
   - AI 改完必须自己看这份报告，把它附在回复里，再说完成。

移植方法照 CLAUDE.md 那节复盘：**搬网页渲染出来的 DOM 和编译后的 CSS**
（`div→view`、`span/p→text`、`img→image`、`className→class`、`{cond && …}→wx:if`、`.map→wx:for`、`onClick→bindtap`，
状态放进 `setData`，数据调 `web.js`），**不许读完 React 源码「按意思重写」**。

## 路线 C（不推荐）：`<web-view>` 直接嵌网页

看起来最省事，但：需要业务域名（ICP 备案、校验文件），个人主体不能用；虚拟支付不能在 web-view 里直接拉起，
要跳回原生页；web-view 里的 IndexedDB 和小程序本地库是两份数据；整站套壳有被审核按「功能过于简单 / 套壳」驳回的风险。
只有 A、B 都走不通时再考虑，而且要先核实主体类型和域名备案。

## 以后任何 AI 接到「改一下 X」时的流程（A、B 都适用）

1. 用户说的是网页上的样子 → 默认两端都改，**同一个对话、同一个提交**。不要问「小程序要不要一起改」。
2. 在 worktree 里做（主目录跑着用户的 5173 学习页，不能热更新），做完当场合回 `main`、删 worktree。
3. 跑 `wechat-miniprogram` 的 `npm test`（含 `check-shared`，B 路线还有 `check-parity`）和网页相关测试。
4. 附上两端截图对照（B 路线用报告，A 路线直接截两边）。
5. 只有微信确实做不到时才停下来问，按 CLAUDE.md 最高优先级规则的格式列差异。

## 禁止事项（每一条都是 2026-09-22 ～ 09-24 真实浪费过的）

- ❌ 读完网页源码后「按自己理解」重写小程序页面（8-24 第一版、9-22、9-24 三次都是这样，三次都不像）。
- ❌ 每页新写一个断言 WXML 绑定名的 smoke 脚本——版式一换全废，还要维护。
- ❌ 用户说改 A，顺手扩到 B、C、D 页（9-24 那次从 4 张截图扩到个人资料 / 帮助 / 关于 / 隐私）。
- ❌ 在隔离目录做完不提交、不合回（9-22 的 `miniprogram-ui-merge`、9-24 已部署却没提交的付费代码）。
- ❌ 报完成时只说「测试全绿」。测试绿只证明逻辑没坏，不证明长得一样。

## 下一步

等用户批准路线 A 的 spike。批准后由**一个**会话在 worktree 里做完 spike，把四条过关条件的结果（带数字和截图）写回本文件末尾，
再由用户决定走 A 还是 B。

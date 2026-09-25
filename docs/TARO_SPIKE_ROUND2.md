# 路线 A 第二轮试验：同一份 TSX 编译成小程序（2026-09-25 定，交给 Codex 执行）

> 背景：`docs/MINIPROGRAM_SYNC_PLAN.md`。第一轮（`codex/taro-spike`，代码已删）判定路线 A 不通过，
> 但复查发现结论下早了，见下面「为什么要再试一次」。**本轮只回答一个问题：路线 A 到底能不能走。**
> 做完把结果写回 `MINIPROGRAM_SYNC_PLAN.md` 末尾，由用户决定 A 还是 B。

## 为什么要再试一次

第一轮三条失败，两条是没做该做的准备，不是 Taro 本身的问题：

| 第一轮的现象 | 真正原因 | 本轮怎么处理 |
|---|---|---|
| 单页 20.48 MiB，超主包 11 倍 | `VocabTestPage → lib/vocab-test → lib/study-core` 里有 `import("../data/jlpt_words_seed.json")`，**这一份就 11 MB**（网页 `dist/assets/jlpt_words_seed-*.js` 实测 11,235,989 字节），网页是按需加载的 chunk，Taro 把它并进了页面。原生小程序早就用 `build-shared.mjs` 的 `SHIMS` 表把它换成 `seed-guard.js` 了 | 复用同一张 `SHIMS` 表 |
| WXSS 编译错误、页面空白 | 一个不支持的选择器 `::highlight(grammar-highlight)` | 编译期剥掉不支持的规则，列出剥了哪些 |
| `Right-hand side of 'instanceof' is not an object` | 没定位 | 定位到具体哪一行、`instanceof` 的是哪个浏览器全局 |

真正难的几样第一轮一样都没测到：弹层（`createPortal`）、`document` / 量尺寸 / `<canvas>`、真机速度。本轮要测到它们。

## 硬规则（违反任何一条，本轮作废）

1. **在新的 worktree 里做**，从最新 `main` 起，分支名 `codex/taro-spike-2`。**不许碰 `~/Documents/shushugo` 主目录的任何文件**——用户的 5173 学习页开在那里，热更新会打断学习，`git stash` 曾经删掉过当天的作答（见 CLAUDE.md）。
2. **网页一个字节都不许变。** React 19 → 18 的降级只在 spike worktree 里做。如果为了让小程序跑起来必须改 `frontend/src` 里的共享代码（比如加平台适配层），改完要证明网页不受影响：`cd frontend && npm run check && npm test` 通过，并在独立端口（**不是 5173**）截图对比改动前后。
3. **不许改写页面。** 页面入口必须直接 `import` `frontend/src/pages/*.tsx` 原文件。小程序专属的东西只能放在 Taro 的平台后缀文件（`xxx.weapp.ts(x)`）或新建的适配层里。「页面我改了几行就能跑」= 这一条不通过，如实记下来。
4. **不上传、不提审、不连正式云端。** 开发者工具只打开 spike 项目；同步 / 支付 / 云地址清空；数据只用出厂库 `frontend/public/nihongo.db`，不碰 `.local/live.db`。
5. **试验代码不许删。** 结束时提交快照并挂到 `refs/archive/worktree/taro-spike-2`（做法见 CLAUDE.md「旧工作目录和分支都归档在 refs/archive」），再删 worktree。第一轮就是删了，结果没法复查。
6. **不合进 main 的只有试验代码**；结果文档（本文件和 `MINIPROGRAM_SYNC_PLAN.md` 的记录）在试验结束后提交到 main，提交时同样不许在主目录里跑会触发热更新的操作——只动 `docs/`。
7. **时间盒：一天（约 8 小时 agent 时间）。** 每个阶段结束在对话里用两三句话报一次进度。某一步撞上**有数字的硬阻塞**（例如分完包主包仍超 2 MiB）就停，不要硬撑，直接写结论。

## 步骤

### 第 1 步：搭壳（≤1 h）

- Taro 4 + React 18 + `@tarojs/plugin-html` + Webpack 5，**生产构建**（`NODE_ENV=production`，开压缩）。第一轮报的数字要注明是不是生产构建。
- 把 `wechat-miniprogram/scripts/build-shared.mjs` 里的 `SHIMS` 表原样搬成 webpack 的 `resolve.alias` / `NormalModuleReplacementPlugin`，**同一份映射，不许另写一版**（能从那个文件 import 就 import）。尤其是 `jlpt_words_seed` → `seed-guard.js`、`database` / `storage` / `entitlements` 这几条。
- 数据库沿用小程序现成的 `src/runtime/sqlite.js`（`WXWebAssembly` 跑 sql.js）和 `database-store`，不要自己再接一套。
- 出厂内容 JSON（题面层、汉字索引、一字多音、音高、辨析审校、语法等）按原生版的做法走分包 + `require.async`（`src/shared/content.js`），**不许进主包**。

### 第 2 步：量体积（≤1 h）—— 第一道闸

只放 `VocabTestPage` 一页，生产构建后量：主包、每个分包、总包。

- **过**：主包 ≤ 2 MiB，每个分包 ≤ 2 MiB。再估一下全部页面迁完后的主包大小：Taro 运行时 + React 是固定成本，页面进分包。
- **不过**：列出主包里最大的 10 个模块和各自字节数（webpack-bundle-analyzer 或 `stats.json`），写清楚还能怎么砍，然后停。

### 第 3 步：让查词汇量页跑起来（≤3 h）

- WXSS：写一个 postcss 插件，剥掉小程序不认的规则（`::highlight`、`:has()`、`@layer` 等），**输出被剥掉的选择器清单**；Tailwind 任意值类名走 `weapp-tailwindcss`。
- 定位并修掉 `instanceof` 那个运行时错误，写明是哪个全局。
- 只为这一页需要的浏览器能力写适配（弹层 / `document` / 量尺寸 / 画布 / 分享图），放在 `frontend/src/lib/platform/`（网页实现保持原逻辑）或 `.weapp.ts` 文件里。**每写一个适配记一行**：适配了什么、多少行、网页行为有没有变。
- 在开发者工具里完整走一遍：进落地页 → 开始测验 → 答 5 题 → 提前交卷 → 看结果页。任何一步走不通就记下来。

### 第 4 步：第二个页面（≤2 h）

在第 3 步通过后，再编译一页**最重的**：`WordStudy.tsx`（背词学习页，用户每天用的就是它）。它能不能在不改写的情况下跑起来，决定路线 A 值不值得走。只要求：出卡、翻面、评分、下一张这条主流程能走通。

同时把全仓 28 个用到浏览器专用功能的文件（`grep -rlE 'getBoundingClientRect|document\.|<canvas' frontend/src --include='*.tsx'`）和 13 个 `createPortal` 列成清单，标出哪些已适配、哪些还没有、估计各要多少工作量。

### 第 5 步：速度和截图（≤1 h）

- 在答题「点评分 → 下一张出现」之间打时间戳（`console.log` 即可），开发者工具里各跑 20 次，报中位数和最大值；再对原生版查词汇量页 / 学习页做同样测量对比。
- 真机：生成预览二维码，**请用户扫码**，把真机上的同一组数字发回来。用户没扫之前这一条标「待真机」，不能算通过。
- 两端截图：网页用独立端口（不是 5173）的 375×812，小程序用开发者工具，**同一个页面、同一个状态**（比如都停在查词汇量落地页、都停在第 1 题）。

## 过关条件（全部满足才算路线 A 通过）

| # | 条件 | 怎么量 |
|---|---|---|
| 1 | 页面源码同一份：`VocabTestPage.tsx` 和 `WordStudy.tsx` 原文件直接编译，小程序侧只多适配层 / `.weapp` 文件 | 列出页面文件的 diff（应为空）和新增适配文件 |
| 2 | 主包 ≤ 2 MiB、每个分包 ≤ 2 MiB，并给出全部迁完后的估算 | 生产构建实测字节数 |
| 3 | 两页主流程在开发者工具里走通 | 截图 + 步骤记录 |
| 4 | 答题到下一张的延迟不比原生版明显慢（中位数差距 < 50 ms，真机） | 时间戳数据 |
| 5 | 同一状态下两端截图看得出是同一个页面 | 左右对照图 |
| 6 | 网页未受影响 | `frontend` 的 check / test 通过 + 独立端口截图 |

另外给出一个**全部迁移的工作量估算**：剩下多少页、多少个浏览器专用功能要适配、按本轮每项的实际耗时推算。

## 交付物

1. `MINIPROGRAM_SYNC_PLAN.md` 末尾新增「路线 A 第二轮实测记录」：六条过关条件逐条给数字和证据，截图放 `docs/assets/taro-spike-2/`，最后一句明确写**建议走 A 还是 B**以及理由。
2. 试验代码挂在 `refs/archive/worktree/taro-spike-2`，并在记录里写明怎么取回。
3. 对话里给用户的汇报：结论一句话 + 六条的结果 + 需要用户做的事（扫码测真机、在 A / B 之间拍板）。

## 本轮不做的事

- 不开始正式迁移任何页面，不改 main 上的小程序代码。
- 不动路线 B 的 `parity-map.json` / `check-parity`。
- 不修主目录里 `npm test` 因「开发环境常开 Pro」开关失败的问题（那个开关是用户留着的，要不要登记豁免由用户定）。

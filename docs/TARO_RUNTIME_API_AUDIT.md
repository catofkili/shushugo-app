# Taro 微信运行时 API 扫描（W4）

日期：2026-09-26。扫描对象是本分支最新一次 `npm run build:weapp` 输出的 `taro-spike-2/dist`；命令为：

```sh
python3 /Users/lsc/Documents/shushugo/tmp/miniprogram-api-audit.py /private/tmp/shushugo-w4/taro-spike-2/dist
```

脚本的“未判断”表示静态扫描器没有识别到保护条件或启动垫片；它本身不等于设备运行时一定会执行该表达式。以下逐项记录调用路径和依据。合并最新 `taro/main` 并重建后，`check:cloud-transport` 扫描了 62 个 JS 文件，没有 Worker 主机名或直接 HTTPS 请求；`project.config.json` 的 `urlCheck` 保持 `true`。

## 指定的五类风险

| 风险 | 扫描结果 | 运行路径与处置 |
|---|---|---|
| 快照 gzip / gunzip | `CompressionStream` 2 / 1；`DecompressionStream` 2 / 1；`Blob` 3 / 3；`Response` 1 / 1 | `frontend/src/lib/sync/snapshot.ts` 在两个压缩函数入口先检查 `Capacitor.getPlatform() === "wechat"`，再异步加载账号分包中的 `fflate.umd.js`，调用同步 `gzipSync` / `gunzipSync` 后返回。Taro 的 Capacitor alias 固定报告 `wechat`，因此 common.js 中剩余的浏览器流分支不可达；其中两处 Blob 和一处 Response 都属于这条分支。额外一处 Blob 与 `Worker`、`URL.createObjectURL` 同在 fflate 的可选 worker 实现中，快照只调用同步 API。gzip smoke 已对构建产物做往返验证。 |
| `fetch` / `AbortController` 和音频索引 | `fetch` 4 / 3；`XMLHttpRequest` 2 / 2；`AbortController` 2 / 2 | fetch/XHR 命中是 SQL.js 和网页数据库加载器保留的浏览器 / Node 后备实现；Taro 通过 `sql-js.weapp.cjs` 的 `WXWebAssembly.instantiate` 与 `database-runtime.weapp.ts` 的云存储出厂库下载绕过它们。音频索引 / 文件走云存储适配，不调用网页 fetch。两个 AbortController 命中是 `sync-api.ts` 的 JSON 与快照请求；`app-polyfills.weapp.ts` 在页面前补齐 API，`fetch.weapp.cjs` 监听 signal 并在超时后以 `AbortError` 结束等待。`wx.cloud.callFunction` 发出后不能由 AbortSignal 真正取消，云端请求仍可能继续完成。云传输产物门禁结果见上。 |
| 音频与语音网页 API | `Audio`、`speechSynthesis`、`SpeechSynthesisUtterance` 均未检出（0） | `speech.weapp.ts` 用云存储音频索引和 `wx.createInnerAudioContext`；没有把网页语音合成 API 带进小程序路径。 |
| 图片与文件读取网页 API | `FileReader` 未检出（0）；`Image` 1 处、未判断 1 | 唯一 `Image` 命中是 Taro 自身组件优先级匹配正则，不是 `new Image` 或全局构造器调用。分享适配经 `share-canvas.weapp.ts` 使用微信 canvas 图片加载与文件 API；W4 路由不包含头像文件输入页面。 |
| WordStudy 庆祝去重 | `sessionStorage` 2 处、未判断 2 | `app.tsx` 在页面依赖前导入 `app-polyfills.weapp.ts`；该入口安装进程内 Map 版 `sessionStorage`。它只负责当前进程的庆祝去重，不存数据库或 token；进程重启后状态清空符合预期。 |

## 其他非零命中

| API | 命中 / 未判断 | 说明 |
|---|---:|---|
| `TextDecoder` | 6 / 2 | 命中包含 SQL.js 胶水和 UTF-8 文件读取。SQL adapter 在载入 vendor SQL.js 前先加载 `text-decoder.js`；`filesystem.weapp.cjs` 也在文件读取入口先加载同一补丁。 |
| `URL` | 5 / 5 | 四处是 Taro 内置 URL 兼容实现（含明确不支持的 `createObjectURL` / `revokeObjectURL`）；一处是 fflate 可选 worker 的 Blob URL。快照只调用同步压缩函数，不需要 Blob URL。 |
| `indexedDB` | 1 / 1 | 命中在网页数据库后备函数；`storage.ts` 对 wechat 平台走本地文件 / 共享数据库分支，不调用该函数。 |
| `Worker` | 2 / 2 | 一处是网络门禁错误信息，一处是 fflate 可选异步 worker；W4 快照只调用同步压缩 API。Taro 线程入口另有 weapp shim。 |
| `TextEncoder` / `queueMicrotask` | 2 / 0；1 / 0 | 扫描器未标出未判断用法。 |
| `localStorage` | 16 / 9 | 命中包含网页共享代码与 grammar 子包；`app.tsx` 启动时先执行 W3 的共享 `polyfill.js`，为各页面提供同一份本地存储。 |
| `atob` / `btoa` / `crypto` | 2 / 2；1 / 1；4 / 4 | 共享 `polyfill.js` 在 Taro 页面入口前提供这些小程序缺失的全局实现，包括同步层使用的 UUID。 |
| `performance` | 12 / 5 | 命中分布在 Taro runtime、WordStudy 动画 / 计时与同步计时。扫描器只报告符号，不证明目标 iPhone 基础库是否提供；本轮没有开发者工具或真机运行证据，需随实际设备验收确认。 |

## 构建与运行验收边界

- 最新 Taro 构建成功；W1 的严格主包预算为 1,900,000 B，main 为 1,895,109 B（余 4,891 B）；account 82,824 B、quiz 72,298 B、study 385,060 B、features 661,703 B、content 1,619,451 B、grammar-foundation 668,448 B、grammar-advanced 547,372 B、grammar-pages 240,488 B。全部包均通过 1,900,000 B 门禁，总计 6,172,753 B。`require.async` 检查为 11 次调用、11 个目标（含账号分包 fflate）；压缩产物 smoke 通过。
- 构建警告仍提示若干单文件超过 Webpack 推荐的 244 KiB，以及 `NoAsyncChunksWarning`；微信分包硬上限检查通过。
- 前端 `npm run check` 通过；`npm run lint` 为 0 错误、34 条警告；`npm test` 为 112 个测试文件通过、2 个跳过，794 项通过、26 项跳过。微信原生侧 `npm test` 的 30 个脚本全部通过，包括云快照、云传输、共享 bundle、文本解码与配对检查。Taro `npm test` 通过异步分包路径、fflate gzip 往返、云 fetch AbortSignal smoke 和包体门禁。
- 网页生产预览在隔离端口 5299、375 × 812 检查了首次启动计划设置页的顶部和底部；页面错误 0、横向滚动 0，纵向设置内容可在内部滚动区完整查看。这个截图只证明网页渲染，不替代微信开发者工具验收。
- 微信开发者工具当前窗口仍加载另一个项目 `/private/tmp/claude-portal/taro-spike-2`。IDE 文档说明若已用不同 HTTP 端口启动，必须先退出 IDE 才能换端口；W4 约束又明确要求不关闭共享 IDE、不切换别人的项目。因此本次没有在该窗口重编译、刷新或截图，也没有假报登录/同步已验证。当前阻塞项是：需要在 W4 专用且空闲的 9450 自动化项目窗口完成页面视觉检查、微信登录和一次云同步后，才能生成预览二维码。若登录回 `WECHAT_ACCOUNT_NOT_FOUND`，验收到选择页为止，不创建账号。 |

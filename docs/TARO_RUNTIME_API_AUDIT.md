# Taro 微信运行时 API 扫描（W4）

日期：2026-09-26。扫描对象是本分支最新一次 `npm run build:weapp` 输出的 `taro-spike-2/dist`；命令为：

```sh
python3 /Users/lsc/Documents/shushugo/tmp/miniprogram-api-audit.py /private/tmp/shushugo-w4/taro-spike-2/dist
```

脚本的“未判断”表示静态扫描器没有识别到保护条件或启动垫片；它本身不等于设备运行时一定会执行该表达式。以下逐项记录调用路径和依据。构建后 `check:cloud-transport` 又扫描了 458 个 JS 文件，没有 Worker 主机名或直接 HTTPS 请求；`project.config.json` 的 `urlCheck` 保持 `true`。

## 指定的五类风险

| 风险 | 扫描结果 | 运行路径与处置 |
|---|---|---|
| 快照 gzip / gunzip | `CompressionStream` 12 处、未判断 6；`DecompressionStream` 12 处、未判断 6；`Blob` 18 处、未判断 18；`Response` 6 处、未判断 6 | `frontend/src/lib/sync/snapshot.ts` 在两个压缩函数入口先检查 `Capacitor.getPlatform() === "wechat"`，同步走仓库自带 `fflate.gzipSync` / `gunzipSync` 后返回。Taro 的 `@capacitor/core` alias 固定报告 `wechat`，所以浏览器流分支不可达。fflate 包含可选异步 worker/Blob 实现，但 W4 只调用同步 API，不触发它。 |
| `fetch` / `AbortController` 和音频索引 | `fetch` 12 处、未判断 9；`XMLHttpRequest` 6 处、未判断 6；`AbortController` 6 处、未判断 6 | 未判断的 fetch/XHR 都来自打包的 `sql-wasm.js` 浏览器/Node 加载后备逻辑，不是音频或 Worker 网络请求。W4 `sql-js.weapp.cjs` 给 SQL.js 提供 `WXWebAssembly.instantiate` 和本地 wasm 路径；音频索引与文件通过原生云存储请求，不调用网页 `fetch`。`fetch.weapp.cjs` 在应用 polyfill 入口装入全局 AbortController 兼容实现，并把 API 路径转给原生 `requestJson` / `requestBinary`。云传输产物门禁结果见上。 |
| 音频与语音网页 API | `Audio`、`speechSynthesis`、`SpeechSynthesisUtterance` 均未检出（0） | `speech.weapp.ts` 用云存储音频索引和 `wx.createInnerAudioContext`；没有把网页语音合成 API 带进小程序路径。 |
| 图片与文件读取网页 API | `FileReader` 未检出（0）；`Image` 1 处、未判断 1 | 唯一 `Image` 命中是 Taro 自身组件优先级匹配正则，不是 `new Image` 或全局构造器调用。分享适配经 `share-canvas.weapp.ts` 使用微信 canvas 图片加载与文件 API；W4 路由不包含头像文件输入页面。 |
| WordStudy 庆祝去重 | `sessionStorage` 2 处、未判断 2 | `app.tsx` 在页面依赖前导入 `app-polyfills.weapp.ts`；该入口安装进程内 Map 版 `sessionStorage`。它只负责当前进程的庆祝去重，不存数据库或 token；进程重启后状态清空符合预期。 |

## 其他非零命中

| API | 命中 / 未判断 | 说明 |
|---|---:|---|
| `TextDecoder` | 20 / 6 | 命中包含 SQL.js 胶水和 UTF-8 文件读取。SQL adapter 在载入 vendor SQL.js 前先加载 `text-decoder.js`；本次补充也让 `filesystem.weapp.cjs` 在文件读取入口先加载同一补丁，避免它先于数据库初始化时访问 TextDecoder。 |
| `URL` | 4 / 4 | 命中是 Taro 对 `URL.createObjectURL` / `revokeObjectURL` 的“不支持”保护。W4 分享图不依赖这两个方法。 |
| `indexedDB` | 3 / 3 | 命中在网页数据库后备函数；`storage.ts` 对 wechat 平台走本地文件/共享数据库分支，不调用该函数。 |
| `Worker` | 7 / 7 | 命中是 fflate 可选异步 worker 代码及小程序网络门禁的错误信息；W4 快照只调用同步压缩 API，Taro 线程入口另有 weapp shim。 |
| `TextEncoder` / `queueMicrotask` | 12 / 0；6 / 0 | 扫描器未标出未判断用法。 |
| `localStorage` | 30 / 9 | 共享 `polyfill.js` 在 Taro 页面入口前提供。 |
| `atob` / `btoa` | 6 / 6；3 / 3 | 共享 `polyfill.js` 在 Taro 页面入口前提供。 |
| `crypto.randomUUID` | 12 / 12 | 共享 `polyfill.js` 在 Taro 页面入口前提供。 |
| `performance` | 16 / 9 | 命中分布于 Taro/SQLite 打包代码和同步请求计时；这是静态符号统计，不表示上述 API 执行到了一个缺失的浏览器分支。 |

## 构建与运行验收边界

- 最新 Taro 构建成功；包体积报告中 main 1.434 MiB、account 1.261 MiB、quiz 1.316 MiB、study 1.739 MiB、features 0.631 MiB、content 1.544 MiB，全部低于 2 MiB；`require.async` 检查为 24 次调用、8 个独立目标。
- 构建警告仍提示若干单文件超过 Webpack 推荐的 244 KiB，以及 `NoAsyncChunksWarning`；微信分包硬上限检查通过。
- 前端 `npm run check` 通过；`npm run lint` 为 0 错误、34 条警告；`npm test` 为 112 个测试文件通过、2 个跳过，793 项通过、26 项跳过。微信原生侧 `npm test` 的 29 个脚本全部通过，包括云快照、云传输、共享 bundle、文本解码与配对检查。
- 微信开发者工具当前窗口仍加载另一个项目 `/private/tmp/claude-portal/taro-spike-2`。IDE 文档说明若已用不同 HTTP 端口启动，必须先退出 IDE 才能换端口；W4 约束又明确要求不关闭共享 IDE、不切换别人的项目。因此本次没有在该窗口重编译、刷新或截图，也没有假报登录/同步已验证。当前阻塞项是：需要在 W4 专用且空闲的 9450 自动化项目窗口完成页面视觉检查、微信登录和一次云同步后，才能生成预览二维码。若登录回 `WECHAT_ACCOUNT_NOT_FOUND`，验收到选择页为止，不创建账号。 |

# 构建、发布与部署

## 部署自检：`GET /api/health`（2026-09-09）

**只返回布尔量**，不吐密钥、计数或用户信息。它回答三个在仓库里看不出来的问题：

```bash
curl -s https://<worker>/api/health | jq
```

- `migrations` / `migrationsApplied` —— 远端 D1 有没有应用 0009–0012。
  少一张表就是**静默失效**：内购归属（0009）、认证限速（0010）、
  通知留痕（0012）、事件状态索引（0011）会在没人发现的情况下不起作用。
- `authHardening` / `turnstileConfigured` / `emailConfigured` ——
  `REQUIRE_AUTH_HARDENING` 有没有真的打开，Turnstile 和邮件配没配。
- `appStoreConfigured` / `appStoreEnvironment` —— Apple 的 Server API 凭据齐不齐。
- `productionReady` —— 上面全部成立才是 true。

⚠️ **加这个接口的理由是：这些全都是静默失效。** 接口一切正常、返回 200，
直到某天有人用同一笔交易开了两个账号，或者线上认证在裸奔了三个月才被发现。

**`apple_notifications` 表（迁移 0012）同理**：Apple 的
「Request a Test Notification」打进来之后，如果服务端不留痕（未认领的交易直接
return），「通知地址到底配对了没有」就没法确认，只能等真实退款发生时才发现没配。
现在**每一次投递都记一行**，包括看不懂的（`ignored`）、查不到交易的
（`apple_lookup_failed`）、无人认领的（`unclaimed`）和真正生效的（`applied`）。

## 构建与发布：三条闸门和一个最低系统版本（2026-09-10）

### ⚠️ 最低支持系统是 iOS 16.4，三处必须一起说同一个数

`ios/App/Podfile` 的 `platform`、Xcode 的 `IPHONEOS_DEPLOYMENT_TARGET`、
`frontend/vite.config.ts` 的 `build.target`。

原来前两处写着 15.0，而 **Vite 7 默认按 baseline（Safari 16）编译** ——
iOS 15 的设备装得上、连 JS 都解析不了，而工程还对外声称支持它。

取 16.4 而不是 16.0：云备份的 gzip 解压直接用 `DecompressionStream`
（Compression Streams，Safari/iOS **16.4** 才有）。低于它的设备本地能学，
**恢复不了云备份** —— 而那正是换设备时唯一要它工作的一刻。
16.0 能跑的机器都能免费升到 16.4，所以这一档几乎不花成本。

### ⚠️ `scripts/package-preview.sh`：清单漏文件是静默的

`git archive` 照样产出 zip，只有收到包的人会撞上。已经漏过的：
`frontend/scripts`（`prebuild` 要跑里面的 `verify-release-db.mjs` 和
`verify-kanji-reading-unit-index.mjs`）、`frontend/eslint.config.js`、
`cloudflare-sync/scripts`（Worker 的 `npm test` 跑的是那里的规则测试）。
现在打完包会**解压到临时目录真跑一遍** `npm ci / check / lint / test / build`，
除非显式 `SKIP_PREVIEW_VERIFY=1`。别把那一步删了 —— 它是唯一能发现清单漏项的东西。

### ⚠️ `scripts/build-ios.sh` 是发版那条路，不许绕过门禁

原来是「看见 `node_modules` 就跳过安装，否则 `npm install --legacy-peer-deps`」，
而且只 build 不跑 check/lint/test。一份几个月前的 `node_modules` 会和
`package-lock.json` 悄悄对不上。现在一律 `npm ci --legacy-peer-deps` +
check / lint / test，应急才用 `SKIP_RELEASE_GATES=1`。

### ⚠️ 网页版默认没有预生成读音音频

那 137 MB 不在版本库里（见 `.gitignore`），干净 runner 上 checkout 完根本没有，
于是网页版**静默**退回系统 TTS，而构建全绿、没有任何提示。
`deploy-pages.yml` 现在支持 `AUDIO_ARTIFACT_URL` + `AUDIO_ARTIFACT_SHA256`
两个仓库变量（下载 → 核对 sha256 → 解开），没配就在日志里 `::warning::` 说明白。
**制品本身还没发布**，要发一版带声音的网页版得先把它传上去。

### ⚠️ 小程序的 CI 入口只有 `npm test`，别在 workflow 里抄脚本名单

抄名单的那一版漏掉了 grammar / runtime / entitlement / modes / budget 五个，
它们从此没在任何一次提交上跑过。`npm test` 走 `scripts/run-all.mjs`，
**枚举 package.json 里的全部脚本** —— 新加 smoke 不用改 CI。


### ⚠️ Taro 小程序的分包闸门读的是**提交进 git 的构建产物**（2026-10-09 修）

`taro-spike-2/npm test` 最后一步 `verify-package-gates.mjs` **不重新构建**，读的是提交在
`taro-spike-2/reports/` 里的 `webpack-stats.json` + `package-sizes.json`（由 `npm run build:weapp`
的 stats 插件和 `measure-packages.mjs` 写出），再写出 `package-gates.json`。

- **stats 里是构建那台 checkout 的绝对路径，而且一份里混着两个前缀**：源码在构建所在的 worktree
  （当时是 `~/Documents/shushugo-wt/integrate`），node_modules 是软链到主目录、被 webpack 解析成主目录路径。
  旧脚本拿「当前 checkout」做 `path.relative` 基准，换个目录跑就得到 `../integrate/frontend/...`，
  20 条核心模块允许清单同时变成「未允许」+「已过期」。拿「构建根目录」做基准也不行（node_modules 那半对不上）。
  现在 `sourceName()` 按仓库顶层目录名（frontend / taro-spike-2 / wechat-miniprogram）截成仓库相对路径，
  `package-gates.json` 里不再有绝对路径，同一份 stats 在任何目录跑出的报告逐字节相同 —— **跑测试不再产生 diff**。
- **改了允许清单（或改了会影响分包的源码）要重新 `npm run build:weapp`，把 `webpack-stats.json`、
  `package-sizes.json`、`package-gates.json` 三份一起提交。** 只改清单不重建，闸门比的是旧构建：
  10-08 那次除了路径问题，提交的 stats 还落后于 main，页面组件清单报 10 条「已过期」，在 main 上重建一次就全绿。
  别为了让测试过去去删允许清单条目。
- 构建没开实验开关时，`build:lucide-assets` 会把只给实验页用的图标（如开口练习的 `mic`）从 study 分包挪走、
  改写 `src/platform/lucide-packages.cjs` 和 `src/package-assets/**`。这些是开关相关的产物，
  **只为刷新闸门报告而构建时，把 `src/` 下的这类改动还原，别顺手提交。**
- `webpack-stats.json` 本身仍带绝对路径（每次从不同 worktree 构建都是几千行 diff）；
  要消掉这份噪音得在 `config/index.js` 的 stats 插件里落盘前改写路径，还没做。

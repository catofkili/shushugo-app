# 构建、发布与部署

## 2026-11-07 T1 Round 2：两项退回复修后的 fresh 构建

修复 mixed 资格就绪判断与自选取消后，重新从本 worktree 网页源码生成 shared/web.js 及辨析内容模块；
原生 `npm test` 的 32 个脚本全通过，含 check-shared。网页 check、lint（0 errors / 52 warnings）、完整 prebuild/生产构建通过。
全量 `VITEST_MAX_WORKERS=2 npm test` 已运行并退出 1：199 文件通过、5 跳过、1 失败；1,640 项通过、30 跳过、1 todo，
唯一失败为 brief 指定的 fsrs-store 顽固词原有 5,000 ms 超时（本次 6,152 ms），未改超时、断言或跳过该例。

Taro 执行原 `npm run build:weapp` 全链与 `npm test`，均退出 0；仍通过临时 offline-doctor.cjs 选择同一原生 binding 的
内置 schema，合法/错误类型/缺失必填项正反例通过，不使用 --no-check，也不请求远端 schema。
新主包 **1,897,472 / 1,900,000 B**，余 **2,528 B**，13 包全部通过，未许可核心/页面重复、过期许可均为 0。
reports 来自本次完整构建，预算和允许清单未改；src 未留下品牌/Lucide 资产生成副作用。
日志为 `tmp/perf/t1-round2-{check,lint,frontend-test,shared-build,wechat-test,taro-build,taro-test,web-build}.log`。
实际分支仍在 e8a3569d：真实 git add 无法创建主目录共享 .git 下的 index.lock，未能提交或合并；
本轮没有再创建临时 Git 历史，不把已有 bundle 当作合并完成。没有联网、发布、启动服务/GUI 或设备验收。

## 2026-11-07 T1 合入 T2/T3 后的构建复核

当前合并结果已重新生成 shared/web.js，并执行完整 Web prebuild/生产构建、原生小程序 32 脚本，
以及 Taro 原 build:weapp 全链和 npm test，均退出 0。Taro 只用当前 worktree 忽略目录中的
`tmp/perf/offline-doctor.cjs` 选择原生 validator 内置 schema；真实校验结果仍能拦错，正反例均已自测。
未使用 --no-check，未联网取 schema；未经适配的默认远端 Doctor 不属于本次通过证据。

fresh 主包 **1,896,994 B**，上限仍为 **1,900,000 B**，余 **3,006 B**；全部 13 包与重复模块闸门通过。
reports 来自本次实际构建，src 下没有资产副作用。完整日志、Node 测量和消费边界见小程序专题 T1 第三次续做。
当前 checkout 的 Web 出厂库 SHA-256 为 `b3e303b3adf95a1020a9171a3a03274aa0caa56b8e5d931a738ca452c731af6b`；
忽略的 frontend/ios/App/App/public/nihongo.db 不存在，所以本次没有 Web/iOS cmp 的证据。
没有执行 bake、上传云存储、部署或发布；下文 T3 的 Web/iOS 比对和云端未更新仍是其原会话的记录。
原 Git 元数据受限，WIP/合并只保存在 tmp/perf/merge.git 和已验证的 bundle；原分支尚未写回，
不能以源码已经合好或构建全绿声称原分支已提交/合并。后续修正和文档未 commit。
用户本次禁止 GUI，因此没有运行画面/设备验收。

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

> **2026-10-12 增补：下面的 `AUDIO_ARTIFACT_URL` / R2 制品方案已被音频包取代。** 网页/iOS 和 Taro 均读取腾讯云开发总索引；Pages 工作流不再拉 tar 音频制品，Vite 不复制 `audio-src`、`audio/words`、`audio/examples` 到发布包（`audio/talk` 沿用）。生成/作者上传/CORS/缓存配置见音频专题「音频包（2026-10-12）」。这不表示云端已经上传或已验收。

> **2026-10-13 增补（发布前对照 V8）**：上一条「网页/iOS 读腾讯云开发总索引」对**线上公开网页**已不成立——作者 10-13 定：线上网页不取音频包、一律系统朗读，
> 首次打开提示一句（`PUBLIC_WEB_WITHOUT_PACKS`，`audio-pack-platform.ts`；「网页端不能赚钱而且容易被破，我不想管理」）。
> 所以 Pages 工作流**不**检查云存储的 `current.json` 能否匿名访问（原来想加的 `::warning::` 没有对象了）：网页走系统声音是设计，不是静默事故。
> 音频包只给 App（Capacitor）、小程序、本机 dev。**iOS 上架前**仍要解决云存储免费档匿名 HTTPS 403（见音频专题），那一步的可达性验收放在 iOS 发版前，不在 Pages 部署里。

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

### 2026-10-12 增补：新路由把已许可的分包组件合到主包时

开口练习转正式路由后，fresh build 的 `DailyPlanSlider.weapp.tsx` 从 account / study 各一份变成 `common.js` 中唯一一份；
旧重复清单却报「已过期」。这次不是旧 stats 路径错误：核对过新 chunks 中只出现主包实例，未许可重复为 0，主包仍低于 1,900,000 B。
判据补成：已许可页面组件若现在**只存在于主包**，视为重复已消除，保留清单以兼容已提交 reports；不为消警告再复制组件，也不删旧许可。
模块彻底消失、只剩一个分包实例、出现未许可重复、预算超限仍照旧拦截。`verify-package-gates.test.mjs` 用隔离 stats 验证这些边界。
本次作者明确要求构建后还原 reports，按该要求处理；后续正式更新构建报告仍遵守上面的三份一起更新规则。

### 2026-10-13 增补：main 上 `taro-spike-2 && npm test` 曾经是红的（发布前对照 V1）

交付（`ebc914a..6ad8fbcc`）改了核心重复许可清单，却按「作者要求构建后还原 reports」把 reports 留在 10-11 的旧构建上：
闸门读旧 stats，报「核心模块重复允许清单不匹配：已过期 [audio-pack-format.ts, speech-audio.ts, …]」。**GitHub CI 和 `ci-local.sh` 原来都不跑 `taro-spike-2` 的测试，所以这条红灯谁也看不到。**
同一次重建还翻出两个同类的东西，都是「改了一头没改另一头」：
- `verify-shim-exports`：`App.tsx` 用了 `PUBLIC_WEB_WITHOUT_PACKS`（线上网页不取包，94657483），小程序替身 `audio-pack-platform.weapp.ts` 没导出，`build:weapp` 第一步就拦住。替身里恒为 `false`。
- `verify-package-gates.test.mjs` 的夹具用的是已从许可清单删掉的 `DailyPlanSlider.weapp.tsx`，测试自己红；换成仍在清单里的 `DailyPlanRing.weapp.tsx`。**夹具要用清单里现有的条目，清单删条目时顺手 grep 一下测试。**
现在的做法：改了许可清单 / 会影响分包的源码，当场 `npm run build:weapp` 并把六份 reports 一起提交（本次是 `webpack-stats.json`、`package-sizes.json`、`package-gates.json`、
`css-source-bytes.json`、`require-async-paths.json`、`route-css-split.json`，`src/` 下没有副作用改动）；`scripts/ci-local.sh` 加了 `taro-spike-2` 的 `npm test`（只读 reports，约 3 秒）。
本次重建后主包 1,888,184 B（上限 1,900,000，余量约 11.8 KB——下一次往主包加东西要先腾地方），`jlpt-bank` 分包 1,015,758 B。

### 2026-10-14 增补：连胜那次主包超了 13 KB，怎么腾出来的

连胜（`docs/STREAK_SPEC.md`）第一次 `build:weapp` 主包 1,913,032 B，超 1,900,000 上限。账是这样算的：

- **主包 JS 几乎不涨**：四个标签页的界面代码在 `lazy/tabs.js`（lazy 分包）。涨的是 CSS —— lazy 块抽出来的 `lazy/tabs.wxss` 在小程序里没人引，
  `split-route-css.mjs` 把它**整份并进 `app.wxss`**（而且是在按前缀拆分**之后**并的，前缀路由管不到它）。所以主页 / 单词页组件 import 的 CSS 全额算主包。
  另外 `lib/streak.ts` 被 `yuzu.ts` 用，进了 `common.js`（约 8 KB）。
- 腾法：① 详情页样式拆成单独的 `StreakPageView.css`（只有 content-pages 里的页面 import，落在分包）；
  ② 删掉 `app.css` / `styles.css` 里全仓库零引用的旧样式（`zoo-hero*`、`zoo-rates`、`zoo-mini`、`zoo-bento`、`zoo-today-grid`、`zoo-tools`、`zoo-answer`、
  `zoo-chips`、`zoo-study-head`、`zoo-card-face`、`glass-jelly*`、`card-glass`、`btn-glass`、`btn-primary`、`btn-secondary`、`stat-card`、`stat-value`、`progress-bar`、`glass-frosted`，约 12 KB 源码）。
  判据：类名在 `frontend/src/**/*.ts(x)`、`taro-spike-2/src`、`index.html` 里一次都不出现，也没有 `前缀-${` / `"前缀-" +` 这种拼接。
  找的时候注意误报：`h5-*` 是 Taro 生成的标签类、Tailwind 的转义类名在源码里写法不同、`quick-study-rating-*` / `ds-say-*` / `rate-*` / `vocab-fb-*` 是拼出来的。
- 结果主包 1,897,803 B，**余量只剩约 2.2 KB**。下一次往主页 / 单词页加带 CSS 的东西，先在这里找地方。
- 同时新增四条页面组件重复许可（`verify-package-gates.mjs`：`streak/` 下三个组件 + `streak.css`），理由写在清单里。
- `build:weapp` 第一步 `verify-shim-exports` 拦过一次：`zoo-sounds.ts` 加了 `playStreakIgnite` / `playStreakGold`，替身 `wechat-miniprogram/scripts/shared/shims/zoo-sounds.js` 要一起加。

## ⚠️ 后端已从 Cloudflare 搬到阿里云（2026-10-11）

**现状**：Worker 本体（`cloudflare-sync/src/index.ts`，一行没改）跑在阿里云武汉轻量服务器 `8.148.68.155`，
Node 22 + `node:sqlite` 模拟 D1/KV/R2/限速（`cloudflare-sync/selfhost/`，细节和运维命令见该目录 README）。
`api.shushugo.com` 的 DNS **直接指向服务器**（灰云，不经 Cloudflare 代理），Caddy 自动签证书。
Cloudflare 上只剩 `cloudflare-sync/proxy/` 那个**转发层**：把已发布的旧 iOS 版本写死的 `*.workers.dev` 转发给 `origin.shushugo.com`。
DNS 仍托管在 Cloudflare（只是 DNS，不收费）。小程序云函数的 `WORKER_ORIGIN` 不用动，仍是 `api.shushugo.com`。

**踩过的坑（删掉这段，下一个人会重踩）**

- ⚠️ **不要 `wrangler deploy` 根目录的 `wrangler.jsonc`**。同名 `master-nihongo-sync` 会被换回旧后端，旧 iOS 的写入落回已停用的 D1（两套库同时接受写入）。
  `npm run deploy` 已改成直接报错；根配置里的 `api.shushugo.com` custom_domain 路由也删了 —— 留着的话部署会让 Cloudflare 把该域名 DNS 抢回去。
  只有 `cd cloudflare-sync/proxy && wrangler deploy` 是对的（`--var MAINTENANCE:1` 是维护模式，一律 503）。
- ⚠️ **Turnstile 核对「验证域名 = 请求到达的域名」**（`index.ts` 的 `result.hostname !== expectedHostname`）。
  Cloudflare 控制台 Turnstile 的 Hostnames 必须包含 `api.shushugo.com`、`origin.shushugo.com`、旧的 `workers.dev`。
  旧客户端经转发层来时，服务器必须还原成 `workers.dev` 的 Host（转发层发 `X-Shushugo-Host`，Caddy 的 `header_up Host` 还原），否则旧 iOS 的注册/登录/找回密码全部 403。
- ⚠️ **真实客户端 IP**：限速按 `CF-Connecting-IP`。直连请求由 Caddy 用 `{remote_host}` 覆盖（防伪造）；转发层的请求凭 `PROXY_KEY`
  （`/etc/caddy/proxy.env` 与 CF 上的 secret 是同一个值）才被信任，否则所有旧客户端在服务器看来是同几个 CF 出口 IP，同步推送「每 IP 每分钟 2 次」会互相挤掉。
- ⚠️ **导入 D1 导出时不许替它补记迁移**。演练实测：线上停在 0017、仓库有 0018，旧写法把 0018 记成「已应用」，duels 等表静默缺失。现在缺 `d1_migrations` 直接报错，没执行的迁移由 `openDatabase` 启动时真正跑。
- 迁移脚本三个坑：D1 内部表 `_cf_KV` 要排除；行数核对不能用 22 段 `UNION ALL`（D1 报 too many terms），用标量子查询；macOS 的 `tar` 会塞 `._*` 文件，要 `COPYFILE_DISABLE=1`，安装器会拒收可疑条目。
- **密钥回读不了**：Cloudflare 的 secret 读不出来，搬家时全部要重新取（Turnstile 在控制台看得到，Resend 只能新建，微信 AppSecret 只能重置）。
  服务器上用 `sudo /opt/shushugo/cloudflare-sync/selfhost/set-secrets.sh` 逐项填；**输入法必须是英文**，中文输入法会把 `1` 变成全角「１」、多出制表符，`/api/health` 里的 `authHardening` 会是 false。
  验收看 `curl https://api.shushugo.com/api/health` 的各项 Configured 和 `productionReady`。
- 自动审查会拦 DNS、密钥库写入、取密钥这类操作；这次 DNS 记录和 Resend 密钥都是用户手动加的。

**待办**：服务器 R2 对象没有异机备份（只有每天一次的 SQLite 备份，保留 14 天）—— 阿里云控制台开自动快照；
官网 `shushugo.com` 仍在 Cloudflare Pages（`shushugo-website`），要搬的话 Caddyfile 末尾已有静态站点块的写法（`/srv/shushugo-website`），DNS 切过去再启用；
CF 上旧 Worker 留下的 secret（RESEND 等）和 D1/KV/R2 数据还在，确认稳定一段时间后再清。

### 2026-10-12 音频包分包验收增补

音频缓存适配器用 `globalThis.__shushugoAudioPackClient` 保存唯一实例：即使 Taro 把定义复制进独立分包，
总索引、下载去重、并发上限和文件 LRU 都由同一实例管理。`speech-packs.ts` 不保留学习计划，购买/偏好每次现读。
新增的允许项分别解释纯格式/哈希函数、类定义和唯一实例的边界，不能把其他有学习数据缓存的模块照此放行。
本次实际 webpack stats 中 `DailyPlanSlider.weapp.tsx` 已不再跨分包复制（`duplicatedModules` 无此项）；
它的旧「account/study 各一份」说明因此失效，随构建证据移除该过期允许项，而非扩大分包/重复代码限额。
用户本次明确要求验收后还原 `taro-spike-2/reports`，因此保留的是基线报告；下一次提交/发布前必须重新构建，
不能拿还原后的旧报告代替这次源码的构建证明。Doctor panic 时只跳过 Doctor，后面的所有脚本仍按 package.json 顺序执行。

### 2026-10-13 审核账号改成一次性密码（不再进密钥库）

背景：原来审核登录靠 `REVIEW_LOGIN_PASSWORD`（密钥）+ `REVIEW_LOGIN_UNTIL`（截止日），密码要进服务器密钥文件、自动审查会拦，截止日一到审核员就登不进去。
现在：`review_passwords` 表（迁移 0019）只存 SHA-256 摘要；账号固定 `review@shushugo.com`（小程序登录页自动填好），密码一次性、每个用一份。

- 第一次登录起算 7 天（`expires_at`），过期作废；一直没用的到 `use_by` 也作废。权益和会话都不超过该密码自己的 `expires_at`，重复登录不会往后推。
- 表里没有任何有效密码时 `/api/auth/config` 的 `reviewLoginOpen` 为 false，登录页入口消失。
- 生成：`node cloudflare-sync/scripts/mint-review-passwords.mjs <个数> <use_by YYYY-MM-DD> <明文输出文件>`，标准输出的 SQL 用 `sudo sqlite3` 灌进服务器库。
  **明文输出文件放在仓库外面**（仓库是公开的）；明文只给提审的人。
- 撤销某个密码：删那一行或把 `expires_at` 改成过去。
- 一次提审只用一个；被驳回要重提就换下一个（没用过的不占时间）。
- 旧的 `REVIEW_LOGIN_PASSWORD` / `REVIEW_LOGIN_UNTIL` 已从代码里删除，服务器 `worker.env` 里残留的两行无害，可以删。

## 2026-11-06 T2：网页首屏路由字节与 HTML 启动 PNG

在 `claude/perf-motion-web`、HEAD **e8a3569d** 上改前 / 改后各跑现行 `cd frontend && npm run build`。背景审计基于 4dcc89dc，不能直接把它的数字当作本次基线。先把本 worktree 的 node_modules 软链换成逐项只读依赖链接，Vite / Vitest 缓存留在 worktree，未改主目录依赖或学习页。

测量脚本与逐文件哈希保存在 `tmp/perf/measure-entry.mjs`、`t2-entry-before.json`、`t2-entry-after.json`、`t2-entry-comparison.json`。读取 **dist/index.html 直接引用的 module script、modulepreload JS 与 stylesheet CSS**，去重后逐文件用 Node `gzipSync` 默认 level 6 压缩再求和；不把运行时 import、idle 预取、WASM、出厂库混入这个「HTML 初始引用」口径。改前须在改源码之前构建并保存 JSON；改后执行 `node tmp/perf/measure-entry.mjs after`。它不是浏览器 HAR 或首屏耗时。

| HTML 初始引用 | 改前 B | 改后 B | 减少 B |
| --- | ---: | ---: | ---: |
| JS 原始 | 2,680,584 | 2,143,802 | 536,782 |
| JS gzip | 838,314 | 662,557 | **175,757** |
| CSS 原始 | 339,167 | 322,511 | 16,656 |
| CSS gzip | 63,282 | 60,040 | 3,242 |
| 两张静态启动 PNG | 213,326 | 42,496 | 170,830 |

JS gzip 降幅高于任务的 120,000 B 闸门。CSS 变化来自页面随路由移出初始依赖闭包，没有删除现有界面样式。

`node frontend/scripts/build-boot-assets.mjs` 沿用现有 Taro 品牌管线的 **sips + pngquant**（256 色、quality 65-90、speed 1），不加 npm 依赖。新图在 `public/brand/boot/`，母版 `public/brand/sheet/` 保留；只替换 index.html 两个 img.src，不改 main.tsx、Sticker、换肤 URL、favicon 或小程序图源。

- splash 显示高 120 CSS px，2× 目标 240 px，但母版只有 **375×233**，不为凑整数放大，量化后 **99,108 → 27,421 B**。
- logo 显示高 80 CSS px，派生 **274×160**，**114,218 → 15,075 B**。
- 两张仍是含透明度的调色板 PNG；背景报告约 27 KB 的合计是 WebP 实验样本，**不能当成 PNG 的验收数字**。不以 WKWebView / 微信本地 WebP 的显示风险换字节。离线看图与页面 / 窄屏 / 真机验收是不同证据。

本次 Taro 标准 `npm run build:weapp` 在 Doctor 原生 `system-configuration` NULL object panic 后挂住，已中止；Doctor 的默认配置还会使用远端 schema，不适合离线任务。随后从 package.json 读取原 build:weapp 命令串，**只把 `taro build --type weapp` 换成 `taro build --type weapp --no-check`** 执行，其余资产、编译、CSS / 字体、内容恢复、async 路径、API、包体、重复模块和 referral 闸门全保留。日志为 `tmp/perf/t2-taro-build.log` 与 `t2-taro-no-check-build.log`；不能把这次写成原命令连 Doctor 也通过。

### 2026-11-07 续验：离线 Doctor 要保留真实配置校验

上面的 `--no-check` 是上一轮证据，不能冒充 Doctor 通过。现行 `@tarojs/plugin-doctor` 的 JS 包装器默认请求 GitHub schema；读取全局配置时又用了 `config.useRemoteConfigSchema ? config.useRemoteConfigSchema : true`，所以把全局配置写成 `false` 仍会选回远端。不要为这次离线任务修改用户全局配置或主目录依赖。

本次将临时适配留在忽略目录 `tmp/perf/offline-doctor.cjs`：只在 Taro CLI 进程里，把 Doctor 的 `validateConfig` 接到**同一个原生 binding** 的 `validateConfig(configStr, '', false)`，选择其内置 schema；函数序列化仍沿原包装器的 `__function__` 口径，原始 `isValid/messages` 原样返回，CLI 照常按失败结果拦截。没有返回写死的成功，也没有使用 `--no-check`。正反例自检要求合法配置为 true、错误类型及缺失必填项为 false，结果在 `t2-resume-doctor-self-check.json`。

复现入口（在本 worktree 的 `taro-spike-2` 中）：`NODE_OPTIONS='--require=/Users/lsc/Documents/shushugo-wt/perf-motion-web/tmp/perf/offline-doctor.cjs' npm run build:weapp`。此命令仍执行 package.json 的整条资产、配置验证、编译和后处理闸门；必须连同离线适配说明报告，不能写成未经适配的默认远端 Doctor 也通过。适配不写入版本依赖或发布产物，不改变包体预算、模块许可或用户数据。

### 2026-11-07 最终网页重建测量

在同一 HEAD `e8a3569d` 和当前补丁上执行 `cd frontend && npm run check && npm run lint && npm run build`，退出 **0**；lint 为 0 errors / 51 个既有 warnings。构建日志为 `tmp/perf/t2-resume-web-build.log`。随后按上面的 HTML 引用口径执行 `node tmp/perf/measure-entry.mjs after`，并从 before / after JSON 重新计算 comparison，以断言检查 JS gzip 至少减少 120,000 B：

| HTML 初始引用 | 改前 B | 最终改后 B | 减少 B |
| --- | ---: | ---: | ---: |
| JS 原始 | 2,680,584 | 2,143,802 | 536,782 |
| JS gzip | 838,314 | **662,565** | **175,749** |
| CSS 原始 | 339,167 | 322,511 | 16,656 |
| CSS gzip | 63,282 | **60,040** | **3,242** |
| 两张启动 PNG | 213,326 | **42,496** | **170,830** |

前表 662,557 B 是上一轮构建记录，保留为历史；当前 `t2-entry-after.json` / `t2-entry-comparison.json` 和逐文件 SHA-256 对应本表。不要从运行时 idle 预取再加回字节来替换 HTML 初始引用口径，也不要把这里的字节差称作首屏时间差。本次只查看本地 boot PNG 与母版；没有启动学习页、独立服务、浏览器或微信开发者工具，也没有提交、推送或合并。

最终完整 Taro 构建（上面的离线 Doctor 适配）、Taro `npm test`、原生小程序 `npm test` 全部退出 **0**；主包 **1,894,809 B**、13 包均通过原 1,900,000 B 闸门，未许可重复与过期许可均为 0。构建未留下 `taro-spike-2/src` 资产副作用，变化的五份 reports 保留。网页全量 **1,627 项通过、30 项跳过、1 项 todo**；没有改算法 / 测试超时 / 断言。最终日志统一为 `tmp/perf/t2-final-{frontend-test,taro-build,taro-test,wechat-test}.log`；离线配置验证结果另为 `t2-resume-taro-doctor-offline.json`。这些是构建与机器回归证据，不是已部署、开发者工具运行或真机验收记录。

## 2026-11-07 T3：预烧出厂库的发布顺序与验收边界

`bake-seed-db.mjs` 现在先调用真实迁移在内存副本上核对内容，再烧 `content_marker_repair`，
同时预建空用户表及三组可空 FSRS 列；判据和旧库兼容回归见存储、FSRS、同步专题的 T3 节。
不能直接用 sqlite3 给任意库补这个标记：版本字符串相等不代表内容真的迁过。

出厂字节变化后，在 **同一个 worktree** 依次执行：

```bash
cd frontend
node scripts/bake-seed-db.mjs
npm run build:kanji-unit-index
npm run check && npm run lint && node scripts/verify-release-db.mjs
npm run build
cd ../wechat-miniprogram
node scripts/build-shared.mjs
npm test
cd ../taro-spike-2
npm run build:weapp
```

`kanji_reading_unit_index.json` 的 dbSha256 也属于派生产物，不能只保留新的 db；prebuild 会拒绝旧摘要。
iOS 出厂库是忽略文件：本 worktree 的 `frontend/ios/App/App/public/nihongo.db` 已由 bake 同步，
发布校验新增逐字节检查（存在该文件时）；不要假定合并 Git 就会更新另一目录的忽略副本。
11-07 Web/iOS 均为 **12,226,560 B**，SHA-256 均为
`b3e303b3adf95a1020a9171a3a03274aa0caa56b8e5d931a738ca452c731af6b`，`cmp` exit 0。

这次 `check`、`lint`（0 error / 51 个既有 warning）、发布校验、全部 prebuild 与 Web 生产构建通过。
普通 `npm run build:weapp` 在 Doctor 复现 macOS `system-configuration` 的 NULL object panic，已中止，
不能写成原命令通过。此前的资产和 shim 检查已通过，随后只给 Taro 编译加 `--no-check`，
按 package.json 原顺序执行全部后处理、异步内容、API、包体与 referral 检查，退出 0。
fresh 主包 **1,894,761 / 1,900,000 B**，余量 **5,239 B**；所有分包和未许可重复检查通过。
保留由实际构建生成的 reports；未改预算、允许清单或页面。

**云存储还没有更新。** 本任务禁止联网、上传和 GUI；用户需要在要发布的 checkout 自行执行：

```bash
cd wechat-miniprogram && bash scripts/upload-cloud-content.sh
```

默认分支会依次上传 `seed/nihongo.db`、Brotli 的 `seed/nihongo.db.br`，最后写 `seed/manifest.json`。
只发布代码包不会更新云端出厂库，只有上传之后小程序新装才会下载到新字节；本机编译、Node 对拍不证明云端已更新。
本次没有启动 dev server、打开学习页、开发者工具或真机，没有视觉/设备验收，也没有提交或推送。

**库体积成本也要计入。** 相同本机 zlib 参数下，旧→新原库 **11,554,816→12,226,560 B**，
gzip level 9 **2,210,372→2,370,361 B**；上传脚本的 Brotli q11/lgwin24 为
**1,341,500→1,455,575 B**（增加 114,075 B）。两份 Brotli 均解压回原字节；
结果在 `tmp/perf/factory-size-report.json`。这些是本地制品字节，不是实际网络等待时间或线上传输大小。

## ⚠️ 上传被拒「invalid file: lazy/tabs.js, 1:N … Invalid or unexpected token」：对象键里的「・」（2026-11-09）

0.2.6 上传时踩到。dist 里一切正常（引号在、`node --check` 过、ci-local 全绿），只有开发者工具上传 / 预览那一步报错。
原因：开发者工具上传时会再处理一遍代码、去掉对象键的引号；它按新版 Unicode（15.1 起 U+30FB「・」、U+FF65「･」算标识符字符）
把 `"書きます・食べます・します・来ます":…` 写成裸标识符，而微信自己的 JS 引擎不认。改 project.config.json 的 `es6` / `minified` **没用**（试过）。

- 判据：含「・／･」、其余全是标识符字符的字符串，**不许出现在对象字面量的键位置**。要用就写成键值对数组，或放进 `JSON.parse('…')` 字符串。
  webpack 打进来的 `.json` 本来就是 `JSON.parse` 字符串，不受影响；`build-shared.mjs` 的 `jsonModule` 会自动处理；手写的 TS 对象要自己注意。
- 守护：`frontend/src/lib/weapp-unquoted-keys.test.ts` 扫 `frontend/src` 和 `wechat-miniprogram/src`。`kanji_variants` 以前踩过同一个坑（生僻字）。
- 定位方法：报错里贴出的是开发者工具处理**之后**的代码，列号对不上 dist。去 `~/Library/Application Support/微信开发者工具/<hash>/WeappLog/logs/` 最新日志里找 `Object.defineProperty(exports` 开头那一行，按列号切出来看。
- 上传前先 `cli preview --project … --qr-format base64 --qr-output <文件>` 跑一遍：它走同一套检查，但不动任何版本。
- 重建 dist 时开发者工具开着这个项目，之后会一直报「未找到 app.json」（缓存失效；`cli close` 不够、`cli quit` 会关掉作者自己的项目不能用）。
  做法：把 `project.config.json` + `dist/` 复制到一个新目录（如 `~/Documents/shushugo-wt/release-0xx-upload`），从那里预览和上传。
- 提审页的「免费加急包」每年只有 1 次；加急队列拥挤时它会写「预计 12 小时」，比常规审核的「预计 2 小时」还慢 —— 先看提示再决定用不用。


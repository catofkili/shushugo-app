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

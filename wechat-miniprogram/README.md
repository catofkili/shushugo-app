# 收集日微信小程序（离线首版开发中）

这是路线 A 的原生最小验证工程，不会启动或刷新现有 `frontend` 学习页面。
当前已经跑通的闭环是：`WXWebAssembly.instantiate` → `sql.js` → 词库下载/读取 → 今日计划 → 显示答案/三档作答 → FSRS 状态与 reviews 写回 → 自动原子保存 → 撤销/冷启动恢复。

词库、进度、复习流水都留在小程序自己的用户目录；页面不会读取 iOS/Chrome 的学习库。学习核心在 `src/core/study-core.js`，不依赖 `wx.*`，因此可以在 Node 对真实出厂库回归；同步通过 `src/runtime/sync-snapshot.js` 接入现有 Cloudflare Worker 的用户数据快照协议。

## 在微信开发者工具里运行

1. 用微信开发者工具打开本目录，`project.config.json` 的 `miniprogramRoot` 已指向 `src/`。
2. 在 `src/config.js` 填写已经备案并加入小程序业务域名白名单的内容 CDN 地址，例如：

   ```js
   module.exports = {
     seedDatabaseUrl: 'https://cdn.example.com/shushugo/nihongo.db',
     syncUrl: 'https://shushugo-sync.example.workers.dev',
     authUrl: 'https://shushugo-sync.example.workers.dev',
     entitlementUrl: 'https://shushugo-sync.example.workers.dev/api/entitlements',
     paymentUrl: 'https://pay.example.com'
   };
   ```

3. 真机调试时点击「初始化本地库」，首次会下载约 11MB 的 SQLite 词库到 `wx.env.USER_DATA_PATH`。
4. 数据更新、同步、备份、原子写盘和冷启动恢复在「设置与权益」页；学习首页只保留学习动作和产品入口。

开发者工具的本地调试可把 `seedDatabaseUrl` 留空，然后在 `src/config.js` 设置 `seedDatabasePath` 为代码包内的临时 seed 文件；正式包不要把 11MB 词库放进主包。

## 云开发：绕开域名备案的那条路（2026-09-19）

小程序直接调的域名必须 ICP 备案（`request` / `downloadFile` 白名单），而 Cloudflare 备不了案。
云函数和云存储不需要业务域名，所以线上走这条：

```
小程序 ──callFunction('api')──▶ 云函数 api ──fetch──▶ Cloudflare Worker（D1 / R2 / KV 原样）
小程序 ──wx.cloud.downloadFile──▶ 云存储（种子库 / manifest / 例句音频）
```

Worker、iOS 端、同步协议一行都不用动；小程序这侧只换了传输层（`src/runtime/cloud.js` +
`wx-promise.js` 里的分支），`config.cloudEnv` 留空时一切照旧。

### 部署步骤（2026-09-19 实际走过一遍）

1. 小程序后台开通云开发，建一个环境，环境 ID 填进 `src/config.js` 的 `cloudEnv`（现在是 `cloud1-d3g7dauie3961575b`）。
2. 开发者工具里先在 `cloudfunctions` 上右键选「当前环境」（刚建的环境刷不出来就关掉项目重开），
   再右键 `cloudfunctions/api` →「上传并部署：云端安装依赖（不上传 node_modules）」。
   ⚠️ **不要选「所有文件」**：那条不装 `wx-server-sdk`。
3. ⚠️ **超时 / 运行时 / 环境变量要用 tcb 命令行推，`cloudfunctions/api/config.json` 在这版开发者工具里不生效**
   （实测传了三次，控制台一直是 Node 16 + 3 秒 + 环境变量空；3 秒连一次 `/api/sync/status` 都跑不完）。
   配置写在仓库根的 `cloudbaserc.json`，推送：

   ```bash
   npx @cloudbase/cli login          # 设备码登录，浏览器里微信扫码
   npx @cloudbase/cli config update fn api
   ```

   代码本身照旧走开发者工具上传（或 `tcb fn deploy api`，两条路等价）。
4. 词库 + manifest 传云存储：`TCB=<tcb 路径> ./scripts/upload-cloud-content.sh`。
   每次 `bake-seed-db` 之后跑一次；它按 `config.js` 里的 fileID 前缀生成 manifest，
   `expectedBytes / expectedWords / version` 从库里现读。云存储权限用默认的「所有用户可读，仅创建者可读写」。
   读音音频加 `--audio`（只传默认声音 voicevox-8，index.json 也只列它）；`config.js` 的
   `audioBaseUrl` / `audioIndexUrl` 填对应 fileID，`InnerAudioContext.src` 直接吃 `cloud://`。
   ⚠️ **本机 HTTP 代理会让 COS 上传 503**，脚本里把代理变量摘掉了；手动跑 tcb 也要 `env -u HTTPS_PROXY`。
5. `syncUrl` / `authUrl` / `entitlementUrl` 照旧填 Worker 地址 —— 客户端只用它取路径，
   **云函数只认自己的 `WORKER_ORIGIN`**，所以配错也不会把请求发去别处（不然它就是个开放代理）。

### ⚠️ `workers.dev` 从大陆被墙，Worker 必须绑自己的域名

用探针云函数实测（2026-09-19，上海地域）：`https://…workers.dev/…` **8 秒超时**，同一时刻
`https://www.cloudflare.com/cdn-cgi/trace` 569ms 正常 —— 拦的是 `workers.dev` 这个主机名，不是 Cloudflare。
所以 Worker 绑了 `api.shushugo.com`（`cloudflare-sync/wrangler.jsonc` 的 `routes`），云函数的
`WORKER_ORIGIN` 指过去，实测从上海 1.8 秒一个来回。这个域名只有云函数调，小程序不直接碰，
**不需要备案**。域名在腾讯云买的（2026-09-19，实名个人），DNS 托管到 Cloudflare（NS：daisy / lochlan）。
`workers.dev` 那个地址保留着 —— 已发布的 iOS 客户端还指着它。

**2026-09-20 模拟器里全线跑通**：微信登录（`/api/auth/wechat`）→ 同步（gzip 快照经 CDN → 云函数 → Worker → R2）
→ 权益（`/api/entitlements` 返回 `free`）。中间踩到的：`config.js` 的 `privacyVersion` 落后 frontend
一版被 Worker 400（现在 `npm run check` 核对两边）、开发者工具里 `mkdir` 撞已有目录会 fail（当幂等成功）、
微信 API 的 fail 对象只有 `errMsg` 没有 `message`（错误消息统一带上 `errMsg` 和服务端 `detail`）。

代码上 `cloudfunctions/api/index.js` 对 Node 16 也做了兜底（没有全局 `fetch` 就用 `https`），
`WORKER_ORIGIN` 没配时有默认值 —— 控制台默认给的运行时就是 Node 16，别指望配置一定推上去。

### 开发者工具模拟器的三个坑（真机没有，但代码要两边都能跑）

- **`readFile` 一次读 11 MB 会在 `atob` 上炸**（`InvalidCharacterError`，栈在 `ide://extensions/appservice`）。
  `wx-promise.js` 的 `readFile` 现在先 `stat` 再按 2 MB 分块读（`position/length`，基础库 2.10.0+）。
- **返回的 ArrayBuffer 来自另一个 JS 上下文**，`instanceof ArrayBuffer` 是 false；`toBytes` 只看 `byteLength`。
- **`require('x.json')` 不认**（真机也不认）：`src/data/*.json` 是源，`npm run build-data` 生成同名 `.js`
  包一层 `module.exports`，代码只 require `.js`；`project.config.json` 的 `packOptions.ignore` 把源 json 排除出代码包。
  `npm run check` 核对生成物和源一致、没人再 require `.json`。

`npm run lint-undef` 借 frontend 的 eslint 只跑 `no-undef`：首页曾把 `getDatabase` 漏在 require 外，
Node 里的 smoke 全绿、模拟器一跑就炸 —— 这类错只有页面代码真正执行到那一行才露头。

### 几条硬约束

- **快照必须 gzip 了再传**（`sync-client.js`，用 vendor 的 fflate）。云函数入参上限 5 MB，
  未压缩快照十几 MB；二进制请求体走 `wx.cloud.CDN` 中转，云函数收到的是临时 URL ——
  实测是 **`http://vweixinf.tc.qq.com/…`（不是 https）**，云函数只认 `*.qq.com` 下的这种地址，
  https 兜底按协议选 `http`/`https` 模块。
  拉取那边云函数返回值也有上限，所以二进制响应先放进云存储 `sync/<openid>/pull.bin`
  （每次覆盖，不用清理），客户端按 fileID 拉。
- 转发的请求头是白名单（`FORWARD_HEADERS`），回来的也是（`RETURN_HEADERS`）。
- 跨境延迟：云函数（上海/广州）出海到 Cloudflare 边缘，一次同步多几百毫秒。`workers.dev`
  在大陆偶有干扰，真不稳就给 Worker 绑个自定义域名（那个不是小程序直接调的，不需要备案）。
- 用户学习记录经云函数去了海外，隐私政策里要写明数据出境；非敏感、不到 10 万人免申报。
- 判据在 `scripts/cloud-transport-smoke.mjs`（假 `wx.cloud` / 假 `wx-server-sdk` 两端各走一遍）。

## 虚拟支付（个人主体）：签名全在 Worker，客户端只付钱和 verify（2026-09-20 写好，等开通）

`src/runtime/payment.js` ↔ `cloudflare-sync/src/wechat-pay.ts` + `index.ts` 三条路由：

| 路由 | 做什么 |
|---|---|
| `POST /api/pay/wechat/orders` | 下单：入库 `wechat_orders`（迁移 0013）→ 生成 `signData` + `paySig`（AppKey）+ `signature`（用户 session_key） |
| `POST /api/pay/wechat/orders/verify` | `/xpay/query_order` 问微信付了没 → 付了才 `saveEntitlement(source='wechat')` → 最后 `/xpay/notify_provide_goods` |
| `/api/purchases/wechat-notifications` | 小程序后台「消息推送」：GET 握手，POST 收 `xpay_goods_deliver_notify`（走同一个 verify）/ `xpay_refund_notify`（撤销权益） |

和 Apple 那条同一套规矩：**先校验、再授权、最后发货**；推送内容一个字不信，只取单号再去问微信；
一笔订单只归下单的账号（别人来 verify 是 409）；沙箱（`WECHAT_PAY_ENV=1`）的到期时间夹到 30 天。
订阅类商品在微信这边是一次性扣款，到期由我们按天算（月 31 / 年 366 / 永久 null，`PRODUCT_DURATION_DAYS`）。

⚠️ **登录时必须记下 session_key 和 openid**（`rememberWechatSession`，KV 30 天）：signature 用 session_key 签、
查单要 openid。KV 里没有就让用户重新登录一次（下单返回 401 `WECHAT_SESSION_MISSING`）。

开通后要配的 Worker secret / var（`/api/health` 的 `wechatPayConfigured` / `wechatPushConfigured` 会说配齐没）：

```bash
cd cloudflare-sync
npx wrangler secret put WECHAT_PAY_APP_KEY     # 虚拟支付后台给的 AppKey
npx wrangler secret put WECHAT_MSG_TOKEN       # 小程序后台「消息推送」自己填的 Token
```

`wrangler.jsonc` 的 `vars`：`WECHAT_OFFER_ID`（后台给）、`WECHAT_PAY_ENV`（"0" 正式 / "1" 沙箱）、
`WECHAT_PAY_PRICES`（JSON，单位分：`{"shushugo_pro_monthly":1200,"shushugo_pro_yearly":9800,"shushugo_pro_lifetime":29800}`，
2026-09-20 定的价）。小程序后台「消息推送」URL 填 `https://api.shushugo.com/api/purchases/wechat-notifications`，
数据格式选 JSON，Token 和上面那个 secret 一致。

判据：`cloudflare-sync/scripts/wechat-pay.test.mjs`（签名和 Node 的 HMAC 对拍、signData 形状、只有 status=2 算付了、
推送签名）和 `worker-wechat-pay-route.test.mjs`（真实 Worker 构建产物走完下单 → 未付 402 → 付了写权益 → 幂等 → 他人 409 → 退款撤销）。

## 已完成的离线能力

- `npm run smoke` 用仓库真实 `frontend/public/nihongo.db` 完成查询、导出、重新打开和关键表校验。
- `npm run core-smoke` 对真实 10,919 词库验证新词计划、FSRS 作答、复习流水、笔记和安全撤销。
- `npm run sync-smoke` 对拍两份本地库，验证 review 自然键去重和进度合并不会重复插入。
- `npm run sync-snapshot-smoke` 验证与 Worker 同格式的 SQLite 用户快照、跨端合并和本地登录令牌剥离。
- `npm run runtime-smoke` 用 Node 模拟 `wx` 文件系统与 `WXWebAssembly`，验证两次原子保存后主库损坏能从 `.prev` 冷恢复。
- `npm run budget` 检查代码包不携带数据库/音频，并按主包 / 分包各卡 2 MiB：主包约 1.6 MiB（含音高重音、动词自他提示、表记判定数据和共享层），`features` 分包约 0.5 MiB；11 MB 词库仍只走用户目录下载。
- `npm run check` 检查适配器、原子写盘和页面代码的关键约束，并比对表记数据与 iOS 端是否一致。
- 产品层已接上：经典/快速/错题/反向/汉字读音/自选六个入口；词库筛选、记忆色阶、批量熟知、收藏、笔记和详情；741 条本地语法；从真实词库现算的 1,912 组疑难辨析；47 个成就（判据来自网页同一份源码）；收藏夹、备考计划、周报、柚子商店、查词汇量（同上，见「共享层」）；统计、28 天学习日历、JLPT 进度地图、温泉打卡和图鉴。卡片还会显示音高重音、例句假名、词源、动词类型、例句词典和辨析提示。
- 首页已提供学习入口、查词库、语法、辨析、成就、旅程、账号绑定和权益入口；数据更新、同步、备份等维护动作已移到「设置与权益」，不再和学习卡混在一起。没有配置服务端时，同步/支付会明确保持不可用，不会伪造成功。

## 汉字读音方向：和 iOS 对齐的三件事

iOS 端把原来的「释义 → 汉字」改成了**汉字读音**（表记 → 读音），小程序这侧同步跟上，
否则两端写的是同一张 `kanji_reading_memory`，却在训练两种不同的题型：

1. **题面是表记，只遮汉字对应的那几拍**（`core/orthography.js` 的 `concealedReadingParts`）。
   中文母语者认得字，盲区在读音——把汉字也藏起来等于考错了东西。
2. **流水写 `reviews.direction = 'kanji_reading'`**。路由键仍叫 `kanji`（页面和本地
   `direction_tasks` 用它），但写进流水的字符串必须和 iOS 一致：写成 `'kanji'` 的话，
   iOS 会当成归档的旧题型，小程序答过的卡在那边不算「今天答过」，会被再问一遍。
3. **按表记优先级筛词**：`src/data/kanji_orthography.json` 是从 iOS 端拷来的同一份数据
   （165 条，源头是 `frontend/scripts/audit-kanji-orthography.mjs` + 人工判定文件）。
   不筛的话 コーヒー、ちょうど 这类本来就写假名的词也会被拿去考读音。
   **别在小程序这侧手改这个 JSON**：`npm run check` 会逐字节比对两份，不一致直接报错。

### 删除同步的兼容边界

快照层现在会把 iOS 的 `table_name/row_key` 和小程序的 `entity/natural_key` 映射成同一份双别名墓碑；导入 iOS 快照时会按删除时间清理小程序对应的 `progress`、方向记忆、任务、笔记、复习流水、打卡、收藏/状态等支持表，避免已合并的重复词重新出现。
仍有一条边界：iOS 侧尚未纳入小程序 schema 的语法高亮、语法阅读位置等表，当前只保留墓碑，不会凭空创建这些表；两端要完全覆盖这些表，仍需后续 schema 对齐。

疑难辨析的分组键和 iOS 一样只看冻结的 `words.sense_key`，不看 `words.meaning`（2026-09-19 修：
09-16 那次释义审校同步进 `words.meaning` 之后，按 meaning 分组从 1,912 掉到 1,722 组，近义组全散了）。
iOS 的人工名单（`frontend/src/data/confusion_manual_review.ts` 里参与分组的两份：稳定表记合并、
排除的假近义组）由 `npm run build-data` 抽成 `src/data/confusion_manual_review.json` 共用，
`npm run check` 核对和 TS 逐字一致；重复行的存活判据也补了 iOS 的 `bareRepeat`。
修完出厂库上两端都是 **1,881 组**，逐组比对只剩 **4 / 4 组**不一样，全是同一类边界：
やめる 三行（1217/1535/2503）谁跟谁配、lock/rock 那对英文源、脅かす 两个读音（9407/9413）、
品 两个读音（1501/3087）—— 都是「同一个词有多行时挑哪一行」的并列判定，不是算法分家。
两端写的是同一个 `confusion_mastered`，这 8 组的差异只影响「哪一组里能看到这个词」。

### 删除同步的兼容边界

快照层现在会把 iOS 的 `table_name/row_key` 和小程序的 `entity/natural_key` 映射成同一份双别名墓碑；导入 iOS 快照时会按删除时间清理小程序对应的 `progress`、方向记忆、任务、笔记、复习流水、打卡、收藏/状态等支持表，避免已合并的重复词重新出现。
仍有一条边界：iOS 侧尚未纳入小程序 schema 的语法高亮、语法阅读位置等表，当前只保留墓碑，不会凭空创建这些表；两端要完全覆盖这些表，仍需后续 schema 对齐。

疑难辨析的分组键和 iOS 一样只看冻结的 `words.sense_key`，不看 `words.meaning`（2026-09-19 修：
09-16 那次释义审校同步进 `words.meaning` 之后，按 meaning 分组从 1,912 掉到 1,722 组，近义组全散了）。
修完出厂库上小程序 1,911 组、iOS 1,881 组：**只在小程序有 43 组、只在 iOS 有 13 组**，差的是 iOS 端
`src/data/confusion_manual_review.ts` 那三份人工名单（排除的近义组、手判异写、保留的表记撞车）
小程序没有搬过来。两端写的是同一个 `confusion_mastered`，发布前要么把那三份名单搬过来，要么接受这几十组只在一端出现。

## 内容更新与同步接口约定

内容 manifest 是小 JSON，不把大库塞进代码包：

```json
{
  "version": "2026-09-01-content-v2",
  "databaseUrl": "https://cdn.example.com/shushugo/nihongo.db",
  "expectedBytes": 11288576,
  "expectedWords": 10919
}
```

同步客户端已经对齐仓库内 `cloudflare-sync` Worker：

- `GET /api/sync/status`：读取账号的 generation/last_modified；
- `POST /api/sync/push`：以 `application/octet-stream` 上传 `master-nihongo-user-sqlite-v1`，`x-sync-compression: gzip`；
- `GET /api/sync/pull`：以二进制返回快照，能读取 Worker 的 `none` 或 `gzip`；
- 小程序先拉取并按行合并，再带 `x-sync-base-generation` 上传，避免首次绑定时覆盖云端；review 仍按 `word_id + created_at + direction` 去重，登录令牌和设备本地状态永不进入快照。
- 为了让 iOS 的 LWW 合并识别小程序刚刚答过的卡，快照会补充 `sync_updated_at/sync_origin_device` 两列（本地业务表不因此膨胀）；进度时间取 FSRS 最近复习时间，流水时间取 `created_at`。

Worker 的同步入口要求已验证账号（`requireVerifiedUser`）。小程序的微信 `wx.login`/`code2session` 代码路径已经接上，但仍需配置 Worker secrets 后，才可在真机打开账号同步与收费闭环。

支付走上面「虚拟支付」那一节，不再是商户支付（`wx.requestPayment`）。

## 仍需要真机/外部系统才能完成的出口

- 微信开发者工具和 iOS/Android 真机：首次下载、WASM 初始化、冷启动恢复、原子写盘、峰值内存和 ruby/字体排版；
- 云开发环境（见上节）；不走云开发的话才需要已备案 HTTPS 域名与业务域名白名单；
- Worker 的微信登录已经有 `/api/auth/wechat` 代码路径；上线仍需在 Cloudflare secret 配置 `WECHAT_APP_ID/WECHAT_APP_SECRET`，并在微信公众平台完成小程序主体、业务域名和审核配置；支付下单/回调与审核资质仍必须由商户侧完成。

## 共享层：能从网页源码打出来的，就不再手抄（2026-09-22）

`src/shared/web.js` 由 `scripts/build-shared.mjs` 用 esbuild 把 `frontend/src/lib` 里的纯数据层模块
**原样**打成小程序能 `require` 的一个文件（约 140 KiB，进主包）。入口清单在
`scripts/shared/entry.ts`，现在收了：收藏夹（favorites-api）、备考计划（jlpt/plan + status）、
周报（analytics/weekly + weekly-reports）、柚子（yuzu + yuzu-catalog）、查词汇量（vocab-test）、
成就（achievements）、studyPreferences、连击、review-budget。

为什么：这些功能之前是「照着网页重写一份」，而它们的表全是跨端同步的，漂移就直接出现在对端——
成就表叫 `achievement_unlocked`（网页叫 `achievements`，两端各解各的）、语法收藏存数字 id
（网页存 grammar.ts 的字符串 id，互相看不懂）、词汇量没有猜测修正、可信度写成了正确率、
周报的 `content_json` 是另一种形状（网页按 schema_version 3 解析会拿到垃圾）。
同一份源码编出来，就不会再漂。

规则：

- **数据层从网页来，页面（WXML）手写。** 只收不碰 DOM、不带出厂内容 JSON 的模块；构建脚本会拒绝
  `src/data/*.json` 进包、拒绝超过 400 KiB。
- 需要平台能力的模块在 `scripts/shared/shims/` 换成小程序自己的实现（库句柄、落盘、正字法、辨析组、
  `word-api/stage1`…）。⚠️ **`stage1` 必须 shim 成只读**：网页那份 `stage1ProgressCounts` 会先按
  网页的排计划器往 `stage1_tasks` 写行、还按 `stage1_plan_version` 删没答的行，直接接上等于每次
  结算柚子都把今天的计划重排一遍。
- `localStorage` / `window` / `document` 由 `scripts/shared/polyfill.js` 提供替身（内联在 web.js 顶部）：
  `studyPreferences` 因此落在 wx 存储的 `mn-study-preferences` 键上，和网页同名。
- 小程序没有网页那套同步触发器，所以 `runtime/extended-features.js` 在每次写收藏 / 夹子之后**自己盖
  `sync_updated_at`、自己补墓碑**——不盖，lww 合并时本机刚移的夹子会输给对端的旧行。
- 语法收藏用 grammar.ts 的字符串 id：`data/grammar_ids.json`（`grammar_points.id == bookOrder` ↔ `pdf-n5-041-2`）
  由 build-shared 从 grammar.ts 抽出来，列表打星在 JS 里按它换算。
- 产物必须提交。`npm run check-shared` 重新构建一次比对，网页那边改了源码没重跑这里就红；
  `npm test` 里 `build-shared` 会先跑一遍。
- `data/*.json` 是数据模块的源，放在 `src/` 外面：放里面会被开发者工具整个打进主包（pitch_accent 一份 266 KiB）。

还没搬过来、仍是小程序自己一份的：单词调度（`core/study-core.js` 的 createTodayPlan，网页是
`word-api/stage1` + scheduler）、疑难辨析分组（`runtime/confusion.js`，网页 1,933 组 / 小程序 1,881 组）、
辨析题（页面还在用 `words.meaning` 当题面，网页规定缺人工题面就整组跳过）、题面层
（`question_meaning_overrides.json`，1 MB）、混合学习的汉字卡 / 连线卡。这几样都要先把
出厂内容数据（题面、辨析审校、sense_key，合计约 2 MB）放进一个分包再谈。

## 仍在继续的开发轨

下一步仍是把本目录的 `runtime` 适配器接到独立的 Taro 4 + React 18 工程（P0-B），并继续完善沉浸式语法阅读、例句 token 词典弹层、两端辨析组逐组对齐和真机排版/内存验证；这不会刷新或改写现有 iOS 学习页面。

## 第三方运行时

- `src/vendor/ts-fsrs.umd.js`：ts-fsrs，MIT License；
- `src/vendor/sql-wasm.js` 与 `src/assets/sql-wasm.wasm`：sql.js，MIT License；
- `src/vendor/fflate.umd.js`：fflate，MIT License（同步快照 gzip）。

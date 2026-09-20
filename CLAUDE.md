# 收集日（ShuShuGo）— Claude 工作须知

## ⚠️ 查我的真实学习数据：`cd frontend && npm run db -- <词>`

**每次新开聊天先看这里，不要再去仓库里翻 .db 文件，也别一上来就连真实 Chrome。**

```bash
cd frontend && npm run db -- 食べる      # 单词详情：FSRS 状态 + 最近作答 + 笔记
cd frontend && npm run db -- --status    # 快照多新 + 最近 14 天 + 到期池
cd frontend && npm run db -- --sql "SELECT ..."   # 任意只读 SQL
```

读的是 `frontend/.local/live.db`（gitignore，个人数据不入库）。这份文件由 dev server
写入：`vite.config.ts` 的 `live-db-snapshot` 插件挂了个只收本机的 `POST /__live-snapshot`，
`storage.ts` 每次写盘（以及页面加载时）把整库送过去，节流 20 秒一次。
所以**只要用户的 `npm run dev` 开着、页面打开过，命令行就有当天的数据**。
`--status` 第一行会打印快照写于多久前，先看它再下结论。
⚠️ **快照只从 5173 端口的 dev server 收**（`vite.config.ts`）：Claude 自己起的验证服务器（5199）配合应用内 Browser pane 打开的是空种子库，2026-09-16 曾把真实快照覆盖成出厂库。看真实数据前先 `--status` 看 reviews 数，是 0 就是被盖了，让用户在自己的 Chrome 里刷新一次 5173 页面即可恢复。

快照缺失/太旧时的排查顺序：dev server 是否在跑 → 用户是否打开过页面 → 是不是改了
`vite.config.ts` 后没重启 dev server（插件是启动时装载的）。实在要现场取数再走下面的
Chrome 兜底，且**只取一次、不许反复刷用户的学习标签页**。

### 数据到底存在哪（原理，别忘）

- 用户日常在 **自己的 Chrome** 打开 `http://localhost:5173`（`cd frontend && npm run dev`）背单词。
- 学习记录存在**那个浏览器的 IndexedDB** 里，不在仓库任何文件里：
  - DB 名 `master-nihongo-storage` → store `databases` → key `study-database`
    （改名到收集日时**故意没改这个字符串**——改了就找不到已有的真实数据，见 `storage.ts` 的 `BROWSER_DB_NAME`）
  - 内容是一整份 SQLite blob（约 7.8 MB）
- **仓库里的 .db 都不是实时数据**：
  - `frontend/public/nihongo.db` = 干净种子库（reviews 表为空，有白名单守卫）
  - `记忆数据合并/*.db`、`nihongo-import-*.db` = 历史导出快照，会停在很早的日期
  - Cloudflare D1 只存整库 blob，SQL 查不出学习记录
- **应用内浏览器（Browser pane）里的那份也是空种子**，必须用 `claude-in-chrome` 连到用户真实 Chrome。

### 兜底：直接从真实 Chrome 取数（只读，不动用户会话）

只在快照拿不到时用。在真实 Chrome 的 `localhost:5173` 标签页里执行：

```js
const mod = await import("/node_modules/.vite/deps/sql__js.js");   // 版本号 ?v= 可从 curl localhost:5173/src/lib/database.ts 取
const initSqlJs = mod.default.__esModule ? mod.default.default : mod.default;
const SQL = await initSqlJs({ locateFile: () => "/node_modules/sql.js/dist/sql-wasm.wasm" });
const bytes = await new Promise((res) => {
  const r = indexedDB.open('master-nihongo-storage', 1);
  r.onsuccess = () => {
    const g = r.result.transaction('databases', 'readonly').objectStore('databases').get('study-database');
    g.onsuccess = () => res(new Uint8Array(g.result));
  };
});
const db = new SQL.Database(bytes);   // 独立副本，不碰应用自己的实例
db.exec("SELECT reviewed_on, COUNT(DISTINCT word_id) FROM reviews GROUP BY reviewed_on ORDER BY reviewed_on DESC LIMIT 14");
```

注意：IndexedDB 里是**上次保存的快照**，当天的量可能还没落盘。

## 仓库速记

- 主应用：`frontend/`（React 19 + TS + Vite + Tailwind，SQLite 走 sql.js/WASM，Capacitor 打 iOS）
- 云同步：`cloudflare-sync/`（Worker + D1 + R2；快照进 R2，版本/幂等记录进 D1，限速用 KV）。
  客户端按行合并，不是整库覆盖（`lib/sync/merge.ts`）

## 内购：收据长什么样、权益归谁、退款怎么回来（2026-09-09 修）

`frontend/src/lib/purchases.ts` + `cloudflare-sync/src/index.ts` 的 `applyAppleTransaction`。
这一整节都是 2026-09-09 那次审计里**可复现**的付费错误，别照着老代码改回去。

### ⚠️ 收据有两种结构，只认一种就等于收了钱不发货

应用**没有配 `store.validator`**。`cordova-plugin-purchase` 在
`validator.ts` 的 `if (!this.controller.validator)` 分支里会「为了向后兼容，视为已验证」，
于是交出来的 `VerifiedReceipt` 长这样：

| | 配了 validator | **没配（当前就是这种）** |
|---|---|---|
| 商品在哪 | `receipt.collection[].id` | `receipt.sourceReceipt.transactions[].products[].id` |
| `receipt.id` 是什么 | 商品 id | **首笔交易 ID** |
| 到期时间 | `expiryDate`（毫秒数） | `transaction.expirationDate`（Date） |

老代码优先把 `receipt.id` 当商品 ID，又去查一个根本不存在的顶层 `receipt.transactions`。
隔离复现（用插件真实的 `VerifiedReceipt` 类 + 应用真实的回调）：合法收据进来后
**授权 0 次、云校验 0 次、`finish()` 1 次** —— 钱付了、交易被完成、用户什么都没拿到。

现在两种都读（`receiptPurchases`，collection 优先、缺的字段由本地收据补），
判据钉在 `purchases.test.ts`。⚠️ **别再写「没匹配上就拿第一条」的兜底** ——
那是把另一个商品的到期时间当成本商品的，正是同一类错误。

### 权益落地的顺序：先校验、再授权、最后 finish()

`finish()` 之后 Apple 认为货已发出，所以它必须在最后。云端校验通过时
`applyCloudEntitlements` 已经把权益写好了；校验失败（离线、服务端故障、
**买的时候还没登录**）不能把这笔交易丢掉 —— 排进 `mn-pending-purchase-verifications`，
启动时和 `CLOUD_AUTH_EVENT`（登录成功）各重试一次。

⚠️ **订阅缺到期时间时不许 `grantPro(id, source, undefined)`** —— 那个签名的语义是
「永不过期」，用在订阅上等于取消续订之后本地 Pro 永远留着。没有到期时间就给
3 天离线宽限期，下次联网由云端权益覆盖。同理，`storekit` 这一档（没经过云端校验的
本地授权）有 30 天离线上限：每次启动 StoreKit 都会重新校验本地收据并刷新
`updatedAt`，正常使用碰不到；它挡的是「一台长期不联网的设备上退款永远传不进来」。

**localStorage 从来不是授权边界**（网页用户能改）。联网时云端说了算。

### ⚠️ 一笔 Apple 交易只能给一个应用账号（`apple_transaction_owners`）

`purchase_events.transaction_id` 上确实有唯一索引，但它是在 `saveEntitlement`
**之后**用 `INSERT OR IGNORE` 写的：第二个账号提交同一笔交易时权益早就写进去了。
实测 A、B 两账号提交同一交易，**都返回 200 / isPro=true**，权益两行、事件一行。

归属现在由 `apple_transaction_owners`（`original_transaction_id` 主键）在**写权益之前**
用一条原子的 `INSERT OR IGNORE` + 读回决定，不是本人就 409。
迁移 `0009` 会把已有权益行的归属回填，否则老用户续费会被自己挡住。

### ⚠️ 权益不许被更弱的交易覆盖（`entitlement-rules.ts`）

每个账号只有一行权益，老代码是任意一笔验证通过的交易直接覆盖它。
实测：先拿到永久 Pro，再校验一笔**已过期的月度订单**，最终响应变成 `isPro=false`。
恢复历史订单、或者响应到达顺序变一下就会触发，不需要伪造订单。

判据是 `entitlementStrength`：永久（无到期时间）> 有效订阅 > 过期订单 > 没有权益，
而**没有到期时间的订阅是最弱的一档**（不能顺手解释成永久）。
只有更强才准覆盖；例外是**同一笔原始交易**的新消息（续费、到期、退款）——
它永远可以改写自己那一行，包括往下改。钉在 `scripts/entitlement-rules.test.mjs`。

### 退款/撤销的闭环有三条路，缺一条都会「退了款还是 Pro」

`/api/entitlements` 只读 D1，缓存自己发现不了退款（实测：写入永久权益后模拟退款，
再查权益仍返回 Pro，Apple 重查次数 **0**）。而**永久购买永远不会过期**，
没有任何别的路径会去看它一眼。三条：

1. **App Store Server Notifications V2**（`/api/purchases/apple-notifications`）。
   ⚠️ **一个字都不信 `signedPayload`**：只从里面取交易号，然后照常用带鉴权的
   App Store Server API 把这笔交易查一遍，用查回来的结果做决定。这样不必在 Worker 里
   实现 x5c 证书链校验，也天然免疫重复投递和乱序 —— 每次都是「现在 Apple 怎么说」。
2. **`/api/entitlements` 上的每日重查**：`app_store` 来源的权益超过 24 小时没核对过就查一次。
3. **定时任务重查最旧的 25 行**（超过 7 天的），覆盖根本不打开 App 的账号。

⚠️ **Apple 查不通时必须把下次重查往后推一小时**，不能只 `catch` 就算了：
`updated_at` 兼作「上次核对时间」，不动的话它一直是陈的，于是 Apple 挂着的时候
这个账号的**每一次** GET 都会再去撞一次 —— 而客户端每次启动都会调这个接口。

被撤销的交易不只是拒绝这次请求，还要 `revokeEntitlementForTransaction` 把那份权益撤掉。

⚠️ **`updated_at` 兼作「上次向 Apple 核对是什么时候」**，所以「候选更弱、不覆盖」
那条路径也要盖一下时间戳，否则每日重查会认为这行永远是陈的，每次请求都打一次 Apple。

⚠️ **`purchase_events` 的唯一索引是 (transaction_id, user_id, status)**（迁移 `0011`）。
原来只有 transaction_id，退款回来时那条 `revoked` 事件会被 `INSERT OR IGNORE` 丢掉 ——
审计线索正好断在最需要它的地方。

### 沙盒交易有 30 天上限

TestFlight 和 App 审核用的都是沙盒交易，不能直接拒；但实测一笔**沙盒的永久购买**
会变成正式账号上永不过期的 Pro。所以沙盒来源的权益到期时间一律夹到 30 天以内。

## ⚠️ Apple 登录：算法要跟着 Apple 的公钥走，写死 ES256 是登不上的（2026-09-09 修）

`verifyAppleIdentityToken`。老代码只接受 `alg === "ES256"` 并按 ECDSA P-256 导入公钥。
直接读 <https://appleid.apple.com/auth/keys>，返回的三把 key **全是 `kty=RSA / alg=RS256`**。
构造一个合法的 RS256 身份 token 交进去，代码在取公钥之前就 401 —— 关联 Apple、
删号后重新认证走的也是这个函数。

现在按 JWK 的 `kty` 选算法（严格白名单 RS256/ES256，且必须和 `jwk.alg` 对上），
issuer / audience / expiry 校验原样保留。

⚠️ **App Store Server API 的开发者签名 JWT 确实是 ES256**（`createAppleJwt`），
那是另一件事，别一起改错。

**重放防护不靠 nonce**：nonce 由客户端给、还能整个省略，挡不住「把同一份 identity token
再发一次」。现在记下 token 哈希放进 KV（TTL 到它自己的 exp），有效期内第二次直接拒。

## 小程序不是「能收 v2」就等于双向无损（2026-09-09 修）

⚠️ **Worker 不做按表合并**：它把每次上传当成这个账号新的**完整备份**。
所以任何一端少导出一张表，云端最新那一代就缺那张表；攒够三代之后，
最后一份完整的快照退出保留范围，全新设备再也恢复不出来。
**「老设备本地还有一份」不是云备份完整。**

两处已修：

1. **作答流水的身份是 `sync_uid`，不是 `(word_id, created_at, direction)`。**
   `created_at` 只到秒，前端同一秒答两次会产生两条自然键完全相同的作答；
   把前端**实际导出器**产生的这两条交给小程序**实际合并器**，2 条只进来 **1 条**。
   小程序的 `reviews` 现在也有 `sync_uid` 列（`ensureStudySchema` 里加列 + 回填
   `设备号:本机行号`，格式和 iOS 一致），导出协议版本随之抬到 **2**。
   ⚠️ **抬版本号和补那一列必须一起做** —— 写着 v2 却没有那一列比拒绝导入更难查。
2. **小程序看不懂的表原样存下来、原样回传**（`sync_passthrough`）。
   收快照时把不在 `SNAPSHOT_TABLES` 里的表（`grammar_progress`、语法流水、收藏、
   汉字单元……）连建表 SQL 和行一起存进本地一张表，导出时重放。
   每次收到新快照整个换掉那一份 —— 和前端本地增量同一个道理：
   后一条完整覆盖前一条，不需要序号也不会有「回放了一半」。
   小程序后来真的认识了某张表，本地那份才是真相，透传里那条会被删掉。

判据在 `wechat-miniprogram/scripts/sync-snapshot-smoke.mjs` 末尾那段**真实往返**
（前端形态的快照 → 小程序合并 → 小程序导出），CI 里跑。

### ⚠️ 透传只保护「小程序不写的表」（2026-09-10 修）

上面第 2 条对**小程序只读的表**成立，对**小程序自己会写的表**是假的：
透传送回去的是「上次收到的远端副本」，本机新写的一个字都出不去。

`grammar_progress` / `grammar_state` 正是这种：`markGrammar` 和
`toggleGrammarFavorite` 会写它们，而它们当时不在 `SNAPSHOT_TABLES` 里 ——
**小程序上背的语法进度、点的语法收藏，一次都没同步出去过**。
现在两张表都进了正式协议，各自有合并规则（`mergeGrammarProgress` 和 progress
同一套口径：计数取大、FSRS 看谁的 `fsrs_last_review` 新）。

⚠️ **进了 `SNAPSHOT_TABLES` 就等于退出了透传的保护**，于是多出两条硬约束：

1. **表必须无条件建出来**（`ensureStudySchema` 里调 `ensureGrammarSchema`），
   不能等语法页第一次打开。表不存在时导出和合并都会静默跳过 ——
   对端的语法进度会在小程序推上去的那一代快照里凭空消失。
2. **列必须和 iOS 的 `grammar_progress` 逐列对齐**（`GRAMMAR_PROGRESS_COLUMNS`）。
   导出只写本机有的列、合并只收两边都有的列，**少一列就等于每次推快照都把
   iOS 那一列从云端最新那一代里抹掉**。smoke 里逐列断言。

⚠️ **`grammar_state.dataset_version` 不进快照**（`LOCAL_GRAMMAR_STATE_KEYS`）：
和 iOS 端 `isDeviceLocalStateKey` 是同一条判据，理由见下面「本机内容迁到哪一版」那节。

### ⚠️ 语法收藏的读和写曾经不在同一张表（2026-09-10 修）

`toggleGrammarFavorite` 用 `core.setState` 写 **app_state**，而 `grammarRows` 的
JOIN 读的是 **grammar_state** —— **点了收藏永远显示不出来**，一次都没成功过。
现在读写都走 `grammar_state`，并把已经误写进 app_state 的
`favorite:*` 迁过来（`migrateFavoritesFromAppState`）。

## ⚠️ 自定义词条的 id 由内容算，不用自增（2026-09-09 修）

`words` 表**不进云快照**（出厂词典两端一致），但 `progress` / `word_notes` /
`reviews` / 收藏全是按 `word_id` 同步的。用自增 id 给用户导入的新词分配身份，
后果是两条：两台设备各导入一个新词会拿到**同一个 id**（相同数字不代表同一个词），
而一台没有这个自定义词的新设备只会收到一堆悬空的学习记录。

现在：

- id = `customWordId(kanji, kana)` —— 内容哈希，落在 `1e12` 起的一段里
  （出厂词典最大 id 才一万出头，永不重叠），两端天生对上；
- 内容本身进同步表 **`custom_words`**（`union`，导入后不再改）；
- 合并之后 `materializeCustomWords()` 把本机还没有的词行补出来，并补 `progress` 行。
  这一步挂在 `mergeDatabaseBytes` 里 —— 所有合并路径都走那儿。

⚠️ 照例三处登记：`sync/tables.ts`、`scripts/user-data-tables.mjs`（出厂库泄漏守卫）、
`legacy-word-migrations` 的合并搬迁（合并重复词条时要把 `custom_words` 那行一起删掉，
否则同步下去会把刚合并掉的词复活）。

ponytail: 哈希空间 1e12 + 本机探测。真撞上（万级自定义词约 5e-5 概率）时，探测出来的
那个 id 只在本机成立，那**一个**词跨端对不上；要根治得给自定义词一个独立的字符串身份
并在合并时做引用重映射。

## ⚠️ 「本机内容迁到哪一版」的标记绝不能跨设备同步（2026-09-09 修）

`jlpt_seed_version`、`furigana_version`、`jlpt_word_metadata_version`、
`jlpt_collocation_content_version`、`dictionary_supplement_version`、
`jlpt_level_override_version`、`kana_reading_fix_version`、`legacy_biru_merge_version`
（在 `app_state`），以及 `grammar_state` 的 `dataset_version`。

这些描述的是**本地内容**，而 `words` / `grammar_points` 根本不进快照。
同步它们等于把对端的「已完成」写到一台还没跑过迁移的设备上，而迁移的入口判断是
「版本号相等就直接返回」—— 结果是版本标记新、词典是旧的，而且不会自己好：
每次启动都在同一个相等判断上早退。语法那条更贵：`ensureGrammarSeed` 是按 pattern
把用户进度迁到新 id 的，被跳过一次就意味着这台设备的 grammar_id 和别人错位。

现在导出（`snapshot.ts`）和导入（`merge.ts`）**两侧都过滤**，共用
`tables.ts` 的 `isDeviceLocalStateKey(table, key)` 一份判据。

已经被写坏的库分两种修法，**不能用同一种**：

- **app_state 那几个词典侧的标记**：`repairSyncedContentMarkers()` 一次性清掉重跑。
  它们对应的迁移都是「补行 / 补列」，幂等且只增不删，代价只是一次启动慢一点。
- ⚠️ **`grammar_state.dataset_version` 绝不能这样清。** 语法那条重建会
  `DELETE FROM grammar_points` + 重排 id + 清空 `grammar_state.queue` + 往 archive
  写一整份 741 行 —— 对没被写坏的库全是白付的代价和风险，而且它正是 CLAUDE.md
  里那条「从没跑过的代码路径」。改成**自愈判据**：`ensureGrammarSeed` 的早退条件
  从「版本戳相等」变成「版本戳相等**且** `COUNT(*) == GRAMMAR_SEED_ROW_COUNT`」。
  一次 COUNT 很便宜，只有真的对不上（比如被写坏后还停在 731 条）才付重建的代价，
  而且以后再被写坏也能自己爬回来，不需要再写一次性修复代码。
  常数由 `verify-release-db.mjs` 和出厂库、seed 一起钉住 —— 写错就等于那道兜底
  常年误触发或者常年不触发。

⚠️ **不能粗暴过滤所有带 `version` 的键**：`stage1_plan_version` 说的是
「今天的计划按哪一版算法排的」，那是用户调度状态，该同步。

## ⚠️ 快照容量有一个具体的死线：2026-11-03（2026-09-09 实测）

**这不是"长期会增长"，是八周。** 实测（真实库 49,696 条 reviews）：

| | |
|---|---:|
| 快照未压缩 | **13.48 MB（占 20 MB 上限 67.4%）** |
| gzip 后 | 1.64 MB |
| reviews 占 | 9.24 MB / 49,696 行 = **186 B/行** |
| 用户每天作答 | 636 条 ≈ 每天涨 **118 KB** |
| 按此速度撞 20 MB | **约 55 天，2026-11-03** |

⚠️ **gzip 后只有 1.64 MB 会让人以为还早得很** —— 闸门卡的是压缩**前**的字节数。

**已做：上限 20 → 48 MB**，买到约 292 天。理由是那个 20 MB 本来就是拍的，
而且**比 App 自己的内存基线还紧**：本机整库 39.28 MB 一直常驻在 sql.js 的 WASM 堆里，
「解压出 20 MB 会撑爆内存」这个担心在一个已经常驻 39 MB 的进程里不成立。
Worker 侧不受影响 —— 它只把 gzip blob 原样存进 R2，**从不解压**（查过了）。

⚠️⚠️ **这是买时间，不是修好了。** 48 MB 也会到。真正的问题是每次小改动仍然上传
全部历史。顺带一条实测：9.24 MB 的 reviews 里约 **3.6 MB 是同一个 36 字节设备 UUID**
在 `sync_origin_device` 和 `sync_uid` 两列里重复了五万遍（`distinct = 1`）——
这部分是纯冗余，但压掉它要动快照格式，前端和小程序两边的合并器都得跟着升，
属于协议 v3，不是顺手能做的。**云端增量协议必须在 48 MB 撞上之前落地**
（远端游标、删除、断线重试、离线设备重返、兼容窗口一起设计；
本地的 `local-delta.ts` **不是**那个东西）。

## 快照容量：上限卡的是压缩前的字节数（2026-09-09）

实测（2026-09-09 的 `live.db`）：本地整库 39.17 MB，**仅用户表快照未压缩 13.98 MB**，
gzip 后 1.73 MB。看着离 20 MB 还很远，实际已经用掉 **69.9%** —— 因为
`compressSyncSnapshot` 的上限卡在压缩**前**。reviews 只增不减，这个数只会往上走，
撞上限之后同步会直接停。

- 设置页的云同步卡里常驻一行「云备份体积 x / 20 MB（n%）」，≥85% 变橙并说明后果。
  这个数由**现导一次**得到 —— 没同步过的会话里摆一个 0 出来比不摆更误导。
- `copyTable` 改成**边读边写**：一条 prepare 好的 INSERT 复用到底，
  不再先把整张表装进 `values[]`（reviews 一张表四万多行，先攒后写等于在导出那一刻
  把整份用户数据在 JS 堆上再复制一份）。
- 导出保留窗口从 `stage1_tasks` 扩到 `stage2_progress` / `kanji_progress` /
  `kanji_reading_progress` / `kanji_unit_tasks`（各 14 天）。
  ⚠️ 这是**逐个查过消费者**的结论：这几张表的每一条读取都是 `reviewed_on = 今天`，
  `critical_reviews` 运行时干脆没有读取方。「stage1 裁了」不等于别的表自动享受同一条策略。

**不做的事**：不为了省几十 KB 删墓碑或历史 reviews（墓碑关系到旧设备会不会复活已删记录，
流水关系到统计和恢复）；也不把 20 MB 改成一个大数字了事（解压内存和新设备恢复仍然是约束）。
真要上云端增量协议，得连远端游标、删除、断线重试、离线设备重返和兼容窗口一起设计——
本地的 `local-delta.ts` **不是**已经实现了云端增量协议。

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

## 请求体、限速与配置降级（2026-09-09）

- **边读边数，超了当场断开**（`readBodyBytes`）。⚠️ 不能只看 `content-length`：
  那个头是可选的，分块传输的请求根本没有它，于是「先 `arrayBuffer()` 读完、
  再检查实际长度」在真正超大的请求上已经把内存占掉了才发现。
  JSON 路由默认 64 KB，个人资料 4 MB（要带 base64 头像），同步推送走原有上限。
- **认证限速改用 D1 的原子 UPSERT**（`auth_rate_limits`，迁移 `0010`）。
  原来是 KV 的 `get → put`：两个节点同时读到 4、同时写回 5，实际放过了两次。
  对同步接口那种「别刷爆账单」够用，对登录爆破和验证码枚举不够。
  改密码这类**认证之后**的昂贵路由也补上了按账号限速。
- **改昵称不再重发头像**：客户端记下上次推上去那份头像的指纹，没变就整个不带
  `avatar` 字段（服务端早就支持「字段缺席 = 不动」），响应也不再把 3 MB 头像原样送回。
- **`REQUIRE_AUTH_HARDENING=1`**：Turnstile 或邮件服务没配好时，注册/登录/找回密码
  直接 503。配置缺一半就整个关掉是给本地开发用的；部署时打错一个变量名会变成
  **静默降级** —— 人机验证没了、邮箱验证没了，而接口一切正常、没有任何告警。
  ⚠️ 这个开关**默认关着**，生产部署时要自己打开（打开之前先确认两样都配好了，
  否则线上会立刻 503）。

## 云同步：花钱的是请求次数和快照体积，不是表的数量

同步是**整份用户表快照**（`master-nihongo-user-sqlite-v1`，gzip 后进 R2），不是按表增量。
所以**加一张同步表不增加任何请求数**，只让快照多几 KB —— 别为了省钱不敢建表。

实测用户库（2026-08-23，86,361 行）：快照 12.75 MB 未压缩 / **1.59 MB gzip**。
行数前三：reviews 36,743 · stage1_tasks 25,463 · progress 11,056。

真正花钱的两处，都已经动过：

1. **`stage1_tasks` 只上传最近 14 天**（`sync/snapshot.ts` 的 `DATED_TABLE_RETENTION_DAYS`）。
   它是「今日计划」的物化不是源数据，读它的地方最远只看到昨天。裁完 1.59 → **1.17 MB
   gzip（−26.7%）**，还要乘以云端保留的 3 代。
   **安全性来自合并语义**：`mergeItems` 是按键取并集，删除只走 `sync_tombstones` ——
   快照里没有的行不会让对端的历史行消失。`merge.test.ts` 里钉住了这条。
2. **轮询会退避，页面藏起来时不发请求**（`sync-api.ts`）。原来固定 5 分钟一跳、
   后台也跳，一台开着不动的设备一天打 288 次 `/api/sync/status` 全是「没变化」。
   现在 5 → 10 → 20 → 40 分钟退避；本地改动 / 回到前台 / 网络恢复都打回 5 分钟。
   连 error 也算空转 —— 后端挂着时更不该每 5 分钟撞一次。

⚠️ **`sync_tombstones` 目前永不过期**（现在 515 行）。跑一次「合并重复词条」会**一次涨到
4,672 行**（实测：198 个词条 + 1,697 条流水 + progress/任务表等，共 +4,157），而且只进不出。
加过期时间是有代价的：离线超过保留期的设备回来会让被删的行复活。gzip 后还只有几十 KB 的
时候不值得冒这个险，等它涨到几万行再说。

⚠️ **本地 `stage1_tasks` 没裁**（只裁了快照）。删本地行会给每一行写墓碑 ——
两万五千条墓碑比省下来的那点空间贵得多。要裁得先想清楚怎么绕开触发器。

## 答一次题该做多少事（2026-09-06 大修）

实测起点：真实库（46,618 条 reviews / 2,522 个学过的词）上**点一次评分，主线程同步
阻塞中位 549ms**，每 50 次作答里有一次冻 **4~6 秒**，再加上 2 秒后一次 100~510ms 的落盘。
改完是**中位 73~79ms、80 次里最大 153ms**，落盘那一下从 35.9MB 变成几 KB。

根因只有一条：**「记一次账」被绑成了「重算全应用状态 + 重写整个数据库」，还全挤在
keydown 的同一个同步 task 里**（`submitWordAnswer` 是同步的，后面那串 `await` 等的都是
已 resolve 的 promise，微任务在同一个 task 里跑完）。四条改动，每条都对应一个「全量」习惯：

| 改的 | 之前 | 现在 |
|---|---|---|
| `ensureProgressInitialized` | 每答一次跑 **6 遍**（每遍 11,740 行的全表 INSERT OR IGNORE + 全表 UPDATE words），115ms | `oncePerDatabase("word-progress")`，一个库一次 |
| `getWordStats` | 30 个统计字段全算好再返回，每答一次算 **2 遍** | 首页才看的字段改成惰性 getter，读到才算 |
| `getProgressOverview`（App.tsx） | 挂在 PROGRESS_UPDATED 上无条件重算，学习页里也算 | 看不见就记脏标记，回到首页再补 |
| `updateMemoryProfileIfNeeded` | 在答题路径上，每 50 次触发一次全量历史聚合 | 整个摘掉，只由统计页算；SQL 本身改写成窗口函数 |

合计：**每次作答的 SQL 从 318 条 / 536ms 降到 102 条 / 69ms**。

⚠️ **「幂等」不等于「免费」。** 那 6 遍 `ensureProgressInitialized` 是十几个 API 入口
各自「反正它幂等，调一下保险」调出来的。闸门用 `oncePerDatabase`（`database/db-utils.ts`）
按 **db 实例**记，不是模块级 boolean —— 同步合并、恢复快照、导入备份都会换掉 db 实例，
那时候必须重跑。同一个实例上新增了 words 行（词单导入）要由那条路自己补 progress 行。

⚠️ **`getWordStats` 别改回「先全算好再返回」。** 学习页每张卡只读
stage1Progress / dailyRelief / stage1Done / dailyPlanDone 这几项；30 天曲线、打卡表、
全库 COUNT、反向和汉字的当日计划都是首页才看的。惰性字段算完就记住，所以首页拿到的
仍然是同一时刻的一致快照。**减负和压轴（`ensureDailyRelief` / `ensureDailyTail`）
必须留在立即算那一档** —— 它们带写，是「今天该给你什么」的一部分，不是展示用的统计。

⚠️ **记忆画像（adaptive.ts）不参与任何调度，别再挂回答题路径。** 它自己的注释就写着
「只用于统计页展示」。代价是从不打开统计页的人，画像停在上次打开时的值 —— 不影响出题。
里面两条相关子查询已换成窗口函数（保持率 3.8s → 约 0.4s），
`adaptive.test.ts` 里**抄了一份旧 SQL 当基准对拍**，改口径必须两边一起动。

## 落盘：整库最多 5 分钟一次，中间只写改过的行（2026-09-06）

`local-delta.ts` + `storage.ts`。以前 `scheduleSave` 是 2 秒 debounce 后**整库** export
再写下去 —— 真人节奏下等于每答一张卡就重写 35.9MB：浏览器端占住主线程 100~510ms，
原生端还要先 base64（36MB → 48MB 字符串）再走三代文件轮转。

现在：中间只写「上次整库快照之后改过的行」（实测 **每张卡约 0.9 KB**），
整库最多 5 分钟一次（`FULL_SNAPSHOT_INTERVAL_MS`）。

- **增量是白捡的**：云同步早就给每张用户表加了 `sync_updated_at`（触发器盖章）和
  `sync_tombstones`。这里没有第二套变更追踪，只是换个地方用同一份；回放也用同一套
  `beginSyncApply` 把触发器压住（回放不是新的本地改动，不该重新盖时间戳）。
- **只有一份增量**：每条增量都是「快照之后改过的所有行」，后一条整个盖住前一条 ——
  不需要序号、不需要排序，也不会出现「回放了一半」。
- **水位线写在库里**（`app_state.local_snapshot_mark`，导出前写），所以快照自带
  「我是哪一刻的」，不用另存 mark 文件，也就没有「mark 写成功快照没写成功」的中间态。

⚠️ **一个看着最诱人的方案是错的：把出厂词典拆出去并不解决问题。** 实测 35.95 MB 里
出厂数据（words / grammar_points / archive / kanji_units + 索引）只有 **8.8 MB**，
用户数据 26 MB —— 光 reviews 加它的四个索引就 15.9 MB，stage1_tasks 5.6 MB。
拆完还剩 26 MB，而且只增不减，代价是每个 `words ⋈ progress` 都要跨库。

⚠️ **`words` 表的改动不在增量里**（它没有 `sync_updated_at`）。词单导入（插行）和
「合并重复词条」（删行）**必须自己喊 `requestFullSnapshot()`**，两处都已经喊了；
再加动 words 的路要记得跟上。启动时的种子迁移和 shuffle_rank 回填也写 words，
但它们每次启动都会幂等地再跑一遍，自愈，不用管。

⚠️ **`local_snapshot_mark` 已加进 `DEVICE_LOCAL_STATE_KEYS`，绝不能跨设备同步。**
它说的是「本机磁盘上那份快照停在哪一刻」，拿对端的值当基准去收增量，收出来的行
对不上本机快照，重启后是一份两边拼起来的库。

⚠️ **换库之后第一次落盘一律整库**（`needsFullSnapshot` 里那条 `snapshotDb !== 当前 db`）。
恢复备份、导入、云同步合并都会换掉 db 实例，而磁盘上那份快照还是换之前的。

⚠️ **`clearStorage` 要把增量一起清掉**，否则「清除数据」之后下次启动会把旧增量
回放到刚重建的出厂库上。

- `flushPendingSave`（退到后台 / 页面隐藏）走的也是增量：那一刻页面随时会被杀，
  写几百行比写 36MB 靠谱得多。硬崩溃最多丢到上一次增量为止（2 秒）。
- DEV 下往 `.local/live.db` 镜像整库改成自己带一道 20 秒的闸（`mirrorForDev`）——
  不挡的话每写一次增量都要为了镜像 export 一遍整库。`npm run db` 的数据新鲜度不变。
- 判据在 `local-delta.test.ts`：拿两份真实的库对着比（改 / 删 / 删了又插回来 /
  回放不改时间戳 / 回放幂等 / **中途写不下去要整条回滚**），不看中间结构。

## ⚠️ 落盘的四条不变量（2026-09-10 审查后补齐）

上面那一节讲的是「什么时候写、写多少」。这一节是「写的过程中不许发生什么」。
四条都曾经真的会发生，而且**全部是静默的** —— 没有报错、没有日志，
只有第二天少一段进度。判据在 `storage-durability.test.ts` 和 `local-delta.test.ts`。

### ① 所有落盘走同一条串行队列（`enqueueWrite`）

定时保存、页面隐藏兜底、显式 `saveDatabase()` 三条路都能同时进到写盘流程，
而它们共用 tmp 文件、`pendingSave` 和快照基准。**让旧的那次晚一点完成，
主文件就从新版本退回旧版本。**

⚠️ `persistNow` 里只能调 `saveDatabaseNow`，不能调 `saveDatabase` ——
后者会在自己那格队列里再排一次队，直接死锁。

⚠️ **写盘期间又有改动的话 `pendingSave` 不许清掉**（拿 `localDataRevision` 前后对比）。
清掉的话退到后台时 `flushPendingSave` 会以为没东西要写，那几百毫秒里答的题就没了。

### ② 增量回放是一个事务

`beginSyncApply()` 只是把同步触发器压住，**它不是 BEGIN TRANSACTION**。
没有事务时，中途某一行写不下去会留下一份「放了一半」的库，而启动代码只在
控制台说一句「已按快照那一刻启动」。回放失败的增量会被**原样另存**
（`stashFailedDelta`），不然下一次落盘就把它盖掉，连查都没得查。

### ③ 「有存档但打不开」≠「没有存档」

`loadDatabase` 现在**抛 `LocalArchiveUnreadableError`**，不再返回 false。
返回 false 的那条路是静默毁数据的：`main.tsx` 拿到 false 就加载出厂库，
下一次落盘用的还是同一个 key/文件名 —— 那份可能只是这次读不出来的存档就没了。
现在停在启动画面上问人：**重试 / 导出这份存档 / 明确同意重建**。
原生端三代文件全读不出来时同理（文件原样留在磁盘上）。

⚠️ `storage-unreadable-archive.test.ts` 钉的就是「必须抛，不许返回 false」。

### ④ 原生端启动要读 `nihongo.delta.json.tmp`

写增量的顺序是 write tmp → delete delta → rename tmp→delta。
**在 delete 之后、rename 之前被杀掉，完整的新增量只剩 tmp 那一份**。
只认 delta 等于把它扔了。半份 tmp（writeFile 途中被杀）解析不出 JSON，
由 `replayDeltaRecord` 的 catch 丢掉，所以多读这一个候选是安全的。

### ⚠️ 内容迁移必须喊 `persistContentSoon()`，不是 `persistSoon()`

内容迁移改的是 `words` / `grammar_points` / `dictionary_entries` 这些
**不带 `sync_updated_at`、因而不进增量**的表，而它写下的版本号在 `app_state`，
那张表是进增量的。用普通 `persistSoon` 的话，离下一次整库还有几分钟时重启，
拿到的就是**旧内容 + 新版本号** —— 而迁移的入口判断是「版本号相等就返回」，
于是这台设备的内容永远停在旧版，每次启动都在同一个相等判断上早退。
**「反正每次启动幂等重跑」在这里不成立，版本门控把重跑挡住了。**
判据在 `seed-migrations.test.ts`（清空版本戳跑一遍，断言 `requestFullSnapshot` 被调用）。

### ⚠️ 导入整库备份必须换设备号（`restoreDatabaseBackup`）

作答流水的跨端身份 `sync_uid` = `设备号 : 本机自增 id`。备份里带着导出那台设备的
设备号，不换掉的话，两台设备从同一份备份出发、各自答一道**不同**的题，
会生成一模一样的 uid —— 云端按 uid 合并时把两次不同的作答当成同一件事，
后到的那条直接丢掉。`resetDeviceId()` 早就写好了，只是**从来没有调用方**。

⚠️ 只有「用户主动导入整库备份」这一条路换号。普通启动恢复每次换号的话，
每次重启都是一台新设备，墓碑和 append 表的来源全乱。

### ⚠️ `importDatabase` 换库之后要关掉旧实例

一个整库就是几十 MB 的 WASM 堆，恢复几次备份就叠几份；校验不过的那份也要关。
关的只有「已经不可能再从 `getDatabase()` 拿到」的那一个。

## ⚠️ 写盘失败的提示挂在常驻层（`App.tsx` 的 `PersistenceBanner`，2026-09-10）

`PERSISTENCE_ERROR_EVENT` 以前只有 `GrammarHighlightProvider` 在听，而那个 Provider
只包着语法页和详情页 —— **在单词学习页写盘失败时，除了控制台一行 error 之外
什么都不会发生**，用户会接着答几十张卡，以为都记下了。

配套加了 `PERSISTENCE_OK_EVENT`（只有真出过错才派，平时每 2 秒一次的成功不广播），
所以自动重试成功之后横幅会自己消失。

**故意不做「正在保存」那一档**：正常节奏下每 2 秒就有一次写入，
一个每两秒闪一下的指示器只是噪音。要说的只有「没存下去」和「又好了」。

## 复习算法：只有 FSRS（2026-08-01 起）

**单词、汉字、语法三个阶段统一由 `ts-fsrs`（Anki 同款 FSRS）调度。自研的 score / 连胜梯子 / 回归模式已整体删除，别再往回加分数。**

- `fsrs-scheduler.ts` — 算法本体（与实体无关）：评分映射、学习步骤、leech 阈值、`isMastered`
- `fsrs-store.ts` — 状态持久化，泛化成可挂任意表：`WORD_FSRS`(progress) / `KANJI_FSRS`(kanji_memory) / `GRAMMAR_FSRS`(grammar_progress)
- `word-api/stage1.ts` — 当日任务表生成；`scheduler/priority.ts` — 出题优先级
- `review-budget.ts` — 每日复习上限、续杯批量、疲劳检测

⚠️ **`isGraduatedForDay` 不能只比 due 和学习日边界**（2026-09-10 修）。
学习日边界是凌晨四点：03:55 答「忘记」，重学步骤把 due 排到 04:05 —— 越过了边界，
于是它被当成「今天已毕业」，这一场里再也不出现。用户点了忘记却等不来那次确认，
而 FSRS 那边这张卡明明还停在 Relearning 的第一步。
现在 **Learning / Relearning 一律不算毕业**：那两个状态下 due 永远是下一个短期步骤，
不是真正的复习间隔。判据在 `fsrs-scheduler.test.ts`。

## 认识音：Shepard 音阶，听感一直升但频率原地转圈

`zoo-sounds.ts`。连对时「认识」的音高往上爬，**但不再封顶** —— 因为它根本没在真的升高。

老做法是五声音阶爬四级就停（再往上会啸到刺耳），于是连对第 5 个和第 50 个听起来
一模一样，「累积」这件事在声音上第四个就说完了。

Shepard 音把这个约束整个拿掉：同一个音级在**九个八度上同时响**，每个分音的音量由一条
**固定在绝对频率上**的钟形包络决定（峰值 C5，宽 0.85 个八度）。每答对一个所有分音一起
上移一个半音：最高那个爬出包络淡出，同时一个新分音在最低处淡入。走满 12 步，
**频谱和第 0 步逐位相同**，所以能无缝转下去。

耳朵跟着「分音都变高了」走，整体亮度几乎没动：走完整整一个八度，谱重心只从
523 Hz 漂到 524 Hz（0.041 个半音）。判据钉在 `zoo-sounds.test.ts`。

- ⚠️ **别让九个分音等响、等长、同相 —— 那就是管风琴。** 第一版包络宽 1.3，相邻八度还有
  74% 音量，三个八度几乎等响地一起响，实听「像电子音不像卡林巴」。三处一起改才回来：
  ① 包络收到 **0.85**（相邻八度 48%、再外面 3%，听起来是「一个音」不是「一摞音」）；
  ② **高分音衰减更快**（`(C5/f)^0.8`，C6 只有 0.57 倍时长，C4 拖 1.74 倍）——
  这是「敲了一下木头」和「按住一个电子音」最主要的区别；③ 起始时刻按频率微错开，
  不让九个振荡器相位锁死。**时长和错开量必须是绝对频率的函数**，按分音序号算的话
  走满一圈会错位、循环不再无缝（测试里连 decay/delay 一起钉了）。
  收窄包络不但没伤错觉反而更稳：重心漂移 1.3 → 0.118 半音、0.85 → 0.041 半音；
  再窄才掉头变差（0.6 时 0.147）。
- **音色没变，还是原来的三角波卡林巴。** 一般讲 Shepard 都说分音必须是正弦，怕三角波的
  3f、5f 谐波给耳朵一个绝对音高的锚点 —— 实际算下来不成立：3 次谐波落在
  3·2^k·f₀ = 1.5·2^(k+1)·f₀，**所有 3 次谐波自己也是一组八度堆叠**（比主堆叠高一个纯五度），
  5 次、7 次同理，每组都各自满足「顶上淡出、底下淡入」。代前 16 个谐波进去算：
  重心漂移 0.118 个半音、能量波动 0.24%，和纯正弦（0.117 / 0.20%）没区别。测试里钉着。
- ⚠️ **两端那几个听不见的分音不能省。** 按「权重低于门限就不开振荡器」去省两个振荡器的话，
  分音会在门限上进进出出，每次都让谱重心跳一下 —— 而「重心不动」是错觉唯一的支点。
  实测门限 0.02 时漂移 0.435 个半音，全留则是 0.041 个、音量波动精确为 0。
- 归一化除以增益总和：所有分音相位都从 0 起，t=0 是同相叠加，峰值 ≈ 增益之和，
  除完峰值就和过去单个音一样，不会因为叠了九个分音而变吵。**增益、时值、音程全部沿用改版前**
  —— 这次只换「音高怎么走」。
- 答错时连击归零 = 音高掉回去，这仍是反馈。但 step 12/24/36 上断掉的话掉回 0 是**同一个音**，
  那 1/12 的情况下靠 `playDontKnow`（柔和下行小三度）说话，本来它才是主要的那句。

## 读音音频：长音该压，语素边界不该（2026-09-07）

预生成的读音音频走 VOICEVOX（`scripts/build-word-audio.mjs`，三个声音，出厂库每个词一份）。
它会把**同一个元音连着两拍**里的第二拍压到 40~90ms（正常一拍 120~220ms）。

对长音这是对的（優勝 ユウ 的 ウ 只有 48ms）；对**语素边界**是错的：
湖（水 + 海）听成 ミズーミ、薄々（うす + うす）听成 ウスース —— 少了一拍。
用户报的就是「湖 みずうみ 把 u 读成长音了」。

⚠️ **声学上两类分不开**：大=おお 75~89ms、氷=こおり 82ms 都是长音，湖 78ms 是边界，
分布完全重叠。按时长自动判会把 優勝 一起撑开。只能按语素边界判，判据两条：

| | 例 | 处理 |
|---|---|---|
| 两个实词拼起来 | 水+海、地+域、うろ+覚え、うす+うす、せかい+いさん | 两拍，撑开 |
| 一个语素内部 / 活用音便 | 椎=シイ（椎茸）、引きて→引いて（ひいては）、大=おお、氷=こおり、言い方 | 长音，原样 |

- 识别 / 分组 / 撑开逻辑在 `scripts/vowel-sequences.mjs`，**审计脚本和合成脚本共用这一份**
  （「怎么算一个连接点」漂移了，判定表就对不上号）。判定表是
  `scripts/vowel-sequence-manual-review.json` 的 `decisions`。
- 体检：`node scripts/audit-vowel-sequences.mjs`（要 VOICEVOX 开着）。新词进库后跑一次，
  没判过的落在 `pending` 里。
- ⚠️ **只有引擎真的压扁了的连接点才进人工表。** 全库 520 个连接点里，引擎已经给足两拍的
  有 307 个（新しい 的 しい 是 228+138ms），判它们没有意义。
- ⚠️ **判定按「读音单位」分组，不按词**：`通=つう` 一次管 25 个词。盖不住的（纯假名边界）
  才退回按词判 —— 按假名两拍分组太粗，`いい` 里既有 言い方（长音）又有 世界遺産
  （せかい|いさん，两拍）。剩下要人判的只有 58 组。
- 撑开只设下限（第二拍 0.12s、前一拍 0.10s），不缩短：引擎给够了的别动。
  实测 湖 的发声段 500ms → 610ms。
- ⚠️ **撑开必须放在 `accent_phrases(明确假名)` 之后**：那一步会按记法重算整份拍表，
  先撑就被覆盖掉了。
- ⚠️ **重跑合成脚本不带 `--label`** 曾会把 index.json 里的显示名冲成 id
  （春日部つむぎ(女声) → voicevox-8），汇总表的 `default` 还会按 id 排序静默换成另一个声音。
  已改成不给就沿用旧值。

## 例句音频：预生成、放 R2 按需拉，不进包也不在端上合成（2026-09-17）

`scripts/build-example-audio.mjs` → `public/audio/examples/<voice>/<hash>.aac`，运行时
`speech.ts` 的 `playExample` / `prefetchExample`，入口是单词卡和语法卡例句框旁的
`ExamplePlayButton`（`WordStudyPanels.tsx`，两张卡共用）。

### 为什么这样定（三个问题当时都问过）

- **为什么不用系统 TTS**：网页版没有保证（Windows Chrome 没装日语包就是哑的，静默失效）；
  单词是 VOICEVOX、例句突然换成 Siri，一张卡两个嗓子；读音语调都不受控。
- **为什么不把 VOICEVOX 装进 App**：一个角色的模型 + Open JTalk 词典 + ONNX Runtime 要
  150–250 MB，比成品音频（一个声音 ≈ 160 MB）还大；每句在手机上算 1–3 秒；
  读音校对那套流程（比对振假名 → 人判表）在端上做不了。**内容有限就存成品，
  内容无限才带生成器**——用户自导的词、自造句走系统 TTS 退路，这条本来就在。
- **为什么不打进 iOS 包**：现在 `public/` 已经 170 MB（含 136 MB 单词音频），再加 160 MB
  例句会到 330 MB。设 `VITE_AUDIO_BASE_URL` 指到 R2 公开域名后包里一个字节不带，
  用户磁盘上只有他听过的（学 2,000 词 ≈ 25 MB）。R2 出站免费、读 $0.36/百万次，
  1,000 日活每天听 300 句仍在免费额度内；一个用户一天的音频请求比他同步一次快照便宜。
  音频**不经过 Worker**，和同步那条云端压力无关。

### 实测过的数字（别再靠估）

| | |
|---|---|
| 例句 | 11,655 句（words 10,919 + grammar 741，去重后），平均 24 拍 |
| 一句 | 约 4 秒，ADTS AAC-LC 24 kbps ≈ **14 KB** |
| 一个声音全量 | ≈ 160 MB |
| HE-AAC | ⚠️ `afconvert -d aach` 在 24k **反而更大**（垫到 30 kbps），16k 只小 16%——不值得赌 Firefox/Linux 的解码器，沿用 LC |
| 静音垫 | VOICEVOX 默认前后各 0.1 s；单词文件 0.6 s 里 **0.2 s 是空的**。例句脚本收到 0.02/0.05 s。单词那份没动（重编要重合成） |
| 振假名盖不住的句子 | 177 句，列在 `unverified` 里，按引擎读法生成。**其中 160 句是 `example_furigana = '[]'`**（有汉字但出厂库里根本没有振假名，卡片上也没 ruby）——是 `build-furigana.mjs` 的内容缺口，不是音频的问题；剩下 17 句是简体字（公园/抽屉/巢）、Ｔシャツ、数字 |
| 全量结果（2026-09-18） | 11,655 句 **143 MB**，人判 `pending` **0 句**——振假名盖得住的句子全部过了校验（拍数一致锁回 / 换假名再喂两条路够用）。5.7 小时（`say` 参考那一步占一半） |

### 句调迁移：借 Kyoko 的短语级起伏，重音型不动（`scripts/prosody-transfer.mjs`）

第一版全量跑到一半时作者实听「一个词还好，一句完全没起伏」。查下来**不是参数问题是架构问题**：
VOICEVOX 按重音短语逐拍预测音高，只知道每个短语的重音型，不理解整句——句尾落多少、
逗号前后松紧、哪个短语抬起来，一律给平均值。假名锁定不是原因（锁前锁后音高曲线逐拍相同）。

三条路 A/B 实听（同一句 事故の原因を調べるため…）：

| | 做法 | 结论 |
|---|---|---|
| `intonationScale` 1.4 / 1.7 | 放大幅度 | 本质没变，1.7 开始「演」 |
| 换 AivisSpeech（Style-Bert-VITS2 系） | 自然度 ★5，VOICEVOX 兼容 API | 单词和例句变两个嗓子；逐拍字段全是假的 |
| **短语级迁移（采用）** | Kyoko 念一遍 → 自相关测 F0 → 按 VOICEVOX 每拍时长对时间轴 → **每个短语一个整体偏移**写进 `mora.pitch` | 明显像人；声音、读音校验、重音数据全留着 |

- ⚠️ **只借短语级，不逐拍抄**：逐拍会把参考引擎的重音位置一起抄过来，而重音是学习者要学的
  内容，句调只是氛围；而且没有强制对齐，按比例映射会错一两拍，短语级几乎不受影响。
  实听逐拍那版起伏更大但有错位感。短语内部形状只按 `PROSODY_STRENGTH`(1.3) 缩放。
- ⚠️ **迁移必须放在明确假名 `accent_phrases` 重算之后**——那一步换掉整份拍表，先写会被覆盖。
- 参考引擎用 mac 自带 Kyoko 是因为免安装；换 AivisSpeech 只改 `referenceWav`。
  代价是每句多一次 `say`（~1 s），全量 2.7 → 5.7 小时。
- 判据在 `prosody-transfer.test.ts`：第二短语被压低而短语内差值不变、无声拍不动、参考全静音时不动。
- `--no-prosody` 关掉（A/B 对比用）。

### ⚠️ 待办（2026-09-18 定下、还没做）：参考引擎从 Kyoko 换成 AivisSpeech，然后上 R2

**为什么要换**：Kyoko 是为了免安装、十分钟出 A/B 才选的。作为参考它有两个短板：
① 它自己的句调只是「还行」（Apple 老一代引擎），参考的天花板就是结果的天花板；
② macOS SLA 把系统语音的输出限定个人非商用，音高曲线算不算「输出」没有先例
（`docs/CONTENT_RIGHTS.md` 记着）。AivisSpeech 是 Style-Bert-VITS2 那一档（自然度 ★5），
模型走 ACML 1.0（商用允许、署名自愿），两条都解决。**迁移架构不变**，只换参考源。

**步骤**（当时网络不好没下载，卡在第 1 步）：

1. 装 AivisSpeech：<https://aivis-project.com/> macOS Apple Silicon 版 dmg，约 1 GB
   （含 650 MB BERT）。不在 Homebrew 里。打开一次让引擎起来，默认 `http://127.0.0.1:10101`。
2. `scripts/prosody-transfer.mjs` 的 `referenceWav(text)` 改成调 Aivis：
   `POST /audio_query?text=…&speaker=<id>` → `POST /synthesis?speaker=<id>`，拿回 WAV，
   `outputSamplingRate` 设 24000（不认这个字段的话按 WAV 头的采样率重采样，或让 `trackF0`
   接采样率参数）。speaker id 从 `GET /speakers` 取（默认模型 Anneli 是 888753760）。
   ⚠️ Aivis 的 `intonationScale` 语义是情绪强度，停顿参数被忽略——都不影响我们，只取 F0。
3. 先 A/B：`node scripts/build-example-audio.mjs --limit 3` 之前把旧文件删掉，和 Kyoko 那版
   （`--no-prosody` 生成一份、Kyoko 版留一份）对着听同一句。**确认更好再全量**。
4. 全量：`rm public/audio/examples/voicevox-8/*.aac` 后重跑，约 6–8 小时（Aivis 合成一句
   比 `say` 慢）。`VOICEVOX_CONCURRENCY=4` 时 VOICEVOX 偶尔 `fetch failed`，再跑一遍补。
5. 改完把 `docs/CONTENT_RIGHTS.md` 例句音频那一行的 Kyoko 说明删掉、About 页不用动
   （发布的音频仍然只有 VOICEVOX 的）。

**R2 那一步和这件事互不影响**：先传现在这版（Kyoko 参考）也行，新版跑完再传一次，
文件名相同、rclone 只传变了的。域名暂时用 r2.dev 公开地址（作者没有域名，Cloudflare
Registrar 按成本价约 $10–15/年，需要时再买，改 `AUDIO_BASE_URL` 一个变量）。
R2 的操作步骤在 `scripts/upload-audio.sh` 头部；密钥只能作者自己填。

### 读音校对：和单词同一套判据，多一条「助词位」

`scripts/voicevox-reading.mjs` 是单词脚本和例句脚本**共用**的：`equivalentMora` /
`pronunciationMismatch` / `explicitKanaNotation` 从 `build-word-audio.mjs` 抽出来的，
两边漂移了就会同一个音一边放行一边判错。

- 标准答案来自 `example_furigana` 展开（`intendedReading`），不是 kana 列。
- ⚠️ **ハ→ワ / ヘ→エ 只在「原文就是平假名、不在振假名底下」的那一拍放行**（`particles`）。
  单词那边是绝不放行的（曾经放行过，10 个词合成成错音）；例句里助词满地都是，
  但汉字读出来的 ハ（母、葉）照旧不许变。测试钉在 `example-audio-reading.test.ts`。
- 拍数一致 → 明确假名锁回去（沿用引擎自己的重音和停顿：`、` 写在引擎停顿过的短语后，
  疑问句尾 `？`）；拍数不一致 → 试一次「汉字全换成振假名」再喂；还不行 → 进
  `scripts/example-audio-review.json` 的 `pending`，人在 `speak` 里写一句替代文本
  （把读错的字换成假名）再跑一遍只补那些。
- 文件名 = 句子原文的 FNV 哈希（`exampleAudioName`）。改一句只换一个文件，
  目录里不在清单上的当孤儿删掉——不需要单词那种 `_stale-*.json`。

### 上线步骤（`scripts/upload-audio.sh` 头部有命令）

1. 开 VOICEVOX，`node scripts/build-example-audio.mjs --limit 20` 试听，再全量（一个声音约 4–6 小时，断点续跑）。
2. `rclone` 推到 R2 桶 `shushugo-audio`，配自定义域名 **和 CORS**——⚠️ `index.json` 是跨域
   `fetch`，没 CORS 就整个退回系统语音，而且没有任何报错；`<audio>` 本身不需要 CORS。
3. GitHub 仓库变量 `AUDIO_BASE_URL`（Pages 工作流据此跳过 tar 那步），iOS 构建前
   `export VITE_AUDIO_BASE_URL`。单词音频也可以一起搬过去，iOS 包瘦 136 MB。
4. 设置页只有一份声音列表（`loadVoices` 读的是 words 的索引）；例句库只做了一个声音时，
   用户选了别的声音会退到例句库自己的默认（`resolveVoice("examples")`）。

**先只做 voicevox-8（春日部つむぎ）。** R2 上多两个声音不花钱，花的是本机十小时。

## 成就：判据现算，不攒计数器

`lib/achievements/` — 47 个成就。**判据全部从 reviews/progress 现算**（`stats.ts`），
解锁记录进数据库 `achievements` 表（`union` 策略同步，解锁不可逆）。

- 好处是**加新成就时以前达成过的会自动补发** —— 没人愿意为了拿成就重学一遍
- `stats.ts` 的字段是**懒算并记住的**：结算只碰「还没解锁的那些」用到的字段。
  全算一遍 281ms，而学习页每分钟结算一次 —— 拿到「先冷静」之后那两条 window function
  连击查询就再也不会跑了
- 缺表要返回 0 而不是抛错（老库没有 word_notes / content_favorites）
- 成就页打开时会当场结算，否则会出现「进度条 8/1 却还锁着」

**前车之鉴：`userProfile` 里那份 `studyTimeMinutes` 自攒计数器从来没涨过** ——
它收秒、每 15 秒 flush 一次、`Math.floor(seconds/60)` 恒为 0。学习时长和天数现在一律
问数据库要（`study-totals.ts`），和统计页同口径。**别再在 Preferences 里攒第二份账。**

## 辨析只有一份：`confusion-groups.ts`

**单词卡顶栏的按钮、答案区那一行入口、疑难辨析页，三处是同一份数据、同一套说法、同一个「已掌握」。**
再往 `confusion.ts` 里加编辑距离规则、或者另起一份手写组，就是在制造第四套口径。

- `confusion-groups.ts` — 1,933 组、七类，附 `TYPE_META`（每类该看哪里）、`displayForm`、`groupWords`
- `models/word-distinctions.ts` — 一张卡的辨析 section：手写辨析 → 七类分组 → 用法辨析 → 题面撞车 → 音形相近（说法从具体到笼统，后面的和前面重复的整段丢掉）
- `components/DistinctionSheet.tsx` — 卡中卡气泡（62vh，形制同疑难辨析页的大卡）

**气泡里没有认识/忘记/模糊，以后也别加。** 气泡里答案全露着，此时评分等于告诉 FSRS「记住了」，
正是排片把同组词隔开 12 张要防的那件事。能留下的只有「已掌握」（`confusion_mastered` 一个布尔量，
不进 FSRS、不进当日计划）。想真刷那张词得点「换这张来答」——那条走 `jumpToSimilarWord`，
会给当前词记一次「模糊」，所以必须是用户明确点的，不能挂在「点开看看」上。

**「音形相近」不收假名完全相同的词。** 编辑距离对「假名一模一样」给满分，于是老库里没合并的
外来語重复行（インターネット / internet）、纯异写（繋がる / つながる）、真同音异义词（公園 / 講演）
全被算成最像的那几个，霸占前三名 —— 实测用户库 18,193 对里 2,892 对（15.9%）是这样来的。
同假名交给 confusion-groups 的 homophone / kanji-choice 组去说，它们的说法才是对的。
**「音形相近」还有第二道闸：没学过、又比这张卡难的词不摆。** 实测用户在学的卡里，音近候选
74% 是他从没学过的词 —— 学 安心(N4) 时旁边挂个 暗然(N1)，你不可能写出一个没见过的词，
它只是把真会混的候选挤出前三名。判据在 `models/familiarity.ts`：学过（progress 有行）或
不比当前卡难，满足一条就留；「无级」按中间档算（那是用户自己导的词表，不是生僻词）。
**筛必须在取前三之前**，否则位置先被占掉再删空。

**「音形相近」的第三道闸：同词干的派生形改挂「同词根」（2026-09-04）。** 手伝い 旁边摆 手伝う、
楽しい 旁边摆 楽しむ、茶色 旁边摆 茶色い —— 这些**不是「长得像」，是本来就是一个词**，
区别在词性和用法。挂在音近名下，用户会去找一个根本不存在的读音差别。实测用户学过的
2,395 个词里音近条目 1,949 条，这样的有 67 条（3.4%，其中约 20 条是自他对、已被 pair 组吃掉）。
判据在 `models/confusion.sameStemForms`：**摘掉送假名之后汉字词干相同**，一条就够。
`word-distinctions` 把它们拆成单独一段，名字和图标借 `TYPE_META.stem`（全应用「同词根」一个说法），
排在音形相近**前面**（说法从具体到笼统）。

⚠️ **别再往判据里加「假名前缀也要对上」。** 走到这一步的候选已经过了相似度那道闸，
何 / 何かしら、中 / 中々、電話 / 電話をかける 这种「同头复合词」根本进不来；加了只会把
大きい / 大きな（假名只共享 3 拍）这种真派生误伤掉。**也别改成在 `confusion-groups` 里建组** ——
按词干全库扫一遍会造出 564 个组，里面 何(なん) 底下挂着 10 个 何で/何でも/何とか，
那正是 ④ 同词根动词族当年要绕开的雪球。

**算出来的分组（同音/自他/汉字用法…）不按这条筛。**「こうえん 底下有四个词」是真的语言现象，
对 N5 的人同样成立、也正是该教的；组还是有机的，抽掉成员剩下的话就说不圆了。

**老库里同一个词录了两遍（202 对）由 `duplicateWordIds()` 统一挡掉，三条路共用一份。**
判据：汉字+假名都一样 = 同一个词（和释义那栏写得一不一样无关）；外来語英文行+片假名行；
纯异写。词单导入后必须 `resetConfusionGroups()` + `resetFamiliarityCache()`，否则新词永远进不了组。

`confusion-audit.test.ts` 是这一档的体检，跑真实库：
`AUDIT_DB=../../../.local/live.db AUDIT_FULL=1 AUDIT_OUT=/tmp/a.txt npx vitest run src/lib/models/confusion-audit.test.ts`

翻面前气泡要藏住当前这张（标题写题面那行中文、成员里滤掉 `isCurrent`），否则「看辨析」变成「看答案」。
`confusionGroupsForWord` 首次调用要扫全表建索引（112ms），学习页用 `warmConfusionGroups` 在 setTimeout(0) 里预热。

### 可练的辨析题（2026-09-15）

`distinction-quiz.ts` 是疑难辨析数据的可练入口，不另建组、不复制 `confusionGroups()`：题面来自
`question_meaning_overrides.json`，选项词形统一走 `displayForm()`，组内注记来自
`confusion_distinction_reviews.ts`。当前计划覆盖 370 个非 synonym 组；运行时另有额外的 synonym
审查组，除非另有题面审校，不要把它们默默混入这批题。

辨析题是“看完当场分清”的练习，不是记忆调度：`quizGroups()` 缺成员题面就整组跳过，绝不回退到
`words.meaning`；`buildQuestions()` 每组连续出完、最多 24 题且不截断半组。结算只能调用
`setConfusionMastered()`，只写既有的 `confusion_mastered`，**不写 `reviews`、`progress`、FSRS 或当日计划**。
今天范围只查 `reviews` 的当天 `forward` 词，已学范围只查 `progress.seen_count > 0` 且组内命中至少两个成员；
这两个查询是筛选范围，不是辨析题作答流水。

辨析成员题面同时服务正向题和查词汇量释义选项，因此修改 `questionMeaning` 后必须重建
`question_meaning_overrides.json`，并跑 `validate-manual-batch.mjs`、`distinction-candidates.test.ts`
和 `vocab-test-distractors.test.ts`。审校批次可包含不在 `jlpt_words_seed.json`、但已登记在
`jlpt_level_overrides.json` 的历史词条；校验器必须把这份合法登记算入键集合，不能修改 seed 来掩盖漂移。

### 释义有两层，辨析审校的那一层必须同时进 `words.meaning`（2026-09-16）

| 层 | 文件 | 谁在读 |
|---|---|---|
| 释义 | `jlpt_meaning_overrides.json` → `words.meaning` | 反向题答案面、辨析气泡、疑难辨析页、词库、收藏、查词汇量选项 —— **用户记的是这一层** |
| 题面 | `question_meaning_overrides.json` | 只有正向题的题面 |

第二轮验收时发现：1,559 条辨析审校（「（饭菜）变凉 / 晾凉（热汤）」）只落在题面层，
翻到答案面、点开辨析气泡看到的还是「冷却 / 冷却 / 冷却」——用户靠 App 记下来的东西
到了选项里照样分不开，这正是整件事的起因。所以 `classification = distinction` 的条目
由 `question-meaning-review/sync-distinction-meanings.mjs` 同步进释义层，两层是同一句话。
普通审校（same_meaning / manual_translation / partial_overlap）仍然只管题面。

跑完同步要 bump `JLPT_WORD_METADATA_VERSION`（`study-core.ts` / `bake-seed-db.mjs` /
`build-furigana.mjs` 三处同一个串）再 `node frontend/scripts/bake-seed-db.mjs`。

⚠️ **疑难辨析的分组不许读 `words.meaning`，只读 `words.sense_key`。** 分组算法按
「中文首义相同」找近义组、按首义判同表记异读是语体还是多义、按首义的汉字判汉字用法——
而释义审校**正是要把首义写得不一样**（医者「医生」/ 医師「医师（执照…）」）。
把审校同步进 `words.meaning` 的那一刻，测试当场红了 **90 组**：近义组散掉、
814 条手写辨析稿成了幽灵 key。`sense_key` 是冻结在 2026-09-16 的词典首义
（`src/data/word_sense_keys.json`，由当时的出厂库导出），出厂库烧、老用户由
`applyWordSenseKeys` 补列；用户自导的词没有它，`senseOf` 退回现算。
**异写合并（`variantMerges`）也按冻结键**：按当前释义判的话，愚か 加了「（书面）」就和
おろか 分家成「近义词」，もっとも(な形) 被改成「最」就被当成 最も 的异写吞掉。
分组的每一步只认冻结键，组才稳；`confusion-groups.test.ts` 的「纯异写」判据同口径。

代价：以后**改释义不会再自动改组**。要动组就改 `word_sense_keys.json`（并写明为什么）。
另一条线的释义审计（`docs/audits/2026-09-15-vocabulary-fixes.md`，532 条改动）烤进去时
不会再碰组，正是这条的用处。

### ⚠️ 外部 AI 的内容审计不许直接落库（2026-09-19 查明并回退）

用户在学习卡上看到 降り続く 的释义是「持续下」（括号里的雨没了），追查下来挖出两件事，
第二件是**上线以来最严重的内容错误**：

1. 辨析审校（`question-meaning-review/manual-batch-0033~0038`）把 降 词干组的「（雨）」砍掉、
   又把 9 条括号截到 9 个字（「突然（不经预告直）」）。`validate-manual-batch.mjs` 的
   「sense dropped」只数分号义项，括号不算，所以没拦住。
2. **2026-09-11~15 的全库释义审计里，N3 第 226 条以后是交给 WorkBuddy AI（免费）做的。**
   它查 JMdict **只按假名匹配、拿到第一条同音词就当作本词**，再反过来把正确的释义判成
   「同音异字混入」：虹→「第二；次要的」（它引的 JMdict 1461870 是 二次）、雁→「癌症」、
   堰→「咳嗽」、鮭→「酒」、炒める→「使受伤」（痛める）、lever→「肝脏」（liver）……
   带振假名括号的词（`堰[せき]`）它连汉字都没对上；纯假名词（くじ、ぶどう、すら、ほうき）
   随便挑一个同音词。每条还配着「现释义及例句均错」——例句明明写着「通过堰把河水引到农田」。
   它自己把 532 条写进 `jlpt_meaning_overrides.json`，09-16 烤库升版本时一并进了出厂库和
   用户的本地库。**题面层没被碰**，于是正向题题面写「彩虹」、翻过来答案面写「第二；次要的」。

526 条已应用的改动逐条看完：**73 条判反，全部退回**（61 条整个换成了另一个词的意思，
12 条砍掉了例句正在用的义项）；其余约 450 条是真的补义，留着。名单在
`docs/audits/2026-09-15-vocabulary-fixes.md` 头部。

⚠️ **退回的方式是把覆盖表里那一行改回原值，不是删掉那一行。** 用户库里已经是错值，
只有覆盖表能把它改回来；删掉覆盖 = 出厂库对了、老用户永远错着。

**两道机械闸，今天就是用它们把 73 条全捞出来的，以后任何外部审计先过这两道再谈人工：**

- **引用校验**：审计台账里引的词典条目（JMdict `ent_seq`）必须真的含有本词的 (汉字, 假名)；
  汉字列要先摘掉 `[振假名]` 和空格再比。这一条捞出 53 行，38 条是「需改写」。
- **例句零重叠**：新释义（摘掉括号）和例句译文一个汉字都不共享、而旧释义共享——55 行。
  单独看有 64 条合法改写也会触发（「聚会 ← 派对」），所以它是**复核清单**不是硬测试，
  但对「同音异字」类判定它是决定性的：释义和例句不可能同时错在同一个同音词上。

规则：**外部工具（Codex / WorkBuddy / 任何非本仓库流程）产出的释义改动，只能进
`docs/audits/` 当清单，不许直接写 `jlpt_meaning_overrides.json`。** 落库前由本仓库的人
（或本仓库的 Claude 会话）按上面两道闸过一遍，改动记在批次文件里，再走 `bake-seed-db.mjs`。
「它说自己人工核对过」不算证据——这次每一行都写着「人工核对」。

## 汉字读音模式：考的是读音，不是写法

`word-api/directions.ts` 的 `KANJI` 方向 + `lib/orthography.ts`。题面给日文表记和释义，
**只遮住汉字对应的那几拍假名**（`ReadingLine` 的 `concealKanji`），点一下揭晓。
中文母语者认得字，盲区在读音——这才是它存在的理由。

- 方向 id 是 `kanji_reading`（phase / 模式 id 仍叫 `kanji`，免得打乱用户存的模式选择）。
  旧的「释义 → 汉字」流水留在 `direction='kanji'` 和 `kanji_memory` 里当历史归档，
  **不回填**到新表：那份练的是写法，重放到读音题会制造虚假熟练度。
- `kanji_orthography.json`（165 条，由 `scripts/audit-kanji-orthography.mjs` 从 JMdict 生成，
  人工判定写在 `scripts/kanji-orthography-manual-review.json`）把词分三档：
  `kana` 不出汉字卡、`low` 出但排队尾、`alternate` 改用标准表记。
- ⚠️ **`alternate` 只能用于「同一个词的异体写法」**（剝→剥、片づける→片付ける）。
  改写成**另一个已存在的词条**是错的：`樹|き→木`、`主旨|しゅし→趣旨` 曾这样写过，
  而 木(#724 N5)、趣旨(#8325 N1) 在库里都是独立词条 —— 结果是两行显示成同一个词形，
  等于把 樹、主旨 改名。已退回 `keep`，测试在 `word-study-utils.test.ts` 里钉住。

**卡面词形全应用只有一份口径**：`orthography.preferredWordSurface`。
`confusion-groups.displayForm` 现在只是它的转发。别再分家——之前学习页走
`preferredWordSurface`（含 165 条表记判定）、词库/辨析/例句气泡走自己那份 `displayForm`，
同一个词在学习卡上是「ちょうど」、在词库里是「丁度」。

**一组辨析里不能出现两个一样的词形**（`buildGroups` 的 `add()` 按显示形态收口）：
老库重复行、异体写法、方括号注音摘掉后重名，三种都会造出「あなた / あなた」这种
自己跟自己辨析。但去重键要带上词源——`lock/ロツク` 和 `rock/ロツク` 卡面都写 ロツク，
那是两个词，正是该并排的一组；这类组的标题改摆词源（`lock / rock`），
副标题那句「读作 ロツク」已经把共同读音讲清楚了。

## 一字多音：说明表只有一份，判据说不清才轮到人写（2026-08-24）

`scripts/build-kanji-reading-usage.mjs` → `src/data/kanji_reading_usage.json`（懒加载，
gzip 42 KB，不进主包）+ `pages/KanjiReadingUsagePage.tsx`。入口在主页「学习工具」第四格。

**520 个多音字，473 个判据自动说清，47 个人写。** 判据五条，顺序就是优先级：
跟数字（月 がつ）→ 送假名形态（生きる/生まれる/生える）→ 封闭词表（留守的 る）→
音读通则 → 训读通则。

**「两行说明逐字相同」就是「该交给人写」的判据本身**，不用手工圈名单：行 い/ゆ、
重 じゅう/ちょう、大 だい/たい 全是这样自己冒出来的。生成脚本把撞车的吐进
`scripts/kanji-reading-usage-manual-review.json` 的 `pending`，写完 `notes` 再跑一次就清零。
`kanji-reading-usage.test.ts` 从产物那一侧钉着这条：**同一个字里不许有两行一样的说明**。

⚠️ **封闭词表（「只出现在这几个词里」）只能对音读用。** 对训读用会把例词少的**基本读法**
说成冷僻音 —— 原型把 月(つき) 写成「只出现在 毎月・月・年月・三日月」，而 つき 是月亮。
训读天生比音读少进复合词，例词少不等于冷僻。测试里正反都钉了。

⚠️ **送假名判据的形态要能真的把兄弟读音分开，而且不能只报最常见的那一个。**
冷(ひ) 最常见形态是「える」，可它还有 冷やす —— 写「带送假名 〜え」等于只说了一半，
全库 356 个读音有过这个毛病。现在形态**按例词熟悉度取、按首假名去重**：
冷 ひ→〜える／〜やす、さ→〜ます／〜める。（按出现次数排会取出「え／える」——
冷え込む 切出「え」、冷える 切出「える」，同一支说了两遍，另一支的 冷やす 整个漏掉。）

⚠️ **两个读音共用同一个送假名形态时，整个字转人工，不许把共用的那个悄悄删掉。**
止める 既是 とめる 又是 やめる。只留「独有形态」的话 と 写「〜まる」、や 写「〜む」，
看着分得清清楚楚，而真正会卡住人的 止める 两边都不提。全库这样的只有 6 个字：
**入・行・開・止・降・描**，全部人写，`kanji-reading-usage.test.ts` 钉着。

**「读哪个音」和「是哪个意思」是两件事，后者靠释义，不靠判据。** 送假名能告诉你
冷ます 念 さます，但说不出它和 冷える 的区别。例词因此带上 `words.meaning`（截到两个义项）——
**这一列本来就在库里，一个字都不用人写**。代价是 chunk 从 42 KB gzip 涨到 70 KB，还是懒加载。

⚠️ **和「疑难辨析」不是一件事，别互相搬运。** `confusion-groups` 的 reading-sense /
reading-register 说的是**词**（月(つき) 和 月(げつ) 是词库里两个词条）；这里说的是**字**
（月 在 一月/月曜日/三日月 里读三个音，而 がつ 根本不是一个词）。两者不重叠。

**没有 FSRS、不进当日计划、不上云同步**：这是查阅用的说明表，不是题，也没有用户状态。
想练读音走「汉字读音」模式。例词烧在构建期（读的是出厂库 `public/nihongo.db`，脚本里有
拒绝 live.db 的守卫），所以用户自己导的词表不会出现在例词里 —— 通则不因此变错，只是例子还是出厂那些。


## 题面拍数提示：给正向题消歧，不是给记不住的词发拐杖

正向题（中文 → 日文）的题面标签那一排多一个「4拍」。**它的用途是消歧**：题面那行中文
常常不止一个词对得上。看到「警察」该答 警察 还是 警察官？答不出来不是忘了，是不知道
在问哪个，那次「忘记」喂给 FSRS 才是假数据。补上拍数，撞车组里 47.1% 的词当场变唯一，
平均候选 2.74 → 1.68。

⚠️ **「撞车」有两份口径，`question-meaning-index.ts` 里两份都在，别合并**（2026-08-23 核对）：

| 口径 | 按什么分组 | 回答什么 | 实测撞车词 |
|---|---|---|---|
| `questionMeaningKeyOf` / `Peers` | `promptMeaning`（首义 + 8 字截断） | 「这两个词近到会互相干扰吗」——排片的干扰隔离用它 | 2,264（20.5%） |
| `displayedPromptKeyOf` / `Peers` | `questionMeaning`（**学习页真正渲染的那一行**） | 「题面这行字在问哪个词」——只有一字不差才算 | 745（6.7%） |

两者交集 721。差出来的 1,543 个是 経済「经济」/ economy「经济；经济舱」这种：会干扰，
但用户一眼看得出题面不一样。**对着这批词说「你们共用同一行题面」是假话**，所以撞车面板
和改写题面入口走口径 2，排片继续走口径 1。

（旧文档写的「3,935 个 / 35.6%」是 `question_meaning_overrides.json` 那 5,853 条人工题面
落地之前的数，已经不对了。）

- 判据在 `word-study-utils.moraCount`：拗音并进前一拍，`っ ん ー` 各算一拍（是「拍」不是
  音节，カード 3 拍）。**只能拿 kana 算**，外来語行的 kanji 是词源。
- 反向题不给（日文就在眼前）、汉字读音题不给（读音正是要考的）。
- **别把它做成「点开才看」或者只给顽固词**：那是把消歧当拐杖，用途就反了。
  所以它是**每张正向卡都给**，不按撞不撞车发 —— 只给撞车的词等于用有没有提示告诉用户
  「这张有陷阱」。剩下那一半分不开的（準備 / 用意 / 備え 全是 3 拍）交给下面那一档去说。

**答案面不再补一行 `words.meaning` 原文**（2026-08-23 删）。那行的条件是「和题面不一样就显示」，
在 5,853 条人工题面落地之前说得通；之后**题面才是更完整的那个**，剩下的是老词库原文，
而且 25.1%（2,777 个词）都会触发 —— 「有的词有有的词没有」就是这个条件造出来的：

| 词 | 题面 | 那行原文 |
|---|---|---|
| 安全 | 安全 | 安全**的** |
| 空港 | 机场 | 空港（根本不是中文翻译） |
| 経験 | 经验；经历 | 经验（信息更少） |
| 柄 | 体格；人品；身份；花样 | 花样；性质（换了一组义项） |

想看词库原文的话，「改写题面」的编辑框里一直摆着。**反向题的释义不在此列** ——
那是答案本身，必须留。

## 题面可以由用户自己改写（2026-08-23）

拍数拆不开的那些（「相当」底下 かなり / なかなか / よほど / 相当 / 随分 全是 3~4 拍），
算法再加标签也分不出来 —— **只有用户自己知道该按什么区别去记**。所以翻面后可以当场改题面。

- 存 `word_question_meanings`（word_id 主键），**不写 `words.meaning`**：words 表不同步，
  而且词单导入 / 换种子库会整表覆盖，手改的内容会静默一次性没掉。
- 覆盖挂在 **`questionMeaning` 和 `promptMeaning` 两处**（`models/user-question-meanings.ts`）。
  只挂后者的话题面纹丝不动、只有底下的撞车分组悄悄变了 —— 学习页渲染的是
  `card.questionMeaning || card.meaning`，`promptMeaning` 只喂给撞车索引。
- **跳过全部清洗**（首义切分、8 字截断、括号剥离）：用户写的就是最终形态，
  截断会把「相当（书面·程度高）」砍成「相当（书面」。
- 入口**只在翻面之后**。题面上挂编辑按钮 = 让人答题前盯着题面琢磨措辞，那是提示。
- **撞车面板那行小字只在真有话说时才出现**：「高亮的是拍数也一样的」只有在
  高亮和不高亮**同时存在**时才是信息 —— 撞车只有一个词、拍数还一样（包 → かばん 3拍）时，
  它解释的是一个看不见的区别。「改写只影响这台设备」那半句已删：一年用不了几次的功能，
  不该每张撞车卡都念一遍。
- 改完这个词自动退出撞车组（`resetSimilarMeaningCache` + `resetInterferenceCache`，
  重建放 `setTimeout(0)`，别在保存那一下同步跑）。
- 保存**不触发云同步**：一场里改五个题面就是五次全库快照上传。和便签一样只落本地盘。
- 新表必须同时出现在三个地方，漏一个都是静默出事：`sync/tables.ts`（不同步）、
  `scripts/bake-seed-db.mjs` 的 `userDataTables`（个人数据随出厂词库外泄）、
  `legacy-word-migrations` 的合并搬迁（重复词合并时把手改的题面一起删掉）。

## 学习时长 = 有在操作的时间，不是页面开着的时间

`lib/study-clock.ts`（纯函数 + 测试），学习页只负责挂事件。

- 判据是**距上次交互多久**，不是「这张卡停留多久」：看例句、开辨析气泡、写便签都是
  真学习，而且都带着滚动和点击；走神是一个事件都没有。
- 阈值 60 秒，从用户自己的作答间隔定的：p50=8 秒、p75=20 秒、p90=51 秒、p95=94 秒，
  而那还是整张卡的时间（翻面 + 评分两次交互），两次交互之间比它更短。低于 45 秒
  就开始吃正常的思考时间了。
- 触发续表的事件里**没有 mousemove**：鼠标扫过、页面抖一下都会误判成还在学。
- 记一次交互必须**先结上一段的账再改 lastInteraction**，否则走神五分钟后点一下，
  那五分钟会被追认。零头按毫秒攒（`pendingMs`）：滚动一秒来几十个事件，
  每次都 `Math.floor` 取秒的话每笔都是 0，一场能记成 0 分钟。
- 改这个口径会连带 `achievements/stats.ts` 的 maxMinutesInDay / minutesTotal 和
  `review-budget.ts` 的疲劳检测 —— 历史那段是老口径，曲线上会有台阶。

## 交互上的三条（2026-09-10 审查）

⚠️ **别再往 document 上挂「300ms 内的第二次 touchend 一律 preventDefault」。**
`webview-optimizer.ts` 里那条防双击缩放不看是不是同一个元素，所以
**快速点两个不同的按钮时，第二下的 click 会被吃掉** —— 而连着点评分正是答题的动作。
双击缩放本来就已经被 `index.html` 的 `user-scalable=no` 挡住了（WKWebView 认这个
属性，移动版 Safari 不认），那条监听器是重复的一道闸，只剩副作用。已删。
（一起删掉的还有两条空监听：`selectstart` 里那句 `preventDefault` 一直注释着，
`touchmove` 那条只有一个 `return`。）

⚠️ **通知 id 分段不许重叠。** 成就通知是 `9200 + Date.now() % 100`，占 9200–9299。
原来是 `% 1000`（9200–10199），把测试通知(9301)和备考提醒(9400–9413)整段吃掉 ——
一次成就解锁就可能顶掉当天的备考提醒，或者反过来被它取消。

⚠️ **`Paywall` 自带模态语义**（`role="dialog"` / `aria-modal` / Esc 关闭 / 焦点进来、
Tab 在卡片里循环、关掉还回原处）。缺了这几样，键盘和 VoiceOver 用户会在背后
那一页里乱走 —— 而背后那一页正是刚被拦下来的付费功能。
用原生 `<dialog>` 能白捡这些，但它要 Safari 15.4；现在最低是 16.4 了，
以后想换成 `<dialog>` 是可以的，换之前先确认 `showModal()` 在 WKWebView 里的行为。

## 图标：功能位一律 lucide，角色位一律留 emoji（2026-09-01）

`lucide-react`（**ISC 协议**，可商用、无需在界面里署名；上游一部分继承自 Feather 的 MIT）。
底部导航、卡片按钮本来就在用它，2026-09-01 把首页那批 emoji 也换过来，全 App 一套图标语言：

| 位置 | 换成 |
|---|---|
| 学习工具六格 | SlidersHorizontal / Library / Puzzle / Speech / Star / Ruler |
| 动物园一条 | Map / Bath / PawPrint |
| 连击、温泉连击 | Flame |
| 进度维护三条 | RefreshCw / Merge / SkipForward |
| 快速复习瓦片、词库图例、一字多音人工徽章、词典气泡播放 | NotebookPen / AlarmClock · Mountain / PenLine / Volume2 |

六个学习模式的图标也在 `studyMode.ts` 里换成了 lucide（`Icon: LucideIcon` 字段，
不再是 `emoji: string`）：经典 CalendarCheck、错题本 Brain、快速 NotebookPen、
反向 Repeat、汉字 Languages、自选 Target。七类辨析的 `TYPE_META` 同理
（ArrowLeftRight / Volume2 / PenLine / Crown / Type / Sprout / Handshake）——
**改成组件之后就塞不进模板字符串了**，学习卡上那行「辨析类别」摘要因此只列名字。

⚠️ **只换「图标」，不换「角色」。** 松鼠 🐿️、松子 🌰（含评分印章「🌰 认识」）、
队友头像、动物园地图的动物、温泉的柚子、纸屑 —— 这些是内容和性格，不是图标；
而且 lucide 里根本没有松鼠、水豚、温泉。全换成线条图等于把这个 App 的脸删掉。

- 颜色：图标走 `currentColor`，工具格和动物园一条上手动给主色
  （`.zoo-quad span>svg` / `.zoo-strip3 span>svg`）—— 那两处原来的说法是
  「中性底、只有 emoji 带色」，换成单色图标后那点颜色得由图标自己带回来。
- 顺手修了工具盘：加「收藏」之后是六格，CSS 还写着 5 列，第六个孤零零掉到第二行。
  改成 6 列，375px 屏上每格 ~58px，四字标签（查词汇量）不折行。

### 动物园主题退场（2026-09-16）

上面「只换图标不换角色」那条**已作废**——作者决定退回「一只吉祥物的普通 App」：
没有画师、也不打算请，而地图 / 温泉 / 图鉴那套园区叙事靠 emoji 撑不起来，
看着永远像「还没请画师」。**退的是比喻，不是功能**，每样东西剥掉动物皮之后都还在：

| 原来 | 现在 |
|---|---|
| 动物园地图（各园区丰容度） | 删。主页「进度概览」折叠区本来就是同一份数据 |
| 饲养员图鉴（`zoo-badges`） | 删。四组徽章的判据成就系统（`lib/achievements`）全都有 |
| 温泉打卡页 | 删。连击在主页问候条里（Flame + 数字） |
| 松鼠小路（`SquirrelTrail`） | **留**，走路的换成吉祥物，松子换成点。文件名没改 |
| 松子评分印章 🌰 | 「● 认识」 |
| 纸屑里的柚子/松子 + 动物列队 | 通用彩带，列队删了 |
| 组队页 | **留**（作者明确要求），队友头像和「松子」文案换成中性的 |
| 「动物园音效」 | 改名「答题音效」，**偏好键仍是 `zooSounds`**——改键会把用户存的开关丢掉 |

- **吉祥物只有 `components/CapybaraMascot.tsx` 一处**（导航栏两处、主页问候条、顶栏小路都从它取）。
  换成 AI 生成的定妆图时只改这一个文件；**不要做成多表情角色**——跨姿势生图不一致，一眼假。
  用在四处封顶：图标、首次启动、完成页、空状态。
- `zoo-*` 的 CSS 类名和 `ZooHome` 等文件名**没改**：改名是纯搅动，没有用户可见的价值。
- 页面 id `zoo-map` / `zoo-dex` / `hot-spring` 已从 `types/app.ts` 删掉，别再往 `AppNavigation`
  的高亮名单里加。

## 主页：入口一个不删，靠层级和收纳分主次

**「杂乱」的成因是均匀，不是数量。** 改版前 11 个入口各自是一张描边+阴影的卡片，
尺寸相近、结构相同（emoji + 标题 + 说明书副标题），于是「今天要背的词」和「收藏」
视觉重量一样。整页 2.4 屏，而第一屏里真正关于「今天学什么」的只有 106px（17%）。

`ZooHome` 现在是四层，**入口一个没删**（队伍卡也留着——上架前会接真后端）：

| 层 | 谁 | 做法 |
|---|---|---|
| T1 | 今日大卡 `.zoo-now` | 全页**唯一的实心主色块**，数字 40px serif。模式切换从旁边 119px 的大卡收成右下角一枚 chip —— 它是「改设置」，不该和「开始学」抢重量 |
| T2 | 备考 / 队伍 | 并排两格，描边不填色，标题 15px |
| T3 | 动物园三件事 | **合成一条三段**（地图 / 温泉 / 图鉴），中性底、只有 emoji 带色 |
| T4 | 工具四格 | 一个盘子里，无独立描边、**无说明书副标题**（「同音·自他·近义词对照」第一次有用，第一百次是噪音） |
| T5 | 进度概览 | 折叠，摘要只有一行数（十根柱子里七根是 0%，常驻 291px 不划算） |

- **收纳靠「盘子」`.zoo-tray`**：同类装进一个比页面底色浅一层、不投影的容器，
  盘子内部的格子不再各自描边。分区标题变成盘子内的小标签，不再是漂在外面的独立行。
- **同一个数字全页只说一次**：改版前「今天还剩 N」在第一屏出现三次（顶栏松鼠条、
  问候语、大卡）。问候语改成说别处没有的（连击 / 今天的状态）。
- 结果：1,532px → **740px**（2.4 屏 → 1.17 屏），入口数量不变。

### 进度概览的三档：单词 / 语法 / 每日（2026-08-28）

`ZooProgressPanel` + `lib/study-load.ts`。

⚠️ **「双栏」那一档删了。** 两栏并排时每栏只剩半个屏宽：五根柱子挤成竹签、摘要那行
折成两行，信息密度反而比单栏低，还得靠一条 CSS(`min-height:2.8em`) 硬撑着让两侧
柱状图对齐。想比较两边左右滑一下就行。腾出来的那格给「每日」。

**「每日」= 过去每天真学了多少 + 往后一周预计要学多少**，一张条形图。

- ⚠️ **只数正向（经典模式）。反向 / 汉字读音 / 语法都不进这张图**（2026-08-29 改）。
  原来四档一起数，症状是主页上两个数字当面打架：图说今天 493、经典模式大卡说 320。
  实测那三档根本没人在背 —— 过去 14 天 3,634 卡次里正向占 **3,583（98.6%）**，
  语法 29、汉字读音 19、**反向 0**。图的左半边本来就已经是 99% 正向；混进来的三档
  只在「今天」和「预计」那几根里凭空挂一笔**永远不会还的账**（反向那 15 张到期卡
  挂了 14 天一次没动过）。一张用来看积压的图，把不会动的债天天画给你看就没意义了。
  代价：**那三档的积压从此在主页上看不见**，只在各自入口里有数。
  单位因此从「张卡」变成「词」，和大卡的「320 词」同一把尺子。
- ⚠️ **改成只数正向之后，「今天」那根仍然不等于大卡上的数**（实测 442 vs 320）。
  剩下的差额是顽固词闸门：正向到期 412 张里 149 张是 lapses≥8 的顽固词，而当日计划
  每天只放 `LEECH_DAILY_INTAKE`(10) 个进去（09-20 起永远生效）。**这条差额是故意留着的**，理由同下面
  「没有套复习上限」那条 —— 这张图就是用来看积压的，把闸门套上去等于把积压藏起来。
- ⚠️ **`direction = 'forward'` 是口径本身，不是顺手加的过滤**：老库里还躺着
  `direction='kanji'` 的历史流水（已废掉的「释义→汉字」写法题）。而且**方向过滤必须
  写在「第一次露面」那个子查询里面** —— 写外面的话 MIN() 会算上反向的日期，
  一个词先背过反向，它的正向首答就被算成「不是第一次」，那天的新学凭空少一个。
- **左边是发生过的事，右边是排出来的账**，两种东西，所以纹理必须不一样
  （实心 vs 斜纹）—— 都画成实心的话，这张图就成了在承诺未来。
- ⚠️ **预计是个下限**：只算了已经排好的 due 和新词额度。今天答错的卡过几天还会回来，
  那部分还没发生，排不进去。也**没有**套复习上限——那是「今天最多给你排多少」，
  套上去会把积压藏起来，而这张图正是用来看积压有没有在变小的。
- ⚠️ **今天那根要画「还没做的」那一截**（`pending`，斜纹）。只画已完成的话，
  早上打开就是一根 0：明明今天有三百张要背，图上却是个空洞，右边的预计柱子还都是满的。
- ⚠️ **未来按学习日（凌晨四点）分桶，边界用 `studyDayEnd` 在 JS 里推**。
  `fsrs_due` 存的是 UTC 时刻，SQL 里 `date()` 切出来是 UTC 日，差几小时的卡会记错天。
- ⚠️ **刻度长在柱子自己身上**。单独摆一行 `space-between` 的话「今天」会飘到正中间，
  而它实际在第 14 根，指的就成了别的日子。
- ⚠️ **别在 flex 子项的内联 `height` 里写 `max(…%, 2px)`**：实测在 WebView 里整根
  塌成一条。要留最小高度就用 `minHeight`，并给 `.zoo-load-stack i` 加 `flex:none`
  （三截加起来贴着 100%，可收缩的话舍入误差会把整根压扁）。
- ⚠️ 新类名别再叫 `.zoo-hero*`：那一族是老主页留下的，`[data-theme="dark"] .zoo-hero`
  会把新卡的背景覆盖成暗绿底 + 暗绿字（踩过一次）。新的一律 `.zoo-now*`。

## 查词汇量：估计怎么算的，以及为什么先摸底再压题（2026-09-01）

**估计 = Σ(该级词数 × 该级答对率)**，答对率 = `(对 − 错/3) / 答题数`（四选一的猜测修正），
夹到 [0,1]。区间是各带方差加权后的 1.96σ。

⚠️ **这个数被大带主导。** 实测用户库各级词数：

| N5 | N4 | N3 | N2 | N1 | 合计 |
|---|---|---|---|---|---|
| 888 | 876 | 2,144 | 3,617 | 4,215 | 11,740 |

N2+N1 占 67%。也就是说 **N1 答对率每差 10% = 422 个词**，而一带只出十来道题 ——
多对一道 ≈ +280 词。用户那次 4,493 的区间是 3,007–5,979，区间自己已经在说
「分不清三千和六千」。往低了估还是往高了估，先看这三条（按影响排序）：

1. **出题漏题**（今天修的那批）。读音题占全部题的七成，而送假名/可见假名的泄漏
   让人不认识也能选对 —— 这会直接抬高每一带的答对率，进而按词数放大。
2. **四选一识别 ≠ 会**。`−错/3` 只惩罚**猜错的那部分**，猜对的那 1/4 留在分子里；
   点「不认识」才完全不算猜。所以「不会就硬猜」的人一定被高估。
3. **词表本身**：11,740 个词里有大量没人会声称认识的词，但答对率是按整带外推的。

⚠️ **进这一页永远先看落地页，一个例外都没有**（`view` 初值恒为 `intro`）。踩过两次：

- 「上一场已经结束」就把结果页顶上来 → 点「查词汇量」看到的是一张
  「答得还太少 · 只答了 0 题」的旧结果，而不是这个功能的门面；
- 「上一场没答完」就直接跳回题目 → **那条「本次测试于 xx 开始、搁了多久、要不要重测」
  的提示永远没机会出现**，而它正是为「隔天回来接着答」写的。

结果页只有两条路进：刚测完，或者在落地页点「上次的详细结果」；
半途那场也只从落地页的「继续测验」进去。

### 先摸底 20 道，再把剩下 40 道压到「说不准」的那一带

`VOCAB_TEST_PROBE_PER_LEVEL`(4) × 5 = 20 道摸底 → 用**实测**的各级答对率重算
Neyman 权重 `N_b·√(p̂(1−p̂))` → 剩下 40 道按这个分配（`extendVocabTestPlan`）。
N5/N4 全会、N1 全不会的人，剩下的题几乎全落在 N3/N2 —— 那才是他词汇量的分界线。

- p̂ 夹在 **[0.15, 0.85]**：一带四题全对/全错很容易是运气，权重直接归零就再没机会纠正。
- ⚠️ **每一带都必须有实测题，不能只考「边界带」。** 最终估计是 Σ(词数 × 答对率)，
  某一带一题不出，那一带就只能拿假设值填（100% 或 0%），那不是测出来的。
  纯自适应（只在边界附近出题）要成立得换成 IRT：每道题标定难度参数、估 θ 再积分出词汇量——
  而题目参数需要大量真人作答数据去标，我们没有。
- ⚠️ **进度条分母是 `plannedTotal` 不是 `questions.length`**：摸底阶段只出好 20 道，
  拿题数当分母的话进度条会在第 20 题冲到 100% 再倒回去。
  词库出不满 60 道时 `plannedTotal` 降到实际出的题数，否则小词库用户答完了所有题，
  可信度还要因为「没答满」被扣一截。

## 读音题：只问看不见的那部分（2026-09-01 修）

一道读音题只有在「被遮住的那部分就是难点」时才成立。三种一眼能蒙对的题（全是实测报上来的）：

| 题面 | 曾经的选项 | 白送在哪 |
|---|---|---|
| 培う | つちかう / つきあたる / つかう / さいばい | 题面那个 `う` 直接排掉两个 |
| 手が離せない | てにつかない / てがはなせない / てがはなれる / あいてをする | 手・が・せない 全露着，不认识「離」也选得对 |
| 手にかける | てをかえる / てにかける / てをかける / てをあげる | 那个 `に` 一出来，三个 `を` 全废 |

判据全部从数据算，**不用人工名单**（`vocab-test.ts` 的 `kanjiCoreReading` + `isReadingQuestion`）：

- **纯汉字词**（経済、自然）→ 出读音题，整词读音就是隐藏部分；
- **一段汉字 + 送假名**（培う、お金）→ 只问汉字那几拍（培う → つちか，题面不变），
  且要求汉字部分 **≥ 2 拍且 ≥ 整词的一半**；
- **汉字占比太小**（手にかける 的 て 只有 1/6 拍）或**中间夹假名 / 带助词**（手が離せない）
  → **不出读音题，改出中文释义题**。释义题的选项是中文，题面上的假名给不了任何线索。

出厂库实测：读音候选 8,922 个里纯汉字 6,162、可拆 2,065、夹假名 695；
按新判据出题后读音:释义 ≈ 339:141。

⚠️ **选项值跟着答案口径走**（`row.readingValue`）：干扰项、拍数相似度、音位槽、
「这个题面的其它合法答案」全部用同一份值算 —— 一处忘了改，就会出现
「つちか 旁边摆个完整的 さいばい」这种长相不一致的选项。

⚠️ **一拍的答案不适用「另有选项共享首拍」那条体检**（`vocab-test-distractors.test.ts`）：
拆完之后这类题的四个选项各是一个假名，「共享首拍」等价于「有两个选项一模一样」，
结构上不可能满足，也没必要 —— 答案本身就只有一个汉字的一拍。

## 疑难辨析：按类分节 + 搜索（2026-09-01）

1,933 组光靠「每天洗一次牌」是翻不到想看的那一类的。现在头部多两样：

- **搜索**：词形 / 假名 / 释义 / 组标签，任一命中。可搜文本按组缓存在 `WeakMap` 里 ——
  上万个成员，每敲一个键重拼一遍是白烧 CPU；组对象一次会话里不变，拿它自己当键最省事。
- **类别 chip**：七类各带数量，点一下只看那一类，再点一下退回全部。**角标跟着搜索走**
  （搜完之后它要回答的是「这一类里搜到几个」）。

正文改成**按类分节**（每节一个小标题 + 数量）。筛选和分组共用同一段渲染：
选中某一类时 sections 只剩一节，没有第二套代码路径。卡片上原来那行「类别」标签因此删掉 ——
节标题已经说了，每张卡再说一遍是噪音。

## 查词汇量：先给一张「第二主页」，测验是它上面的一个按钮（2026-09-01）

`VocabTestPage` 的落地页 = 最近一次成绩 + 历史表 + 分享 + 规则说明 + 开始/继续测验。

- **历史落 `vocab_test_history` 表**（run_id 主键，同步策略 `union`：每次测完追加、之后不改）。
  只存结果不存题目 —— 题是每次现抽的，存下来既没用也白占快照体积。
  照例三处登记（`sync/tables.ts` / `scripts/user-data-tables.mjs` / 建表 SQL）。
- **按 run_id 幂等**：结果页来回进出、刷新都只写一行。**一题没答的会话不记** ——
  那不是一次测验，是打开看了一眼。
- **规则那一段是必要的，不是装饰。** 这个数天然会被当成「我的日语水平」到处说，
  而它只是 JLPT 词表范围内的抽样外推。把口径（四选一扣分、不认识不扣分、
  可信度怎么被「蒙的比例」乘下去、超时按不认识记、少于 15 题不给数）摆在进门的地方，
  比在结果页写一行小字管用。
- **分享出的是一张图**，和打卡分享同一块底座（`lib/share-canvas`：背景、「語」牌、
  日期胶囊、圆角、导出都在这里，两张卡都从这儿取）。图上必须写着「JLPT 词表覆盖范围内的
  抽样估计 · 仅供参考」和可信度 —— 这张图会离开 App，口径不跟着图走，
  「我的日语词汇量 4,493」就会被当成体检报告。各级表现画横条，没答过的等级画空槽写「未答」，
  不画成 0%（那是两件事）。历史行为此多存一列 `levels_json`。

### ⚠️ 用时是「答题用的时间」，不是墙上时间

实测出过一条「2 题 · 用时 **4160 分 36 秒**」：中途切走、隔天回来接着答，全算进去了。
两头都堵：
- 记录侧 `activeSeconds()` = 每题 `responseMs` 求和，且**每题按自己的时限封顶**
  （读音 15 秒 / 释义 10 秒）—— 超时限的部分一定是人不在；
- 界面侧切走时记下时刻，回来把这段从 `questionStartedAt` 里减掉；
- 读历史时对早期按墙上时间记的行按「每题 20 秒」封顶。

### ⚠️ 续测要说清楚「什么时候开的、隔了多久」

搁了半小时以上（`STALE_RESUME_MS`）就把提示变成橙色并建议重测：前后半场不是同一个状态，
默默把两段拼成一次成绩，那个数就不是这次测出来的。

## 词库页（主页那个「选词」按钮）：颜色说的是记忆强度，不是排期

> 和下面「选词 = 优先级 + 排片」不是一回事：那条说的是**出哪张题**，这条说的是**浏览词库**。

`lib/word-library.ts` + `pages/WordLibraryPage.tsx`。入口两个：主页「选词」瓦片、
进度概览里**每一根柱子**（N5 那根点开就是 N5 的全部词；语法柱跳语法库）。

- **记忆档按 FSRS stability 对数分档**（未学 / <1天 / 1-3天 / 3-7天 / 1-3周 / 1-3月 / 3月+ / 已掌握），
  颜色只在 `app.css` 的 `[data-band]` 里定义一遍。**不要改成按到期或回忆概率 R 上色** ——
  那样同一个词今天红、复习完变绿，翻词库看到的就成了排期而不是记忆。
- **色阶别拿 180 天当满绿**：用户 2,092 个学过的词里 stability 从 <1 天到 90 天+ 都有，
  按 180 天铺整页只剩红黄；「已掌握」只有几十个，它是单独一档不是色阶终点。
- **词库里未学的词不算「到期」。** 全局口径 `fsrs_due IS NULL` 视同到期（那是给出题池用的），
  在这一页会把八千多条没碰过的词全染红，所以 `DUE_IN_LIBRARY_SQL` 额外要求 `seen_count > 0`。
- **分布带只画学过的词**（未学占八成，混进去彩色部分会被压成看不见的一条线）。
- 分页/筛选/排序全在 SQL 里，每次取 100 行；`offsetRef` 记偏移**不能用 `rows.length`**
  （同一 tick 里连着触发两次会拿同一个 offset 再查一遍 = 整页重复）。
- **一路懒加载，不许设「加载到 N 条就改手动」的封顶** —— 那等于把懒加载退化成分页器。
  DOM 的重量交给 CSS 的 `content-visibility:auto` + `contain-intrinsic-size`：实测行数
  2,300 → 4,600 翻倍时 DOM 节点跟着翻倍，但布局开销**没变**（54ms → 52ms），
  浏览器只给屏幕上那十几行算布局。
- 续页用滚动事件，**别用 IntersectionObserver、也别拿 rAF 当节流闸门** ——
  两者在页面不可见时都不触发，等于给「滚了却不续」留一条静默失效的路（见 `check()` 上的注释）。
  底部那行「正在加载…」本身是个按钮：看着是状态不是分页器，真卡住了点一下还能推下去。
- **片假名永远是最大最显眼的那行。** 外来語行的 `kanji` 存的是**词源**
  （camera / apartment house / gram；(法) gramme，用户库里 835 个词、7.5%），
  照 `kanji || kana` 摆大字等于让人学英文。一律走 `confusion-groups` 的 `displayForm`：
  kanji 里有拉丁字母就退回假名，词源降到小字那行。学习页（`isLoanwordSourceCard`）、
  疑难辨析、词库、例句词典气泡四处共用这一份，**别再写第五套**。
  `displayForm` 顺带摘掉方括号注音（飴[あめ] → 飴），其中 28 条注音夹在词中间
  （一目 惚[ぼ]れ、茶[ちゃ] 碗[わん]），摘完要连空白一起收掉，否则卡面写着「茶 碗」。
- **选词的手势和快速学习是同一份实现**：`hooks/useRowSelection`（长按 460ms 进选择模式、
  按住往下划一路选过去、拖到边缘自动滚）。这套原来只长在 QuickStudyPanel 里，
  抽出来两边共用 —— 手势那几个阈值和「松手那一下不能再触发行点击」的坑，每写一遍都要重踩。
  hook 里的 onEnter/onExit 必须走 ref：调用方多半是行内箭头函数，直接进依赖会让 exit
  每次渲染换身份，只在挂载时跑一次的 loadSession 跟着失效。
- 一万行的列表光有手势不够，**按条件整批勾**才是常用的：工具条上那排「全选 / 未学 /
  该复习 / 顽固 / 清空」走的是列表同一条 SQL（`wordLibraryIds`），勾中的就是看得见的那些，
  单次上限 300（和自选清单一次最多带 300 个词是同一个数）。
- 词性字段脏（名词/名/名·サ变/名词・する动词… 48 种写法），`classifyPos` 收敛成七类。
- **点开是只读详情：没有评分按钮，以后也别加。** 和辨析气泡同一个道理——答案全露着的时候评分
  等于给 FSRS 灌「记住了」。能改的只有收藏和笔记。

**队列只有一份**：progress 里的 FSRS 状态。「今天」是它在学习日边界（凌晨四点）上的一个投影，
`stage1_tasks` 只是那个投影的物化。所以**只有没学过的词才谈得上「加入队列」** ——
学过的词到期自己会出现，给它一个「加入今日」按钮既没有含义、也做不到（当日任务表的取词条件
卡着 `fsrs_due <= 今日边界`，硬插一个下个月到期的词进去是静默无效的）。词库页据此把
「加入队列」按钮对学过的词灰掉，只有未学的词在详情里才有那个按钮。

批量操作三条，都不碰 FSRS 记忆状态：

| 操作 | 做法 |
|---|---|
| 熟知（每行末尾那颗 + 多选工具条上那颗，**同一条实现**） | `setWordsKnownForever`：等价于「这个词进了队列、第一次出现就答了熟知」—— seen_count +1、写一条 `answer='known_forever'` 的正向流水，然后 `known_forever = 1` 退出 FSRS 队列。**不往 stage1_tasks 插行**：当日任务的「完成」判据就是 `known_forever = 1`（见 `stage1ProgressCounts`），插进去等于凭空给今天加一条已完成任务，标 50 个熟知今日计划会瞬间变成「50/70 完成」。再点一下撤销：**当天**点的连流水一起删、seen_count 减回去（点错了要能真的回到「没学过」），更早那次只翻标记不重写历史。`markWordKnownForever` / `unmarkWordKnownForever` 只是单个词的包装，别再写第二套 |
| 加入队列 | `addWordsToQueue`，**只收未学的词**。今天的新词名额优先给用户挑的这些：额度满了就把「系统自己挑的、还没答过的」新词让出来换掉（腾挪的候选**必须排掉这次勾中的词**，否则刚放进去的那个 order_index 最大，下一轮就把它删了，最后只剩一个进得去）。额度之外的写进 `dictionary_discovered_words`，之后排计划时最优先 |
| 只学这些 | `focus: "picked"` 通道，见下。想不管到期与否现在就刷，走这条 |
| 标熟知 / 放回复习 | `known_forever`，等于「别再考我」，记忆状态原样留着 |

`addWordToTodayEncore`（例句词典里「我现在就想学这个词」）是另一条：一个词、当场插队、
用 encore_new 越过配额。两条别混——一个是「排进队列」，一个是「现在就给我」。

## 老库重复词条：先搬记录，再删行

同一个词录了两遍的行，判据一直在 `confusion-groups` 的 `duplicateMergeTargets()`
（原来只吐一个 id 集合，现在连「并到谁」一起吐；辨析过滤和合并迁移共用这一份）。

**去重当年刻意没做数据迁移**，因为直接删行会连带删掉挂在那行上的学习记录。代价是这些行
还躺在词库和新词池里：用户学到 25 次的 一昨日 旁边有一行从没出现过的 おととい 写着「未学」，
而且迟早被当新词教一遍 —— 实测用户库里 77 对两行都学过了。

`duplicate-merge.ts` 把这件事做完：`mergeWordInto`（从 ビル 那次一次性迁移里抽出来的）
逐表把流水、便签、收藏、三个方向的记忆、当天任务挂到存活的那行，然后删词条行。

- **reviews 必须先删后插，不能 UPDATE word_id。** 它的同步身份是 (word_id, created_at, direction)，
  UPDATE 不写墓碑 → 旧身份在别的设备上原样留着，同步回来就多出一份。删触发墓碑杀掉旧身份。
- 删行**必须**走同步触发器留墓碑，否则另一台设备把重复行复活（`words` 表本身不同步，
  但它的 progress 行同步；墓碑没了 `ensureProgressInitialized` 会重新长出来）。
- 三个方向的长期记忆各自按 seen_count 多的一行取胜（沿用 ビル 那次的口径），
  不做加总 —— stability/difficulty 不是能相加的量。
- 入口在首页「进度维护」里，**手动触发 + 二次确认 + 先存整库恢复点**
  （`saveRecoverySnapshot("before-duplicate-merge")`，浏览器端落在 IndexedDB 的
  `recovery-before-duplicate-merge` 键上）。删行不可逆，不做成开机自动迁移。
- 实测用户库：11,056 → 10,858 行，搬走 1,651 条作答，**作答总数 35,767 一条没变**，
  新词池里少了 120 个幽灵行。`duplicate-merge.test.ts` 盯的就是这几条
  （跑真实库：`MERGE_DB=../../.local/live.db npx vitest run src/lib/duplicate-merge.test.ts`）。

### ⚠️ 它从上线起一次都没成功过（2026-08-23 查明并修复）

用户报告「メモ 在词库里写着未学，但我肯定学过很多次」。查下来 メモ 有两行：
`memo|メモ`(#839，N5) 和 `メモ|メモ`(#2429)，学过 11 次的记录全在 #2429 上，#839 一直显示未学。
判据本身没问题（`duplicateMergeTargets()` 认得这一对），**是合并每次都在同一行上回滚**：

`reviews` 里有 1 条（36,759 条中的 メールアドレス 2026-08-02）`sync_uid IS NULL`。删它时
delete 触发器算出 `row_key = NULL`，撞 `sync_tombstones.row_key` 的 NOT NULL 约束，
**把整个批量迁移的事务掀翻**。所以点多少次都没用，而且报错埋在事务里不显眼。

NULL 是怎么来的：uid 回填原来写在 `!columns.has(SYNC_UID_COL)` 分支里，**只在第一次加列
那一次跑**。而 insert 触发器补 uid 的前提是 `applying_remote` 没开 —— 云端合并全程开着它，
于是从对端合并进来、自己又没带 uid 的行永远补不上。

两处都修了（`sync/schema.ts`，回归测试在 `schema.test.ts`）：
1. **uid 回填改成每次启动都跑**，不再只跑一次；
2. **delete 触发器加守卫**：`row_key` 算不出来（某列 NULL）就跳过墓碑，而不是抛错。
   没有同步身份的行本来就不可能被对端按键复活，跳过是安全的；抛错则会掀翻调用方。

修完在用户真实库上试跑：11,056 → 10,858（−198），**36,765 条作答一条没变**，
known_forever 322 → 287，墓碑 515 → 4,672。メモ 的 11 次记录和 FSRS 状态（due 2026-08-30、
lapses 1）正确落到 #839 上，用户当天误标的「熟知」被真实状态覆盖掉。
**198 行里有 18 行是「被标了熟知、但真正学过的是另一行」** —— 这个误导一直在发生，不止 メモ 一个。

注：两行都学过的 94 对**不加总 seen_count**（按 seen 多的一行整行取胜，沿用 ビル 那次的口径），
所以合并后 seen_count 合计会掉 461，而 reviews 一条不少。这是有意的 —— stability/difficulty 不是能相加的量。

## 语法考题：和单词同一套 FSRS（2026-08-27 改）

`lib/grammar-quiz.ts` + `pages/GrammarQuiz.tsx`。入口在语法列表页工具条的「考题」，
和「沉浸学习」并排。**题面是句型，答案是接续 + 中文意。**

**语法是第四个走同一条流水线的阶段**（正向 / 反向 / 汉字读音 / 语法）：
FSRS 到期集 → 当日复习上限 → 新语法配额 → 学习步骤（没毕业就当天隔几张重刷）
→ 往 `grammar_reviews` 记流水。作答那一段和 `word-api/direction-answer.ts`
一字不差，包括**当天首答点认识按 Easy** 和顽固卡的三步重学。

⚠️ **上一版写着「刻意不上 FSRS，一个等级只有一百来条」，那条理由是错的。**
它只在「第一次过一遍」的时候成立 —— 洗牌洗的是顺序，不是「哪些今天该复习」，
所以第二轮开始每次都得把已经记牢的一百多条重新点一遍，真正忘掉的那几条淹在里面。
条数少不改变遗忘曲线的形状。

- 数据落 **`grammar_progress`**（数字 grammar_id，和 `grammar_points` 同一套 id）
  的 `fsrs_*` 列 + `grammar_reviews` 流水。两张表本来就接了云同步，
  `jlpt/status.ts` 和 `progress-api.ts` 早就在按 `p.fsrs_due` 查语法了 —— 改完它们才有数。
- **刻意没建当日任务表。** stage1_tasks 是给八千词做物化的；语法一个等级一百来条，
  「今天该做什么」现算一次几毫秒，「今天做过什么」由 `grammar_reviews` 说了算。
- **新语法配额走自己的旋钮 `preferences.grammarDailyGoal`（默认 5 条/天，2026-09-06 改）。**
  原来蹭的是单词的 `dailyGoal`，那是错的：一个等级只有一百来条，按每日新词 15 排
  等于八天过完一级，而一条语法要记的是接续 + 用法，不是一个词形。范围 [0, 30]，
  **0 = 今天只复习学过的，不进新条目**（单词那根滑杆下限是 5，语法允许停）。
  和单词各排各的一份、互不挤占；复习上限仍然共用 `reviewCap`（那是「一天最多复习多少」
  的唯一旋钮）。判据钉在 `grammar-quiz.test.ts`。今天的过完了
  想继续走「再学 10 条」（`extendGrammarQuizPlan`，把当天配额抬高，记在
  `grammar_state` 的 `quiz_encore:<等级>:<日期>`），不自动往后借明天的账。
- 评分四颗：忘记 / 模糊 / 认识 / 熟知，V/B/N/M，和单词学习共用
  `answerOptions` + `answerHotkeyLabels`。**「模糊」以前不摆是因为没有调度器接
  Hard 档**，现在有了。
- 重刷队列和「刚答过的别连出」共用 `word-api/session-state`，方向键叫 `grammar` ——
  那条通道上队列项里的 `word_id` 装的是 grammar_id。
- 没有排片器：干扰隔离靠「同混淆组」，而语法点没有那份数据。
- 「错得最多」那份列表还在（按 `forgot_count` 倒序），现在只是攻坚入口，不再是唯一的算法。
- 等级选择器长在考题页自己身上，不沿用列表页那个可以选「全部」的筛选：备考是按等级来的。

### 语法「抓手」：一句 ≤20 字，说这条最容易错在哪（2026-09-08）

`src/data/grammar_key_points.json`（741 条，人工逐条写）+ `lib/grammar-key-points.ts`。
显示在语法考题卡（翻面后，接续和中文意之下、例句之上）、语法辞典、语法库、沉浸阅读四处。

⚠️ **它不是「把解释缩短」，是「说解释里没说的那一点」。** 重写之后的 `explanation`
本来就短（**中位 49 字、p90 59 字、最长 72 字**），在 49 个字里再划三个字收益接近零。
真正累的是**四个字段 × 741 条在同一屏上等重摆开**，没有主次。所以抓手写的是
「这条最容易错在哪」——`ではない` 不是 `ではありません`、`ことにする` 是自己决定而
`ことになる` 是别人定的、`しか` 后面必须接否定。判据是「删掉它，这张卡还剩什么」。

- **键是 `grammar_points` 的 `pattern`，不是 grammar.ts 的字符串 id。** 语法考题卡
  （`GrammarCard`）拿到的只有 DB 那一行，学习页拿到的是 grammar.ts 的 point ——
  用 pattern 当键两边共用同一份，考题卡也就不用为了查一句抓手把 1.5 MB 的
  grammar.ts 拉进自己的包。重名的 14 条在 `aliases` 里存 id → 带后缀的 pattern。
- ⚠️ **故意不进数据库、不进 `grammar_seed`。** 它是内容不是用户状态；加一列就要动
  `ensureGrammarSeed` 那条会掉条目、会删用户进度的迁移路径（见下一节），
  而这份 JSON 换一版只是换个文件，没有迁移、不用升种子版本。
- ⚠️ **也绝不要写进 `grammar_highlights`。** 那张表是**用户自己划的重点**：走云同步、
  按 block + start/end 存、带 `GRAMMAR_HIGHLIGHT_DATASET_VERSION` 失效检测、上限 500 条。
  混进去的后果是「用户清空自己的重点会把系统的一起清掉」，以及每次内容改版给每个人
  糊几百条「此重点已失效」。
- 样式一份：`.grammar-key-point`（辞典 / 语法库 / 沉浸阅读三处共用）。
  **浅色主题单独沉一档**（#81D8CF 在奶油底上读不动，同振假名标注那条）。
  考题卡不用这个类 —— 那张卡的颜色由调用方通过 `--quiz-accent` 传进来
  （考题页青绿 / 混合模式琥珀），写死就破了那条口径。
- 体检在 `grammar-key-points.test.ts`：741 条一条不缺、都在 20 字以内、
  **重名的两条不许串成同一句**（やる 在 N5 是「做，比する随便」、在 N4 是「给晚辈」，
  按 title 查会并成一条）。

### 接续标在题面每个 `～` 的头上（翻面后）

`grammar-formation.ts` 的 `patternAttachment`。`～` 是这张卡真正的坑，光在答案区
写一行接续，眼睛还得自己把「名词／用言普通形」和句型里的哪个 `～` 对上号。

`formation` 是人写的说明文不是可解析的语法，所以原则是**宁可不标**（判不准返回 null，
下面那行完整接续照旧）。出厂库 741 条里 554 条标得出来。四条判据：

1. 题面得有 `～`、接续得有 `＋`（没 `＋` 的是整句说明，不是「A ＋ 句型」的形状）；
2. 取 `＋` 前第一段；它自己不能再含 `～`（`～が／は＋他動詞て形` 说的是助词）；
3. ⚠️ **它不能和题面的字面部分互相包含** —— `もう～`、`お／ご～になる`、`なにしろ～から`
   的第一段是 もう／お／なにしろ，那是句型自己的一部分，标上去就成了「往 `～` 里填 お」；
4. ⚠️ 多个 `～` **只认叠用**（`～にしろ～にしろ`：字面两两重复、接续只有一段）。
   `～から～にかけて`、`～ば～ほど` 两个坑填的不是一个东西，把第一个坑的答案抄到
   第二个头上比不标更糟。
   两条独立规则写在一起的那 55 条走 `splitFormationRules` 各取一段再并起来
   （`動詞て形／動詞ない形`），只取头一段会把另一半说没了。

⚠️ **标注是绝对定位的，不占行内空间** —— 句型自己的排版和换行一个字都不变。
真拿 `<ruby>` 做的话，`名词／用言普通形` 会把那个 `～` 的基字撑到一百多像素宽，
四个 `～` 的叠用句型在手机上直接散架。代价是容器要留出上方空间和行距
（`.grammar-pattern--annotated`）。颜色走橙色系区别于振假名的绿，
**浅色主题单独沉一档**（#E8971C 在奶油底上只有 2.2:1，11px 小字读不动）。

⚠️ **翻面前不标。** 接续正是这张卡要考的一半，答题前摆出来就是给答案。

⚠️ **语法有两份进度，别混用。** 列表页的「熟悉/没记住」在 `hooks/useStudyStore` 的
**localStorage** 里，按 grammar.ts 的**字符串 id**（pdf-n3-010）存，**不同步**；
考题这份在 `grammar_progress`，**数字 id**，同步。两边桥接要靠 pattern 匹配，而
两份 id 体系不同，所以现在**没有合并**，考题是自成一套的。
（seed 和出厂库的 741/731 那条已于 2026-09-08 修掉，见下一节；
但列表页那份 localStorage 进度和 `grammar_progress` 仍然是两本账。）

### 混合模式（单词 + 语法，2026-09-05）

`STUDY_MODES` 的 `mixed`：今日计划照旧，**每答 `MIXED_GRAMMAR_EVERY`(5) 个单词插一条语法**。

- **没有第二套语法逻辑。** 插播出的是 `getGrammarQuizSession` / `submitGrammarQuizAnswer`
  ——语法考题页那同一副牌（同一份 `grammar_progress`、同一个当日计划和新条目配额、
  同一套 FSRS 和重刷队列）。在哪边答的都算数，两处进度天然是一份账。
- **卡片也只有一份**：`features/grammar-quiz/GrammarCard`，考题页和混合模式共用
  （连键位一起）。**差别只有颜色**：考题页走全应用的青绿，混合模式走琥珀
  （`QUIZ_ACCENT_AMBER`，和接续标注的橙同一系）。配色靠 CSS 变量传 ——
  Tailwind 的 hex 是静态字符串，塞不进变量，所以 hover 那一档在 `styles.css`
  的 `.quiz-accent-btn` 里。
- ⚠️ **语法卡是「盖在」单词卡上面的**，不改单词那边的任何状态：下一张单词卡照常排好摆在
  底下，答完清掉就接着背词。所以插播不需要碰 stage1 的取词、减负、压轴、当日回顾。
  代价是 WordStudy 的全局键盘监听得让开（`grammarCard` 在时直接 return，
  键位归 GrammarCard 自己那一套）。
- **等级跟着备考目标走**（`preferences.jlptTarget`），不给第二个等级选择器——
  多一个旋钮就多一处口径，而「我在考哪一级」设置页里已经答过了。
- 语法今天过完了就不插，也不借明天的账（想多学去考题页点加餐）。反过来，**单词今天背完
  之后剩下的语法会接着上**，两边都空了才算今天完成（`loadNext` 里的 `grammarTail`）。
- ⚠️ **首页角标 `modeCounts.mixed` = 词数 + 今天还欠的语法条数**（`stats.grammarRemaining`，
  走 `grammarPlanRemaining`，不抽卡只数数）。第一版只报词数，结果是混合和经典在主页上
  写着同一个数 —— 多出来的那部分工作量在界面里根本不存在。单位因此从「词」换成「项」，
  大卡脚注那一行也从「新词 · 复习」换成「单词 · 语法」（两栏加起来仍等于大卡的合计）。
- ⚠️ **「上一个」必须按作答顺序分派（2026-09-05 修）。** 单词和语法各有一份互相不知道
  对方存在的撤销栈（`last_answer` / `quiz_undo:<等级>`），而学习页的撤销一直只调
  `undoLastWordAnswer`。于是答完一条语法再点「上一个」，撤掉的是**语法之前那个单词**：
  语法留下一次不该留的作答（FSRS 已推进、流水已写），单词丢掉一次该留的 ——
  **一次误操作造两笔假数据**，而按钮还亮着，看着像正常工作。语法卡显示时整页被顶掉、
  工具栏跟着不在，所以那会儿连撤都撤不了。现在 `WordStudy` 记一小段 `undoKinds`
  （只在内存里，长度同 `UNDO_LIMIT`）按栈顶分派，语法卡自带一颗撤销按钮。
  ⚠️ **混合模式下只撤这一次进页面之后答的**：顺序不落库，退出再进来就没了，
  这时按「word」去撤等于把同一个 bug 换个入口复现。判据在 `mixed-undo.test.ts`
  （⚠️ 它跑的是被调用的那两个函数；分派本身在组件里，仓库没有 testing-library，覆盖不到）。
  ⚠️⚠️ **语法卡还摆在屏幕上时，栈顶那一笔一定是单词**（`submitAnswer` 先压栈、再
  `maybeGrammarTurn`）—— 所以点语法卡右上那颗撤销走的是单词分支，撤掉的是语法卡**底下**
  那张单词卡：库里退了、屏幕纹丝不动，看着就是「上一个不能用」（2026-09-06 报）。
  现在单词分支里顺手把插播收回去（`setGrammarCard(null)` + 计数退回
  `MIXED_GRAMMAR_EVERY - 1`）：那次作答不算数了，插播也不该被它提前用掉。
- **松鼠轨道在混合模式里数「单词 + 语法」**（2026-09-06 改，原来只数单词）。
  原因和首页角标那条一样：角标、大卡脚注早就按合计在说话，小路只数单词的话，插播那几条
  语法答完顶上纹丝不动，而分母还比大卡小一截 —— 两个数字当面打架。分子分母各自加上
  `stats.grammarDone` / `+ grammarRemaining`（`SquirrelTrail` 的 `mode === "mixed"` 分支）。
  ⚠️ **只有混合模式这么算**：经典模式那条路仍然是 `stage1_tasks` 的物化，语法不掺进去。
  ⚠️ 代价是学习页每答一次多两条语法当日计划的 SQL（`grammarPlanDone` / `grammarPlanRemaining`
  都是惰性字段，但小路每次 `PROGRESS_UPDATED` 都会读到它们）。

## 语法考题：「A／B」两个写法不能互相推出来的，拆成两条（2026-09-18）

用户报的是 `～てしかた（が）ない／てしようがない`：看到前一个就点了认识，后一个其实不会。
一张卡两个写法、一套 FSRS，等于用 A 的熟练度给 B 记账。

**242 条带 `／` 的标题逐条看过，拆了 26 条（→ 54 条，741 → 769 行）**，记录在
`frontend/scripts/grammar-variant-splits.json`（连新条目的正文、例句、抓手一起），
由 `scripts/apply-grammar-variant-splits.mjs` 一次性写进 `grammar.ts` 和抓手表。判据：

| 拆 | 不拆 |
|---|---|
| **换了词**：しかた／しよう、なんか／なんて、もちろん／もとより、いうものの／言い条、や／や否や、いらっしゃる／おいでになる | 活用变体：にあたって／にあたり、ごとき／ごとく／ごとし、というと／といえば |
| **敬语对**：あげる／さしあげる、もらう／いただく、くれる／くださる（含 て 形三对）、どう／いかが、誰／どなた、たち／がた、かな／かしら、だろう／でしょう、なぜ／どうして／なんで | 通则变体：ず／ないで（ずにはおかない／ないではおかない）、しろ／せよ、濁音（くらい／ぐらい、とおり／どおり）、缩约（ておく／とく、てしまう／ちゃう、やしない／はしない） |
| **一张卡两个意思**：かねる／かねない、次第／次第だ、だけあって／だけに／だけのことはある、にたえる／にたえない、うちは／ないうちに | 肯否对（得る／得ない、わけがない／わけはない）、范式（これ／それ／あれ／どれ、お／ご～） |

没拆但想过的：`見える／お見えになる`（拆出来的「見える」单独当题面只会被当成「看得见」，
合着写反而把「来る 的尊敬语」这层意思带出来了）、`極まる／極まりない`（同义，只是形似否定）、
`なくてはならない／なくてはいけない`（ならない／いけない 这对在 146/147 已经各有一条）。

拆的机制全走既有的内容管线，**没有第二套「子卡」**：

- 旧条目改成第一个写法、保留 id 和进度；第二个写法是新条目（id 形如 `pdf-n3-061-2`，
  bookOrder 紧跟原条目，后面全部顺延）。**新条目从零开始** —— 拆的理由正是 B 不该继承 A 的
  FSRS 状态。升版本时旧名 → 新名由 `study-core.ts` 的 `GRAMMAR_PATTERN_RENAMES` 接住，
  不登记的话旧进度会被当成「新版本里已不存在的语法点」删掉（`grammar-seed.test.ts` 钉着）。
- `～とは` / `～なんて` 在 N3（定义 / 轻视）和 N1（吃惊）各一条，N1 那条拿到 `（N1-2）` 后缀，
  重命名表里写的也是带后缀的。**题面上后缀一律摘掉**（`grammarQuizQuestion`）——
  它只是 UNIQUE 约束需要的，露出来先把等级说出去；抓手表按后缀 pattern 各拿各的。
- 新例句没有预生成音频（文件名是句子哈希），运行时退到系统 TTS。
  要补：开 VOICEVOX 跑 `node scripts/build-example-audio.mjs`，只补缺的。

### ⚠️ 顺手查出：重建出来的 grammar_id 从来没和新装用户对上过

`ensureGrammarSeed` 是 `DELETE FROM grammar_points` 再 INSERT，而 AUTOINCREMENT 在
DELETE 之后接着上次的最大值往下编 —— 实测作者自己的库重建九次后 id 落在 **6600~7340**，
新装用户是 1~741。`grammar_progress` 正是按数字 grammar_id 跨设备同步的，
「words / grammar_points 这类出厂内容两端一致」那条前提一直是假的。
现在重建前 `DELETE FROM sqlite_sequence WHERE name = 'grammar_points'`，
出厂库那边 `build-furigana.mjs` 改成按 grammar.ts 整表重建、显式 `id = bookOrder`，
`verify-release-db.mjs` 钉住 `id == sort_order == 1..N`。
**增删语法条目只改 grammar.ts，别手工往库里 INSERT** —— 两边各自按同一个顺序编号才对得上。
重建时顺手清掉 `quiz_undo:*` 和 `review_queue_grammar`：里面存的是旧 id，按旧 id 撤销会
删掉一条已经迁走的流水，计数却退不回去。

### ⚠️⚠️ 用户 dev server 开着的时候，工作区里的任何「回退」都是一次降级重建（2026-09-18 踩到）

这次拆分落地时我在用户正学着的 5173 dev server 底下跑了一次 `git stash` / `git stash pop`
（只是为了确认 lint 警告是不是原有的）。stash 那十几秒里工作区退回 HEAD：
`grammar_seed.json` 是 741 行的旧版、`study-core.ts` 没有重命名表 —— 页面热重载，
`ensureGrammarSeed` 看见「库版本 ≠ 常量」就按**旧种子**重建了一遍：新标题在旧种子里找不到，
**用户当天在 3 条拆分语法上的作答（流水 1289–1291）连同 progress 一起被删掉了**；
pop 回来再重建一次，已经没有东西可迁。`grammar_points_archive` 里那一代
`2026-09-18` 标签的 769 行就是这次降级留下的痕迹。

判据：**只要用户的 dev server 在跑，就不许 `git stash` / `git checkout -- <src>` /
改 `grammar_seed.json`、`study-core.ts` 这类会触发内容迁移的文件**。要验证「这些警告是不是
原有的」，用 `git worktree` 另开一份，或者 `git show HEAD:<file>` 比对。
迁移本身没有回滚路径 —— 删掉的行只有云端上一代快照里还有（如果开了云同步）。

## ⚠️ 语法种子升版本会走一条从没跑过的代码路径（2026-08-23 踩到）

`ensureGrammarSeed` 只在 `grammar_state.dataset_version != GRAMMAR_SEED_VERSION` 时才跑。
从写下来到 2026-08-23 版本一次都没升过，于是里面那条 INSERT **14 个列名配 13 个占位符**
一直没被发现。真升一次版本的结果是：每个已安装用户启动时崩在 `initDatabase`，
界面显示「本地词库读取失败」—— 一次内容更新把所有人的 App 变砖。已修，
回归测试在 `grammar-seed.test.ts`（强行写入一个假版本号，跑完整条重建路径）。

### ⚠️ seed 和出厂库曾经用两套重名消歧写法（2026-09-08 修）

**`grammar_seed.json` 一度只有 731 行，而出厂库 `public/nihongo.db` 是 741 行。**
根因不是「少了 10 条」，是**两边各用一套 pattern 重名消歧**（`pattern` 有 UNIQUE 约束，
而 grammar.ts 里有 14 组同名语法点分布在不同等级）：

| | 重名的第二条写成 |
|---|---|
| 出厂库（`syncGrammarDbContent`） | `やる（N4-2）`、`～をよそに（N1-2）` |
| 旧 seed | `やる（N5・做（比「する」语气更随便））` |

`ensureGrammarSeed` 是**按 pattern 字符串**把用户进度迁到新 id 的，两套写法谁也对不上谁。
真升一次版本的后果：**16 个语法点从老用户库里消失**，它们上面的
`grammar_progress` / `grammar_reviews` / `grammar_mistakes` 被末尾那句
`DELETE ... WHERE grammar_id >= OFFSET` 一并删掉（archive 只存 grammar_points 内容，
不存进度，删了回不来）；而且出厂库自己的 `dataset_version` 已经是新值，
**新装用户走 early return 保留 741 条、老用户重建成 731 条，两边 grammar_id 从此错位** ——
`sync/tables.ts` 里 `grammar_progress` 正是按数字 `grammar_id` 同步的，
那行「words / grammar_points 这类出厂内容两端一致」的注释就是这个前提。

现在 seed 改成**和出厂库逐行同构**（741 行、bookOrder 顺序、同一套 `（N4-2）` 后缀，
生成代码在 `build-furigana.mjs` 写 `grammarRows` 那一段），升版本对老用户是无损重建。
闸门在 `verify-release-db.mjs`：**逐行比对 seed 和 grammar_points 的 13 个字段**，
差一行就拒绝构建。

⚠️ **自愈判据后面还有一道闸，别让它把修复挡回去**（2026-09-10 修）。
第一层是「版本戳相等**且** `COUNT(*) == GRAMMAR_SEED_ROW_COUNT`」才早退；
但下一层还有一条 `if (grammarSeed.version === grammarVersion) return`，
它本意是提示「常量落后于 JSON」。**不带「常量确实落后」这个前提的话**，
三个版本号相等、只有条数少了的库会在这里原地 return，还打一句误导的
「GRAMMAR_SEED_VERSION 常量落后」—— 自愈那一层等于白写。
现在的条件是 `JSON 版本 == 库版本 && 库版本 != 常量`。判据在 `grammar-seed.test.ts`。

### ⚠️ 发布校验比对的是 12 个字段,不是 7 个（2026-09-10 补）

`verify-release-db.mjs` 原来只逐行比 pattern / meaning / 首条例句 /
等级 / 排序 / 分词。**语法的文字层(用法说明 `notes`、中文译文 `example_meaning`、
接续 `formation`、辨析 `confusions`)一个都没在比** —— 而那正是 2026-09 为了版权
逐条重写的东西:出厂库和 grammar.ts 在这几列上悄悄分家,谁都不会知道,
因为界面读的是库,而重写记录对的是 grammar.ts。

⚠️ **出厂库和 iOS 那份必须用同一条 SELECT**（`GRAMMAR_TEXT_SQL`）。
两处各写一份列清单的话,加一列就会让「两份库正文不一致」永远成立(列数都对不上)。

（2026-08-23 改 `～うちは／ないうちに` 的释义时就撞上这条：最后**没有升版本**，
改成直接把新释义写进 `public/nihongo.db` 和 `ios/App/App/public/nihongo.db`
——`verify-release-db.mjs` 会逐条比对出厂库和 grammar.ts，两边一致才让构建过。
动过 `public/nihongo.db` 之后要跑 `npm run build:kanji-unit-index`，
那个索引里存着库文件的 sha256。）

## 错题本的阈值必须踩用户自己那条分布的尾巴（2026-08-23 重调）

用户报告「背完一天回首页看到错题 1200 道」。判据本身的形状没问题，**是三个阈值都拍在了
分布的正中间**，于是「错题本」= 学过的词的一半。实测 1,262 个，改完 261 个。

| 信号 | 旧 | 新 | 为什么 |
|---|---|---|---|
| 加权错误率 | ≥ 0.5 | **≥ 0.65** | 判据把「忘记」按 2 倍权重算，而用户忘记率本来就有 25% —— 实测 1,563 个学过的词里加权错误率**中位数正好 0.50**（p25=0.42 / p75=0.55 / p90=0.61）。0.5 选的是「较差的一半」，0.65 才在 p90 以外 |
| 记忆强度上限 | < 60 天 | **< 21 天** | 每三周复习一次的词（stability≈21）是健康的成熟卡，不是错题 |
| FSRS 难度 ≥ 8.5 | 有 | **整条删掉** | 见下 |

⚠️ **别再拿 `fsrs_difficulty` 当判据。** 它是 Again +2 / Hard +1 / Good 0 / Easy −1 的累加量，
均值回归项极弱 —— 只要历史上反复忘过就永久顶在满档，再也下不来。实测用户库 1,927 个
学过的词里 **1,160 个难度落在 9 档、1,023 个顶到 9.5 以上**，光这一条就放出 1,225 个「错题」
（其中 380 个只中这一条）。它正是 `filters.ts` 那段注释自己说要避开的
「只增不减的终身计数器」，只是换了个名字。

留下的两条都是**比例**判据（遗忘占复习的比例、忘记/模糊的加权占比），会随着答对次数
自动降下来 —— 所以错题本会自己变小，是能清完的一批，不是只涨不跌的账。
`word-api.mistakes.test.ts` 里正反两条都钉着：真薄弱的词要进，**表现普通的词（加权错误率
0.60、难度顶到 10）必须不进**。

## 收藏夹：夹名就是行身份；完成页给当天顽固词一个出口（2026-09-01）

`favorites-api.ts` + `components/FavoriteFolderPicker.tsx` + `word-api/stubborn-today.ts`。

**收藏夹不是新的一层数据，只是 `content_favorites` 上多一列 `folder`。**
`favorite_folders` 那张表只为了让「建好但还没往里放东西」的夹子活得下来。

- ⚠️ **夹子的身份是它的名字，不是自增 id** —— 同步表的行身份绝不许用自增 id
  （见 `sync/tables.ts` 开头），两端各建一个「考前突击」必须是同一个夹子。
  代价是改名要连带 `UPDATE content_favorites SET folder = ?`，一句就做完了。
- **夹子清单 = 建过的夹子 ∪ 收藏行上出现过的夹名。** 后半段不是冗余：对端删了夹子、
  这台还有收藏挂在上面时（`favorite_folders` 走 union 合并，删除靠墓碑），
  光看 favorite_folders 会让那些收藏在「全部」以外的任何视图里凭空消失。
- ⚠️ **删夹子不删收藏**，里面的东西回到未分类。测试里钉着这条。
- ⚠️ **一个夹子都没建过时不弹选择框**，直接进未分类。收藏本来是一下点完的动作，
  给从没用过分类的人加一次弹窗是纯摩擦；夹子是用户自己建出来的，建了才问。
- **「收进哪个夹子」只有一份实现**：`useFavoriteFolderPicker`。学习卡星标、词库详情、
  语法列表、沉浸阅读、收藏页移动、完成页顽固词，六处共用。别再写第二个选择框。
- 选择框是 portal，但**要挂在会 stopPropagation 的那层里面**（词库详情 `wl-sheet`）——
  portal 的事件仍按 React 树冒泡，挂外面点收藏夹会撞上遮罩的 onClose 把详情关掉。
- 新表照例三处登记：`sync/tables.ts`、`scripts/user-data-tables.mjs`（泄漏守卫）、
  `legacy-word-migrations` 的合并搬迁（那句 INSERT 要把 `folder` 一起带走，
  否则合并重复词条会把手动分好的夹子悄悄清成未分类）。
- ⚠️ **浮层开着必须把按键吞掉**（`stopImmediatePropagation`，capture 阶段）。
  学习页的全局快捷键挂在 window 上：翻面前**按任意键**就翻面、翻面后 V/B/N/M 直接评分——
  不吞的话「选个收藏夹」这一下会顺手给 FSRS 灌一次假作答。输入框里的按键要放行，
  否则敲名字 + 回车建不了夹子。（`stopPropagation` 不够：按键的 target 常常就是
  body/window，同一节点上的其它监听器只有 Immediate 版拦得住。）
- 改名用行内输入框，不用 `window.prompt`：那是个没样式的系统框，而且在 WKWebView 里
  未必回得来。删夹子沿用 `window.confirm`（和「合并重复词条」同一套二次确认）。
- 市面上成熟的做法只抄了两条：**默认夹子不可删不可改名**（B 站的「兜底」，我们的
  未分类 = `folder = ''`，删不掉也改不了名，收藏永远有个去处）、**记住上次收进哪个**
  （Pinterest 把最近用过的板置顶）。**故意没抄**多级分组、把最近用过的夹子置顶
  （位置一动肌肉记忆就废了，只加一个「上次」角标）、以及**一条收藏进多个夹子**——
  多对多要另建一张关系表和一套多选 UI，而一个词该在哪一组的答案通常只有一个。
  真要多标签再说。

### ⚠️ 语法收藏从来就没在收藏页显示过（2026-09-01 查明并修复）

收藏夹的计数把它照出来了：角标写着 3、列表只有 2 条。

语法收藏存的是 `grammar.ts` 的**字符串 id**（`pdf-n5-001`，两处写入都是 `point.id`），
而 `getFavoriteItems` 解析语法用的是 `SELECT ... FROM grammar_points WHERE pattern = ?`
—— 出厂库里根本没有那个字符串 id 这一列，于是每条语法收藏都在 `flatMap` 里被静默丢掉。

id 是全应用的语法身份（详情页、furigana 表、进度都按它走），**不改存的东西**：
查不到的行原样交出去（标题留空），由收藏页按需 `import("../data/grammar")` 补标题、
释义、等级。那份 1.2MB 的语法数据只在真有语法收藏时才拉，不进主包。

### 完成页的「今天的顽固词」

判据是**两条都要满足**（2026-09-01 收紧，原来是 OR）：累计点过 > 8 次「忘记」
**且**今天答错 ≥ `STUBBORN_DAILY_MISTAKES`(3) 次。

⚠️ **单看累计不行**：忘过 20 次的词今天一次就答对了，它今天并不顽固 —— 按 OR 算，
这张表就成了「今天露过面的所有顽固词」。**单看当天也不行**：新词头一天磕三次是正常的
学习过程。要的是「历史上就难 + 今天又打了一架」的交集。

⚠️⚠️ **累计数的是 `progress.forgot_count`，不是 `fsrs_lapses`。** 两者听着一样，差一个
数量级：`fsrs_lapses` 只在**复习态**的卡答错时 +1（当天重学阶段再错多少次都不加），
而且顽固词每天最多放 `LEECH_DAILY_INTAKE`(10) 个进计划。第一版写成 lapses，实测用户库
2026-08-26~09-01 每天只有 **0,1,1,2,1,0,1** 个 —— 那张表几乎永远是空的，用户当天就报
「快速复习当天顽固没出来」。换成 forgot_count 后同期是 **6,9,11,14,23,16,15**（均 13 个）。

- **单词那张表只数 `direction='forward'`**：和主页「每日学习量」同一把尺子
  （见「只数正向」那条）。
- **语法另算一段，判据一模一样**（`getStubbornGrammarToday`，2026-09-06 加）：
  `grammar_progress.forgot_count > 8` 且今天 `grammar_reviews` 里错 ≥ 3 次。
  混合模式里语法和单词是同一场，完成页只列单词等于说了一半。没答过语法的日子这段自己
  就是空的，所以不用按模式加闸。实测用户库 2026-09-06（当天答了 290 条语法）出 8 行，
  和单词那张表一个量级 —— 阈值不用为语法另调。
  ⚠️ **语法行没有收藏按钮**：语法收藏存的是 grammar.ts 的字符串 id，而这里只有
  `grammar_points` 的数字 id，桥接得按 pattern 去翻那份 1.2MB 的语法数据
  （见「语法有两份进度」）。为一颗星把它拉进完成页不划算，收藏和攻坚都在语法列表页。
  「快速复习」按钮同理只带单词（`QuickStudyPanel` 是词的批次模式）。
- **只在完成页现算一次**：判据要数今天的流水，而这一页是今天最后一次结算，查早了数还没记全。
- 它是**出口不是攻坚入口**：一览 + 一键收藏，没有评分按钮（答案全露着时评分等于给 FSRS
  灌「记住了」，和辨析气泡、词库详情同一个道理）。集中攻坚仍然走错题本模式。

### 往日顽固词：同一条判据换个日期，这一档是 Pro（2026-09-09）

完成页顽固词卡的头部多一颗「往日」，点开是一张按天倒序的清单（日推历史那种翻法），
点某一天看那天跟你打过架的词。`getStubbornHistoryDays()` + 给两个 getter 加了个
`day` 参数 —— **没有第二条判据**：历史用的就是今天那张表的同一段 SQL，只是换了日期。

- ⚠️ **判据里的「累计忘过几次」是 `forgot_count` 的当前值，不是那天的值。**
  所以历史是「以今天的眼光回看那天」：一个词上个月只忘过 3 次、这个月忘到 12 次，
  它会补进上个月那天的名单里。要按当天的累计算，就得对每个 (天, 词) 数一遍截止那天的
  流水；而今天那张表本来就是拿 forgot_count 说话的，**两处口径分家比这点偏差贵**。
- **日期列表不在 SQL 里 LIMIT**：单词和语法各查一次再取并集，先截断会让两边的日子对不上。
  实测用户库 83 天、单词那条查询 30ms 上下，进这张浮层时查一次。
- ⚠️ **今天没有顽固词的日子，那张卡整个不出现** —— 所以那时候要单独摆一行
  「今天没有顽固词 · 翻翻往日」的入口，否则这个付费功能在状态好的日子里凭空消失。
- **没有评分按钮**（答案全露着时评分等于给 FSRS 灌「记住了」，同辨析气泡、词库详情），
  能做的只有一键收藏和「快速复习这 N 个」（走 `QuickStudyPanel` 的 wordIds 批次模式）。
- **Pro 门是 `FeatureId` 的 `stubbornHistory`，`FinishPanel` 自己弹 `Paywall`** ——
  不为一个按钮把 `requirePro` 从 App 一路穿过 WordStudy 传进来。
  ⚠️ **`Paywall` 的 `benefits` 列表要跟着改**：那几行是买之前看到的承诺，
  必须和真正锁着的功能对得上（现在锁着两样：沉浸式语法学习、往日顽固词）。
- 行样式抽到 `features/word-study/stubborn-history.tsx` 的 `StubbornWordRow` /
  `StubbornGrammarRow`，今日卡和历史浮层共用（**新文件导出、WordStudyPanels 引用**，
  反过来会成环）。

### 顽固词太多就不给加餐，改成「快速复习今天的顽固词」

当天顽固词 ≥ `STUBBORN_ENCORE_BLOCK`(30) 时，完成页把「继续学习 N 个」整块换成
「快速复习这 N 个顽固词」（走 `QuickStudyPanel` 的 `wordIds` 批次模式）。

⚠️ **30 是用户定的数，但实测他一天只有 6~23 个**，也就是只有最糟那一两天才触发。
所以顽固词卡片上**常驻**一个「快速复习」按钮，这个阈值只决定「要不要把加餐整个换掉」，
不决定这个功能出不出现。要让它天天触发，把 30 调到 10~15。
加餐是「今天状态不错，再来一批」；而今天有三十个词跟你打了一架的时候，
再塞新词进来只是把明天的账提前记上。

- ⚠️ **在「加餐」这一层，两者必须是同一笔账**（`recordStubbornQuickStudy` → `recordEncore`）。
  长期积压大的人根本见不到加餐按钮 —— 如果只有加餐记账，那就是**越吃力的人越拿不到
  加餐那一层的东西**（本周加餐次数、炫耀图上的加餐徽章、以后任何按加餐算的成就）。
  47 个成就本身都是从 reviews/progress 现算的，快速复习写的是正常流水，天然算数。
- ⚠️ **批次模式不写快速学习的草稿**（`persistDraft` 包了一层）。那份草稿是「今天那轮
  快速学习排到哪了」，拿一次性名单覆盖它，用户回去会发现自己评了一半的那页没了。
  批次过完就结束，不接着把今天剩下的词拉进来。
- 从别处进快速学习（`navigateToPage("quick-study")`）会清掉这批名单，否则点一次顽固复习
  之后，首页那个入口会一直停在那批词上。

### 收藏夹能直接开一场

收藏页选中一个夹子 → 「学这 N 个词」，走的是**自选清单**那条通道
（`focus: "picked"`，不看到期、不进今日计划、上限 300）。不新开通道：
「把一批词单独刷一遍」这件事词库页已经有了一份实现，收藏夹只是换了个选词的地方。

## 压轴卡：按「记得牢」挑，不是按「此刻回忆概率高」挑（2026-09-01 修）

`word-api/daily-tail.ts`。今天的计划全毕业之后再送 3~7 张轻松的收尾。

⚠️ **老判据 `recall >= 0.82` 排序取前 7 张是错的。** recall 是「距上次复习多久 ÷ 稳定性」
的函数，**刚答过的卡 recall 恒等于 1** —— 于是排在最前面的永远是今天刚复习过、
而且因为老记不住所以复习得最勤的那批。实测用户 2026-08-31 的压轴七张里四张是这么进来的：

| 词 | 看过 | 忘过 | 稳定性 |
|---|---|---|---|
| 別れ | 30 次 | 11 次 | **0.57 天** |
| 虫 | 8 次 | 3 次 | 0.83 天 |
| 鍋 | 12 次 | 4 次 | 1.45 天 |
| 袖 | 9 次 | 3 次 | 3.84 天 |

说好的「轻松收尾」，端上来的是他最不熟的词 —— 用户原话是「现在的简单词好像也在推我
不太熟悉的词」。现在按**稳定性**设闸（`fsrs_stability >= 14` 天，和「昨日减负」那批词的
实际水平同一档：实测减负词 14~21 天），达标的候选**随机取**，不再按 recall 排序；
今天已经答过的词也排掉（那不是「再确认一次」，是一小时前刚做过的题）。
实测用户库里达标候选 870~900 个，够选。

⚠️⚠️ **改压轴的挑法必须同时把 `TAIL_STATE_KEY` 升版**（现在是 `daily_tail_v2`，
和 `daily_relief_v2` 同一个套路）。`ensureDailyTail` 见到当天已有状态就直接返回 ——
第一版改完判据没换 key，用户当天怎么刷新都还是老那七张，反馈是「你的更新我这边没变化」。
**按天生成、存在 app_state 里的东西，改判据 = 换 key**，否则改动要等到第二天才看得见。

⚠️ **答错的压轴卡要挪到队尾重来（最多两次）。** 压轴卡走的是正式 FSRS，答错的那一下
已经写进库里了，界面上却让这个词当场消失、直接进完成页 —— 说好再确认一次却没确认。
「上一个」也要能用：撤销时 `rewindDailyTail` 把队列退一格（连答错时排进队尾的那一份
一起撤掉），并留在压轴模式里，否则撤一下就掉出压轴直接看到完成页。

**顺带一条实测结论（不是 bug）**：用户每天的复习池 288 张里 237 张是「看过 10 次以上、
稳定性只有 4.8 天、平均忘过 4 次」的词。这是 FSRS 的必然结果 —— 记牢的词间隔被拉长、
自然很少露面，每天队列里剩下的当然就是最不稳的那批。他学过的 2,088 个词里 34%
稳定性不到 7 天，那才是「天天见的都是不熟的词」的来源。

## 自选清单 = 第六个模式，但藏起来

`word-api/picked.ts`。和错题本一样**只换选词通道**：不进 stage1_tasks、不参与排片、不占今日计划。

- 出题范围**故意不看到期**（考前突击就是要提前刷；FSRS 按实际间隔算，提前复习不是假数据）；
  但今天答过并已排到明天以后的词退出本轮，否则一场里同一个词会被问第二遍——那才是灌假数据。
- `STUDY_MODES` 里 `hidden: true`，不摆进模式列表（那五个仍然是平级的五个），入口只有词库页。
- `transient: true`，`saveStudyMode` 拒绝记账：清单是「这一次想突击这些」，不是长期偏好。
- 一次最多 300 个词（和词库页「全选」上限同一个数）。

## 选词 = 优先级 + 排片，两件事

**「谁更该复习」和「放在序列的这个位置合不合适」是两层，别混在一个打分函数里。**
往 `priorityComponents` 里加项去凑「前 20 张要有几个容易的」，就是在攒互相打架的魔法数字。

- `scheduler/priority.ts` — **谁更该复习**：陌生度（FSRS stability 越低越靠前）、lapses、importance。只看单张卡。
- `scheduler/sequencer.ts` — **排片**：硬约束过滤 + 按优先级加权随机。纯函数，状态显式传入，
  所以能写序列级测试（「任意 12 张窗口内同混淆组 ≤ 1 个」这种）。
- `scheduler/interference.ts` — 混淆组邻接表，三份来源合并：自他动词对（`verb_pair_hints`，368 对）、
  释义相近组（`similar_meaning_groups`，38 组）、音形相近（`confusion.ts` 口径，全库 47726 对 / 覆盖 73%）。
  音近**只在当天候选集内**两两算，按天缓存；绝不能每张卡扫全库。

### ⚠️ 优先级按「有多陌生」排，不按「欠了多久」（2026-09-17 改）

2026-08-04 删自研分数时，「有多该复习」被顺手翻译成「due 过期了几天 × 6」（Anki 默认的
due date 顺序）。它成立的前提是每天清完队列；清不完的话陈年尾巴永远排最前，
昨天刚学的词永远垫底。实测用户库（最近 10 天）：**昨天首见的词 100% 落在当天最后 1/4**
（平均相对位置 0.81–0.96），末段答错率 40% vs 前三段 30%，末段 74% 是重刷。
当天最后剩下没答的 3 张全是昨天的新词、stability 0.01–0.3 天。

用户原话：「欠得久的都是老朋友怎么都有印象，真正陌生的是这几天新学的」。
过期 14 天的卡再拖 8 小时不会更忘（早忘了），stability 0.3 天的会 —— FSRS 作者对积压
场景的建议也是同一个方向（先复习还救得回来的）。现在 `score = 50 × (1 − log₂(1+stability) / log₂31)`：
0.3 天 ≈ 48、3 天 ≈ 36、30 天+ = 0。**欠了多久不再进优先级**（`age` 那项还托着
「太久没见」的底）。**随机抖动从 8 抬到 60**（`JITTER`）：用户要的是「整体偏陌生的先出，
但局部乱序」，8 分抖动对着 0–50 的陌生度等于按分死排。60 分下差 21 分（昨天新学 vs
14 天没见的老朋友）仍有约 76% 排前面，差 6 分的两张接近对半。`priority.test.ts` 钉着「昨天新学 + 昨天见过」必须压过「14 天没见的老朋友」。

⚠️ **顺手查出一条从没生效过的约束**：`pickStage1Next` 的 SELECT 原来不带
`fsrs_stability / difficulty / last_review`，`recallFromRow` 拿不到 stability 就返回 undefined，
于是正向这条路上**每张卡的 recall 都是 0.7 占位值** —— 排片器的「开场减压（recall ≥ 0.35）」
和「连败保护（避开最难的一半）」在经典模式里一次都没真正筛过东西。反向 / 汉字那条
（`direction-plan.ts`）一直是带的。列已补上；别再从 stage1 的 SELECT 里删 fsrs 列。

排片的四条规则（都是「能满足就满足，满足不了就跳过」，永远选得出一张）：

| 规则 | 做法 |
|---|---|
| 干扰隔离 | 同混淆组的词 12 张内不挨着出 |
| 开场减压 | 前 6 张不给顽固词、不给预测最难的 |
| 连败保护 | 连着错 2 个**不同**的词 → 避开预测最难的一半 |
| 加权随机 | 优先级前 6 名按 0.5^名次 抽，取代 argmax（不然最过期的那批连着糊脸） |

**新词保底每 8 张一个**（`NEW_WORD_MIN_SHARE`）。只按「剩余新词 / 剩余总量」穿插的话，
复习积压会把新词饿死：实测用户当天复习任务 232～688 条、新词配额 15，比例只有 3%，
于是一天答四五百张也只碰得到三个新词，配额那 15 个天天剩十二个没见过。
配额的意思是「今天要学这么多新词」，不是「新词占计划的百分之几」——积压是复习的事，
不该由新词买单。（配额本身 = 设置页「每日学习量」里的第一根滑杆，`dailyGoal`，存在 localStorage。）

**主页备考格底下也有一个入口**（`.zoo-goal`，2026-09-06）：一枚 chip
「每日新的 · 单词 15 · 语法 5」，点开是两行档位 chip（档位说法直接用
`INTENSITY_ANCHORS` / `GRAMMAR_INTENSITY_ANCHORS`，不另抄一份）。

- **摆在备考格底下是因为上面那行「还差 新词 50 · 新语法 6」正是按考期算出来的应学量**，
  而旋钮是它的另一半：计划说要 50，你设的是 15。所以盘子里多一颗
  「按 N3 备考计划：单词 50 · 语法 6」，一键把两个数抬到计划值
  （`Math.max`，只往上不往下）。**计划值低于当前设定时整行不出现** ——
  那说明强度已经够，没必要劝人往下调；考前 21 天的收尾期计划值是 0，条件天然不成立。
- ⚠️ **它不是第二份状态**：存的还是 `studyPreferences`，改完发 `PREFERENCES_EVENT`，
  设置页那两根滑杆同一秒跟着动（主页也监听这个事件，所以反过来也成立）。
  **主页只给档位 chip，不放滑杆**：随手改一下用 chip，精调去设置页（盘子最后一行是入口）。
- ⚠️ **改完必须 `refreshTodayWordPlan()`**：新词名额是排计划那一刻定的，
  不重排的话大卡上的数要等到明天才认这个新值。

**设置页的「每日学习量」是独立一节，排在「学习偏好」前面**（2026-09-06 拆出来）。
四个量在一张卡里：单词新词 / 语法新条目 / 汉字读音总题量 / 每日复习上限。
原来它们埋在「学习偏好」里，前面还压着自动播放、动物园音效、显示罗马音三个开关 ——
用户（作者本人）找不到自己在哪调每天背多少词。**别再把新的开关插进这一节**，
它只装「今天给我多少题」这一类的量。

**名额这个数只由用户说了算，三条口径都有测试钉着**（`word-api/new-word-quota.test.ts`）：

| 情况 | 行为 | 为什么 |
|---|---|---|
| 今天复习积压 600 条 | 新词还是 30 个 | 积压是复习的事。名额不因它缩水 |
| 一整天没背 | 明天还是 30 个，**不是 60** | 欠的账只改「先给谁」，不改「给几个」。补作业式的堆积只会让人再也不想打开 |
| 今天只背了 5 个 | 明天那 25 个**优先回来**，补 5 个新的凑满 30 | —— |

第三条 2026-08-23 才修：`newWordOrderSql` 末尾是 `ABS(RANDOM())`，
没背到的词第二天会被重新丢回八千词的随机池，回来的概率和任何一个陌生词一样，
等于「今天没背完」这件事没有任何后果。现在新词名额分三档，档内才轮到随机：
**① 例句词典里点名要的 → ② 排过但没背到的（按第一次排进计划的日期升序，等最久的先回来）→ ③ 全新词**。

顽固词（leech）**不置顶**：`critical` 只给 12 分、`mistake` 封顶 40 分（都远低于陌生度上限 50），
上限装得下全部到期词时每天最多引入 `LEECH_DAILY_INTAKE` 个，集中攻坚交给错题本模式。
失败八次的词是「卡片坏了」不是「复习不够」，加密只会让整场变成受刑。

### ⚠️ 上限装不下时选词是纯随机，不按任何推词逻辑（2026-09-18，用户定的；顽固词闸 09-20 补回）

`fsrsDueWordIds`：**先过顽固词闸**（池子 = 到期非顽固全部 + 随机 `LEECH_DAILY_INTAKE` 个顽固词），
闸后还 > 复习上限 → 在这个池子里 `ORDER BY RANDOM()`，**没有「刚栽跟头优先」、没有 due 顺序**。
装得下时全进，老排序只影响 `order_index`。
⚠️ 09-18 那版是「装不下就随机、闸不生效」，用户 09-20 当场否了（「顽固词有 10 的上限，慢慢来」）：
到期 587 里 243 个顽固词，不先挡的话随机 400 个里四成是它们。**闸永远生效，随机只在闸之后。**
「今天该复习的」这个数也按闸后算（`plannedDueCount` = 非顽固到期 + min(顽固到期, 10)），
圆环的复习建议 / 一键安排用的都是它，不是裸到期数。

理由是模拟出来的（用户真实库前推 180 天，`scratchpad/sim.mjs` 那套）：任何有偏好的选法
都有一批词被结构性饿死——按 due 选，昨天新学的（due 是今天）永远排最后、上限一卡整批掉出计划；
按 stability 选，老朋友 539 个 90 天没见、最长 176 天。随机没有偏好：每个到期词每天被抽中的
概率 = 上限 ÷ 池子，尾巴是随机的。上限 150 + 新词 30、答对率 0.85·R 下，随机的积压反而最小
（3,860 vs due 4,333 / stability 5,973），中位过期天数和 due 顺序一样（17 天）。

⚠️ **顽固词闸（`LEECH_DAILY_INTAKE`）是这个用户积压的全部来源**（2026-09-18 实测）：
此刻到期 220 个学过的词里 **219 个是顽固词**，253 个顽固词 stability 只有 1.3 天、
FSRS 想每天见它们一次，闸每天只放 10 个（加餐那条路没闸，实际 12–34 个），
于是它们永远过期、每次露面 36% 答对率、lapses 继续涨——自我维持。模拟删掉闸：
日均作答 +18%（361 → 426），积压当天清零，顽固词总数不变（两种跑法都 ~770）。
闸本身不减少顽固词，只是把它们藏起来。**用户 09-20 定了：闸留着，永远生效，慢慢来。**

⚠️ **加餐（`startEncore`）那条路还是「due 升序 + lapses 降序」**，没跟着改。

⚠️ **模拟里 150 上限 + 30 新词在任何选法下都超载**（积压 4,000–6,000）。上限不减少工作量，
只是往后推；真正的杠杆是新词随上限收缩（Anki 默认「复习到顶就不出新卡」），
这和上面「名额只由用户说了算」那条冲突，还没动。

例外：顽固词连着错到 `STUBBORN_MISTAKE_STREAK` 时**当场接着刷**，这条走 `pickStage1Next` 里的
早返回，不进排片——排片会把刚答错的词当难词避开，正好把钻研机制废掉。

口径速查：

| 概念 | 判据 |
|---|---|
| 到期 / 薄弱 | `fsrs_due <= studyDayEnd()`，**`fsrs_due IS NULL` 也算到期** |
| 顽固词 | `fsrs_lapses >= 8` |
| 长期低分词 / 错题本 | `filters.ts` 的 `mistakeCandidateSql` / `isLongTermWeak`（两份，改口径要一起改） |
| 已掌握 | 间隔（`fsrs_due − fsrs_last_review`）≥ 180 天 |
| 当天是否再出 | 是否毕业（下次到期越过本学习日边界） |
| 重刷隔几张 | 3~8 张；**长期低分词的毕业判定那次拉到 8~20** |

「毕业判定拉远」的道理：中间步骤隔 3 张再问，答对的是工作记忆，但那没关系——中间答对也不毕业，
FSRS 不会据此拉长间隔。只有「答对就当天出队」那一次会真的改写长期间隔，靠残留答对的话
FSRS 就收到假的「记住了」，把复习排到几天后，然后必然再忘。排不下就尽量靠近，**不留到明天**。

**保留的不是分数**：stage2/汉字的 `temp_score`、`mistake_streak` 是会话内计数器（这一轮过没过、要不要贴脸重复），`sessionScoreDelta` 只服务它们。`progress.score`、`low_history`、`mastered_on`、`reviews.score_after` 是遗留列，**不再读写**。

坑：SQL 模板字符串里注释用 `--` 不能用 `//`；`ensureFsrsColumns` 按 (db, 表名) 记忆化，测试里 DROP/CREATE 同名表要自带 `fsrs_*` 列。


## ShuShuGo 命名与兼容边界（2026-09-10）

项目展示名称统一为 ShuShuGo，本地目标目录为 `~/Documents/shushugo`，GitHub 仓库为 `catofkili/shushugo-app`。旧设计稿与导出图片文件名也使用新名称。

以下旧字符串是已有数据或服务的标识，不能当作展示文案直接替换：

- `master-nihongo-storage`、原生 `masternihongo/` 路径：现有学习数据库及故障恢复文件。
- `master_nihongo_`：系统安全存储中的登录密钥前缀。
- `master-nihongo-user-sqlite-v1`：前端、小程序与 Worker 共同使用的同步格式。
- Cloudflare Worker 域名、D1 数据库名、R2 桶名：实际线上资源，改配置字符串不等于迁移资源。

迁移这些标识必须另行设计旧数据读取与恢复、跨版本同步及线上切换流程。历史审计 JSON 的 source 保留当时实测路径。正在学习时不可移动服务根目录、修改其页面源码触发热更新或刷新学习标签页；改名先在独立工作目录完成。

## 混合学习：四种卡、一份每日量、三个入口（2026-09-20，设计在 docs/MIXED_STUDY_PLAN.md）

单词 / 语法 / **单独汉字**（`lib/kanji-char-cards.ts`）/ **疑难连线**（`lib/confusion-cards.ts`）
四种卡进同一条 FSRS 流水线；后两种共用 `lib/card-log.ts`：**reviews 是唯一事实（append，sync_uid），
memory 是本机检查点（合并后从流水重放重建），tasks 是当天投影（快照只带 14 天）**。
撤销 = 删最后一行流水 + 重放那张卡（`undoLast`），不另存快照。

- 新表照例三处登记（`sync/tables.ts`、`snapshot.ts` 保留天数、`scripts/user-data-tables.mjs`），
  且**必须建在 `local-schema.sql`**：`ensureSyncSchema` 只给启动时已存在的表挂触发器和 sync_uid，懒建的表拿不到。
- 单独汉字卡和 `kanji-unit-scheduler.ts`（按「一个字的一种读音」、在旗子后面）、「汉字读音」方向
  （词里遮汉字）**是三件事**，记忆各存各的，别互相回填。
- 连线卡的组 = `confusion_mastered` 同一个 group_key；能出题的组和原辨析题同一道闸（`matchable`）；
  标了「已掌握」的组不进队列。评分只看连错次数（0 认识 / 1 模糊 / ≥2 忘记），不让用户点四档 ——
  答案全露着时选分等于灌假数据。
- 每日量只有一份状态：`studyPreferences` 的 `dailyGoal / reviewCap / grammarDailyGoal / grammarReviewCap /
  kanjiDailyGoal / kanjiReviewCap / confusionDailyGoal / confusionReviewCap`（三种 cap 的 0 = 到期全出，
  单词那个 0 = 自动、−1 = 不限）。圆环 / 数字表单 / 备考一键都是 `DailyPlanPanel`，主页和设置页同一个组件。
- ⚠️ 圆环的段长 = log(1 + 数量)（`daily-plan.segmentLength`）：**数字是真的，长度是压过的**。
  别改成线性或 √ —— 517 词 / 31 语法按原比例是 90% / 5%，√池子那版单词也还占八成，用户当场报的。
- ⚠️ 备考一键的用时按 `SECONDS_PER_CARD` 固定值算，**不拿用户自己的历史算**（作者边看视频边学，效率不代表标准）。
- ⚠️ **拖圆环每帧只改 React 状态，松手（`onCommit`）才写盘 + 重排**（`refreshTodayWordPlan` 几十条 SQL、
  `refreshMixedCardTasks` 删表重建）。第一版每帧都落盘，用户报「掉帧严重」；改后实测每帧 4.6ms 中位 / 9.5ms 最大。
  放大后的新学/复习滑杆同理（`onPointerUp` / `onKeyUp` / `onBlur` 才 commit）。
- **能从数据算的都别让用户猜、也别写死作者的数**（用户原话「所有东西都要灵活有算法」）：
  - 「现在 N几」= `learnedLevel()`：从 N5 往上，一级里学过的词过半就算过了，第一级不过半停；一个词没学过 → 「从零」。
    作者库 N5 93% / N4 82% / N3 56% / N2 3% → N3；出厂库 → 从零。用户改了选择框就按用户的。
  - 汉字卡和连线卡都按 JLPT 分级：`kanji_char_memory.level_rank`（最容易的那个读音单元的等级）、
    `confusion_progress.level_rank`（**最难那个成员**的等级 —— 成员没学全就分不了）。池子、当天清单、
    备考剩余量都只数目标等级以内的；老库由 `materializeConfusionCards` 回填（默认 4 = N1）。
  - 「一键安排」= 复习 = 今天该复习的（`plannedDueCount`，顽固词闸后），新学 = **平时额度**（`mn-daily-plan-baseline`）：只有数字表单和备考一键
    这种明确写数字的动作才更新基线，拖圆环是临时挪，不算；没定过就是默认档 15 / 5 / 5 / 5。
    ⚠️ 之前那版叫「按今天本来的来」、新学取默认值 —— 用户要的是「我本来的强度」，不是出厂值。
- 会员范围（无广告、一档 Pro）：疑难辨析、一字多音、混合学习；页面级在 `App.tsx` 的 `proPages` 一处拦。
  - ⚠️ **改额度重排今天的清单是「补抽」不是「删光重建」**（`refreshTodayWordPlan` → `createStage1Tasks(day, {topUp})`）：
    只删没答的行，答过的留着，没答的按新额度重抽。重建那条路会把今天答过的**每一个词**（快速学习、
    自选清单、压轴卡、反向题 —— 回填连 direction 都不看）回填成今天的任务：清单凭空多几十条「已完成」，
    压轴卡还和自己的进度条重复计数。圆环每松一次手就重排一次，这条路暴露得比以前多得多。
    回填只留给「任务表整个没了」（换设备 / 恢复备份）那种情况。
  - 减负卡（不写 reviews）和压轴卡（写正式 FSRS，但不进 stage1_tasks）在统计里各自一栏
    （`stage1ReviewDone/Total` = 任务 + 减负 + 压轴），和圆环上「你定的数」天然差这十几张 —— 那不是 bug。

# 账号、Apple 登录与内购

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

## 兑换码：只走 Apple Offer Codes，码永远不进仓库（2026-09-20 定的）

`purchases.ts` 的 `redeemOfferCode()` + Pro 页「恢复购买」下面那一行「兑换码」。
按钮打开的是 **系统兑换页**（`presentCodeRedemptionSheet`），兑完 StoreKit 像正常购买一样
吐一笔交易，走同一条 approved → verified → 云端校验 → grantPro 的路，App 侧没有第二套授权。

起因是作者想在淘宝卖码。查下来 **3.1.1 明文禁止 App 用自建的 license key / 二维码解锁功能**
（国内大 App 里那些自建兑换框能活着是靠体量或没被查到，规则是明的、执行看运气），
而 Apple 自己的 Offer Codes **条款禁售**。作者最后定的是：**不卖，按 Apple 的规定来**。
曾经写过一版「网页兑换 + Worker 自建码表」（3.1.3(b) 多平台权益那条路，合规且能卖），
当天撤掉了 —— 别再写第二遍。

- ⚠️ **别在 App 里加自建的兑换码输入框**，也别在 Worker 里建码表。想赠送就去
  App Store Connect → 商品 → Offer Codes 生成（订阅和一次性商品都支持），下载 CSV 发人。
- ⚠️⚠️ **码只存作者本机，绝不进仓库、不进 Worker、不进任何同步盘目录。**
  App Store Connect 下载的 CSV 放到 `~/Documents/shushugo` **以外**（比如 `~/收集日/兑换码/`），
  一张码就是一份权益，进了 git 历史就等于公开发放。发完把批次在 ASC 里停用。
- 兑换页只在真机有；模拟器 / 网页版按钮会提示「只能在真机上使用」。

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


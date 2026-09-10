# 云同步、安全与付费修复验收（2026-09-09）

## 结论

**当前代码不能按“生产可发布”验收通过。** 已修复的大多数问题在类型检查、单元测试、
隔离路由复现和跨端往返测试中通过，但还存在两条会影响付费权益正确性的代码缺口，
并且生产配置、远端迁移、App Store Connect 通知和真机沙盒均未验收。

本次没有刷新或操作正在学习的网页，没有启动开发网页，没有读取浏览器实时数据库，
没有调用真实同步、支付、账号或部署接口。同步体积测量只读加载
`frontend/.local/live.db` 到独立 Node/sql.js 内存数据库，输出与构建都在 `/tmp`。

## 阻断项

### P1：漏掉续订通知后，定期重查仍发现不了新续订

- `cloudflare-sync/src/index.ts:785` 固定调用
  `GET /inApps/v1/transactions/{transactionId}`。
- `cloudflare-sync/src/index.ts:1560` 和 `cloudflare-sync/src/index.ts:2058` 用账号当前保存的
  旧交易号调用上述接口，分别作为用户访问时的一日重查和 cron 的七日重查。
- Apple 将 Get Transaction Info 定义为查询**单笔交易**；恢复漏通知应使用 Get All
  Subscription Statuses、Get Transaction History，或 Notifications V2 的 Get Notification
  History。当前实现无法从旧交易 T1 找到漏掉通知的新续订 T2。

隔离复现：数据库保存已过期月订阅 T1，并将 `updated_at` 设为陈旧；假定用户已续订为
T2、但通知漏掉。`GET /api/entitlements` 确实向 Apple 重查一次，但请求的仍是 T1，结果
返回 `isPro: false`。因此报告中“通知 + 每日重查 + cron 已闭环”的说法不成立。

验收判据：订阅重查使用订阅状态或交易历史接口，并有一条路由级测试证明
“T1 已过期、T2 有效、T2 通知漏掉”时，访问权益接口或 cron 能恢复到 T2 的有效期限。

Apple 官方资料：

- https://developer.apple.com/documentation/appstoreserverapi/get-transaction-info
- https://developer.apple.com/documentation/appstoreserverapi/get-all-subscription-statuses
- https://developer.apple.com/documentation/appstoreservernotifications/responding-to-app-store-server-notifications

### P1：权益写入失败时仍在 `finally` 中完成交易

`frontend/src/lib/purchases.ts:248-254` 在异步 verified 回调的 `finally` 中无条件执行
`receipt.finish()`。这与同处注释“权益必须先落地”相反：

- `receiptPurchases(receipt)` 返回空数组时，没有发放任何权益也会 finish；
- 云校验和本地 `grantPro` 都没能成功写入时，异常仍会进入 finally 并 finish；
- `receipt.finish()` 返回 Promise，当前没有 `await`；插件的 callback 类型是 `void`，其
  `safeCall` 也不等待异步回调，Promise 拒绝不会被插件的同步 try/catch 接住。

隔离复现使用已安装插件的真实 `VerifiedReceipt` 类：正常收据可做到授权 1、云校验 1、
finish 1；随后模拟本地权益写入抛错，回调抛出异常但 finish 计数仍增加到 2。

验收判据：只有解析出受支持商品且每一项已成功落到云端或本地后才 `await finish()`；
解析为空或落地失败时保留交易、记录可诊断错误，不完成交易。新增回调级测试覆盖
正常、空收据、云端失败后本地成功、本地写入失败和 finish 自身失败。

## 生产发布门槛

这些不是本次隔离测试能代替的事项，完成前仍不能给线上放行结论：

1. `cloudflare-sync/wrangler.jsonc:8-11` 没有 `REQUIRE_AUTH_HARDENING=1`。远端是否另以
   secret 配置没有核验；若未配置，Turnstile 或 Resend 缺项时仍会静默降级。
2. 新迁移 `0009`、`0010`、`0011` 只在新建的内存数据库验证过，没有确认远端 D1 已应用。
3. 没有确认 App Store Connect 的 Server Notifications V2 地址，也没有通过 Request a
   Test Notification 验证真实投递与响应。
4. 没有真机/TestFlight 沙盒验收首次购买、恢复购买、未登录购买、离线后联网、应用重启、
   Ask to Buy/待批准和退款撤销。

## 已通过

| 检查 | 结果 |
|---|---|
| 前端 TypeScript | 通过 |
| 前端完整 Vitest | 85 个文件通过、1 个跳过；610 通过、23 跳过 |
| 付费/权益/同步相关测试连续运行 5 次 | 每次 6 个文件、42 个测试通过 |
| ESLint | 0 error、44 warning |
| 前端生产构建与出厂 DB/汉字索引守卫 | 通过；存在既有大 chunk 警告 |
| Worker TypeScript、权益规则测试、Wrangler dry-run | 通过 |
| 新建数据库顺序应用全部 D1 迁移 | 通过 |
| 同一交易绑定两个账号 | 第一个 200，第二个 409，只有第一个获得权益 |
| 旧过期订阅覆盖永久权益 | 未覆盖，永久权益保留 |
| 沙盒永久购买 | 权益被限制为最多 30 天 |
| Apple 登录 RS256 | 签名通过，进入协议同意检查，说明算法分支已通过 |
| 已安装插件的无 validator 收据 | 正常解析，授权 1、云校验 1、finish 1 |
| 小程序 snapshot/sync/entitlement/runtime smoke 与 source check | 全部通过 |
| 前端快照经小程序合并后再回传 | 2 条 review 和 grammar_progress 均保留，reviews 带 sync_uid |
| `git diff --check` | 通过 |
| 跟踪文件中的私钥/常见 token 形式 | 未发现实际密钥；只命中变量名与 README 说明 |

## 仍需处理但不单独阻断上述代码修复

### 自动化覆盖不足

Worker 的 `npm test` 目前只运行 `entitlement-rules.test.mjs`，没有覆盖交易归属、Apple
登录算法与重放、通知、定期重查、请求体限制、认证限流和 D1 迁移。上述通过项中的大部分
来自 `/tmp` 隔离复现，CI 不会防止它们回归。小程序 CI 也没有执行已经存在的
`entitlement-smoke` 和 `runtime-smoke`。

### 依赖告警

当前 `npm audit`：前端 11 项（1 critical、6 high、3 moderate、1 low），Worker 4 项 high。
命中的主要是 Capacitor CLI、Vitest/PostCSS 和 Wrangler/Miniflare 的开发构建依赖，不能
直接称为已部署 Worker 的 15 个线上漏洞，但会影响本地安装、构建和 CI 的安全边界。
Worker 的 Wrangler 有同主版本修复可用；前端 `tar` 的自动建议涉及 Capacitor 主版本升级，
应单独升级并做 iOS 集成验证，不能直接运行 `npm audit fix --force`。

### 云同步体积和费用

修复后对开发服务镜像做一次只读测量：本地数据库 39.28 MB，未压缩用户快照 13.48 MB，
gzip 后 1.64 MB，单次导出约 246 ms、压缩约 83 ms。相较修复前的一次测量，未压缩体积
下降约 3.6%，gzip 下降约 5.3%；两次源库内容和运行条件不同，不能把耗时差直接当性能
承诺。

当前仍是“每次有变化上传一份完整用户快照”，49,660 条 reviews 占 gzip 后约 1.11 MB，
是主要增长项。流式复制降低了构建时的中间内存，保留窗口减少了部分会话数据，但没有
改成增量传输。现有规模的单次上传并不夸张；长期成本与 20 MB 压缩前上限仍随历史增长，
需要容量告警的实际 UI 验收，并根据用户数、每日上传次数和保留代数观察 R2/D1/Worker
账单后再决定是否做增量协议。

本次的脱敏隔离结果见：

- `docs/audits/2026-09-09/acceptance-reproduction-results.json`
- `docs/audits/2026-09-09/acceptance-snapshot-measurement.json`

# 云同步、安全、付费与代码冗余审计 · 2026-09-09

审计对象：`feat/fsrs-sync-accounts`，HEAD `211ff53` 加当时已有的未提交改动。结论针对当前工作区，不代表已部署 Worker 或 App Store 二进制。本次只新增审计材料，没有修改业务代码、锁文件、既有说明文件，没有刷新学习网页、启动学习端口、操作真实同步或购买。

**结论：架构可以保留，当前优先级是付费正确性、跨端数据完整性和同步容量。大量删代码不是收益最大的事。** 已经具备用户表快照、gzip、R2、版本冲突保护和限流；仍存在可复现的付费错误，以及小程序丢失跨端信息的问题。

范围包括生产入口依赖图，Worker 所有路由与迁移，前端同步导出/合并/调度、认证和购买链路，小程序同步与权益适配，构建、测试、依赖告警和网络调用入口。没有逐条人工重审词典内容、执行真机付款、检查 Cloudflare 账单或做线上渗透测试。公开 Worker 配置接口读取超时，因此生产密钥、Turnstile 当前启用状态、远端迁移和部署版本未确认。

## 1. 优先处理的问题

### 1.1 [P1，已复现] 内购回调不认识已安装插件的收据结构

- 位置：[purchases.ts:79](/Users/lsc/Documents/shushugo/frontend/src/lib/purchases.ts:79)、[purchases.ts:130](/Users/lsc/Documents/shushugo/frontend/src/lib/purchases.ts:130)。
- 应用没有配置 `store.validator`。已安装 `cordova-plugin-purchase` 的默认分支会生成 `VerifiedReceipt`，其中 `id` 是首笔交易 ID，商品在 `sourceReceipt.transactions[].products[]`，默认 `collection` 为空。
- 应用却优先把 `receipt.id` 当商品 ID，并查不存在的顶层 `transactions`。实际商品因此无法匹配白名单。
- 隔离复现使用**插件实际的 VerifiedReceipt 类**和应用实际的 `initializePurchases` 回调：合法结构进入后，授权次数 **0**，云验证次数 **0**，`finish()` 次数 **1**。不是一次真实扣款测试，但已经证明当前代码与插件对象不匹配。
- 修复方向：使用插件的明确类型与真实字段；将校验、权益落地与交易完成的顺序接通；校验失败保留可重试状态。不要仅把某个字段名换掉就视为支付验收。
- 验收：首次购买、恢复购买、离线购买后联网、尚未登录时购买、应用重启、待批准交易，均需要真机沙盒验证。现有 purchases 测试只覆盖到期时间解析，未覆盖这条核心回调。

### 1.2 [P1，已复现] 一笔 Apple 交易可给多个应用账号开通 Pro

- 位置：[Worker:1277](/Users/lsc/Documents/shushugo/cloudflare-sync/src/index.ts:1277)、[Worker:1299](/Users/lsc/Documents/shushugo/cloudflare-sync/src/index.ts:1299)、[权益迁移](/Users/lsc/Documents/shushugo/cloudflare-sync/migrations/0002_entitlements.sql:1)。
- 校验检查 bundle、product、transaction、revocation，但没有检查该交易属于哪个应用账号，没有使用 `appAccountToken`，也没有在授权前原子约束原始交易的归属。
- `purchase_events.transaction_id` 有唯一索引，但它在 `saveEntitlement` **之后**通过 `INSERT OR IGNORE` 写入，挡不住第二个账号获得权益。
- 复现：真实 Worker 代码、真实迁移、内存 SQLite 模拟 D1，Apple 响应被替换成固定的测试交易；A、B 两账号提交同一交易，均返回 **200 / isPro=true**；权益两行，事件只有 A 的一行。
- 修复方向：在写权益之前，以交易归属为中心做原子校验；关联原始交易与用户，明确恢复购买、换号与账号删除后的策略。Apple 提供 [appAccountToken](https://developer.apple.com/documentation/appstoreservernotifications/appaccounttoken) 用于关联交易与开发者服务中的用户；已有交易没有 token 时仍需明确的兼容归属规则。

### 1.3 [P1，已复现] 旧订阅交易会覆盖永久权益

- 位置：[Worker:588](/Users/lsc/Documents/shushugo/cloudflare-sync/src/index.ts:588)、[Worker:1299](/Users/lsc/Documents/shushugo/cloudflare-sync/src/index.ts:1299)。
- 每个账号仅保留一行权益，任意验证通过的交易直接覆盖该行，没有比较永久购买、当前有效订阅和历史过期订阅。
- 复现：先获得永久 Pro，再验证一笔已过期的月度交易，最终响应变成 **isPro=false**。恢复历史订单或响应到达顺序变化即可触发，不需要伪造订单。
- 修复方向：从仍有效且未撤销的交易推导权益。当前永久购买未撤销时，旧的月/年订单不能把它降级；订阅到期时间缺失也不能自动解释成永久。

### 1.4 [P1，代码确认及缓存复现] 缺少完整的续费、退款与撤销闭环

- 位置：[Worker:1252](/Users/lsc/Documents/shushugo/cloudflare-sync/src/index.ts:1252)、[Worker:1776](/Users/lsc/Documents/shushugo/cloudflare-sync/src/index.ts:1776)、[purchases.ts:142](/Users/lsc/Documents/shushugo/frontend/src/lib/purchases.ts:142)。
- `/api/entitlements` 只读取 D1；定时任务只清理过期记录。路由没有 App Store Server Notifications 接收入口，也没有按交易重新计算订阅状态的后台任务。
- 本地云核验失败直接被忽略，没有可靠的待验证交易重试队列。已经登录前买过的交易也不能仅靠登录时读取云端权益补齐。
- 复现：永久权益写入后，模拟 Apple 侧退款，再查询权益，仍返回 Pro，Apple 重查次数为 0。这证明缓存不会自行发现退款，不代表测试了 Apple 的实际通知投递。
- 结果：续费可能未及时延长云权益；退款后可能继续拥有权益，永久购买尤其明显。再次验证被撤销交易的拒绝路径也没有清除旧权益。
- 修复方向：接入经验证的通知，或先建立可靠的服务端重查和客户端补报策略。通知不是“收到了就信”，必须验证来源、签名并处理重复/乱序。参考 [Apple notificationType](https://developer.apple.com/documentation/appstoreservernotifications/notificationtype?changes=_6_7)。

### 1.5 [P1，已复现] Apple 登录算法与 Apple 当前公钥不匹配

- 位置：[Worker:395](/Users/lsc/Documents/shushugo/cloudflare-sync/src/index.ts:395)。
- 代码只接受 `ES256`，按 ECDSA P-256 导入 Apple 公钥。
- 本次直接读取 [Apple 公钥接口](https://appleid.apple.com/auth/keys)，返回的三个 key 均为 `kty=RSA, alg=RS256`。Apple 部分说明页存在容易混淆的 E256 表述，本结论以其实际公钥接口和代码行为为证据，不依赖该表述。
- 隔离构造 RS256 签名身份 token 后，代码在获取公钥之前直接 **401**。同一个函数也用于关联 Apple 和 Apple 删除账号再认证。
- 修复方向：身份 token 使用与可信 Apple JWK 匹配、严格允许的算法；保留 issuer、audience、expiry 校验。App Store Server API 的**开发者签名 JWT** 使用 ES256 是另一件事，不要一起改错。
- 后续安全加固：nonce 当前来自客户端且可省略，不是服务端持有的一次性挑战；修正算法后应同时覆盖重放防护。

### 1.6 [P1，已复现] 小程序接收 v2 不等于双向无损同步

- 位置：[小程序导出表清单](/Users/lsc/Documents/shushugo/wechat-miniprogram/src/runtime/sync-snapshot.js:24)、[小程序合并](/Users/lsc/Documents/shushugo/wechat-miniprogram/src/runtime/sync-snapshot.js:346)、[小程序同步上传](/Users/lsc/Documents/shushugo/wechat-miniprogram/src/runtime/sync-client.js:128)。
- 当前小程序已接受协议 v2，因此旧的“v2 一律拒绝”结论已经不适用。但接收时丢弃 `sync_uid`，仍按 `word_id + created_at + direction` 去重。
- 本次将前端**实际导出器**产生的两条同词、同秒、同方向、不同 `sync_uid` 作答交给小程序实际合并器：2 条只插入 **1 条**。
- 同一输入还包含一条语法进度。小程序再导出的快照**没有 grammar_progress 表**。其清单也没有前端完整的语法流水、收藏、汉字单元等用户表。
- Worker 不进行按表合并，它把每次上传当账号新的完整备份。小程序上传后，新设备从最新云快照无法恢复缺失信息；足够多次产生新代后，旧的完整快照会退出三代保留范围。
- 前端已有本地行不会因为缺表直接删除，但这不能保护全新设备恢复。不要把“老设备尚有副本”当云备份完整。
- 修复方向：事件身份一致；尚不支持的表也必须无损保留并回传，或显式限制此客户端写入共享完整备份。验收必须是前端→小程序→前端真实导出/合并往返，覆盖同秒多次作答与所有用户表。

### 1.7 [P1，代码确认] 自定义词条与学习记录的身份不能跨设备稳定对应

- 位置：[word-list-import.ts:396](/Users/lsc/Documents/shushugo/frontend/src/lib/word-list-import.ts:396)、[同步身份清单](/Users/lsc/Documents/shushugo/frontend/src/lib/sync/tables.ts:24)。
- 导入新词通过 SQLite 自增 ID 分配身份，`words` 不进云快照，进度和便签却仍按 `word_id` 同步。
- 两台设备导入不同的新词可能得到相同 ID；没有该自定义词的新设备也只能收到悬空的学习记录。相同数字不代表相同词条。
- 修复方向：出厂词典继续不传；用户新增词条需要单独的同步身份和内容，并在合并时映射引用。暂不支持时应明确阻止此类数据被承诺为可完整跨端恢复。
- 此项为数据路径确认，本次未调用真实账号或修改真实词条进行复现。

### 1.8 [P2，传输已确认，失配触发路径待验证] 出厂内容迁移标记被当成用户状态同步

- 位置：[DEVICE_LOCAL_STATE_KEYS](/Users/lsc/Documents/shushugo/frontend/src/lib/sync/tables.ts:85)、[元数据迁移早退](/Users/lsc/Documents/shushugo/frontend/src/lib/study-core.ts:677)、[云合并后补种子](/Users/lsc/Documents/shushugo/frontend/src/lib/sync-api.ts:829)。
- 用户快照包含 `jlpt_word_metadata_version`、`furigana_version`、`jlpt_collocation_content_version` 等“这份本地词典已完成迁移”的标记；对应 `words` 内容并不随快照同步。
- 若旧内容数据库合并进新设备写下的“已完成”标记，随后运行迁移的相等判断可能直接跳过，造成版本标记新、实际词典旧。正常启动也会先跑种子迁移，可能先消除这个前提；本次没有复现一条完整用户操作序列，因此只确认这类标记被不必要地同步，失配后果仍需按实际升级/恢复顺序验证。
- 修复方向：逐一识别描述本地内容状态的标记，将其与账号学习状态分开；导出和导入两边都过滤，并为已经错误同步的标记提供一次安全重检。不能粗暴过滤所有名字含 `version` 的键，有些确实参与用户调度。

## 2. 云端到底传了什么，有没有浪费

### 2.1 当前体积实测

数据来源是开发服务镜像 `/Users/lsc/Documents/shushugo/frontend/.local/live.db`，**不是读取 Chrome 当前内存，也不是线上 R2 数据**。源文件修改时间为 2026-09-09 18:58:37（UTC+8）。读取一次后在独立 sql.js 内存副本执行当前导出/压缩器；已有同步表结构，测量不运行启动迁移。不写源文件，不上传快照。

| 项目 | 实测 |
|---|---:|
| 本地完整数据库 | 39,170,048 字节，39.17 MB |
| 仅用户表云快照，未压缩 | 13,979,648 字节，13.98 MB |
| gzip 后实际请求体 | 1,732,724 字节，1.73 MB |
| 压缩前 20 MB 上限占用 | 69.9% |
| 导出耗时，单次 Node 测量 | 558 ms |
| gzip 耗时，单次 Node 测量 | 87 ms |

MB 使用十进制。Node 测量不能作为 iPhone 或浏览器卡顿时长承诺。测量详情见 [snapshot-measurement.json](/Users/lsc/Documents/shushugo/docs/audits/2026-09-09/snapshot-measurement.json)。

快照包含 49,559 条 reviews、11,740 行 progress、最近窗口内 5,162 行 stage1_tasks、4,951 条墓碑、5,082 行 stage2_progress 等。流水范围包含导入的历史记录，因此不能把首尾日期跨度直接拿来推算每天实际作答量。

**不是每次把 39 MB 整库或静态音频传上云。** 当前前端已经排除了出厂词典、语法内容和音频，使用二进制 gzip，stage1_tasks 只放最近 14 天。正常自动上传设置了 30 秒静默窗口与 5 分钟间隔；空闲状态轮询退避到 40 分钟，隐藏页面不跑轮询。手动操作、启动/登录和冲突合并有不同路径，不能把 5 分钟理解成所有上传的硬上限。

### 2.2 [P2] 每次小改动仍上传完整历史，且有可预见的容量边界

位置：[快照复制](/Users/lsc/Documents/shushugo/frontend/src/lib/sync/snapshot.ts:61)、[压缩前上限](/Users/lsc/Documents/shushugo/frontend/src/lib/sync/snapshot.ts:151)、[上传](/Users/lsc/Documents/shushugo/frontend/src/lib/sync-api.ts:703)。

增加一条作答之后，下一次上传仍带全部用户快照；服务端哈希只能省掉相同内容的重复存储，无法退还已上传的数据。reviews 会持续增长，**即使 gzip 后远小于 20 MB，压缩前超过 20 MB 也会停止同步**，目前约还有 6.02 MB 余量。本次没有据此预测具体哪一天达到限制。

最小可行次序：

1. 为已有数据库可读的容量状态提供明确提示，避免用户误以为持续备份成功。
2. 减少快照构建内存：当前先把整张表装进 `values[]` 再逐行 `run()`；可边读取边写入，并复用准备好的 INSERT。需要以真实规模副本重新测量，不预先承诺提速倍数。
3. 检查其他按日会话表的消费者，再为仅用于近期会话的行增加**导出保留窗口**。stage1 已做，不代表 stage2/kanji/critical 等自动享受同样策略。
4. 若继续增长，保留全量快照用于初始化和恢复，日常同步传变更行；必须一起设计远端游标、删除、断线重试、离线设备重返和兼容窗口。本地 `local-delta.ts` 不是已经实现了云端增量协议。

不要为了省几十 KB 随便删墓碑或历史 reviews。墓碑关系到旧设备是否复活已删除记录；历史流水关系到统计与恢复。也不建议只把 20 MB 改成一个大数字后就结束，解压内存限制与新设备恢复仍需保留。

### 2.3 [P2] 修改昵称/简介时重复发送头像

位置：[profile-sync.ts:15](/Users/lsc/Documents/shushugo/frontend/src/lib/profile-sync.ts:15)、[Worker:1025](/Users/lsc/Documents/shushugo/cloudflare-sync/src/index.ts:1025)。

每次保存个人资料都包含整个 base64 头像，Worker 重新写 KV，再把头像放进响应。GET profile 也总是读取并返回它；头像字段允许约 300 万字符。

如果只改了昵称，这是明确不必要的上传、KV 写入和响应体。Worker 已支持省略 avatar 时不写，但那条路径仍会读头像放进响应。先让客户端仅在头像变化时发送，并缩小更新响应；需要时再独立头像对象地址/版本，不必立刻引入复杂图片服务。

### 2.4 账单应该按什么计算

根据本次核对的 [Cloudflare R2 官方价格](https://developers.cloudflare.com/r2/pricing/)，R2 Standard 出站流量免费；免费月额度为 10 GB-month 存储、100 万次 Class A 和 1000 万次 Class B。超出后分别计费，不能把“每次传 1.73 MB”直接乘成出站流量费用。

例如仅用于理解数量级：假设 1000 个账号都使用本次规模的快照，各保留三代，则约 5.20 GB；假设每人每天产生 24 次新上传，30 天是 72 万次对象写入。这个场景中的两项均在上述 R2 免费额度内，**但不是整套应用免费**，也不是读取了你的真实账单。备份峰值、失败重试、其他桶、头像、D1、Worker CPU/请求和邮件要另算。

Worker Paid 账号基础费目前最低每月 5 美元；D1 按读写行数计量，KV 按操作计量。每次 `/api/sync/status` 在此项目中也会写一条 D1 限流计数，不能当“没有上传就没有成本”。参考 [Workers/D1/KV 官方计费](https://developers.cloudflare.com/workers/platform/pricing/)。

云同步接口当前并没有 Pro 条件：免费账号也可同步。因此要独立确定免费用户容量、使用频率和全站预算。现在的每账号限额不能等同于全站账单上限；创建很多账号仍会扩大总用量。

## 3. 其他安全与商业边界

### 3.1 [P2] 请求体大小在部分路径上检查得太晚

位置：[Worker readJson](/Users/lsc/Documents/shushugo/cloudflare-sync/src/index.ts:331)、[Worker 二进制读取](/Users/lsc/Documents/shushugo/cloudflare-sync/src/index.ts:1365)。

二进制上传先检查可选 Content-Length，随后完整 `arrayBuffer()`，最后才再次检查实际长度。未知长度请求仍可能先占内存；普通 JSON 路由没有按路由控制读取上限，头像也是完整解析后才检查。应在流式读取时计数并提前终止，认证/个人资料路由使用较小限制。没有对生产服务发送大请求，本项是代码路径确认。

### 3.2 [P2] 认证限流仍依赖 KV 非原子计数

同步 push/pull/status 有边缘限流和 D1 原子账号配额，是应保留的保护。注册、登录和购买校验等仍使用 KV `get → put`，无法提供跨节点并发下精确的尝试次数上限。改密码等认证后昂贵路径没有同样的路由限流。

另外，Turnstile 两个配置只要缺一个就完全关闭；没有邮件服务时也放过邮箱验证。这可服务开发环境，但部署错误会变成静默降级。生产应有明确的配置校验和告警，不能仅以“存在代码”证明已经启用。

### 3.3 付费缓存与沙盒不能作为生产授权边界

- [entitlements.ts](/Users/lsc/Documents/shushugo/frontend/src/lib/entitlements.ts:34) 信任可修改的 localStorage 中 `isPro`、`source`、`expiresAt`。网页用户能够修改本机权限；离线客户端无法完全防篡改，但联网权益至少应来自可信校验，并设置合理离线有效期。
- 订阅缺少有效到期时间时，本地 `grantPro` 可以得到没有期限的状态。修复收据字段后也必须修这条兜底，不能只让回调开始工作。
- [Worker 查询交易](/Users/lsc/Documents/shushugo/cloudflare-sync/src/index.ts:661) 允许 Production 404 后回退 Sandbox；[授权逻辑](/Users/lsc/Documents/shushugo/cloudflare-sync/src/index.ts:1277) 没有环境隔离。复现中的 Sandbox 永久交易进入正常账号权益表，并由普通权益接口返回。TestFlight/审核需要沙盒，但不应把测试交易无条件变成可跨正式账号使用的无限期生产权益。
- 当前实际付费入口仍只有沉浸式语法，其他 FeatureId 没有实际访问拦截。现有 Pro 页面已对此作了说明，本次没有重复把旧版宣传不一致当成新发现。

### 3.4 已具备的保护，以及没有证明的部分

已看到：随机 Bearer token、数据库只存 token 哈希、密码加盐哈希、iOS Keychain 保存 token、按认证 user_id 查询备份、SQL 参数绑定、版本条件更新、对象写失败清理、gzip 解压大小限制、三代备份、账号删除路径。CORS `*` 不会凭空产生合法 Bearer token，不能仅凭这一项断言任意网站可读取任意账号。

Web token 经 Preferences 落入浏览器存储，比 iOS Keychain 更依赖同源脚本安全。运行时代码搜索未发现 `dangerouslySetInnerHTML`、`eval` 或明文前端私钥调用路径，但这不等于做完 XSS/供应链安全认证。快照是压缩数据，代码没有客户端端到端加密；应按服务端能接触学习数据和便签来理解隐私边界。

账号删除目前没有 Apple 授权撤销调用，也没有验证并发上传期间的删除完整性；需另做隔离账号生命周期测试。本次不把没有做过的线上删除验收说成已通过。隐私组件说明仍写 Workers/D1/KV，缺少当前使用的 R2；若正式提供微信登录，也应按实际数据路径补齐说明。

## 4. 哪些代码不必要，哪些不能贸然删

生产入口静态导入图没有发现大片失联模块。唯一未从主入口到达的 `kanji-reading-units.ts` 是被测试使用的构建内容契约，不能仅凭“页面不 import”删除。运行时主要依赖都有调用；`cordova-plugin-purchase` 经原生注入 `window.CdvPurchase` 使用，Capacitor iOS 依赖也不能靠普通 import 搜索判断多余。

按预计收益排序的精简方向：

1. **shrink：头像重复传输与写入。** 只传变化字段，缩小更新响应。具体代码证据见 2.3。
2. **shrink：用户快照导出中间数组和逐行重复 SQL 准备。** 流式复制、复用 statement；保持回滚与 free。具体证据见 2.2。
3. **delete/隔离：遗留 FastAPI 生产实现。** `backend/server.py`（历史文件，当前工作区已删除，见 Git 历史）295 行，项目已明确为 legacy，生产 CI 和前端走 Worker。若确实不再用于本地实验，可删除其实现及仅供它使用的依赖文件；保留说明其历史定位的文档和 Git 历史。它目前不会增加云端运行账单。
4. **delete：失效的旧原型入口。** `frontend/shushugo-prototype.html`（历史文件，当前工作区已删除，见 Git 历史）13 行仍引用旧资源路径，当前 Vite 默认入口不使用它。归档价值由用户决定；没有证据表明它影响生产包。
5. **delete/重做：旧 score 测试按钮。** `frontend/src/lib/test-utils.ts`（历史文件，当前工作区已删除，见 Git 历史）仍用 score=9“完成任务”，与 FSRS 语义不符，也直接制造模拟流水。这些入口在 [DevTools](/Users/lsc/Documents/shushugo/frontend/src/components/DevTools.tsx:12) 受 DEV 条件保护，不是线上付费后门；但用户实际就在 DEV 网页学习，不适合继续把它当可信诊断工具。可删过时模拟功能，保留仍需要的开发解锁，并明确只在隔离数据上使用。
6. **shrink：空的免费功能数组及尚无调用的权益类型。** [entitlements.ts:79](/Users/lsc/Documents/shushugo/frontend/src/lib/entitlements.ts:79) 每次创建空数组再 `includes`，当前结果始终等于 `isPro`。这是小清理，不能优先于支付错误。

可明确量出的遗留实现候选为 295 + 13 = **308 行**，此外旧测试功能可以进一步缩小。已确认可直接移除的主应用运行时依赖为 **0 个**。本次没有执行删除，也没有为了凑数字把文档、测试、数据内容或原生插件算成垃圾代码。

构建确有大块：入口 JS 约 1.575 MB（gzip 0.491 MB），词库 seed JS 约 11.236 MB（gzip 1.620 MB），grammar 约 1.177 MB。seed 已经动态加载，不能把构建目录总量当成每次同步或每次进入页面必然下载量；也不能删掉仍服务老库迁移的 seed 数据。后续需分别测新安装、版本升级与老用户稳定启动，才决定进一步拆分或延迟加载。

## 5. 验证结果与证据边界

| 验证 | 结果 |
|---|---|
| 前端 TypeScript | 通过 |
| Worker TypeScript | 通过 |
| 前端完整 Vitest | 606 通过、23 跳过、1 失败 |
| 失败项单独重跑 | word-api.sequencer 4/4 通过；完整运行曾出现混淆词 1236/3468 落入禁止窗口，按随机性/稳定性问题保留，不能改称全套通过 |
| ESLint | 0 error，44 warning |
| 出厂 DB 与汉字索引守卫 | 通过 |
| 前端生产构建 | 通过，输出仅写 `/tmp`，存在大块提示 |
| 小程序 sync-snapshot / sync / entitlement smoke + source check | 通过；新增往返探针仍揭示数据丢失，说明现有 smoke 覆盖不足 |
| 当前 npm audit，前端 | 11 个依赖包告警：1 critical、6 high、3 moderate、1 low |
| 当前 npm audit，Worker | 4 个 high 包告警 |

上述 npm 命中的节点按锁文件全部为开发/构建依赖，包括前端 Capacitor CLI→tar、Vitest，以及 Worker 的 Wrangler→Miniflare→sharp/undici。它们会影响安装、构建或本地开发的安全边界，不能直接换算成线上 Worker 的漏洞数量。未运行 `npm audit fix --force`，避免跨大版本升级破坏 Capacitor/iOS。后续应按依赖链更新，在独立环境验证构建与原生集成。

汇总证据：

- [Worker/购买回调隔离复现结果](/Users/lsc/Documents/shushugo/docs/audits/2026-09-09/reproduction-results.json)
- [前端→小程序实际导出/合并结果](/Users/lsc/Documents/shushugo/docs/audits/2026-09-09/cross-client-results.json)
- [同步体积与行数](/Users/lsc/Documents/shushugo/docs/audits/2026-09-09/snapshot-measurement.json)
- [主入口依赖图候选](/Users/lsc/Documents/shushugo/docs/audits/2026-09-09/import-graph.json)
- [前端依赖告警，含原公告地址](/Users/lsc/Documents/shushugo/docs/audits/2026-09-09/frontend-dependency-audit.json)
- [Worker 依赖告警，含原公告地址](/Users/lsc/Documents/shushugo/docs/audits/2026-09-09/worker-dependency-audit.json)

这些证据不含真实 token、密码或个人学习记录正文。隔离复现脚本与构建暂存在 `/tmp/shushugo-audit-20260909`；其中 Apple 响应和 D1 运行环境是模拟边界，业务路由、SQL 迁移和购买回调来自当前源代码。没有实际发起扣款、退款、账号创建或生产数据写入。

建议修复顺序：先修 1.1–1.6 的支付/登录与跨端问题，再处理自定义词身份和内容迁移状态，之后做容量、重复传输与请求边界，最后清理遗留实现。

## 6. 修复状态（2026-09-09 同日）

上述条目已按建议顺序全部实施，判据写进 `CLAUDE.md`（内购、Apple 登录、小程序无损透传、
自定义词条身份、内容迁移标记、快照容量、请求体与限速六节）。

| 条目 | 落点 | 备注 |
|---|---|---|
| 1.1 内购回调收据结构 | `frontend/src/lib/purchases.ts` | 两种收据形态都读；2026-09-11 再修正为只有受支持商品全部完成权益持久化后才 `await finish()`，空收据或写入失败保持未完成。测试覆盖顺序和失败边界 |
| 1.2 一笔交易多个账号 | 迁移 `0009` + `applyAppleTransaction` | 写权益前用 `apple_transaction_owners` 主键原子认领，非本人 409；回填已有权益的归属 |
| 1.3 旧订阅覆盖永久权益 | `cloudflare-sync/src/entitlement-rules.ts` | 只有更强才准覆盖；同一笔原始交易可改写自己那一行。测试 `scripts/entitlement-rules.test.mjs` |
| 1.4 续费/退款/撤销闭环 | `/api/purchases/apple-notifications` + 权益接口每日重查 + 定时任务批量重查 | 通知只当提示，一律回查 Apple；2026-09-11 将订阅重查由旧单笔交易改为当前订阅状态接口，可由 T1 找到漏通知的 T2；撤销时清除对应权益；`purchase_events` 唯一索引改成 (交易, 用户, 状态)（迁移 `0011`） |
| 1.5 Apple 登录算法 | `verifyAppleIdentityToken` | 按 JWK 的 `kty` 选算法（RS256/ES256 白名单）；identity token 一次性（KV 记哈希）防重放 |
| 1.6 小程序双向无损 | `wechat-miniprogram/src/{core/study-core,runtime/sync-snapshot}.js` | reviews 补 `sync_uid` 并按它去重、导出协议抬到 v2；未知表走 `sync_passthrough` 原样回传。往返判据进 `sync-snapshot-smoke.mjs` 与 CI |
| 1.7 自定义词条身份 | `custom_words` 表 + `customWordId` + `materializeCustomWords` | id 由内容算，内容随快照同步，合并后补出 words/progress 行 |
| 1.8 内容迁移标记 | `sync/tables.ts` 的 `isDeviceLocalStateKey` | 导出与导入两侧共用一份过滤；`repairSyncedContentMarkers()` 对已污染的值做一次性重检 |
| 2.2 容量与快照构建 | `sync/snapshot.ts` + 设置页 | 容量水位常驻显示、≥85% 告警；导出改流式 + 复用 statement；保留窗口扩到四张按日会话表 |
| 2.3 头像重复传输 | `profile-sync.ts` + Worker `updateProfile` | 按指纹只在变化时发送；响应不再回带未改动的头像 |
| 3.1 请求体上限 | `readBodyBytes` | 边读边数、提前终止；按路由分档（认证 64 KB / 资料 4 MB / 同步原上限） |
| 3.2 限速与配置降级 | 迁移 `0010` + `assertAuthHardening` | 认证限速改 D1 原子 UPSERT；改密码补按账号限速；`REQUIRE_AUTH_HARDENING=1` 时配置不全直接 503 |
| 3.3 付费边界 | `entitlements.ts` + Worker | 订阅缺到期时间给 3 天离线宽限而非永久；`storekit` 本地授权 30 天离线上限；沙盒权益夹到 30 天 |
| 3.4 隐私说明 | `privacy-policy-content.ts` | 补 R2 与「快照未做端到端加密」；版本 2026-08-03 → 2026-09-09 |
| 4.3/4.4/4.5/4.6 冗余 | 删除 `backend/server.py`、`backend/requirements.txt`、`frontend/shushugo-prototype.html`、`frontend/src/lib/test-utils.ts` 及 DevTools 里的四个模拟按钮；`canUseFeature` 去掉空数组 | `backend/LEGACY.md` 保留并说明实现已删 |

### 2026-09-11 付费复查补记

第二轮验收后来发现两处残留错误：订阅定期重查仍拿旧交易号调用单笔交易接口，无法发现漏通知的续费；前端又在 `finally` 中无条件完成收据，使权益持久化失败的交易失去插件重试机会。两项现已按上表修正，并补入 Worker 订阅状态选择、Worker 实际路由入口与前端收据完成顺序测试。

订阅状态请求使用 Apple 的 Get All Subscription Statuses，由任意旧交易号取得各订阅组的最新交易；状态 1 视为有效，状态 4 使用宽限期截止时间，其余状态撤销对应权益。API 域名使用 Apple 自 2026-05-05 起推荐的 `api.storekit.apple.com` 与沙盒对应域名。`worker-purchase-route.test.mjs` 会让 Wrangler 打包真实 Worker，再以模拟 D1/Apple 响应调用实际权益 GET 与 cron；它还锁住了 cron SQL 必须选出 `user_id` 的回归。真实 Apple 响应、通知投递、远端 D1 和真机购买仍按第 7 节验收，不能改称已经生产通过。

## 7. 上线前门槛清单（2026-09-09 第二轮）

前四条是**只有你能做**的（要 Cloudflare / Apple 凭据和真机），但前两条现在**可以一条命令验证**：

```bash
curl -s https://<worker>/api/health | jq
```

| 门槛 | 怎么确认 / 现状 |
|---|---|
| `REQUIRE_AUTH_HARDENING=1` 是否在远端生效 | `/api/health` 的 `authHardening`。⚠️ 仓库里**故意没有**打开：Turnstile 或 Resend 没配好时它会让注册/登录/找回密码直接 503。先看 `turnstileConfigured` 和 `emailConfigured` 都为 true，再 `wrangler secret` / vars 打开它 |
| 远端 D1 是否已应用 `0009–0012` | `/api/health` 的 `migrations`。全 true 才算。应用命令：`npm run d1:migrate:remote` |
| App Store Connect 通知地址 + 真实测试通知 | 地址填 `POST https://<worker>/api/purchases/apple-notifications`；在 App Store Connect 点 "Request a Test Notification"，然后查 D1：`SELECT * FROM apple_notifications ORDER BY received_at DESC LIMIT 5`。**测试通知会记成 `outcome='ignored'` 并带上 `notification_type='TEST'`** —— 有这一行就说明链路通了 |
| 真机 / TestFlight 购买验收 | 六个场景：首次购买、恢复购买、离线购买后联网、**未登录时购买**（走 `mn-pending-purchase-verifications` 重试队列，登录后应自动补齐）、应用重启、待批准交易（Ask to Buy）。退款验收：Apple 后台退款后，最迟下次 `/api/entitlements` 或定时任务重查时应变回 `isPro=false` |

依赖告警（第二轮已处理）：

| | 审计时 | 现在 | 剩下的是什么 |
|---|---|---|---|
| 前端 | 1 critical / 6 high / 3 moderate / 1 low | **1 critical / 1 high / 1 low** | `tar` + `@capacitor/cli` 要跨 Capacitor 大版本（8.5.1），审计明确说别在这次动；`esbuild` 是 dev server 的读文件问题，不进产物 |
| Worker | 4 high | **3 high** | 升到 `wrangler@4.130` + `@cloudflare/workers-types@5`（typecheck / test / dry-run 全过）。剩下三条同一个根：miniflare 拉进来的 `sharp`→libheif；2026-09-11 审计已报告可用普通 `npm audit fix` 刷新传递依赖，本轮按机械依赖维护暂缓 |

⚠️ **`@cloudflare/workers-types` 是 4 → 5 的大版本**，但它只是类型，`npm run check`、
`npm test` 和 `wrangler deploy --dry-run` 全过；miniflare 被带成了 `5.x-alpha`，
只影响本地 `wrangler dev`。

### 容量：不是"长期"，是 2026-11-03

审计当时写的是"本次没有据此预测具体哪一天达到限制"。现在算过了：

- 快照 **13.48 MB 未压缩**（占 20 MB 上限 **67.4%**）/ 1.64 MB gzip
- reviews 占 9.24 MB / 49,696 行 = **186 B/行**；用户每天 636 条 = 每天涨 **118 KB**
- **约 55 天后撞上限，2026-11-03，届时同步直接停**

已把上限抬到 **48 MB**（约 292 天）。理由不是"改个大数字"：20 MB 比 App 自己的内存
基线还紧（本机整库 39.28 MB 常驻 sql.js WASM 堆），而 Worker 侧从不解压、只存
gzip blob。设置页在 85% 转橙告警。

⚠️ **这是买时间。** 云端增量协议必须在 48 MB 之前落地。顺带一条实测线索：
9.24 MB 的 reviews 里约 **3.6 MB 是同一个 36 字节设备 UUID**
（`sync_origin_device` distinct = 1，`sync_uid` 是 `设备号:行号`）重复了五万遍。

**仍未做、需要人来做的三件事**（代码里做不了）：

1. **真机沙盒验收**：首次购买、恢复购买、离线购买后联网、未登录时购买、应用重启、
   待批准交易。本次只做到「代码与插件对象匹配」和隔离复现层面。
2. **App Store Connect 配置 Server Notifications V2 的地址**指向
   `POST /api/purchases/apple-notifications`，并跑通一次真实通知。
3. **生产打开 `REQUIRE_AUTH_HARDENING=1`**（先确认 Turnstile 与 Resend 都已配置，
   否则线上会立刻 503）；以及按依赖链更新 npm 告警的开发/构建依赖，在独立环境验证
   Capacitor/iOS 集成后再合入。

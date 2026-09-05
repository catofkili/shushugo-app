# ShuShuGo Cloudflare Sync

Cloudflare Worker + D1 + R2 backend for ShuShuGo account login and learning-data sync. Workers KV 只保存短期认证/限速数据，并兼容读取升级前的旧备份。

## Setup

```bash
cd cloudflare-sync
npm install
npx wrangler login
npm run d1:create
npm run kv:create
npm run r2:create
```

Copy the `database_id` printed by `d1:create` into `wrangler.jsonc`, then run:

```bash
npm run d1:migrate:remote
npm run deploy
```

首次为现有线上环境升级时，必须先创建 R2 bucket、运行 D1 迁移，再发布 Worker；`0006_account_profiles_and_identities.sql` 会增加登录身份和跨设备个人资料表结构，`0007_sync_rate_limits.sql` 会增加同步账号额度表，`0008_r2_user_snapshots.sql` 会记录新旧快照的存储后端和格式。

## Sign in with Apple

第一版同时支持邮箱密码和 Apple 登录。学习数据始终先保存在本机：未登录、退出登录或暂时离线都不会阻止学习；登录后才启用账号资料与学习进度的跨设备同步。

微信小程序使用同一个 Worker 的 `POST /api/auth/wechat`：小程序只提交一次性 `wx.login` code，Worker 通过 `WECHAT_APP_ID` 与 `WECHAT_APP_SECRET` 向微信换取 openid/unionid，再签发与 iOS 相同的 Bearer session。两个密钥只能配置在 Worker secret/变量中，不能写入小程序代码包；微信身份视为已验证身份，可直接使用云同步。

发布前需要完成以下配置：

1. 在 Apple Developer 后台为 App ID `com.shushugo.app` 启用 **Sign in with Apple**。
2. 在 Xcode 的 Signing & Capabilities 中选择开发团队并确认 **Sign in with Apple** capability。仓库已包含 `App.entitlements`，但开发团队不能由代码仓库代替配置。
3. Worker 的 `APPLE_SIGN_IN_CLIENT_ID` 必须与原生 App 的 Bundle ID 一致。当前 `wrangler.jsonc` 已使用 `com.shushugo.app`。
4. 若以后支持网页 Apple 登录，另建 Apple Services ID 和 HTTPS return URL，并在前端设置 `VITE_APPLE_CLIENT_ID`、`VITE_APPLE_REDIRECT_URI`。第一版 iOS 原生登录不依赖网页回调。

Apple 返回的邮箱若已属于一个邮箱密码账号，服务端不会静默合并账号。用户必须先验证该邮箱账号密码，再由已登录会话关联 Apple 身份。

## 人机验证（Turnstile）

注册、找回密码，以及多次密码失败后的登录可以使用 Cloudflare Turnstile。在 Cloudflare 控制台创建生产 widget 时：

- 名称可使用 `ShuShuGo Production`；
- 模式选择 `Managed`；
- Hostname 只添加 `master-nihongo-sync.master-nihongo-lsc.workers.dev`；
- 不要把 Cloudflare 的测试 sitekey/secret 部署到生产环境。

创建后配置：

```bash
cd cloudflare-sync
npx wrangler secret put TURNSTILE_SITE_KEY
npx wrangler secret put TURNSTILE_SECRET_KEY
```

两个值都存在时验证才会启用。前端在登录弹窗内加载 Worker 自己的 `/auth/challenge` 页面，验证结果仍由 Worker 向 Cloudflare 服务端校验。

## Transactional email

Email verification and password reset use Resend's REST API.

1. Add a sending domain in Resend.
2. Add the DNS records Resend shows for SPF, DKIM, and DMARC.
3. Create a Resend API key.
4. Store it as a Worker secret:

```bash
cd cloudflare-sync
npx wrangler secret put RESEND_API_KEY
```

Set the sender address as a Worker variable or secret:

```bash
npx wrangler secret put EMAIL_FROM
# Example value:
# ShuShuGo <noreply@your-domain.com>
```

For a quick private test, Resend's default `onboarding@resend.dev` sender can be used, but production should use a verified domain sender.

## App Store Server API

购买收据的服务端验证需要 App Store Connect 的 **In-App Purchase** API key。它与 Sign in with Apple key、普通 App Store Connect API key 不是同一种凭据。

1. 打开 App Store Connect → Users and Access → Integrations → In-App Purchase。
2. 生成 In-App Purchase key，记录 Issuer ID 和 Key ID。
3. 下载 `.p8` 私钥。Apple 只允许下载一次，不要把它加入 Git 或前端代码。
4. 将三项写入 Worker secret：

```bash
cd cloudflare-sync
npx wrangler secret put APP_STORE_ISSUER_ID
npx wrangler secret put APP_STORE_KEY_ID
npx wrangler secret put APP_STORE_PRIVATE_KEY
```

`APP_STORE_PRIVATE_KEY` 需要粘贴包含 `BEGIN PRIVATE KEY` 与 `END PRIVATE KEY` 的完整 `.p8` 内容。服务端默认先查询 Production，交易不存在时再回退 Sandbox，以兼容 TestFlight 和 App Store 审核交易。

After deployment, set the iOS frontend env var:

```bash
cd ../frontend
cp .env.example .env.local
# edit VITE_SYNC_API_URL to the Worker URL printed by deploy
npm run build
npx cap sync ios
```

## 开发试用号

权益只有一条写入路径 —— `POST /api/purchases/verify`，而那条路要一张真的 App Store
收据。所以「注册一个号来试 Pro」在正常流程里做不到：注册完它就是个免费号。
`scripts/dev-account.mjs` 补的就是这一段。

```bash
cd cloudflare-sync

# 先自检：确认脚本算的 PBKDF2 和 Worker 的 hashPassword 是同一个算法
node scripts/dev-account.mjs selfcheck

# 路线 A：已经在 App 里注册过了，只补 30 天 Pro 试用
node scripts/dev-account.mjs grant dev2@example.com --days 30 --apply

# 路线 B：直接建号（密码在提示后手输，不要写进命令行）
node scripts/dev-account.mjs create dev2@example.com --days 30 --name "开发试用 2" --apply
```

**能不用 B 就不用 B。** 路线 A 走的是 App 自己的注册流程，协议同意、身份行、
Turnstile、验证邮件都由 Worker 生成，不会和以后的改动走散；脚本只补一条 entitlements。
路线 B 是在旁边手写 users + auth_identities，register() 以后加了字段这里就得跟着改。

几条口径：

- **密码只从 stdin 读，不接受命令行参数**：argv 会进 shell 历史，也会在 `ps` 里
  对同机器的其他进程可见。脚本不生成、不保存、不打印密码，落到 SQL 里的只有哈希。
- **默认只打印 SQL 不执行**，确认无误再加 `--apply`。
- 权益写 `source='development'` + `expires_at`。`entitlementPayload` 把过期的当免费，
  所以试用到期会自己失效，不用回来清理。将来批量清试用号也按这个 source 筛。
- `create` 会直接给 `email_verified_at` 盖章：`requireVerifiedUser` 拦着没验证的账号
  用云同步，而试用号多半用的是收不到信的地址。
- ⚠️ 客户端 `applyCloudEntitlements` 把 source 一律改写成 `cloud`，所以 Pro 页上
  这个试用号会显示成「App Store 权益」。要区分得让前端透传服务端的 source。

清理：

```bash
npx wrangler d1 execute master_nihongo_sync --remote \
  --command "SELECT u.email, e.expires_at FROM entitlements e JOIN users u ON u.id = e.user_id WHERE e.source = 'development'"
```

## API

- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/apple`
- `POST /api/auth/wechat`
- `POST /api/auth/link-apple`
- `POST /api/auth/logout`
- `POST /api/auth/change-password`
- `POST /api/auth/send-verification-email`
- `POST /api/auth/verify-email`
- `POST /api/auth/request-password-reset`
- `POST /api/auth/reset-password`
- `GET /api/auth/config`
- `GET /api/user/profile`
- `POST /api/user/profile`
- `GET /api/entitlements`
- `POST /api/purchases/verify`
- `POST /api/sync/push`
- `GET /api/sync/status`
- `GET /api/sync/pull`

微信小程序首次登录请求体还必须带当前 `terms_version` 与 `privacy_version`（当前仓库版本为 `2026-08-03`），服务端会拒绝缺失或过期的协议同意。启用微信登录前配置：

```bash
cd cloudflare-sync
npx wrangler secret put WECHAT_APP_ID
npx wrangler secret put WECHAT_APP_SECRET
```

前端生成一个只包含用户学习表的临时 SQLite，gzip 后作为二进制上传。`words`、`grammar_points` 等出厂内容由 App 版本统一提供，绝不再随账号重复上传。D1 保存账号、版本和对象元数据，R2 保存最近三代压缩快照。

登录设备会在本地数据库保存后静默自动上传，并在应用启动、回到前台、恢复联网或定时检查时自动同步。连续学习产生的保存会先合并，停止操作 30 秒后再尝试上传；同一前台会话最多每 5 分钟自动上传一次，云端状态也改为每 5 分钟轮询。

同步实现有几层保护：

- Worker 为每个账号维护单调递增的 `generation`，客户端上传时携带自己最后读到的版本；旧版本上传会被拒绝，不会静默覆盖另一台设备的新数据。
- 上传带 `operation_id` 幂等键；网络超时后重试不会重复生成备份，也不会把同一份数据误判成冲突。
- 当前传输是“仅用户数据”的压缩 SQLite 快照；客户端在两端都发生改动时按同步表逐行合并：不同单词/语法记录保留双方结果，复习流水按 `sync_uid` 去重，同一行才按更新时间和设备号做确定性决胜，删除通过墓碑防止旧设备复活数据。
- 新 Worker 仍接受旧客户端的 Base64 整库，但会转成二进制放入 R2；新客户端也能读取旧 KV 备份，并且只合并其中用户表。账号下一次成功上传后会自然迁移，不需要一次性搬运或停机。旧客户端可继续读取旧整库；账号一旦产生新格式用户快照，旧客户端会收到 `SYNC_CLIENT_UPDATE_REQUIRED`，不会把缺少词典的快照误当整库导入。
- 账号切换、未绑定的本地学习数据和明确冲突会暂停自动同步，设置页要求用户确认“上传覆盖云端”或“拉取覆盖本机”。手动上传/拉取与后台同步共用锁，并会先等待本地写盘完成。
- 同步接口同时按账号和 IP 限制分钟级突发，并通过 D1 原子计数按账号设置跨地区小时硬额度：上传 12 次/小时、拉取 30 次/小时、状态查询 120 次/小时。客户端收到 `429` 后会按服务端给出的时间静默退避；过期限速窗口由每日定时任务清理。
- 新客户端不再产生 Base64 的三分之一膨胀；上传在读取请求体前检查声明大小，并继续设置 20 MB 服务端硬上限。

数据库迁移按以下命令执行：

```bash
npm run d1:migrate:remote
npm run deploy
```

旧方案中 2,838,528 字节的出厂数据库有约 94.1% 是所有账号相同的静态词典，Base64 后每份约 3.78 MB、三代约 11.35 MB/账号；新方案已移除这部分固定浪费，并迁到 R2。下一阶段若用户复习流水增长明显，再把“全量用户快照”升级为按游标上传/拉取变更行；R2 快照届时只承担新设备初始化和灾难恢复。

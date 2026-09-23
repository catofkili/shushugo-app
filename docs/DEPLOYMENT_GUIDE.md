# 云服务部署指南

收集日当前唯一的生产后端是 `cloudflare-sync/`：Cloudflare Worker 负责 API，D1 保存账号与同步元数据，R2 保存压缩学习快照，KV 保存短期认证数据和兼容旧备份。

`backend/` 只保留历史说明，原 FastAPI 实现已经删除。不要再按 Railway、Fly.io、Render、Heroku 或 `backend/server.py` 部署，也不要把旧的 Base64 整库示例接回前端。

本文只说明发布顺序和验收边界。执行远端迁移、写入密钥、发布 Worker、操作 App Store Connect 或真机购买都会改变外部状态，必须在明确准备上线时人工执行。

## 1. 发布前本地检查

需要 Node.js、npm、Cloudflare 账号与 Wrangler 登录状态。依赖必须按锁文件安装：

```bash
cd /Users/lsc/Documents/shushugo/cloudflare-sync
npm ci
npm run check
npm test
```

前端也必须独立通过质量门禁：

```bash
cd /Users/lsc/Documents/shushugo/frontend
npm ci --legacy-peer-deps
npm run check
npm run lint
npm test
```

这些检查只证明当前源码和本地测试通过，不证明远端配置、D1 数据、Apple 凭据或真机购买通过。

## 2. Cloudflare 资源

现有生产项目的资源 ID 已绑定在 `cloudflare-sync/wrangler.jsonc`。升级现有环境时不要重复创建 D1、KV 或 R2，也不要把新建资源的 ID 随意覆盖进去。

只有在建立全新、相互隔离的环境时才运行：

```bash
cd /Users/lsc/Documents/shushugo/cloudflare-sync
npx wrangler login
npm run d1:create
npm run kv:create
npm run r2:create
```

然后把命令返回的 D1 `database_id`、KV namespace `id` 和 R2 bucket 名称写入该环境自己的 Wrangler 配置。三个绑定名必须继续是：

- `DB`
- `SYNC_DATA`
- `SYNC_BUCKET`

不要把生产资源和测试资源混用。同步限流器、每日 cron、Bundle ID 和 Apple Client ID 也在 `wrangler.jsonc` 中声明，复制配置时需要逐项核对。

## 3. 远端密钥与生产开关

敏感值只能写入 Worker secret，不得提交到 `.env.local`、源码、README 或 Git 历史。

邮件与人机验证：

```bash
cd /Users/lsc/Documents/shushugo/cloudflare-sync
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put EMAIL_FROM
npx wrangler secret put TURNSTILE_SITE_KEY
npx wrangler secret put TURNSTILE_SECRET_KEY
```

App Store Server API：

```bash
npx wrangler secret put APP_STORE_ISSUER_ID
npx wrangler secret put APP_STORE_KEY_ID
npx wrangler secret put APP_STORE_PRIVATE_KEY
```

微信小程序登录（启用时）：

```bash
npx wrangler secret put WECHAT_APP_ID
npx wrangler secret put WECHAT_APP_SECRET
```

移动 App 微信登录（微信开放平台“移动应用”审核通过后再配置；不是上面的小程序凭据）：

```bash
npx wrangler secret put WECHAT_MOBILE_APP_ID
npx wrangler secret put WECHAT_MOBILE_APP_SECRET
```

只配置 Worker secret 不会让 iOS 自动出现微信登录。还必须完成微信 OpenSDK、Universal Link、URL Scheme、开放平台应用审核和真机回调；`/api/health` 的 `wechatAppLoginConfigured=true` 只验证服务端凭据存在。详见 [`WECHAT_APP_LOGIN.md`](WECHAT_APP_LOGIN.md)。

生产认证加固开关必须在 Turnstile 与 Resend 均配置成功之后打开：

```bash
npx wrangler secret put REQUIRE_AUTH_HARDENING
# 输入 1
```

不要先把开关写成 `1` 再慢慢补配置：代码会刻意让注册、登录和找回密码返回 503，以免生产环境静默降级。也不要因为测试环境暂时关闭该开关，就把测试环境的状态当成生产验收结果。

`APP_BUNDLE_ID` 与 `APPLE_SIGN_IN_CLIENT_ID` 当前在 Wrangler 配置中均为 `com.shushugo.app`。`APP_STORE_ENVIRONMENT` 默认是 `Production`；服务端遇到交易不存在时会回退查询 Sandbox，以兼容 TestFlight 和审核，不需要为了 TestFlight 把正式 Worker 永久改成 Sandbox。

## 4. D1 迁移与 Worker 发布

先迁移，后发布：新 Worker 可能立即查询新表或新索引，颠倒顺序会把结构缺失暴露给真实请求。

```bash
cd /Users/lsc/Documents/shushugo/cloudflare-sync
npm run d1:migrate:remote
npm run deploy
```

不要在不清楚目标账号和数据库时执行 `--remote`。迁移命令完成后仍要查看输出，不能只以退出码推断每个迁移都落到了预期环境。

发布后进行只读健康检查：

```bash
curl -s https://<worker-host>/api/health | jq
```

生产放行前至少确认：

- `migrationsApplied` 为 `true`，其中购买归属、认证限流、购买事件索引和 Apple 通知表全部存在；
- `authHardening`、`turnstileConfigured`、`emailConfigured` 均为 `true`；
- `appStoreConfigured` 为 `true`，环境与预期一致；
- `productionReady` 为 `true`。

健康接口只返回布尔配置状态，不验证密钥确实有权限，也不证明通知、邮件或购买能端到端成功。

## 5. App Store Connect

内购服务端校验使用 App Store Connect 的 In-App Purchase API key；它不是 Sign in with Apple key。`.p8` 私钥只能下载一次，完整内容写入 `APP_STORE_PRIVATE_KEY` secret。

订阅定期重查使用 Apple 的 Get All Subscription Statuses 接口，以账号保存的旧交易号查找最新续费交易；一次性购买仍使用 Get Transaction Info。服务端使用 Apple 自 2026-05-05 起推荐的 `api.storekit.apple.com` 与 `api.storekit-sandbox.apple.com` 域名。

在 App Store Connect 配置 App Store Server Notifications V2：

```text
POST https://<worker-host>/api/purchases/apple-notifications
```

配置后使用 Request a Test Notification，并在 D1 中确认收到 `notification_type='TEST'` 的记录。通知只触发服务端回查，不能直接把通知体当作授权依据。

## 6. 前端与 iOS 构建

复制示例环境文件并填写刚发布的 Worker 地址：

```bash
cd /Users/lsc/Documents/shushugo/frontend
cp .env.example .env.local
# 设置 VITE_SYNC_API_URL=https://<worker-host>
```

`.env.local` 不得提交。正式 iOS 构建使用仓库脚本，它会按锁文件安装依赖、执行类型检查/lint/测试、构建 Web 资源并同步 Capacitor：

```bash
cd /Users/lsc/Documents/shushugo
./scripts/build-ios.sh
```

对外预览包只使用：

```bash
./scripts/package-preview.sh
```

不要压缩整个仓库，不要手工删除再重建 `frontend/ios`，也不要重复运行 `npx cap add ios`。现有 iOS 工程包含签名、capability、deployment target 和插件配置，重建会丢失这些人工配置。

## 7. 上线验收

以下事项不能由本地测试代替：

1. 生产 Worker 健康检查与远端 D1 迁移状态。
2. 注册、登录、验证邮件、找回密码和 Turnstile 的真实投递/拦截。
3. App Store Server Notifications V2 的测试通知。
4. 真机或 TestFlight 的首次购买、恢复购买、未登录购买后登录补报、离线购买后联网、重启、Ask to Buy、续费和退款撤销。
5. 隔离测试账号的云同步上传、另一台设备拉取、冲突处理和账号删除。

测试账号与测试学习数据必须和正在使用的真实学习数据分开。不要为验证部署刷新正在学习的网页，也不要拿主账号执行覆盖上传、覆盖拉取或删除账号。

## 8. 回滚判断

Worker 发布失败时先看 Wrangler 日志和 `/api/health`，确认是代码、配置还是迁移问题。D1 迁移不是通过重新部署旧 Worker就能自动撤销的；涉及表结构或数据回滚时必须先备份并逐条设计逆向迁移。

不要使用 `git add .`、强制推送、删除生产 D1/R2/KV 或覆盖本地学习数据库作为“快速回滚”。源码回退、Worker 版本回退、数据库迁移和客户端版本回退是四个不同层次，需要分别确认影响。

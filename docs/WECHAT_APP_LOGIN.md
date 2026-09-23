# App 微信登录接入与验收

## 当前结论

微信小程序和移动 App 的登录不是同一套入口：

- 小程序调用 `wx.login`，Worker 用小程序 AppID/Secret 调用 `jscode2session`；
- iOS App 必须通过微信 OpenSDK 拉起微信客户端，取得移动应用授权 code；
- Worker 再用微信开放平台“移动应用”的 AppID/Secret 调用 `sns/oauth2/access_token`。

仓库当前已完成移动 App 登录所需的服务端路由、账号身份归一、前端请求函数、条件式登录/关联界面、原生桥接契约和自动化测试。尚未接入 iOS 微信 OpenSDK，也没有配置真实 AppID 或 Universal Link，因此不能把本地测试描述成 App 已经可以拉起微信。原生插件不可用时，微信入口不会显示。

## 已完成的代码路径

- `POST /api/auth/wechat-app`：用移动应用授权 code 登录；首次创建账号必须带当前用户协议与隐私政策版本。
- `POST /api/auth/link-wechat-app`：用户先登录现有邮箱/Apple/微信账号，再把移动微信身份关联到该 `user_id`。
- `GET /api/auth/config`：返回 `wechatAppEnabled`，只表示 Worker 的移动应用 AppID/Secret 已配置。
- `GET /api/health`：返回 `wechatAppLoginConfigured`，同样只检查凭据存在，不代表客户端和平台设置可用。
- `frontend/src/lib/sync-api.ts`：提供 `cloudWechatAppLogin` 与 `linkCloudWechatApp`；原生桥接完成后直接传一次性 code，不把微信 access token 或 AppSecret交给 WebView。
- `frontend/src/lib/wechat-auth.ts`：声明名为 `WechatAuth` 的最小 Capacitor 插件契约；只有 Worker 已配置、处于原生运行时且插件已注册时才显示入口。每次授权生成 `state`，并要求原生回调原样返回后再接受 code。
- 登录弹窗：支持微信登录和首次创建协议确认。首次探测消耗的 code 不会复用；用户确认协议后会重新拉起微信取得新 code。
- 账号安全页：支持关联微信，并正确展示微信登录方式；纯微信账号删除使用当前有效会话确认，不会错误要求 Apple 重验。

## 为什么强制要求 UnionID

同一个微信用户在小程序和移动 App 中的 OpenID 不同。只有当两者绑定到同一个微信开放平台帐号时，UnionID 才能作为跨应用身份。

服务端因此遵守以下规则：

1. 移动 App 登录没有 `unionid` 就返回 `WECHAT_UNIONID_REQUIRED`，不创建账号。
2. 小程序旧账号如果原来只有 `openid:*` 身份，后续 `jscode2session` 开始返回 UnionID 时，会给原 `user_id` 补一条 `unionid:*` 身份。
3. 新身份同时保存 UnionID 和平台 OpenID 别名；对客户端仍只显示一个“微信”登录方式。
4. 如果数据库中 UnionID 和平台 OpenID 已经指向两个不同 `user_id`，返回 `WECHAT_IDENTITY_CONFLICT`，停止自动处理。学习数据不能在没有用户确认的情况下静默合并。
5. 不使用微信昵称、头像或收集日昵称猜测账号归属。

已有收集日账号的用户应先用原方式登录，再在账号安全页关联微信。首次微信登录界面必须明确提示：已有账号先关联，否则确认协议后会创建新账号。

## iOS 仍需完成的工作

当前仓库核对结果：Bundle ID 已是 `com.shushugo.app`，最低系统为 iOS 16.4；但 Podfile 里没有 WeChat OpenSDK，Info.plist 没有微信 URL Scheme/查询白名单，entitlements 里也只有 Apple 登录、没有 Associated Domains，AppDelegate 目前只转发 Capacitor 默认 URL 与 Universal Link 回调。以下项目都还是真实缺口，不是文档占位：

1. 在微信开放平台创建“移动应用”，填写 Bundle ID `com.shushugo.app`，申请微信登录并等待审核。
2. 将小程序和移动应用绑定到同一个微信开放平台帐号，确认两端能获得同一 UnionID。
3. 准备 HTTPS Universal Link；托管并验证 `apple-app-site-association`，在 Xcode 增加 Associated Domains。
4. 接入微信 OpenSDK，配置 URL Scheme、`LSApplicationQueriesSchemes` 和 AppDelegate/Scene 回调。
5. 实现名为 `WechatAuth` 的 Capacitor 插件及 `authorize({ scope, state })` 方法：原生层发起 `snsapi_userinfo` 授权，把微信回调的 `{ code, state }` 返回 WebView；前端会校验 state 后才接受 code。
6. App 未安装微信时隐藏或禁用微信登录，并保留 Apple、邮箱和离线学习入口。
7. 更新隐私政策，把 App 微信登录处理的 OpenID/UnionID、用途和第三方 SDK 信息写清楚；按 App Store 隐私申报检查 SDK 数据收集。

当前项目是 Capacitor 6。现成的 `@capgo/capacitor-wechat` v6 已停止维护，而活跃版本跟随 Capacitor 8；因此本阶段没有直接加入一个无人维护的依赖。后续有两个可接受方案：

- 先完成 Capacitor 8 升级和所有现有插件回归，再使用受维护的同代微信插件；
- 只为 iOS 写一个很薄的本地 Capacitor 桥接，直接调用官方 WeChat OpenSDK，并由项目自行承担 SDK 升级和回调维护。

不要为了一个登录按钮直接做未经回归的 Capacitor 大版本升级。应在拿到开放平台移动应用 AppID 和 Universal Link 后，再用真实配置评估两条路线的总风险。

## Worker 配置

移动 App 与小程序使用不同的 secret 名称：

```bash
cd cloudflare-sync
npx wrangler secret put WECHAT_MOBILE_APP_ID
npx wrangler secret put WECHAT_MOBILE_APP_SECRET
```

禁止把 AppSecret 写入 `capacitor.config.ts`、前端 `.env`、Info.plist 或 App 包。客户端只持有可公开的 AppID，并把一次性授权 code 发送给 Worker。

## 验收顺序

1. 本地静态检查：Worker `npm run check`、前端 `npm run check`、微信身份路由测试通过。
2. 测试环境：配置独立移动应用凭据，确认 `/api/auth/config` 与 `/api/health` 只返回布尔状态，不泄漏凭据。
3. iOS 真机安装微信：首次登录、取消、拒绝、重复登录、微信未安装、后台切回、冷启动回调分别验证。
4. 跨端身份：同一微信先登录小程序，再登录 App，必须返回同一个 `user_id`；顺序反过来也要成立。
5. 账号关联：邮箱/Apple 账号登录后关联微信成功；另一个账号尝试关联同一微信返回 409。
6. 冲突保护：构造 UnionID/OpenID 指向不同用户的测试数据，服务端必须停止自动合并。
7. 数据边界：登录和关联前后，本机离线学习数据不被清空；云同步仍按现有冲突确认流程处理。
8. 发布验收：微信开放平台审核、TestFlight 真机、App Store 隐私申报分别记录证据。本地测试、模拟器和 Worker 布尔自检都不能替代这些步骤。

## 自动化回归

`cloudflare-sync/scripts/worker-wechat-auth-route.test.mjs` 会构建真实 Worker 产物并覆盖：

- 移动 App 首次创建与再次登录；
- 已登录账号关联微信，以及他人账号关联冲突；
- 缺少 UnionID 时拒绝创建；
- 小程序旧 OpenID 身份补 UnionID；
- UnionID 与平台 OpenID 已分属两个用户时停止自动合并；
- 多条微信身份别名对客户端仍只返回一个 `wechat` provider。

这些测试不调用真实微信接口，也不证明 iOS 能拉起微信。真机测试必须等开放平台配置完成后单独执行。

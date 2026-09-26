# Taro 微信小程序提审清单（路线 A / v1）

目标是 `taro/main` 集成线里的 `taro-spike-2/` 最终提审产物。原生版材料 [`wechat-miniprogram/docs-submit.md`](../wechat-miniprogram/docs-submit.md) 保留作原生版记录，不代表 Taro 版已验收。

每项都列出验法、通过条件、负责人和依据。`待确认` 表示仓库里没有足够证据，不能用推测填上。此文档是清单，不是构建、微信后台、真机或线上验收证明。

## 当前已知阻塞与证据边界

- 最近记录的 Taro 标签页候选（`taro/w5-shell`，2026-09-26）主包为 **2,073,221 B**，超过本项目 **1,900,000 B** 的提审闸门；语法页仍空白，包体重复闸门及 iPhone 真机验收也未完成。必须在最终集成版本重新构建、收敛包体并验收，不能把该候选标作通过。依据：`docs/MINIPROGRAM_SYNC_PLAN.md:619–639`；分包限额：`:548`。
- Taro 付款适配目前只列月卡、年卡、永久版，缺少已批准的季卡；同一候选的 `release-config.weapp.cjs` 仍为 `purchase:false, team:false, reminders:false`。这些是实现/发布配置现状，不是获批的 v1 差异，也不能据此把购买、组队或提醒写成已批准隐藏项。依据：`taro/w5-shell @3003768` 的 `frontend/src/lib/purchases.weapp.ts:13–18`、`taro-spike-2/src/platform/release-config.weapp.cjs:1`；已批准差异：`docs/MINIPROGRAM_SYNC_PLAN.md:596–602`。
- Taro 编译出的 `DailyPlanRing`、`TimerRing`、`KanjiPairLines` 曾因内联 SVG 在小程序中无法显示；记录称该问题只在网页验证时发现，尚无 Taro 修复验收证据。不要通过隐藏这些未批准功能来判通过。依据：`docs/MINIPROGRAM_SYNC_PLAN.md:613–616`。
- Worker 健康状态最后一份仓库记录是 2026-09-24 的 `productionReady=false`；本次没有查询线上。提审前必须重新读实际 `/api/health`，历史快照不算当前结果。依据：`wechat-miniprogram/docs-submit.md:139–142`。

## 1. 构建、包体与自动检查

### 怎么验

在最终提审提交及其锁定依赖上依次执行：

```bash
cd taro-spike-2
npm run build:weapp
npm run check:release
npm test
cd ../wechat-miniprogram
npm test
```

`build:weapp` 必须包含并通过 Taro 构建、异步内容检查、WeChat API 允许清单和包体闸门；不得用 `build:preview:weapp` 计时产物提审。`check:release` 检查实际 `dist/` 与 `project.config.json`。原生目录的 `npm test` 是本清单要求的额外回归检查，不把原生包作为上传物。

### 通过条件

- 上述命令全部退出码为 0。
- `reports/package-sizes.json` 中主包和**每一个**分包均不超过 **1,900,000 B**；`reports/package-gates.json` 通过：没有跨包重复的核心模块，页面组件重复总量不超过 100,000 B，产物没有 `wechat-miniprogram/src/shared/web.js`。
- API 允许清单没有未解释的新命中；`check:release` 确认 sourcemap 关闭、`urlCheck=true`、正式 AppID、`DEV=false`，没有本机地址、`workers.dev`、vConsole、计时预览标记、开发专用代码或密钥形状字符串。
- 保存命令结果、各包字节数、Taro commit 与锁文件版本，供 Claude 复核。

### 负责人与依据

- **Codex**：在最终 Taro 集成提交上运行并记录全部命令与逐包字节数。
- **Claude**：复核产物和报告；没有逐包结果或任何命令失败就不得给提审通过结论。
- **用户**：随后扫码做第 5 节真机验收。
- 依据：`docs/MINIPROGRAM_SYNC_PLAN.md:548,604–610,613–616`；Taro 脚本定义见 `taro/main` 的 `taro-spike-2/package.json`、`scripts/check-release.mjs`、`scripts/verify-package-gates.mjs`；原生测试要求见 `wechat-miniprogram/docs-submit.md:12–21`。

## 2. Worker 与首月赠送

### 怎么验

提审当天由用户只读检查：

```bash
curl -fsS https://api.shushugo.com/api/health | jq
```

不复制或公开任何 secret。逐项解释如下：

| 字段 | 含义与通过值 |
|---|---|
| `ok` | 迁移齐全，且若启用登录加固则 Turnstile 与邮件配置齐全；要求 `true`。 |
| `migrations` / `migrationsApplied` | 远端 D1 的逐表/索引结果；要求每项及汇总均 `true`。当前 Worker 实现检查 `apple_transaction_owners`、`auth_rate_limits`、`apple_notifications`、`idx_purchase_events_transaction_status`、`wechat_orders`、`teams`、`team_members`、`team_daily_activity`、`team_cheers`、`team_reports`、`trial_grants`、`launch_gift_grants`。 |
| `authHardening` / `turnstileConfigured` / `emailConfigured` | 登录加固开关、Turnstile 配置、Resend 邮件配置；`productionReady` 计算要求三项为 `true`。 |
| `productionReady` | `migrationsApplied && turnstileConfigured && emailConfigured && authHardening`；必须为 `true`。它**不包含**微信支付或消息推送配置。 |
| `wechatPayConfigured` | Worker 有虚拟支付所需配置；必须为 `true`，且后台四档道具也要已发布。 |
| `wechatPushConfigured` | Worker 有微信支付通知 Token；必须为 `true`，并且微信后台 GET 握手成功。 |
| `wechatContentSecurityConfigured` | Worker 配有微信内容安全所需的小程序 AppID / Secret；组队不是已批准的隐藏差异，因此必须为 `true`。 |
| `wechatAppLoginConfigured` | 微信**移动 App** 登录配置，不等同小程序 `wx.login`；不要拿它单独判断小程序登录。 |
| `appStoreConfigured` / `appStoreEnvironment` | Apple Server API 凭据与环境；仅 Apple 端诊断，不作为微信小程序开关。 |
| `weeklyReportRetentionDays` | 云端周报保留期；v1 隐藏周报，不以此值证明小程序提审通过。 |

**核对口径注意：** `CLAUDE.md` 的旧部署自检文字仍把迁移范围写作 0009–0012（`:671–685`）；当前 Worker 健康检查已包含到 0016 的表及 0011 索引（`cloudflare-sync/src/index.ts:3155–3202`）。以当前接口返回的 `migrations` 逐项结果和 Worker 实现为准，不能只看旧编号说明。

首月赠送：提审当天把 `LAUNCH_GIFT_CLAIM_UNTIL` 设为**预计正式上线日 + 1 个月**并部署 Worker；审核期间领取窗口须保持开启。若上线日期改变，在关闭窗口前按实际日期复核。每账号仅领取一次、领取后 30 天；不等于永久免费会员。

### 通过条件、负责人与依据

- **用户**：重新查询线上健康接口，确认上表要求的字段为 `true`；设置赠送截止时间并在提审当天部署。不得用 2026-09-24 的历史状态代替。
- **Codex**：对照最终客户端功能检查 `wechatContentSecurityConfigured` 与支付配置；不读取或回显 secret。
- **Claude**：审核字段解释、上线窗口日期及健康结果。
- 依据：`CLAUDE.md:229–253,257–265,671–685,2803–2807`；当前健康字段定义：`cloudflare-sync/src/index.ts:3155–3202`；历史线上检查：`wechat-miniprogram/docs-submit.md:139–142`；赠送时间点：`docs/MINIPROGRAM_SYNC_PLAN.md:600–602`。

## 3. 微信后台设置

### 基础库

- **怎么验**：小程序后台「设置 → 基本设置 → 基础库最低版本」。
- **通过**：最低版本为 **2.32.3**。
- **负责人**：用户设置，Codex 对照最终产物使用的 API，Claude 复核。
- **依据**：`wechat-miniprogram/docs-submit.md:3–10`。

### 服务器域名与云函数

- **怎么验**：确认提审 AppID 所在 CloudBase 环境、`api` 云函数部署版本及其 Worker 上游；从最终 `dist/` 检查客户端请求路径与内容/音频下载来源。
- **通过**：业务 `/api/...` 请求经 CloudBase `api` 函数转发到 `https://api.shushugo.com`；客户端产物不直接请求 Worker，也不含 `workers.dev`。微信后台域名白名单只填写最终代码实际需要的域名，不从原生版照抄或推测；若 Taro 最终产物还使用其他域名，逐项列出并在后台验证。
- **云函数**：`api` 必须在目标环境可调用。学习提醒没有列入已批准的隐藏差异：当前 `reminders:false` 是阻塞状态，不能视为获批下线；最终版本需保持已批准的产品行为，并在提醒入口可用时部署 `reminder`、填写有效模板 ID、走完授权/发送验收。模板 ID 不得保留 `TODO`。当前仓库配置中的提醒模板为 `TODO`，待用户在后台完成。
- **负责人**：用户部署/核对 CloudBase 环境和后台域名；Codex 检查产物路由；Claude 复核证据。
- **依据**：`docs/MINIPROGRAM_SYNC_PLAN.md:587–588`；Taro 接口表（`taro/main`）`docs/TARO_PLATFORM_ADAPTERS.md:16,19,22,32,38–41`；`wechat-miniprogram/cloudbaserc.json:3–31`；上游 Worker 与推送端点见 `wechat-miniprogram/docs-submit.md:109–115`。客户端不直接请求 Worker 的约束见 Taro 接口表 `:22,38`。

### 虚拟支付四档商品

| 后台道具 ID | 价格 | 权益期限 |
|---|---:|---|
| `pro_monthly` | ¥10 | 1 个北京时间自然月 |
| `pro_quarterly` | ¥24 | 3 个北京时间自然月 |
| `pro_yearly` | ¥68 | 12 个北京时间自然月 |
| `pro_lifetime` | ¥298 | 永久 |

- **怎么验**：用户在微信支付后台逐个打开沙箱与正式环境商品，核对发布状态、短道具 ID 和价格；Codex 同时核对最终 Taro 商品、Worker 分价及订单映射。
- **通过**：四项都已在目标环境发布，价格与 Worker 分价一致（1000 / 2400 / 6800 / 29800 分），期限卡均为单次付款、到期后手动续购；最终客户端四档全部可见并能各自创建正确订单。
- **负责人**：用户完成微信后台道具；Codex 核对最终客户端与 Worker 映射；Claude 复核。
- **当前阻塞**：Taro 候选 `frontend/src/lib/purchases.weapp.ts:13–18` 只有月、年、永久三项，且 `release.purchase=false`；季卡未接入。不得以后台有四个商品或旧原生代码有四个商品声称 Taro 已通过。
- **依据**：`CLAUDE.md:257–265`；`wechat-miniprogram/docs-submit.md:132–142`；Worker 短 ID 映射：`cloudflare-sync/src/wechat-pay.ts:38–58`；当前 Taro 差异：`taro/w5-shell @3003768` 的 `frontend/src/lib/purchases.weapp.ts:13–18`、`taro-spike-2/src/platform/release-config.weapp.cjs:1`。

### 微信支付消息推送

- **怎么验**：微信后台「开发 → 消息推送」填写 `https://api.shushugo.com/api/purchases/wechat-notifications`，格式 JSON、加密明文；Token 由用户生成并在 Worker secret `WECHAT_MSG_TOKEN` 中保存相同值，提交配置时完成微信 GET 握手。
- **通过**：微信后台保存成功、GET 握手通过，且线上 `wechatPushConfigured=true`。Token 不写入本仓库或本提审文档。
- **负责人**：用户配置；Codex 只核对状态；Claude 复核健康结果。
- **依据**：`CLAUDE.md:246–250`；`wechat-miniprogram/docs-submit.md:109–115`。

### 隐私保护指引：逐项核对接口和数据

后台「用户隐私保护指引」必须与最终 Taro 产物逐项一致。下面是当前 Taro 适配证据中的接口候选；Codex 要在最终构建产物中确认每项可达/已启用，再由用户在微信后台逐项勾选并说明用途。未被最终产物调用的项不勾选；新增命中也必须补查，不能漏报。

| 接口 | 在指引中的用途/数据说明 | 判定依据 |
|---|---|---|
| `wx.login` | 用户主动绑定微信账号时取得登录 code；服务端换取 OpenID / UnionID，作为账号身份，不取微信昵称、头像、手机号或通讯录。 | Taro W4 `docs/TARO_PLATFORM_ADAPTERS.md:19`；`frontend/src/lib/privacy-policy-content.ts:63–66` |
| `wx.requestVirtualPayment` | 用户主动购买 Pro；解释订单、商品与支付结果处理，不声称应用能读取支付方式。 | Taro W4 `docs/TARO_PLATFORM_ADAPTERS.md:20`；`frontend/src/lib/privacy-policy-content.ts:68–69` |
| `wx.requestSubscribeMessage` | 用户主动订阅学习提醒；只在最终版本开放提醒入口且有真实模板时登记。 | Taro W4 `docs/TARO_PLATFORM_ADAPTERS.md:16,32`；模板状态：`wechat-miniprogram/cloudbaserc.json:18–25` |
| `wx.getSetting`、`wx.authorize(scope.writePhotosAlbum)`、`wx.saveImageToPhotosAlbum` | 用户选择保存分享图到系统相册；说明授权时机与用途。 | `taro/main` 的 `frontend/src/lib/share-image.weapp.ts:9–20`；Taro W4 `docs/TARO_PLATFORM_ADAPTERS.md:14–15` |
| `wx.cloud.callFunction('api')` | 将用户主动登录/同步等业务请求经腾讯云函数转发到 Worker；绑定并同步后涉及账号资料、学习记录等数据。 | Taro W4 `docs/TARO_PLATFORM_ADAPTERS.md:19,22`；`frontend/src/lib/privacy-policy-content.ts:63–69` |
| `wx.cloud.downloadFile`、`wx.cloud.getTempFileURL`、`wx.cloud.CDN` | 下载词库/音频内容及同步所需文件传输；核对最终产物确实使用的接口，并说明内容与用户文件的边界。 | Taro W4 `docs/TARO_PLATFORM_ADAPTERS.md:22,25`；隐私政策 `frontend/src/lib/privacy-policy-content.ts:65–68` |

`wx.chooseMessageFile` 在原生设置页 `wechat-miniprogram/src/pages/settings/index.js:220` 用于导入备份，但目前没有确认它在最终 Taro 产物中的实现；若 Taro 版实际开放文件导入，必须把最终实际调用接口和“仅读取用户主动选中的文件”一并补入指引。组队若开放，指引还须说明队名/昵称及 OpenID 会送微信内容安全接口检测。隐私政策需明确 CloudBase 中转、境外 Worker 同步、内容云存储、微信登录标识、组队数据及支付订单范围。

- **通过**：指引所选接口与最终 Taro 产物逐一对应；功能用途、用户数据、CloudBase 中转和组队内容安全处理均与当前隐私政策及实际界面一致；微信后台审核状态通过。
- **负责人**：Codex 从最终产物列接口并对照隐私政策；用户录入/提交微信后台指引；Claude 审查接口与描述是否匹配。
- **依据**：`wechat-miniprogram/docs-submit.md:42–50,54–60`；Taro W4 `docs/TARO_PLATFORM_ADAPTERS.md:13–22,32,37–39`；`frontend/src/lib/privacy-policy-content.ts:63–69`。原生版接口不得未经 Taro 产物核对就照搬。

### 小程序服务类目

- **怎么验**：用户查看微信后台当前主体可选类目、已备案/认证资质及提审表单中的一级/二级类目，并对照 Taro 最终可见功能。
- **通过**：实际类目与实际功能及主体资质相符，微信后台无缺项或资质拦截。
- **负责人**：用户选择并提交；Claude 复核说明与产品实际一致；Codex 提供最终功能清单。
- **状态**：具体类目及资质在已读材料中没有依据，**待确认**，不在此代填。
- **依据**：`wechat-miniprogram/docs-submit.md:3–10` 只指出类目是常见打回原因，未给出 Taro 版应选类目。

## 4. v1 范围与已批准差异

提审说明只列下表三项已获用户批准的差异。不得擅自把其他功能写成 v1 隐藏/取消项。

| 已批准差异 | 怎么验 | 通过条件 | 负责人与依据 |
|---|---|---|---|
| 小程序 v1 隐藏周报 | 扫描四个主标签页及相关入口；确认不能从其他小程序入口打开周报。 | 周报入口不可见、路由不可达；其他已迁页面仍按网页对应行为工作。 | Codex 核查最终页面与路由；Claude 复核。用户同意及原因：`docs/MINIPROGRAM_SYNC_PLAN.md:596–598`。 |
| 小程序隐藏 7 天完整计划试用 | 新建计划并查看是否出现 7 天试用/领取流程；检查 Worker 试用接口返回。 | 小程序不显示该试用流程，接口按既定关闭语义返回 410 / `TRIAL_DISABLED`；不得影响已批准的首月赠送。 | Codex 核查页面和接口；Claude 复核。依据：`CLAUDE.md:2803–2807`；`docs/MINIPROGRAM_SYNC_PLAN.md:600–602`。 |
| 微信小程序首月赠送 Pro | 登录后检查窗口开放时的领取入口；在沙箱账号领取一次并检查权益到期时间，重复请求不得续送。 | 提审时窗口截止日按预计上线日 + 1 个月设置且审核期间开启；每账号一次、领取后 30 天；不是永久免费。 | 用户设 Worker 日期；Codex 核查回包/权益；Claude 复核。依据：`CLAUDE.md:2803–2807`；`docs/MINIPROGRAM_SYNC_PLAN.md:600–602`。 |

## 5. 用户扫码真机验收

使用最终提审候选二维码；由用户在自己的微信里走完并记录构建号、设备/微信版本、结果和截图。不得以源码、网页或历史开发者工具截图替代真机结果。

| 流程 | 怎么验 | 通过条件 | 负责人 |
|---|---|---|---|
| 登录 | 用户扫码后走 Taro 小程序微信登录；若账号已绑定，确认进入正确账号，不发生静默账号/学习数据合并。 | 登录成功后显示正确账号；未关联/冲突时有明确选择或错误，不错误归属数据。 | 用户操作并记录；Codex 对照日志/回包；Claude 复核。依据：Taro W4 `docs/TARO_PLATFORM_ADAPTERS.md:19`。 |
| 答题落盘与重启 | 完成一题并记录已知词条/学习记录；彻底结束小程序再打开。 | 同一账号本地记录仍在，题目和进度未回滚/重复写入。 | 用户扫码；Codex 核对存储链路；Claude 复核。依据：`taro/main @77d4cd2` 的 `taro-spike-2/src/platform/database-runtime.weapp.ts:43–82` 和 `src/platform/filesystem.weapp.cjs:7–14`；接口设计背景：`docs/MINIPROGRAM_SYNC_PLAN.md:440–446,550`。 |
| 两端云同步 | 同一个账号分别从 Taro 与网页新增一条可识别的学习记录，触发同步后双向刷新读取。 | 两端最终读到相同记录与进度，无覆盖、重复或错误账号归属。 | 用户用真账号操作；Codex 对照 Worker 同步结果；Claude 复核。依据：Taro W4 `docs/TARO_PLATFORM_ADAPTERS.md:19,22`。 |
| 微信支付沙箱 | 对四档逐项测试取消、成功、重复验单/重试、退款；另验证另一账号不能认领订单、通知补单及重新登录/重装后的恢复。 | 取消无权益；成功后以服务端验单发放一次；重复不重复发放；退款撤权；订单归属正确；恢复后权益与服务端一致。只做沙箱，不在此清单要求真实付款。 | 用户真机沙箱操作；Codex 核对订单/权益；Claude 复核。依据：`CLAUDE.md:249–253`；`wechat-miniprogram/docs-submit.md:116–118`。 |
| 分享 | 从最终 Taro 页面执行可见的微信分享；收件端打开分享卡片。若有保存图片入口，再检查相册授权、存图与朋友圈说明。 | 接收方打开正确页面/内容，无空白或错误；保存图能打开且权限拒绝时有清晰提示。 | 用户扫码；Codex 检查实现；Claude 复核。依据：Taro W4 `docs/TARO_PLATFORM_ADAPTERS.md:13–15`。 |
| 四个标签页首次打开时间 | 在同一设备与版本上分别测主页、单词、语法、我的，从首次点入到内容可交互，记录每项毫秒数、设备和微信基础库版本。 | 四页均可交互且无白屏/异常，并留下四项实测数字。**数值上限待确认**；不把 W3 之前的 1,390 ms 历史首页数字当作新版本阈值。 | 用户真机测量；Codex 汇总；Claude 与用户确认阈值后才可判性能门槛通过。依据：`docs/MINIPROGRAM_SYNC_PLAN.md:562–574,637–639`。 |

当前另有已记录的空白风险：`DailyPlanRing`、`TimerRing`、`KanjiPairLines` 内联 SVG 在小程序无法绘制；须在最终界面修复后重走涉及页面的真机检查，不能靠“功能入口隐藏”消除失败。依据：`docs/MINIPROGRAM_SYNC_PLAN.md:613–616`。

## 6. 审核说明草稿

> 本小程序使用 Taro 路线 A 提供日语学习功能。审核时可从首页进入主页、单词、语法和我的标签页，完成一项学习/答题后返回查看本机学习记录；在“我的”中可按页面提示登录并体验账号同步。Pro 购买使用微信虚拟支付沙箱，可分别检查取消支付与支付成功后的权益状态。小程序 v1 不含周报入口及 7 天完整计划试用；登录领取的首月赠送仅在活动窗口内开放。
>
> 测试账号：基本学习流程无需预置账号。若审核需要登录、同步或支付测试账号/路径，由用户在微信后台提供。此说明和提交材料中不填写真实密码、密钥、AppKey、Token 或订单凭证。

提交前由 **Codex** 用最终 Taro 界面逐字核对标签、菜单路径、四档支付项和可用测试流程；由 **用户** 确认后台账号获取方式；由 **Claude** 最后审稿。若最终界面标签或审核账号获取路径与草稿不同，先据实改草稿再提交。

依据：小程序登录身份与数据流：`frontend/src/lib/privacy-policy-content.ts:63–69`；支付需在提审前闭环：`CLAUDE.md:235–253`；核心流程测试账号说明仅在原生版材料中出现（`wechat-miniprogram/docs-submit.md:37–40`），Taro 最终路径仍须按实际界面确认。

## 提审前签核记录

| 闸门 | 状态 | 证据/负责人 |
|---|---|---|
| Taro 构建、`check:release`、Taro + 原生 `npm test`、逐包体积 | 待验；最近候选主包超过 1,900,000 B | Codex 附命令输出与报告；Claude 复核 |
| Worker `/api/health`、四档支付配置、支付通知握手 | 待现场核验；最新保存的历史健康状态 `productionReady=false` | 用户读取后台/健康接口；Claude 复核 |
| 隐私指引、服务器域名/云函数、服务类目 | 待用户后台确认，类目待确认 | Codex 给产物接口清单；用户提交；Claude 复核 |
| 已批准的三项 v1 差异 | 待最终构建和扫码复核 | Codex 核对；Claude 复核 |
| 真机登录、落盘、双端同步、沙箱支付、分享、四页首开时间 | 待用户扫码；性能阈值待确认 | 用户实测；Codex 记录；Claude 复核 |
| 审核说明与账号获取方式 | 草稿，待最终界面/后台路径确认 | 用户确认账号提供方式；Codex 改稿；Claude 审稿 |

只有全部相关闸门都有当前提审候选上的证据，才能把状态改成通过；代码合并、开发版上传和历史真机记录不能替代这张表的签核。

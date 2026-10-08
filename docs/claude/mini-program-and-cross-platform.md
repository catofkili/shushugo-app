# 网页与微信小程序协同

## ⚠️ 改页面 = 网页和小程序一起改（2026-09-25）

用户只对着网页提要求，小程序必须在**同一个对话、同一个提交**里跟上，不许再让用户开第二、第三个对话去改另一端、去监督两边是否一样。
怎么做、闸门和禁止事项见 [`docs/MINIPROGRAM_SYNC_PLAN.md`](docs/MINIPROGRAM_SYNC_PLAN.md)（路线 A：同一份 TSX 用 Taro 编译成小程序，待 spike 验证；
路线 B：原生小程序 + 设计变量自动生成 + 页面对照表提交闸门 + 截图对比）。Codex 读的是根目录 `AGENTS.md`，它指回这里。

## ⚠️ 新项目必须编译并运行小程序版；前端必须做视觉检查（2026-09-25）

**每个新项目都必须产出微信小程序版**：完成后先按项目实际技术栈编译小程序，再在微信开发者工具中打开运行，并把核心流程实际走一遍。还要运行 `wechat-miniprogram` 的 `npm test`；不能拿网页构建、网页测试或共享逻辑测试代替小程序编译和运行验收。没有完成这几步就不能报项目完成；遇到构建或运行阻塞，必须写明阻塞和未完成的验收项。

**只要改了前端，就要主动做视觉检查**：在独立端口打开实际页面并查看运行画面或截图，至少检查目标页面和窄屏布局，确认没有遮挡、溢出、裁切、错位或不可见/不可点的控件；小程序界面有改动时也要在微信开发者工具里检查对应页面。按检查结果修正后再看一次。5173 是用户正在学习的页面，不得用它验证、刷新或触发热更新；遵守上面的同提交双端要求，并参照 [`docs/MINIPROGRAM_SYNC_PLAN.md`](docs/MINIPROGRAM_SYNC_PLAN.md) 做小程序运行和两端截图检查。

## ⚠️ 微信小程序付费 / 登录上线闸门（2026-09-21 核实，尚未完成）

**支付代码写完不等于虚拟支付已经开通。** 截至 2026-09-21，微信后台的虚拟支付尚未开通，
`cloudflare-sync/wrangler.jsonc` 的 `WECHAT_OFFER_ID` 仍为空，Worker secrets 也没有
`WECHAT_PAY_APP_KEY` / `WECHAT_MSG_TOKEN`。线上 `/api/health` 因此明确返回
`wechatPayConfigured: false`、`wechatPushConfigured: false`、`productionReady: false`。
开发版可以上传，但只要小程序里还保留「购买 Pro」入口，**这三项为 false 时就不能提交审核，
更不能把它写成“上线后再开通”**；否则审核员和用户都会遇到一个必定失败的购买按钮。

提审前必须闭环：

1. 小程序后台「支付与交易 → 虚拟支付」完成主体实名、结算资料和协议签署，取得 OfferID / 当前 AppKey。
2. 后台创建并发布客户端实际使用的商品。当前购买页只调用永久商品
   `shushugo_pro_lifetime`，价格必须和 Worker 的 `29800` 分一致；月付 / 年付虽然服务端已有价格，
   当前客户端没有入口，不要误报为已经可售。
3. `wrangler.jsonc` 写 OfferID；AppKey 只能用 `wrangler secret put WECHAT_PAY_APP_KEY` 保存，
   不写进仓库、不贴在聊天里；重新部署 Worker。
4. 后台「开发 → 消息推送」配置
   `https://api.shushugo.com/api/purchases/wechat-notifications`，数据格式 JSON、明文；Token 与
   `wrangler secret put WECHAT_MSG_TOKEN` 保存的值一致，并通过微信的 GET 握手。
5. `/api/health` 必须同时看到 `wechatPayConfigured: true`、`wechatPushConfigured: true`、
   `migrationsApplied: true`、`productionReady: true`。
6. 先用沙箱（`WECHAT_PAY_ENV=1`）和真机验证：取消支付不发权益、支付成功发权益、重复 verify 幂等、
   另一账号不能领单、发货通知能补单、退款通知撤销权益、重新登录 / 重装后可恢复。全部通过后再切
   正式环境（`WECHAT_PAY_ENV=0`）并做一笔最小范围真金白银验收。

如果决定本版暂不卖 Pro，必须先隐藏购买入口再提审，不能留下已知必失败按钮。

### 2026-09-24 增补：四档微信道具与词汇量页面同步

上面的“只售永久版”是 2026-09-21 的旧状态。本轮代码接入月卡、季卡、年卡、永久版四个普通虚拟道具，
价格分别为 ¥10 / ¥24 / ¥68 / ¥298；WeChat ID 用 `pro_monthly` / `pro_quarterly` / `pro_yearly` /
`pro_lifetime`，内部权益 ID 保持 `shushugo_pro_*`。期限按北京时间的 1 / 3 / 12 个自然月计算，
到期后手动续购。服务端拒绝有效期内重复购买期限卡，允许升级永久版；客户端在调用支付前校验服务端返回的商品和分价。
改动只在本地，未部署或上传；后台四档已填写来自用户本轮报告，仍需真机支付、补查、发货和退款验收。
（2026-09-25 更正：同一会话后来**已部署** Worker 版本 `1077c5ff`（`api.shushugo.com`，`WECHAT_PAY_ENV=1` 沙箱，绑的是共用正式 D1）
并上传了小程序开发版 `0.2.2`，但代码一直没提交，直到 2026-09-25 才补进 `main`。真机支付 / 退款仍未验收。）

词汇量共用逻辑仍从 `frontend/src/lib/vocab-test.ts` 生成到 `wechat-miniprogram/src/shared/web.js`，
本轮 `npm run check-shared` 通过。原生 WXML 不会随网页 React 视觉改版自动变化；当前把网页“答题少于 15 题不算最近成绩、历史显示未出数”
的判据同步到小程序页。好友分享继续使用微信原生结果卡；网页 Canvas 图片和网页分享弹层不是小程序现成能力。
新测验答对 +1、答错 −1.15、不认识或超时 0；未完成的旧会话沿用 −1/3，历史 `levels_json` 继续区分 `version=2`，网页和小程序都会标记旧成绩。
用户学习时不打开或刷新 5173；需要看网页结果时用独立端口，学习页只允许在所有改动完成后热更新一次。

登录目前能完成 `wx.login` → Worker 换取 openid/session_key → 本地保存会话，支付签名所需的微信会话
也会记入 KV；但以下三项仍是**可以延期、不可遗忘**的待办：

1. 给 `POST /api/auth/wechat` 增加直接路由自动化测试；现有检查主要是静态约束和传输 smoke，
   不能替代登录接口的端到端回归。
2. 增加 `linkWechat` 账号绑定流程，把微信身份绑定到已有邮箱 / Apple / iOS 账号；否则老用户首次微信登录
   可能得到第二个账号，学习数据和权益会分家。
3. 同时保存并识别 openid 与 unionid 两个别名。当前 subject 有 unionid 就用 unionid、否则用 openid；
   如果用户第一次登录只有 openid，后来才获得 unionid，同一个人可能被当成新账号，需要别名表或迁移逻辑。

**2026-09-23 进度**：第 2、3 条服务端已做（Codex 9-22 在 `wechat-app-login` 隔离目录里写的，
今天才合进来）。`auth_identities` 里一个人可以有 `openid:`（小程序）、`mobile-openid:`（App）、
`unionid:` 三种别名，都指向同一个 user_id；老小程序账号第一次拿到 unionid 时自动补别名；
几种别名已经分别落到两个账号时返回 `WECHAT_IDENTITY_CONFLICT` 停下，**不自动合并学习数据**。
App 端有 `/api/auth/wechat-app`、`/api/auth/link-wechat-app` 和账号安全页的「关联微信」，
判据在 `cloudflare-sync/scripts/worker-wechat-auth-route.test.mjs`。
⚠️ 当时 level-plan 那边也各写了一份别名逻辑（`wechat-identity.ts`），合并时删掉了，
只留这一套 —— 两套各管一半的登录路由，迟早有一边改了格式另一边没跟上。
App 真正能拉起微信还差 iOS 那一半（开放平台移动应用、Universal Link、OpenSDK 桥接），
清单在 `docs/WECHAT_APP_LOGIN.md`；原生插件不存在时按钮不显示。

**2026-09-24 小程序已有账号关联补齐**：小程序的 `POST /api/auth/wechat` 现在只登录已有微信身份；
遇到未关联的微信身份会返回 `WECHAT_ACCOUNT_NOT_FOUND`，只有用户在设置页或组队页明确选择新建时，
才接受 `create_account: true` 并创建账号。已有邮箱账号和 Apple 账号可在「我的」输入登记邮箱，
通过一次性邮件验证码把当前小程序 OpenID / UnionID 关联到原 `user_id`；验证码经 Resend 发送，
路由按 IP、邮箱哈希和账号限速，不存在的邮箱也返回相同的发送结果，避免枚举账号。
关联前须同意当前用户协议和隐私政策；隐私政策已增补邮箱验证用途并升到 `2026-09-24`，
小程序 `config.js` 与 Worker 共用版本。若该微信身份已属于另一个 `user_id`，仍返回冲突并停止，
这次没有合并历史账号或学习数据；历史双账号要另做用户确认与数据合并方案。
本次只改了源码和文档，未部署 Worker、未上传小程序，也未做微信开发者工具/真机验收。

### 2026-09-26 Taro 版付费链路（`taro/main` 的 `202a773`，服务端同一份在 `main` 的 `c83cb3a`，**Worker 未部署**）

- **iOS 可以卖**：微信已全面支持 iOS 小程序虚拟支付（手续费 15%），并要求 2026-04-01 起各端都接虚拟支付，
  所以 Pro 页在 iPhone 上照常显示购买，不用做「iOS 不可购买」分支。
- **防重复扣款在服务端**：付完款、验单还没回来时再点购买，权益还没写，`PRO_ALREADY_ACTIVE` 挡不住。
  `createWechatPayOrder` 下新单前先把这个账号近两小时 `status='created'` 的订单向微信查一遍，付了的当场结算；
  查不通（断网 / 微信 `errcode -1` 系统繁忙）就 503 `PREVIOUS_ORDER_UNCONFIRMED`，不下新单。
  ⚠️ 别把这件事挪到客户端：换设备、清缓存之后客户端根本不知道还有一张没结清的单。
- **待确认订单只查一次**（`payment.js` 的 `verifyPendingPayment`）：有明确结果（付了 / 402 没付 / 其他 4xx）就清掉，
  只有断网、5xx 才留到下次。原来取消掉的订单每次启动连查 4 次而且永远不清。真付了却漏查的那一单，
  微信发货推送和上一条「下新单前先结算」两条路都会补上。判据在 `payment-price-smoke.cjs`。
- **文案是期限卡，不是订阅**：月卡 / 季卡 / 年卡「到期不自动续费」，永久版一次买断。写「按月订阅」是在误导付费用户。
  四档分价三处必须一致：`purchases.weapp.ts`、Worker `WECHAT_PAY_PRICES`、虚拟支付后台道具价。
- **付费小窗只有一个**：删掉了 `Paywall.weapp.tsx`（整屏深色遮罩、赠送期间藏掉购买、没登录也能点买），
  小程序用网页 `Paywall.tsx`。平台差异只有三处：期限卡说明代替 Apple 条款、领首月会员、先登录再买
  （`PurchaseResult.needsAuth` → `onRequireAuth` → `requireAccount`）。网页 Paywall 里的 DOM 调用必须一路可选链
  （Taro 元素没有 `querySelector` / `focus`）。
- 首发赠送记成 `source: "trial"`，永远弱于付费。赠送期间买期限卡**从赠送到期日起算**（用户 2026-09-26 定），
  按 `launch_gift_grants` 的固定到期日算——同一单会结算不止一次，按「当前权益是不是赠送」算，第二次会把到期日往回缩。
- `release-config.weapp.cjs` 的 `purchase` 仍是 `false`。开之前：部署含 `c83cb3a` 的 Worker、`/api/health` 的
  `wechatPayConfigured: true`、四档道具已发布、沙箱真机把取消 / 成功 / 重复购买 / 恢复 / 退款走一遍。

详细支付路由、密钥和消息推送约定见 `wechat-miniprogram/README.md`；每次提审按
`wechat-miniprogram/docs-submit.md` 的硬门槛逐项验收。

### ⚠️ 小程序上传包不得夹带开发诊断界面（2026-09-22 修）

2026-09-21 上传的 `0.1.0` 开发版曾把设置页里的「原子写盘」「冷启动恢复」「查看到期数量」、
内部用户 ID、权益来源、数据库文件路径和原始异常详情一起带进用户界面。它尚未提交审核，
2026-09-22 已从发布界面删除；真正给用户的更新、同步、备份功能保留。

`scripts/check-source.mjs` 现在会拦截这些诊断控件和数据库路径重新出现，并要求
`project.config.json` 保持 `uploadWithSourceMap=false`、`urlCheck=true`。每次上传前必须跑
`npm test`；再扫描 `src/`，确认没有 localhost / mock / vConsole / 私钥 / AppSecret / 硬编码密钥。
测试脚本、README、提审文档、云函数源码和 `project.private.config.json` 都在 `miniprogramRoot: src/`
之外，不进入小程序代码包；`src/config.js` 里的云环境 ID、云存储 fileID 和公开 API 地址是客户端
运行所需的公开标识，不是密钥。开发者工具上传日志只能证明工具成功打包上传，不能代替这道源码检查。

### 组队是云端真实数据，不准再退回示例队友（2026-09-22）

组队页已从 SAMPLE_TEAM / SAMPLE_PLAZA 占位改成网页与微信小程序共用的 Worker + D1 实现。
首页也不再显示「还没开放」。后续改版不得塞回假队友、NPC 或硬编码队伍来制造热闹；广场没人时就
明确显示没人。

数据和规则：

- D1 迁移是 0014_teams.sql：teams / team_members / team_daily_activity / team_cheers /
  team_reports。同一账号只能加入一支队伍，默认 6 人；容量由数据库 trigger 兜底，不能只信客户端。
- 公开队伍能从广场加入，邀请队伍只能用 8 位邀请码；邀请码只用于入队，不是登录凭据。
- 队长退出且还有成员时，移交给最早加入的人；最后一人退出时解散。删除账号必须先走同一条退队 /
  移交流程，否则队伍会留下一个已删除的队长。
- 每日学习量由各设备上报，只用于组内展示；服务端只允许同日附近日期、0–5000，并用 MAX 合并，
  避免旧设备把新进度覆盖小。它**绝不**发柚子、Pro、排名奖励或其他权益。
- 成员接口只返回随机成员 ID、昵称和确定性 emoji，不返回邮箱、OpenID、内部 user id 或原始学习流水。
- 加油每个发送者对同一队友每天最多一次；公开广场支持举报，举报后该队伍对举报者立即隐藏。

用户生成内容不能靠仓库里维护“敏感词大全”。链接、联系方式和长号码只做便宜的结构校验；微信账号
提交队名 / 昵称时，Worker 必须再调用微信官方 wxa/msg_sec_check（v2，结果只有 pass 才发布），
review / risky 一律拒绝，接口异常时也不能放行。它复用 WECHAT_APP_ID / WECHAT_APP_SECRET 和
现有 access_token KV 缓存；/api/health 的 wechatContentSecurityConfigured 必须为 true。
邮箱 / Apple 账号没有小程序 OpenID，官方接口无法替它做这一步，目前只允许结构校验并保留举报；
以后若要让网页版公开组队成为主要入口，应接腾讯云 TMS 这类不依赖 OpenID 的服务，不能扩写本地词表。

发布依赖顺序：先远程应用 0014，再部署 Worker，再上传小程序。旧 Worker 没有 /api/teams/*，
旧 D1 没有新表，任何一个漏掉都会让组队页真实报错；网页生产构建和小程序静态检查通过不等于线上
迁移已完成。微信分享路径固定为 /pages/team/index?invite=邀请码，从分享进入只预填邀请码，
必须由用户主动点加入，禁止自动入队。

## ⚠️ 小程序整个数据层都从网页源码打包，不许再手抄一份（2026-09-22 定的）

`wechat-miniprogram/src/shared/web.js` = `scripts/build-shared.mjs` 用 esbuild 把 `frontend/src/lib`
里的纯数据层模块**原样**打出来的（入口清单 `scripts/shared/entry.ts`，平台能力在 `scripts/shared/shims/`
替换）。现在收了收藏夹、备考计划、周报、柚子、查词汇量、成就、studyPreferences。

起因是 2026-09-22 审查 Codex 那批「小程序 UI 合并」：它把这些功能**照着网页重写了一份**，
而它们的表全是跨端同步的，漂移直接出现在对端，而且每一处单看都像「差不多」：

| 漂移 | 后果 |
|---|---|
| 成就表叫 `achievement_unlocked`（网页 `achievements`） | 两端各解各的，谁也看不到对方的；柚子按成就发钱也各发各的 |
| 语法收藏存 `grammar_points.id`（网页存 grammar.ts 的 `pdf-n5-041-2`） | 同一张 `content_favorites`，互相看不懂 |
| 词汇量：没有 −错/3 猜测修正、可信度 = 正确率 | 小程序的成绩混进网页历史，口径不同但长得一样 |
| 周报 `content_json` 是另一种形状，却写 `schema_version = 3` | 网页按 v3 解析会拿到垃圾 |
| 周报无条件上云 | 网页 `syncedTablesForCloud` 只给 Pro 带周报 |

用户定的规则（原话：「除了通知付费之类确实微信小程序机制不一样的部分和小程序已经做好的组队模式之外，
其他的全部按网页端合并」）：**凡是网页有的逻辑，小程序一律用网页那份**；例外只有微信自己的机制
（登录、虚拟支付、消息推送）和已经做好的组队。

### 2026-09-24 最高优先级规则：小程序与其他版本的主要功能一致

用户最新确认：小程序与其他版本的主要功能必须完全一致；任何有意保留的产品差异都必须先得到用户明确同意。此规则优先于旧的分支记录、页面现状、工期便利和个人实现偏好，适用于功能入口、流程、文案、视觉、权限、数据格式、状态、计算结果和同步行为。

默认把发现的差异视为需要修复的问题，并按其他版本的现行产品定义补齐。只有技术或微信官方要求确实使一致性无法实现时，才提交差异说明，列明对比版本、具体差异、官方依据、用户影响、建议处理方式和代码位置；在用户明确点头前，不得把该差异作为设计决定实现、保留、延期或发布。意外差异属于未完成项，不需要逐个等待批准才修复。

目前事先允许的差异仅为微信支付所需流程，以及完成同一功能所必需、范围最小的少数微信平台适配。平台适配可以更换底层 API 和原生控件；若它改变任何用户可见的功能、步骤、权限、内容或结果，仍按上面的差异审批规则办理。适配必须能指向具体官方要求，不能把“微信用户习惯”“实现方便”或已存在于某个旧版本当成授权。

### 2026-09-24 补充：小程序与 5173 对齐期间的单一业务源

上句保留的是当时的历史决定。当前网页已经有组队页；按用户 2026-09-24 最新确认的多端对齐目标，
组队也不是独立的小程序业务例外。所有网页与小程序共有的功能都以 `frontend/src/lib` 的业务逻辑、
数据格式和产品规则为唯一来源，通过 `scripts/shared/entry.ts` / `src/shared/web.js` 接入；
小程序页面可用原生 WXML/WXSS 重做呈现，但不得另算计划、FSRS、成绩、权益或同步规则。

小程序可保留独立代码的范围限于微信平台明确要求的薄适配，例如 `wx.login`、原生控件与事件桥接、
虚拟支付调用及微信回调、订阅消息、系统分享、云存储/文件 API、音频和生命周期桥接；这些例子不是
对所有相关产品差异的概括授权，具体实现应缩到完成同一功能所必需的最小范围。支付界面和签名字段
可以遵循微信接口；商品/价格判定、服务端验单、订单归属、权益授予与撤销仍走共同服务端与权益模型。
组队等两端共有功能继续遵循相同接口契约、校验和用户可见结果。适配若造成用户可见差异，按上面的
最高优先级审批规则处理，并记录对应的官方 API / 审核依据及适配文件位置。

### ⚠️ 2026-09-25 复盘：小程序「对齐网页」耗了二十来个小时却看不出变化，原因和该怎么做

用户看到的小程序从 8 月 24 日第一版（`fdc44a2`）起就是 Codex 自己手写的一套蓝色卡片 WXML/WXSS，
从没接过 `design/` 和网页的样子。之后每一轮「合并」都只做了两件事里的一件，从没做过第三件：

| 轮次 | 做了什么 | 结果 |
|---|---|---|
| 09-22 Codex 约 6.5 h（`miniprogram-ui-merge` worktree） | 给旧页面换暖色 + 照网页**重写**八个功能 | 同一天被 Claude 做的共享数据层（`build-shared.mjs` → `web.js`）整体取代，从没合入 |
| 09-22/23 Claude | 把 `frontend/src/lib` 整个数据层打进小程序 | 数据两端一致了，**页面长相一个没变** |
| 09-23 Codex 约 4 h（HANDOFF / level-plan） | 小程序的起点设定、备考页 | 已合入 `1c7e35a` |
| 09-24 Codex 约 1.7 h | 四档付费、词汇量新计分、上传修复，部署 Worker 并传 0.2.2 | 有价值，但没提交；09-25 补提交 |
| 09-24 Codex 约 5 h（`miniprogram-parity-20260924`） | 又一次**逐页手写**首页、语法、辨析、快速复习、个人资料、帮助、关于、隐私 | 仍是它自己理解的样子；用户叫停。见下 |

时间主要耗在：① 每页先读网页 React 源码、再按自己的理解重写 WXML，而不是拿网页渲染出来的样子去搬；
② 主包 2 MiB 上限（每加一页都要挪分包、压缩共享包，反复重跑）；③ 每页新写一个 smoke 脚本、每次改动重跑 25–31 个脚本；
④ 把范围扩到截图里没有的页面（个人资料 / 帮助 / 关于 / 隐私）。它自己估的「一人全职 20–40 个工作日」就是按「逐页重写」算的。

**该怎么做（用户 09-24 提出、Codex 也承认顺序错了）**：页面层直接移植网页。网页在手机宽度下渲染出来的
DOM + 编译后的 CSS（Tailwind 产物 + `app.css` / `design.css` / `styles.css`）就是规格：
`div→view`、`span/p→text`、`img→image`、`className→class`、`{cond && …}→wx:if`、`.map→wx:for`、`onClick→bindtap`，
状态从 React state 挪到 `setData`，数据仍调 `web.js` 里的同一份函数。先搬、再在模拟器里按报错修。
已知要手改的只有 WXSS 不认的选择器（`:has()`、挂在 `html` 上的 `[data-theme]` / `[data-skin]` 要改挂页面根节点）、
`position:fixed` 与原生 tabBar 的关系、`<canvas>` 画的东西（分享图、圆环）。**不要再「照网页的意思重写一版」**。

下一步怎么做见 `docs/MINIPROGRAM_SYNC_PLAN.md`（Codex 写的 `WECHAT_WEB_PARITY_PLAN.md` 按「逐页重写」估了 20–40 个工作日，
2026-09-25 删掉了；其中「主要功能一致」那条规则上面已有，parity 分支里还能取用的东西列在新计划的路线 B 里）。

### 旧工作目录和分支都归档在 `refs/archive/*`（2026-09-25）

那天把 21 个 worktree（`~/.codex/worktrees/*`、`.claude/worktrees/*`、`~/Documents/日语学习/开发中/shushugo-data-sync-fix-20260917`）
全部删了：每个先把未提交的改动连同未跟踪文件提交成一个快照，挂在 `refs/archive/worktree/<名字>` 上再删。
这些 ref **不出现在 `git branch` 里，但随时能取回**：

```bash
git for-each-ref refs/archive                       # 列出全部
git show refs/archive/worktree/level-plan --stat     # 看某一个快照改了什么
git worktree add /tmp/x refs/archive/worktree/level-plan   # 需要时再展开成目录
```

绝大多数是已经合进 main 的旧副本（main 上是更新的版本），归档只是为了「万一有漏的」能找回。
⚠️ 以后**不要再从这些快照里整份拷文件回 main** —— 它们基于旧提交，整份拷回等于回退。要用就按文件看差异、只取缺的那一处。

- 新功能进小程序：先看能不能加进 `entry.ts`。不能（碰 DOM、带出厂内容 JSON）才 shim，shim 只做
  平台替换，不改判据。
- ⚠️ **`word-api/stage1` 必须 shim 成只读**（`shims/stage1.js`）：网页的 `stage1ProgressCounts` 会先
  `ensureStage1Tasks()`——按网页的排计划器往 `stage1_tasks` 写行、按 `stage1_plan_version` 删没答的行。
  小程序今天的计划由自己的 `createTodayPlan` 排，直接接上等于每次结算柚子把当天计划重排一遍。
  同理 `word-api/bootstrap` / `grammar-api` 也 shim 掉（那里面是 FSRS 回填迁移）。
- 小程序**没有**网页那套同步触发器：`runtime/extended-features.js` 在每次写收藏 / 夹子后自己盖
  `sync_updated_at`、自己补 / 撤墓碑。lww 表不盖时间戳 = 本机改动输给对端旧行。
- 同一天顺手查出的老小程序删除路径**没有一条留墓碑**：`undoLastAnswer` 删作答、`setConfusionMastered(false)`
  删掌握标记，推上云之后下一次合并原样回来（撤销等于没撤）。而且网页的作答墓碑键是 `sync_uid`，
  小程序 `applyTombstone` 只认三列自然键，网页那边撤销的作答在小程序上永远删不掉。都修了
  （`sync-snapshot-smoke` 里两个方向各钉一条）。**小程序任何 DELETE 同步表的地方都要自己写墓碑**，
  它没有触发器。
- 仍不一致、暂时接受的：小程序 `progress` 合并是「计数取大、FSRS 看 last_review 新」，不是网页的 lww ——
  撤销后本机 progress 回退了，云上那份没回退的会在下一次合并时赢回来（流水已删、进度没退）。
  疑难辨析组的 key 出厂库上 1,881 组里 1,880 组两端一致，差的一组（网页 `homophone:ロック` / 小程序
  `stem:開`）等 confusion-groups 进共享层一并解决。
- 产物提交进仓库；`npm run check-shared` 会重新构建比对。**网页那边改了 lib 要在这里重跑
  `node scripts/build-shared.mjs`**，否则小程序 CI 红。构建读的是**同一个 checkout 里的** frontend
  源码——在没有那些改动的 worktree（比如 Codex 的）里跑会解析不到模块。
- `wechat-miniprogram/data/*.json` 是数据模块的源，故意放在 `src/` 外：放里面会整个打进主包。
  `data/grammar_ids.json`（数字 id ↔ 字符串 id，`grammar_points.id == bookOrder`）由 build-shared
  从 grammar.ts 抽。

**第二轮（2026-09-22 当天做完）：连调度和同步一起换成网页的。** 用户原话
「除了通知付费之类确实微信小程序机制不一样的部分和小程序已经做好的组队模式之外，
其他的全部按网页端」。现在 `src/shared/web.js`（706 KiB，进主包）收的是整个数据层：
建表 + **同步触发器**（study-core / sync-schema）、单词三方向的调度与作答（word-api）、
语法考题（grammar-quiz）、词库、辨析分组与辨析题、收藏、成就、柚子、周报、词汇量、备考、偏好、
**云同步的导出与合并**（sync/snapshot + sync/merge）。小程序侧只剩薄适配：

| 小程序文件 | 现在是什么 |
|---|---|
| `core/study-core.js` | 1,048 行手抄调度器 → 160 行「db-first 调用惯例 → 网页的隐式当前库」 |
| `runtime/learning.js` | 出卡 / 作答 / 撤销全走 word-api；减负卡、压轴卡按网页学习页那条顺序插 |
| `runtime/card-view.js` | **纯展示映射**（WordCard → WXML 字段）：词形、题面、遮读音、音高、词典条目全部取网页模块 |
| `runtime/word-library.js` `confusion.js` `analytics.js` | 转发到网页的 word-library / confusion-groups / word-api + progress-api |
| `runtime/sync-snapshot.js` | 678 行自研合并器 → 转发到 `mergeDatabaseBytes`，外加老快照的墓碑列名翻译 |
| `runtime/legacy-migrations.js` | 新增：0.1.x 的库升上来（墓碑换列名、透传表放回真表、`achievement_unlocked` → `achievements`、删掉自创的 `direction_tasks` / `mode_tasks`） |

⚠️ **删掉的不止是重复代码，是一批真实的跨端 bug**：小程序以前没有同步触发器，所以
撤销作答、取消收藏、取消已掌握**都不留墓碑**（对端下一次合并原样复活）；
语法列表的「熟悉」直接 UPDATE `grammar_progress` 而不写 `grammar_reviews`、不动 FSRS；
导入整库备份走的是只认三张表的 JSON envelope（收藏 / 成就 / 柚子 / 周报全丢）。

⚠️ **出厂内容数据进了两个分包**，主包放不下（微信每包 2 MiB）：
`content`（题面层 599 KiB、汉字单元索引 390 KiB、一字多音 190 KiB、音高重音 266 KiB
+ 一字多音页和辨析题页）、`features`（辨析审校 340 KiB、简繁对照、汉字读音表、语法抓手
+ 其余功能页）。主包 1.80 / features 0.71 / content 1.42 MiB。
装载器是 `src/shared/content.js`（`require.async`），**顺序是硬要求**：
`database-store.ensureContentLoaded()` 在库就绪前先把它们灌好，再点一下网页那几个
`loadXxx()` 的缓存。⚠️ 网页那几个 loader 是 `loading ??= import(...)`，**失败一次就永久失败**
（rejected promise 被缓存），所以绝不能让页面在内容到位之前先触发它们。
⚠️ 模块初始化时就取一层属性的那几份（`kanji_variants.japanese_to_simplified`、
`kanji_readings.readings`、`grammar_key_points.points`）必须用 `shims/lazy-json.js` 的**活代理**，
返回 undefined 的话 `?? {}` 会把空表永久固定下来，加载完也永远查不到。
自他动词对（`verb_pair_hints`）相反：网页在 init 时 `Object.entries()` 就展开了，**只能同步**，
所以它留在主包。

**还没按网页合并的（下一步，按这个顺序）**：① 混合学习的插播卡面（语法 / 单独汉字 /
辨析连线三种卡在小程序里还没有 WXML，所以模式列表里先隐藏 `mixed`；数据层的
`grammar-quiz` / `kanji-char-cards` / `confusion-cards` 已经在包里了）；
② 每日量圆环（`daily-plan.ts` 已在包里，缺的是 canvas 那套交互）；
③ 学习页的翻卡动效、甩卡、连击音效这些纯 UI。这三样都不影响跨端数据一致。

⚠️ **顺手修了一条网页自己的同步 bug**（`sync/schema.ts` 的 `withoutSyncStamp`）：
`ensureProgressInitialized` / `ensureGrammarProgressInitialized` 给每个词补的**空占位行**
会被 insert 触发器盖上「现在」的 `sync_updated_at`，而 progress 的合并是 LWW ——
今天刚装上的设备，它那堆空行的时间戳比云端那条真学过的行新，合并之后**云端的学习状态
被一行空记录静默盖掉**（现象：换台设备打开，学过的词变回未学）。现在占位行在
`applying_remote` 下写、时间戳留空（= 纪元），任何真实记录都赢得过它。
同类的占位行（`materializeKanjiChars` / `materializeConfusionCards` 的 `kanji_char_memory`、
`confusion_progress`）一起改了 —— 后者连 `level_rank` 回填也不盖章：那个值每台设备自己
从出厂内容算得出同一个，不需要靠同步传播，盖章只会让「刚重算过等级」的设备赢掉对端的进度。
判据在 `frontend/src/lib/sync/merge.test.ts` 的「占位行不参与 LWW」两条。

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


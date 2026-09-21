# 小程序提审材料（2026-09-20 准备，等备案 / 认证 / 隐私指引审核过了就用）

## 提交审核前的顺序

1. 后台三样都变绿：**小程序备案**（管局审核）、**微信认证**、**用户隐私保护指引**。
2. Worker 先部署带 `/api/legal` 和微信支付路由的这版（`npx wrangler d1 migrations apply master_nihongo_sync --remote` 跑 0013，再 `npx wrangler deploy`）。
   没部署的话小程序协议页会显示「读取失败」，审核员第一眼就是这个。
3. 后台 **设置 → 基本设置 → 基础库最低版本** 设 **2.32.3**（隐私弹窗 API 从这版起；WXWebAssembly 2.13.0、readFile 分块 2.10.0 都在它之下）。
4. 开发者工具 → 顶栏「上传」→ 填版本号和备注 → 后台「版本管理」里把这个开发版**提交审核**。
5. 审核时长通常 1–7 天；被打回看理由，大多是隐私指引和类目。

## 提交审核前：上传包清理

1. 在 `wechat-miniprogram` 运行 `npm test`，必须全部通过；其中发布检查会确认开发诊断控件未回到界面，
   `uploadWithSourceMap=false`、`urlCheck=true`。
2. 扫描 `src/`，不得出现 localhost / 测试域名、mock / vConsole、私钥、AppSecret、硬编码 Token 或管理员入口。
3. 用户界面不得显示数据库路径、内部用户 ID、权益来源枚举、原始服务端异常，或「原子写盘」「冷启动恢复」
   之类开发诊断操作。检查内容更新、同步、导入导出备份属于正式用户功能，可以保留。
4. `miniprogramRoot` 必须保持 `src/`。测试脚本、README、提审文档、云函数源码和本机私有配置都在它之外，
   不进入审核代码包。
5. 上传新开发版后，在后台确认它替换旧开发版；没有完成本清单和下面的支付硬门槛，不提交审核。

## 版本号与「项目备注」（上传时填）

版本号：`0.1.1`
备注：`首个上线版本：JLPT 词汇与语法查询、记忆复习、辨析与学习统计；本地保存，可选微信账号同步。`

## 提审表单：「版本描述」

> ShuShuGo 是一个日语词汇与语法查询记忆工具。收录 JLPT N5–N1 词汇 10,919 条、语法 769 条，
> 提供读音、例句、音高重音、近义词辨析、词汇量测试和学习进度统计。所有内容和学习记录默认保存在本机，
> 不登录即可完整使用；绑定微信账号后可选择把学习进度同步到云端用于多设备恢复。
> 无广告、无第三方统计 SDK。

## 「测试帐号」

不需要：核心功能不登录即可全部体验。如审核员要求：绑定微信账号用审核员自己的微信即可，
不需要预置账号。

## 隐私相关审核常问

| 问 | 答 |
|---|---|
| 收集了哪些信息 | 「选中的文件」（导入备份）和「学习记录」（自定义项，仅绑定账号后上传）。指引里已填 |
| 有没有第三方 SDK | 无。运行时只有 sql.js 和 ts-fsrs（MIT），都在包内 |
| 数据出境 | 已在隐私政策「微信小程序版」一节写明：经腾讯云云函数转发到境外服务器；未绑定账号不上传 |
| 为什么要「文件」权限 | 用户手动导入自己导出的学习备份文件，且只读用户选中的那一个 |

## 学习提醒（订阅消息）：要你在后台申请一个模板

个人主体开不了服务号，教育类目也没有长期订阅，能用的只有**一次性订阅消息**：用户点一次授权 = 能发一条，
授权不过期。小程序把请求挂在翻面 / 评分按钮上（`runtime/reminder.js`，第一次 + 每 20 次作答要一次），
用户勾过「总是保持以上选择」之后每次静默 +1 条，云函数 `reminder` 记账；定时器每天 **20:00** 给
「今天没学、还有额度」的人发一条（`cloudfunctions/reminder`）。**学完了不弹任何东西。**

你要做的（5 分钟）：

1. mp.weixin.qq.com → **功能 → 订阅消息 → 公共模板库**，搜「学习提醒」，选一个字段最少的
   （比如只有「提醒内容 thing」+「时间 time」两个字段的），**选用**。
2. 「我的模板」里点开它：把**模板 ID** 和**字段名**（`thing1` / `time2` 这种带数字的）发给我。
   我填两处：`src/config.js` 的 `reminderTemplateId`，`cloudbaserc.json` 里 `reminder` 的
   `REMINDER_TEMPLATE_ID` / `REMINDER_DATA`（`thing1=今天的单词还没复习;time2={date}` 这种写法），
   再 `tcb fn deploy reminder --force`。
3. 云开发控制台 → 数据库：集合 `reminders` 是云函数第一次记账时自己建的，不用手建；
   权限保持默认（仅创建者可读写）即可，云函数不受权限限制。

⚠️ 环境变量里**不能写 JSON**（`{"thing1":…}`）：tcb 部署时会把它解析成对象，云 API 直接拒收
（`Environment.Variables.1.Value is not valid`），所以字段用 `key=值;key=值` 这种写法。

## 提交审核前：虚拟支付硬门槛（保留「购买 Pro」入口时）

⚠️ **不能把虚拟支付留到上线后。** 支付代码存在不等于微信后台已经开通。只要当前版本显示购买入口，
下面各项就必须在提交审核前全部完成；否则先隐藏购买入口，再提交一个不含付费功能的版本。

1. 后台「支付与交易 → 虚拟支付」完成开通、实名 / 结算资料和协议签署，取得 OfferID / 当前 AppKey。
2. 创建并发布客户端实际使用的商品。当前客户端购买入口只调用
   `shushugo_pro_lifetime`，价格应为 **298 元**，必须与 Worker 的 `29800` 分一致。
   `shushugo_pro_monthly` / `shushugo_pro_yearly` 目前只有服务端价格，客户端没有购买入口。
3. `cloudflare-sync/wrangler.jsonc` 填 `WECHAT_OFFER_ID`；AppKey 不得写入仓库或聊天，使用：

   ```bash
   cd cloudflare-sync
   npx wrangler secret put WECHAT_PAY_APP_KEY
   npx wrangler deploy
   ```

4. 后台「开发 → 消息推送」配置：URL
   `https://api.shushugo.com/api/purchases/wechat-notifications`，数据格式 **JSON**，加密方式明文。
   Token 自己生成，并用 `npx wrangler secret put WECHAT_MSG_TOKEN` 保存同一个值。点「提交」时微信会立即
   向 URL 发 GET 握手，必须通过后才能保存。
5. 检查 `https://api.shushugo.com/api/health`，必须同时满足：
   `wechatPayConfigured=true`、`wechatPushConfigured=true`、`migrationsApplied=true`、
   `productionReady=true`。
6. 沙箱（`WECHAT_PAY_ENV=1`）真机验收：取消支付不发权益、支付成功发权益、重复 verify 不重复发放、
   其他账号不能认领订单、发货通知可补单、退款通知撤销权益、重新登录 / 重装后能恢复。通过后切回
   正式环境（`WECHAT_PAY_ENV=0`），再完成一笔最小范围真实支付与退款验收。

截至 2026-09-21 的已核实状态：OfferID、支付 AppKey、消息推送 Token 均未配置，线上健康检查的
`wechatPayConfigured` / `wechatPushConfigured` / `productionReady` 均为 false；因此开发版可以保留，
但还不能提交审核。

## 上线后

- 监控支付查询、发货通知和退款通知的错误；抽查权益发放与撤销是否和微信订单状态一致。

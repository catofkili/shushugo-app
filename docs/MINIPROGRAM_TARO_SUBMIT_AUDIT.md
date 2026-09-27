# Taro 版小程序提审前审计

审计日期：2026-09-27

代码基线：taro/main @ 4ef4682228ce48f024c6c0e9c045a7694a294b9c

审计分支：taro/w19-submit-audit（本报告不代表已合并、上传或提审）
目标包：taro-spike-2/dist；本轮没有查询线上 Worker / CloudBase，没有部署、上传、提审、扫码或读取学习数据。

## 结论摘要

- **本地构建闸门通过**：Taro 构建、Taro 发布检查与 Taro 测试通过；前端类型检查、lint、测试通过；原生小程序仓库测试通过。包体 10 个分包均低于 1,900,000 B 上限，主包 1,846,883 B，距上限 53,117 B。
- **发现并修复一个明确的上传包缺口**：Taro 生产包虽把周报 mock 置于 DEV 分支，Taro 仍把动态导入的夹具放进产物。本轮在正式构建时将其替换成拒绝调用的 stub，并加哨兵检查；重建后模拟学习数值和标记不再出现在包内。
- **还不能称为可提审**：备案/认证/隐私指引、线上 Worker 与迁移、CloudBase 实际部署、账号注销的服务端结果、类目资质、真实微信多账号组队验收、开发者工具运行和真机均未验证。开发者工具当前 HTTP 自动化服务占用 49985；指定的 9591 未运行。官方 CLI 拒绝在不重启共享 IDE 的情况下切换端口，因此没有打开其他窗口，也没有截图或模拟器验收。
- **需要产品决定的显眼入口**：Taro 上导航栏仍显示“ShuShuGo · 路线 A 试验”；purchase=false 时 Pro 入口仍打开空购买页，登录完成流程仍会尝试领取首月赠送；team=false 没有被实现读取，组队路由和云端调用仍在包内。按任务约束只记录，没有改这些用户可见行为。

## 1. docs-submit.md 硬门槛逐条核对

| 门槛 | 结论 | 证据与剩余动作 |
|---|---|---|
| 小程序备案、微信认证、隐私保护指引后台均通过 | **需用户在后台确认** | 本轮无后台访问。上传前按“备案、认证、用户隐私保护指引”三项均为绿色处理。 |
| Worker 包含登录、同步、权益、组队路由，迁移到 0014，health 为真 | **未验证；当前组队功能仍可达** | 没有查线上 API/D1。docs-submit.md 的 2026-09-24 记录当时 productionReady=false，不能当作 2026-09-27 当前状态。Taro 前端仍调用 /api/teams/*。如果保留组队，用户需按该文档核验 0014、五张表、wechatContentSecurityConfigured、账号验收及举报流程；若要下线组队，需先批准并实现 UI/路由调整。 |
| 最低基础库 2.32.3 | **本地通过；后台需用户确认** | taro-spike-2/project.config.json 已设 libVersion=2.32.3；check:release 将其作为硬闸门。小程序后台“设置→基本设置→基础库最低版本”是独立设置，尚未核对。 |
| 所有产物 API 均不高于 2.32.3 | **静态核对不完整，需开发者工具确认** | 源码可见 wx.login、getSystemInfoSync、getFileSystemManager、setClipboardData、saveImageToPhotosAlbum、shareFileMessage、createInnerAudioContext、云函数/云存储接口；本地文档记录的 WXWebAssembly 2.13.0 与分块 readFile 2.10.0 均低于基线。verify-weapp-apis 检查的是编译产物中的浏览器/Taro API 访问与白名单，不会逐项证明所有 wx.* 接口最低版本。必须在 2.32.3 基线实际运行。 |
| 上传版本替换旧开发版，版本描述、备注准确 | **未上传；版本元数据需用户核对** | 当前 Taro package.json 版本仍是 0.0.0；旧 docs-submit.md 写 0.2.2，不能直接照抄。先在后台确认最近开发版版本，再定下一版号和与实际启用功能一致的版本说明；最后在微信开发者工具上传，不提交审核。 |
| 审核周期 1–7 天 | **不属于本地闸门** | 这是原提交文档的预计时长，不是本轮能确认的事实。 |

### 上传包清理与本地构建

| 项目 | 结论 | 证据 |
|---|---|---|
| 上传目录 | **通过** | project.config.json 的 miniprogramRoot=dist/；上传内容是 Taro 编译包，不是原生 src/。 |
| appid、debug、urlCheck、source map | **通过（静态）** | 配置是正式 appid；app.json 未开启 debug；urlCheck=true；uploadWithSourceMap=false；产物无 .map 与 sourceMappingURL。 |
| 开发诊断、vConsole、计时浮层、测试 Worker 域名、本机地址、密钥 | **本地检查通过，范围有限** | check:release 14 项全通过；覆盖 DEV=true、vConsole/enableDebug、计时标记、live-snapshot、localhost/私网及 link-local IPv4、IPv6 loopback、.local、workers.dev、常见私钥/secret/token 字段。它只扫描 dist 中的 js/json/wxml/wxss/wxs 和 project.config.json，不是全源码审查或运行时验收。 |
| 周报假数据 | **本轮已修复并通过** | 首次产物中发现 mockWeeklyReport 的假学习数量与开发标记仍进入 content-pages 周报 chunk。正式构建现在将该动态模块替换为 no-weekly-mock.weapp.ts stub；mock 源加入 __SHUSHUGO_DEV_ONLY_FIXTURE__ 标记，发布脚本阻止标记回流。重建产物该哨兵命中 0 次，check:release 通过。 |
| 包体 | **通过，主包余量不大** | npm run build:weapp 与 package gate 通过。以下是脚本统计的未压缩字节数，单包上限 1,900,000 B。 |

| 包 | 字节 |
|---|---:|
| main | 1,846,883 |
| study | 299,865 |
| account | 248,854 |
| content-pages | 1,057,854 |
| features | 580,407 |
| content | 1,619,455 |
| grammar-foundation | 668,452 |
| grammar-advanced | 547,376 |
| grammar-pages | 354,910 |
| core | 279,124 |
| lazy | 567,062 |
| 合计 | 8,070,242 |

### 产物路由与隐私配置

| 字段 | 产物值 / 结论 |
|---|---|
| 主包页面 | 4：主页、单词、语法、我的 |
| 分包 | 10 个：study、account、content-pages、features、content、grammar-foundation、grammar-advanced、grammar-pages、core、lazy |
| app.json 注册路由 | 37 个：主包 4、study 9、account 10（含 login）、content-pages 7，另有 7 个 helper/placeholder 包各注册 1 页。 |
| 产品路由表 | 29 个：主包 4、study 9、account 9（不含单独 login 路由）、content-pages 7。 |
| tabBar | 4 个：主页、单词、语法、我的 |
| lazyCodeLoading | 未配置。不能据此断言功能错误；是否需要 requiredComponents 及内存/首屏表现待开发者工具检查。 |
| preloadRule | 四个 tab 均预加载 lazy 与 core，network=all；应在模拟器和弱网环境检查启动成本。 |
| __usePrivacyCheck__ | 未设置。仅凭该字段缺失无法判断当前微信隐私授权流程是否已正确启用或被绕过；仍需对照当前后台隐私指引，在开发者工具与真机核验。 |
| requiredPrivateInfos / permission | 均未设置；本次源码搜索未发现定位接口，当前无需为位置能力添加声明。 |
| app.json.debug | 未开启。 |
| 可见导航栏标题 | **ShuShuGo · 路线 A 试验**。这是用户可见的提审候选文本，必须由用户决定是否换成正式名称；本轮没有擅改。 |

### 隐私接口与指引填写依据

以下为 Taro 包使用的接口与数据流静态盘点。最终以实际上线开关、后台隐私声明和真机行为为准。

| 接口 / 数据 | 包内用途 | 后台指引核对项 |
|---|---|---|
| wx.login | 用户主动登录/关联时取得一次性 code；经 CloudBase api 云函数交给 Worker 换取账号会话 | 声明微信账号登录、OpenID/微信身份标识及用于云同步的账号数据；说明不登录时的本地使用边界。 |
| getSystemInfoSync | 取屏幕尺寸、pixelRatio 等供布局与 Canvas 绘制；代码路径未见上传这些值 | 若仅本地适配，应如实写“本地用于显示适配，不上传”；不得笼统声明为采集/上传设备画像。 |
| wx.cloud.callFunction / api | 登录、同步、权益、组队等业务请求走 CloudBase api 函数，再由其转发到 Worker | 声明账号与用户主动同步的数据流、目的、保存地与境外传输情况；核对隐私政策文字与 CloudBase/Worker 实际部署一致。 |
| wx.cloud.getTempFileURL、wx.cloud.downloadFile、wx.downloadFile、wx.cloud.CDN | 下载词库/清单/音频与同步二进制；快照上传通过 CloudBase CDN 中转 | 说明用户主动开启云同步时学习记录会离开本机；词库、音频下载本身是内容分发。核对数据存储区域、期限、删除规则。 |
| 昵称、队名、学习数量、OpenID | 保留组队时，前端会调用 /api/teams/*；提审文档要求 Worker 做微信内容安全检测 | 若保留组队，隐私指引必须覆盖昵称、队伍、学习数量，以及内容安全检测涉及的 OpenID；并完成真实账号审核与举报处理。 |
| 邮箱地址 | 用户主动绑定已有邮箱账号时发送验证码与关联请求 | 声明仅在用户选用邮箱关联时收集邮箱及用途；确认验证码和账号删除流程。 |
| getFileSystemManager、createOffscreenCanvas、getSetting、authorize、saveImageToPhotosAlbum、shareFileMessage | 本机文件读写与离屏生成分享图；保存相册前读取 scope.writePhotosAlbum 状态并按需请求授权，用户主动保存/分享时才调用 | 声明用户触发的生成、保存或分享行为及其中可能显示的学习统计；本包未发现 chooseImage、chooseMedia、chooseMessageFile 或读取相册接口。 |
| setClipboardData | 用户点复制时写入邀请文本/代码 | 只写剪贴板；未发现 getClipboardData 读取剪贴板。无需把它写成读取用户剪贴板内容。 |
| createInnerAudioContext | 播放词语与提示音频 | 如后台表单要求接口用途，写音频播放；未发现麦克风采集。 |
| requestSubscribeMessage | 适配器含该调用，但 release.reminders=false 且 reminderTemplateId 为空，当前配置不会开放请求 | 当前不是已启用提醒功能；若日后开启，先申请模板、配置 ID 与云函数，再更新隐私说明和订阅说明。 |
| requestVirtualPayment | 支付 runtime 中存在该能力，但 release.purchase=false，产品为空且购买函数先行拒绝；当前没有可执行支付 | 当前不应申报成已开放购买。若用户批准开放支付，须先走 docs-submit.md 全套虚拟支付、价格、Worker 通知与退款验收，并补充订单/交易数据声明。 |
| 位置、相机、麦克风、联系人、读取剪贴板、选图/选文件 | 未发现相关调用 | 当前不需为这些未使用能力虚构声明；每次改开关/加功能时重新扫描。 |

隐私参考：微信官方小程序隐私接口说明：[用户隐私保护指引与隐私接口](https://developers.weixin.qq.com/miniprogram/dev/framework/user-privacy/PrivacyAuthorize.html)。后台入口：[微信公众平台](https://mp.weixin.qq.com/) → 小程序 → 设置 → 服务类目 / 用户隐私保护指引。若政策页面与后台能力清单更新，以账号后台当前表单为准。

### 合法域名、云环境与云函数

| 项目 | 盘点 |
|---|---|
| CloudBase 环境 | Taro 配置 cloudEnv=cloud1-d3g7dauie3961575b；正式资源 FileID 使用同一环境。仅配置存在，不证明该环境当前启用或资源存在。 |
| 云存储对象 | seed/nihongo.db、seed/manifest.json、audio/words 与 audio/words/index.json；构建/运行代码还会请求压缩数据库与派生内容。用户需核验目标环境已上传完整且版本对应的内容。 |
| api 云函数 | 源码 wechat-miniprogram/cloudfunctions/api/index.js；依赖云函数环境 WORKER_ORIGIN=https://api.shushugo.com，把路径限制在 /api/ 后转发。配置见 cloudbaserc.json 与 cloudfunctions/api/config.json；README 有部署说明。本轮未部署/调用。 |
| reminder 云函数 | 源码 wechat-miniprogram/cloudfunctions/reminder；当前 reminders=false 且模板 ID 为空，暂不应视为本次上线必需项。 |
| 小程序直接业务域名 | Taro 的 fetch.weapp.cjs 在 CloudBase 未就绪时 fail closed；当前 cloudEnv 有值，业务请求经 wx.cloud.callFunction 送 api 云函数。共享 wx-promise.js 保留 wx.request 直连 fallback，但当前 Taro 配置路径不应进入它；不要清空 cloudEnv。配置中的 syncUrl、authUrl、paymentUrl 均为空，未发现 Taro 业务流程直连 api.shushugo.com。Worker URL 是云函数服务器端目标，不要误填成小程序直连域名。 |
| 后台域名白名单 | 云函数和云存储的可用性要在真实 CloudBase 环境及小程序端验证；不能仅凭本地配置判断。微信消息推送 URL 只在开通支付推送时需要，当前购买开关关闭。 |

README 的 CloudBase 部署说明不能替代对目标环境的核验。上线前应确认 api 函数版本、环境变量、Worker 可达性、Cloud Storage 文件与内容安全配置；不要在本轮把部署状态当作已知。

### check:release 的覆盖范围

当前 14 项分别检查：无 source map、urlCheck=true、libVersion=2.32.3、真实 appid、app.json 未开启 debug、DEV=false、无本机/内网地址、无 workers.dev、无 vConsole/调试开关、无计时预览标记、无 perf overlay、无开发专用字符串、无周报夹具标记、无已知密钥/token 格式。check-release-smoke 覆盖关键拦截规则及错误配置必须失败。

它仍是产物静态扫描，不会发现任意新命名的诊断 UI、错误的服务端权限、隐私弹窗行为、隐藏在运行时数据里的 URL、账号删除未级联、后端密钥未配置或版本不兼容。原生版 npm test 检的是 wechat-miniprogram/src；Taro 产物要依赖 taro-spike-2 的 build、npm test、check:release，不能用原生测试替代。

## 2. 付费、赠送、协议与账号删除

| 项目 | 结论 | 依据 |
|---|---|---|
| purchase=false 时能否购买 | **不能完成真实购买，但入口仍可见** | initializePurchases 返回空 products；purchaseProduct 在触发支付前返回“微信支付尚未开放”；虚拟支付调用处有开关保护。 |
| Pro 页面 | **需产品决定** | 仍显示“选择 Pro 方案”并进入 Paywall。用户看到的不是有效商品，而是一个未开放购买页。是否隐藏/替换入口属产品文案与流程变化，本轮没有改。 |
| 首月赠送 | **登录后仍可能出现** | AuthDialog.finish 会重新查 launch gift 并自动尝试 claim；Paywall 也能显示领取入口，未登录时提示微信登录后领取。该逻辑不受 purchase=false 保护。需要用户决定保留赠送并确认后端资格/重复领取规则，或批准关闭该入口。 |
| 组队 team=false | **开关无效，真实路由仍在** | 搜索显示 release.team=false 没有消费者；TeamPage 继续加载真实云端队伍/广场并调用 /api/teams/*，不是样例数据。需决定保留并完成组队上线五项硬门槛，或批准在 Taro 版隐藏/禁用此用户可见功能。 |
| 协议与隐私政策登录前可打开 | **静态代码通过；页面运行未验收** | AuthDialog 登录视图内可打开共享 frontend 的协议/隐私正文；创建账号和关联账号需勾选同意。Taro 内容为本地共享文案，不依赖 /api/legal。原生 docs-submit 对 /api/legal 的旧要求不应直接套作 Taro 页面阻塞项；其他登录/同步 Worker 路由仍是依赖。 |
| 注销入口 | **本地有入口，服务端结果未验收** | AccountSecurity 存在“删除账号/永久删除账号”入口并调用 deleteCloudAccount。实际 Worker 删除、关联 D1/队伍/交易处理与重新登录行为需用真实账号核验。 |

如果保留购买入口，原 docs-submit.md 的 OfferID/AppKey、商品、微信消息推送、health 状态、沙箱支付与退款验收全都仍适用；当前静态开关不足以证明后台准备完成。

## 3. 类目判断（不给账号代选）

产品功能同时接近 JLPT 日语学习、词典查询和词汇/语法练习。建议用户在当前账号的服务类目页对照两组候选：

1. **教育类中最贴近语言学习/学习工具的选项**：若该账号类别和资质允许，并且目录条目覆盖自学、练习与学习进度，这是功能主定位的候选。
2. **工具/信息查询类中最贴近词典或查询工具的选项**：若当前目录把离线词典、词汇检索归在工具类，且该类目允许同时出现练习、统计和可选组队，则可比较。

精确类目名称、主体资格及是否要求办学/出版等证明按账号当时可选目录和规则核对；我没有账号主体/资质信息，也未确认当前账户可选列表，所以没有断言某类一定能过。以微信公众平台“小程序→设置→基本设置→服务类目”当前目录及对应资质提示为准。不要只根据“日语学习”字样直接选培训机构或教育平台。

## 4. 从原生包切换到 Taro 上传包的方案

| 项目 | Taro 版方案 / 当前状态 |
|---|---|
| 项目入口 | 在开发者工具打开 taro-spike-2/project.config.json；miniprogramRoot=dist/ 已指向构建产物。继续使用 taro-spike-2，不把 wechat-miniprogram/src 当上传根目录。 |
| 项目身份 | appid 仍是当前正式小程序 appid；描述已改为“提审候选，待外部验收”。projectname 仍含 spike，app.json 导航标题仍含“路线 A 试验”，均待用户确认。 |
| 构建顺序 | 每次上传前先执行 Taro npm ci（依赖有变化才需）、npm run build:weapp、npm run check:release、npm test。确保当前产物和 project.config.json 是同一工作树、同一提交。 |
| 原生 npm test | 保留运行作共享/native 代码回归；它验证 native src，不验证 Taro 的 dist。必须另外通过 Taro 自己的 build/test/check:release。 |
| 版本号与描述 | package.json=0.0.0 不作为微信后台上传版本。先看后台最近开发版，再手动选择递增版本号；重新写符合当前实际功能的版本描述和备注，旧文案提到真实组队/购买时须先解决本文的入口和后端状态。 |
| 上传操作 | 通过微信开发者工具“上传”填写版本号/备注，然后只上传开发版供后台确认；本轮没有上传命令，也没有执行 CLI upload。完成本报告待办之前不提交审核。 |
| 原生源码保留 | Taro 直接复用 wechat-miniprogram/src/config.js、runtime/cloud.js、runtime/wx-promise.js、runtime/text-decoder.js、vendor/sql-wasm.js 与 vendor/fflate.umd.js；也复用 scripts/shared/shims-map、polyfill、部分 content/features 数据、CloudBase api 云函数。配置路径见 frontend/src/lib/{speech,notifications}.weapp.ts、taro-spike-2/src/platform/{fetch,sql-js}.weapp.cjs 与 taro-spike-2/config/index.js。runtime/sqlite.js 本轮静态依赖搜索未发现 Taro 引用；仍属于原生运行时代码，本次不删除。 |
| 可停用部分 | 可在 Taro 切换稳定且验收后评估原生 pages 与 WXML/WXSS 的维护/发布，但不是本次任务；不删除、不改名，也不影响原生测试。 |

Taro 页面采用 shared frontend TSX 与若干 .weapp 适配器。由于本轮无法运行开发者工具，没有可交付的 375×812 实机/模拟器截图，也不能证明页面在微信容器中的视觉 parity。除已知的导航栏“路线 A 试验”标题外，其余平台差异须在开发者工具恢复到指定 9591 后逐页查看；不得把本地编译通过表述成视觉验收。

## 5. 本轮实际验证与未完成项

| 命令/动作 | 结果 |
|---|---|
| taro-spike-2: npm run build:weapp | 通过；重新构建目标 dist。 |
| taro-spike-2: npm run check:release | 通过，14/14。 |
| taro-spike-2: npm test | 通过：异步内容、浏览器运行时、Cloud fetch 中止、release smoke、包体闸门。 |
| frontend: npm run check | 通过。 |
| frontend: npm run lint | 通过，0 errors、43 warnings。 |
| frontend: npm test -- --maxWorkers=2 | 通过：115 passed、2 skipped；814 passed、26 skipped。初次并发默认运行时出现超时/初始化错误，受控重跑通过，最终结果以受控重跑为准。 |
| wechat-miniprogram: npm test | 通过，30 个检查脚本；native 包体统计 4,295,179 B。此结果不代替 Taro 包验证。 |
| git diff --check | 通过。 |
| 微信开发者工具 / 9591 | **未通过外部视觉/模拟器检查**。只读检查显示指定端口 9591 未监听；官方 CLI 报告现有共享 IDE HTTP 服务在 49985，要求先重启才能改到 9591。公共规则禁止关闭共享 IDE，故未重启、未操作其他项目窗口、未截图。 |

## 用户要在微信后台做的事

1. **备案、认证、隐私指引**：在小程序后台确认三项当前为通过。依据上面的 API 表，逐项填写登录/OpenID、可选云同步的学习记录、用户选用邮箱关联时的邮箱、（若保留组队）昵称/队伍/学习数量及内容安全检测所需 OpenID；注明系统信息只用于本地显示适配（若后台表单要求申报）；说明用户主动生成/保存/分享的学习统计图或备份文件。不要声明本包没有的选图、定位、摄像头、录音或读取剪贴板能力。团队/支付/订阅开关如日后改变，同步更新声明。
2. **决定是否保留组队**：若保留，确认线上已执行 0014、五张表齐全，Worker health 的组队/内容安全字段为真，用两个真实账号走通创建/加入/邀请/同步/加油去重/退出/移交/解散/举报；若停用，请批准对应 UI/路由改动后再准备上传。
3. **决定 Pro 入口和首月赠送**：当前购买不可用，但 Pro CTA 和领取赠送流程仍可见/触发。确认展示策略与赠送资格规则；若要隐藏，请批准 Taro 页面调整。若要开放购买，逐条完成 docs-submit.md 虚拟支付的正式闸门。
4. **确认账号删除**：后台/Worker 侧核实注销能处理账号、同步记录及其他关联数据，且成功后无法用旧会话恢复；使用受控测试账号走完整删除流程。
5. **核验 CloudBase**：确认 cloud1-d3g7dauie3961575b 环境仍可用；api 云函数已按当前源码部署并设置 WORKER_ORIGIN；内容库、manifest、音频文件已上传且版本匹配；Worker 登录/同步/权益路由可达。reminder 当前关闭，不必为此轮申请模板。
6. **设置基础库**：在小程序后台最低基础库设 2.32.3；开发工具也选 2.32.3，再完成真实模拟器流程。当前 DevTools 的 9591 被端口状态阻挡；先由使用者安排共享 IDE 释放/重启到 9591，再仅打开本项目完成视觉与运行验收。
7. **选服务类目**：在“小程序→设置→基本设置→服务类目”核对教育学习工具与词典/查询工具的可选项、主体资质和限制；由账号主体负责人确认最终类目。
8. **确认提交流程信息**：检查最近开发版后定上传版本号与准确备注/版本描述；明确是否正式更改“路线 A 试验”导航标题、projectname；完成以上内外部闸门后再由开发者工具上传开发版。本轮没有上传、部署或合并。

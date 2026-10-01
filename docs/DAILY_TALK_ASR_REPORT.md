# 开口练习：小程序日语转写实现与验收（2026-10-02）

本任务在 `shushugo-wt/talk-asr` / `codex/talk-asr` 内完成。未提交、未合并、未访问主目录或 5173，
未部署云函数、修改云端配置、上传小程序或提审。以下区分源码检查、模拟器 fixture 和真实录音证据。

## 实现与选择

- 新增 `wechat-miniprogram/cloudfunctions/talk-asr/`，用 **腾讯云官方 `tencentcloud-sdk-nodejs-asr` SDK**
  （4.1.315，放在 dependencies，部署时云端安装）。没有手写签名。SDK 负责 TC3-HMAC-SHA256，
  HTTP 层用自带的 node-fetch，不依赖 Node 16 没有的全局 fetch；比维护自定义签名代码更简单。
- 固定 `ap-shanghai`、`SentenceRecognition`、`16k_ja`、`SourceType=1`、MP3，`DataLen` 是解码后的字节数。
  仅接受有 WXContext.OPENID 的调用；先限制 base64 长度再解码，最多 600 KiB；格式和编码非法直接拒绝。
- SecretId / SecretKey 只读函数环境变量。缺任一个直接 `not_configured`，没有调用腾讯云。
  成功只回 `{ text }`，腾讯云失败只回 `{ error: "asr_failed", code }`，不回错误正文或请求，代码没有音频/密钥日志。
- 小程序接口与网页同名同签名，增加可选第四参数 `onStatus("recognizing")`；网页不触发它。
  小程序先 `wx.authorize(scope.record)`，录音 MP3 / 16kHz / 单声道 / 48kbps / 15 秒；
  停止后实际 readFile(base64) → callFunction(`talk-asr`) → onText → onEnd。
- 错误映射到 `not-allowed`、`no-speech`、`not-configured`、`too-long`、`no-match`。
  只认明确的 FUNCTION_NOT_FOUND/函数不存在，不能把所有 -501000 或断网都当成未部署。
  `not-configured` 后本次进程的能力检测返回 false；页面提示并隐藏按钮。
- 共享 `PracticeCard` 显示/禁用「识别中…」，所有结束路径恢复状态，晚到的旧卡回调有原有 generation 防护。
  `talk.css` 明确设置识别状态文字颜色：实看模拟器发现微信禁用按钮默认白字在浅底上不可读，已修正。

### 必须保留的录音器兼容判断

**微信开发者工具基础库 2.32.3 的 RecorderManager 没有 offStart/offStop/offError**（运行时实际检查）。
最初按其它平台的 API 写 off* 会在停止时抛错。现在只注册一次监听，结束后清空当前回调；
不要改回「每次 listen 注册一组 + off* 清理」，也不要只用带 off* 的 mock 当成微信真实能力。
单元测试的录音器刻意没有 off*，并验证第二次使用仍只注册一次监听。

## 验收输出

完整构建输出、测试输出与截图放在忽略目录 `taro-spike-2/reports/talk-weapp/`。
这些材料供本机审阅，不进入提交，也不代表云端或真机验收。

- 前端：`check.log`、`lint.log`、`vitest.log`。
- 实验构建 / 预期拒绝发布：`build-experimental.log`、`release-experimental.log`。
- 默认构建 / 发布检查 / Taro 测试：`build-default.log`、`release-default.log`、`taro-test.log`。
- 原生小程序全部脚本：`native-test.log`，其中包含新增 `talk-asr-smoke`。

最终命令全部执行，退出码符合预期：

```text
frontend npm run check: tsc --noEmit，exit 0
frontend npm run lint: 45 problems (0 errors, 45 warnings)，exit 0
vitest src/lib/talk: Test Files 9 passed (9); Tests 77 passed (77)
SHUSHUGO_EXP_TALK=1 build:weapp: 编译、包体/平台闸门通过，exit 0
实验包 check-release: 拒绝 talk 页 / __SHUSHUGO_EXP_TALK__ 代码，共 2 项，exit 1（预期）
默认 build:weapp: 编译、包体/平台闸门通过，exit 0
默认 check:release: 上传前检查通过，exit 0
Taro npm test: 全部通过，package-gates passes: true，exit 0
wechat-miniprogram npm test: 32 个脚本全部通过，exit 0
```

随后执行了用户要求的 `git checkout -- reports`，恢复受追踪的构建报告；
最终 dist 保持**无实验开关的默认包**。CLI 在 9641 重新编译默认包，清除自动化临时 mock。
无需提交构建生成的图标、品牌资源或 reports 差异；这些在默认构建后都已恢复。
未看到此项改动的新增 lint 警告，45 条来自既有页面。

## 视觉与开发者工具证据

网页在独立 **5199** 端口、独立 Chromium 上下文、375×812 检查；没有读取用户浏览器或个人学习库。
`web-02-card.png` 中「说一句」、提示、翻面均可见；无横向溢出、无 JS 异常。

开发者工具使用本 worktree 的 `taro-spike-2`，`cli auto --auto-port 9641`，基础库 2.32.3。
`mini-01-say.png` 证实真实页面出现「说一句」。**按钮显示「在听…」是页面的乐观状态，不能证明录音已经开始。**

真实授权尝试：`wx.authorize(scope.record)` 没有 success/fail 回调，自动化 `authorizeAllow` 后也没有回调；
`getSetting` 里没有 `scope.record`，原生电脑工具无法取得开发者工具窗口（cgWindowNotFound），不能实际点击允许。
没有改系统麦克风设置、基础库或任何云端权限。`mini-flow.log` / `mini-auth-probe.png` 留存这条缺口。

补充 fixture 检查（**不算真实录音验收**）：模拟 authorize 成功和 recorder start/stop，用本模拟器的临时合成文件，
**FileSystemManager.readFile 和未部署的 wx.cloud.callFunction 仍是真实调用**。
fixture 文件检查后删除；mock 在后续默认包重建 / 工具重新编译后清除。
`mini-flow-fixture.log` 记录标准录音参数、停止、识别中禁用、未开通提示和按钮消失；
`mini-fixture-01-say.png`、`mini-fixture-02-recording.png`、`mini-fixture-03-recognizing.png`、
`mini-fixture-04-not-configured.png` 为对应画面。

真实云函数空音频探针返回 `-501000 / FunctionName parameter could not be found / FUNCTION_NOT_FOUND`。
这只证明 talk-asr 当前未部署及客户端识别错误所需的真实错误格式，不代表调用过腾讯云 ASR。

## 作者后续步骤

按 [`wechat-miniprogram/README.md`](../wechat-miniprogram/README.md)「开口练习的语音识别」执行：
开通语音识别 → 只给专用子账号 QcloudASRFullAccess → 生成密钥 → 指定环境部署 talk-asr →
用 `tcb config update fn talk-asr` 将两个变量推到函数环境 → 隐私指引补录音用途。
必须先补做允许录音后的真实模拟器 / 真机验收，再做真实日语转写与计费账户验收。
编译开关和发布闸门保持原样，实验包不能上传。

## 尚未完成

- 真实录音开始/停止、授权弹窗点击：卡在上述模拟器授权和不可见窗口，未以 fixture 冒充通过。
- 真实腾讯云日语识别：按用户约束，需作者开通服务、配置密钥并部署后验收；本任务没有调用 ASR。
- 部署、上传、提审、提交：明确不属于此次授权范围，没有执行。

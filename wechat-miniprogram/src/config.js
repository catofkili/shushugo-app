// 生产环境必须使用已经备案并加入小程序业务域名白名单的 HTTPS 地址。
// 真机验证/正式发布前填写已备案 HTTPS 地址；不要把 11MB 词库塞进代码包。
module.exports = {
  // 云开发环境 ID（如 'shushugo-1a2b3c'）。填了之后：http(s) 接口走云函数 api 转发到 Worker，
  // 云函数 / 云存储不需要业务域名备案；下面各 URL 可以填 cloud:// 开头的云存储 fileID。
  // Worker 真实地址配在云函数 api 的环境变量 WORKER_ORIGIN 里，客户端这边只保留路径。
  cloudEnv: 'cloud1-d3g7dauie3961575b',
  seedDatabaseUrl: 'cloud://cloud1-d3g7dauie3961575b.636c-cloud1-d3g7dauie3961575b-1491634527/seed/nihongo.db',
  seedDatabasePath: '',
  // 内容更新 manifest 只描述版本、数据库 URL、字节数和词条数；不把大库放进代码包。
  contentManifestUrl: 'cloud://cloud1-d3g7dauie3961575b.636c-cloud1-d3g7dauie3961575b-1491634527/seed/manifest.json',
  audioBaseUrl: 'cloud://cloud1-d3g7dauie3961575b.636c-cloud1-d3g7dauie3961575b-1491634527/audio/words',
  audioIndexUrl: 'cloud://cloud1-d3g7dauie3961575b.636c-cloud1-d3g7dauie3961575b-1491634527/audio/words/index.json',
  // 同步接口必须使用已备案 HTTPS 域名，留空时客户端保持纯离线。
  syncUrl: 'https://api.shushugo.com',
  entitlementUrl: 'https://api.shushugo.com/api/entitlements',
  // 虚拟支付走 Worker 的 /api/pay/wechat/*，留空就用 syncUrl；客户端不会自行生成任何签名。
  paymentUrl: '',
  authUrl: 'https://api.shushugo.com',
  // 与 cloudflare-sync Worker 发布的协议版本保持一致；新微信账号首次登录
  // 必须明确同意当前协议，服务端不会接受缺失版本的注册。
  termsVersion: '2026-08-03',
  privacyVersion: '2026-09-20'
};

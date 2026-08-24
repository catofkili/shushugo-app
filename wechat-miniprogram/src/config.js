// 生产环境必须使用已经备案并加入小程序业务域名白名单的 HTTPS 地址。
// 真机验证/正式发布前填写已备案 HTTPS 地址；不要把 11MB 词库塞进代码包。
module.exports = {
  seedDatabaseUrl: '',
  seedDatabasePath: '',
  // 内容更新 manifest 只描述版本、数据库 URL、字节数和词条数；不把大库放进代码包。
  contentManifestUrl: '',
  audioBaseUrl: '',
  audioIndexUrl: '',
  // 同步接口必须使用已备案 HTTPS 域名，留空时客户端保持纯离线。
  syncUrl: '',
  entitlementUrl: '',
  paymentUrl: '',
  // 服务端下单接口；客户端不会自行生成微信支付签名。
  paymentPath: '/api/pay/orders',
  authUrl: '',
  // 与 cloudflare-sync Worker 发布的协议版本保持一致；新微信账号首次登录
  // 必须明确同意当前协议，服务端不会接受缺失版本的注册。
  termsVersion: '2026-08-03',
  privacyVersion: '2026-08-03'
};

// 登录 / 注册 / 绑定只需要版本，不应因此把协议全文带进小程序主包。
// 版本是服务端验收的同意记录标识，不是文案生效日期：升级必须先部署服务端、再发客户端，旧客户端会被挡。
// 2026-10-13 的隐私文字修订只更新生效日期，仍沿用以下版本；原因详见 privacy-policy-content.ts 的历史说明。
export const PRIVACY_POLICY_VERSION = "2026-09-27";
export const USER_AGREEMENT_VERSION = "2026-09-22";

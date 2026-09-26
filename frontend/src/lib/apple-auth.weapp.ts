import type { AppleLoginCredential, CloudAuthConfig } from "./sync-api";

export async function requestAppleCredential(_config: CloudAuthConfig): Promise<AppleLoginCredential> {
  throw new Error("Apple 登录在微信小程序中不可用，请使用微信登录或邮箱验证码关联账号。");
}

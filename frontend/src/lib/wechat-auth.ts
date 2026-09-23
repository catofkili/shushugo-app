import { Capacitor, registerPlugin } from "@capacitor/core";
import type { CloudAuthConfig } from "./sync-api";

interface WechatAuthPlugin {
  authorize(options: { scope: "snsapi_userinfo"; state: string }): Promise<{ code?: string; state?: string }>;
}

const WechatAuth = registerPlugin<WechatAuthPlugin>("WechatAuth");

export const isWechatAppLoginAvailable = (config: CloudAuthConfig) =>
  config.wechatAppEnabled
  && Capacitor.isNativePlatform()
  && Capacitor.isPluginAvailable("WechatAuth");

export const requestWechatAppCode = async (config: CloudAuthConfig): Promise<string> => {
  if (!isWechatAppLoginAvailable(config)) throw new Error("微信登录尚未在此 App 中配置完成。");

  const state = crypto.randomUUID();
  const result = await WechatAuth.authorize({ scope: "snsapi_userinfo", state });
  if (!result.code) throw new Error("微信没有返回授权凭据，请重试。");
  if (result.state !== state) throw new Error("微信登录状态校验失败，请重新发起登录。");
  return result.code;
};

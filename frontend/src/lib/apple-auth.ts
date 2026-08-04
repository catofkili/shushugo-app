import { Capacitor } from "@capacitor/core";
import { SignInWithApple } from "@capacitor-community/apple-sign-in";
import type { AppleLoginCredential, CloudAuthConfig } from "./sync-api";
import { getCloudApiUrl } from "./sync-api";

const appleRedirectUri = () => {
  const configured = import.meta.env.VITE_APPLE_REDIRECT_URI as string | undefined;
  if (configured) return configured;
  const apiUrl = getCloudApiUrl();
  return apiUrl ? `${apiUrl}/auth/apple/callback` : "https://example.invalid/auth/apple/callback";
};

export const requestAppleCredential = async (config: CloudAuthConfig): Promise<AppleLoginCredential> => {
  const clientId = config.appleClientId || import.meta.env.VITE_APPLE_CLIENT_ID;
  if (!clientId) throw new Error("Apple 登录尚未配置 Client ID。");
  if (!Capacitor.isNativePlatform() && !import.meta.env.VITE_APPLE_REDIRECT_URI) {
    throw new Error("网页预览尚未配置 Apple 回调地址，请在 iOS 真机中测试 Apple 登录。");
  }

  const nonce = crypto.randomUUID();
  const result = await SignInWithApple.authorize({
    clientId,
    redirectURI: appleRedirectUri(),
    scopes: "email name",
    state: crypto.randomUUID(),
    nonce
  });
  const response = result.response;
  if (!response.identityToken) throw new Error("Apple 没有返回身份凭据，请重试。");
  const displayName = [response.givenName, response.familyName].filter(Boolean).join("").trim() || undefined;
  return {
    identityToken: response.identityToken,
    nonce,
    email: response.email ?? undefined,
    displayName
  };
};

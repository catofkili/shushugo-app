import { Preferences } from "@capacitor/preferences";
import { exportDatabase, importDatabase } from "./database";
import { clearEntitlements, getEntitlements, ProductId, saveEntitlements, type EntitlementState } from "./entitlements";
import { saveDatabase } from "./storage";
import { ensureSeedData } from "./study-core";

export interface CloudSession {
  configured: boolean;
  email?: string;
  token?: string;
  emailVerified?: boolean;
}

interface TokenResponse {
  access_token: string;
  email: string;
  emailVerified?: boolean;
  entitlements?: CloudEntitlements;
}

interface PullResponse {
  db_data: string;
  last_modified: string;
}

interface CloudEntitlements {
  isPro: boolean;
  source: string;
  productId?: ProductId;
  expiresAt?: string;
  updatedAt: string;
}

const API_URL = (import.meta.env.VITE_SYNC_API_URL ?? "").replace(/\/+$/g, "");
const TOKEN_KEY = "mn_cloud_sync_token";
const EMAIL_KEY = "mn_cloud_sync_email";
const EMAIL_VERIFIED_KEY = "mn_cloud_sync_email_verified";

const bytesToBase64 = (data: Uint8Array): string => {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < data.length; index += chunkSize) {
    binary += String.fromCharCode(...data.slice(index, index + chunkSize));
  }
  return btoa(binary);
};

const base64ToBytes = (base64: string): Uint8Array => {
  const binary = atob(base64);
  const data = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    data[index] = binary.charCodeAt(index);
  }
  return data;
};

const requireConfigured = () => {
  if (!API_URL) {
    throw new Error("还没有配置云同步地址。请先设置 VITE_SYNC_API_URL。");
  }
};

const requestJson = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
  requireConfigured();
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...init.headers
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof data?.detail === "string" ? data.detail : `请求失败：${response.status}`);
  }
  return data as T;
};

const applyCloudEntitlements = (data?: CloudEntitlements): EntitlementState | undefined => {
  if (!data) return undefined;
  return saveEntitlements({
    isPro: data.isPro,
    source: data.isPro ? "cloud" : "free",
    productId: data.productId,
    expiresAt: data.expiresAt
  });
};

export async function getCloudSession(): Promise<CloudSession> {
  const [{ value: storedToken }, { value: storedEmail }, { value: emailVerified }] = await Promise.all([
    Preferences.get({ key: TOKEN_KEY }),
    Preferences.get({ key: EMAIL_KEY }),
    Preferences.get({ key: EMAIL_VERIFIED_KEY })
  ]);
  return {
    configured: Boolean(API_URL),
    token: storedToken ?? undefined,
    email: storedEmail ?? undefined,
    emailVerified: emailVerified === "true"
  };
}

async function saveCloudSession(data: TokenResponse) {
  await Preferences.set({ key: TOKEN_KEY, value: data.access_token });
  await Preferences.set({ key: EMAIL_KEY, value: data.email });
  await Preferences.set({ key: EMAIL_VERIFIED_KEY, value: data.emailVerified ? "true" : "false" });
  applyCloudEntitlements(data.entitlements);
}

export async function cloudRegister(email: string, password: string, displayName?: string): Promise<CloudSession> {
  const data = await requestJson<TokenResponse>("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ email, password, display_name: displayName })
  });
  await saveCloudSession(data);
  return getCloudSession();
}

export async function cloudLogin(email: string, password: string): Promise<CloudSession> {
  const data = await requestJson<TokenResponse>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password })
  });
  await saveCloudSession(data);
  return getCloudSession();
}

export async function cloudLogout(): Promise<CloudSession> {
  const { token } = await getCloudSession();
  if (token) {
    await requestJson("/api/auth/logout", {
      method: "POST",
      headers: { authorization: `Bearer ${token}` }
    }).catch(() => undefined);
  }
  await Preferences.remove({ key: TOKEN_KEY });
  await Preferences.remove({ key: EMAIL_KEY });
  await Preferences.remove({ key: EMAIL_VERIFIED_KEY });
  return getCloudSession();
}

export async function deleteCloudAccount(password: string): Promise<CloudSession> {
  const { token } = await getCloudSession();
  if (!token) throw new Error("请先登录云同步账号。");
  await requestJson("/api/auth/delete-account", {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify({ password })
  });
  await Preferences.remove({ key: TOKEN_KEY });
  await Preferences.remove({ key: EMAIL_KEY });
  await Preferences.remove({ key: EMAIL_VERIFIED_KEY });
  // 云端权益随账号一起删除;本地缓存的 cloud 来源权益也要回退,
  // App Store 购买仍可通过"恢复购买"重新激活。
  if (getEntitlements().source === "cloud") {
    clearEntitlements();
  }
  return getCloudSession();
}

export async function sendCloudVerificationEmail(): Promise<string> {
  const { token } = await getCloudSession();
  if (!token) throw new Error("请先登录云同步账号。");
  await requestJson("/api/auth/send-verification-email", {
    method: "POST",
    headers: { authorization: `Bearer ${token}` }
  });
  return "验证码已发送到你的邮箱。";
}

export async function verifyCloudEmail(code: string): Promise<CloudSession> {
  const { token } = await getCloudSession();
  if (!token) throw new Error("请先登录云同步账号。");
  await requestJson("/api/auth/verify-email", {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify({ code })
  });
  await Preferences.set({ key: EMAIL_VERIFIED_KEY, value: "true" });
  return getCloudSession();
}

export async function requestCloudPasswordReset(email: string): Promise<string> {
  await requestJson("/api/auth/request-password-reset", {
    method: "POST",
    body: JSON.stringify({ email })
  });
  return "如果该邮箱已注册，验证码会发送到邮箱。";
}

export async function resetCloudPassword(email: string, code: string, newPassword: string): Promise<string> {
  await requestJson("/api/auth/reset-password", {
    method: "POST",
    body: JSON.stringify({ email, code, new_password: newPassword })
  });
  return "密码已重置，请使用新密码登录。";
}

export async function refreshCloudEntitlements(): Promise<EntitlementState | undefined> {
  const { token } = await getCloudSession();
  if (!token) return undefined;
  const data = await requestJson<CloudEntitlements>("/api/entitlements", {
    method: "GET",
    headers: { authorization: `Bearer ${token}` }
  });
  // 云端"非 Pro"不能覆盖本地 StoreKit 权益:买断/订阅可能还没在云端核验过
  // (比如服务端未配置 Apple 密钥)。本地过期由 getEntitlements 自身处理。
  if (data && !data.isPro && getEntitlements().source === "storekit") {
    return undefined;
  }
  return applyCloudEntitlements(data);
}

export async function verifyCloudPurchase(productId: ProductId, transactionId: string): Promise<EntitlementState | undefined> {
  const { token } = await getCloudSession();
  if (!token) return undefined;
  const data = await requestJson<CloudEntitlements>("/api/purchases/verify", {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify({ product_id: productId, transaction_id: transactionId })
  });
  return applyCloudEntitlements(data);
}

export async function pushCloudBackup(): Promise<string> {
  const { token } = await getCloudSession();
  if (!token) throw new Error("请先登录云同步账号。");

  const data = exportDatabase();
  if (!data) throw new Error("当前没有可上传的本地数据库。");

  await requestJson("/api/sync/push", {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify({ db_data: bytesToBase64(data), last_modified: new Date().toISOString() })
  });
  return "云端备份已上传。";
}

export async function pullCloudBackup(): Promise<string> {
  const { token } = await getCloudSession();
  if (!token) throw new Error("请先登录云同步账号。");

  const data = await requestJson<PullResponse>("/api/sync/pull", {
    method: "GET",
    headers: { authorization: `Bearer ${token}` }
  });
  // 校验云端 blob 是本 App 的数据库,防止损坏数据覆盖本地进度;
  // 恢复的备份可能来自旧版本,需要重跑种子迁移。
  await importDatabase(base64ToBytes(data.db_data), { validateBackup: true });
  await ensureSeedData();
  await saveDatabase();
  return `已恢复云端备份：${new Date(data.last_modified).toLocaleString()}`;
}

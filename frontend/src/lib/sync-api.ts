import { Preferences } from "@capacitor/preferences";
import { exportDatabase, importDatabase } from "./database";
import { ProductId, saveEntitlements, type EntitlementState } from "./entitlements";
import { saveDatabase } from "./storage";

export interface CloudSession {
  configured: boolean;
  email?: string;
  token?: string;
}

interface TokenResponse {
  access_token: string;
  email: string;
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
  const [{ value: token }, { value: email }] = await Promise.all([
    Preferences.get({ key: TOKEN_KEY }),
    Preferences.get({ key: EMAIL_KEY })
  ]);
  return { configured: Boolean(API_URL), token: token ?? undefined, email: email ?? undefined };
}

export async function cloudRegister(email: string, password: string, displayName?: string): Promise<CloudSession> {
  const data = await requestJson<TokenResponse>("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ email, password, display_name: displayName })
  });
  await Preferences.set({ key: TOKEN_KEY, value: data.access_token });
  await Preferences.set({ key: EMAIL_KEY, value: data.email });
  applyCloudEntitlements(data.entitlements);
  return getCloudSession();
}

export async function cloudLogin(email: string, password: string): Promise<CloudSession> {
  const data = await requestJson<TokenResponse>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password })
  });
  await Preferences.set({ key: TOKEN_KEY, value: data.access_token });
  await Preferences.set({ key: EMAIL_KEY, value: data.email });
  applyCloudEntitlements(data.entitlements);
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
  return getCloudSession();
}

export async function refreshCloudEntitlements(): Promise<EntitlementState | undefined> {
  const { token } = await getCloudSession();
  if (!token) return undefined;
  const data = await requestJson<CloudEntitlements>("/api/entitlements", {
    method: "GET",
    headers: { authorization: `Bearer ${token}` }
  });
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
  await importDatabase(base64ToBytes(data.db_data));
  await saveDatabase();
  return `已恢复云端备份：${new Date(data.last_modified).toLocaleString()}`;
}

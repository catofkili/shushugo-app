import { Preferences } from "@capacitor/preferences";
import { getDatabase } from "./database";
import { clearEntitlements, getEntitlements, ProductId, saveEntitlements, type EntitlementState } from "./entitlements";
import { flushPendingSave, getLocalDataRevision, saveDatabase } from "./storage";
import { notifyProgressUpdated } from "./progress-events";
import { ensureSeedData } from "./study-core";
import { ensureSyncSchema, getDeviceId } from "./sync/schema";
import { mergeDatabaseBytes } from "./sync/merge";
import {
  compressSyncSnapshot,
  decompressSyncSnapshot,
  exportSyncSnapshot,
  SYNC_SNAPSHOT_FORMAT,
  type SyncSnapshotCompression
} from "./sync/snapshot";
import { PRIVACY_POLICY_VERSION } from "./privacy-policy-content";
import { USER_AGREEMENT_VERSION } from "./user-agreement-content";
import { getCloudAccessToken, removeCloudAccessToken, setCloudAccessToken } from "./secure-token";

export interface CloudSession {
  configured: boolean;
  email?: string;
  token?: string;
  emailVerified?: boolean;
  displayName?: string;
  authProviders?: Array<"email" | "apple">;
  isNewAccount?: boolean;
}

interface TokenResponse {
  access_token: string;
  email: string;
  emailVerified?: boolean;
  displayName?: string;
  authProviders?: Array<"email" | "apple">;
  isNewAccount?: boolean;
  entitlements?: CloudEntitlements;
}

export interface CloudAuthConfig {
  appleEnabled: boolean;
  appleClientId?: string | null;
  turnstileEnabled: boolean;
}

export interface CloudUserProfile {
  email: string;
  display_name?: string | null;
  bio?: string | null;
  target_level?: string | null;
  avatar?: string | null;
  profile_updated_at?: string | null;
  email_verified_at?: string | null;
  authProviders?: Array<"email" | "apple">;
}

interface PullResponse {
  db_data: string;
  last_modified: string;
  generation?: number;
}

interface CloudSnapshotPayload {
  bytes: Uint8Array;
  lastModified: string;
  generation?: number;
  format: string;
  compression: SyncSnapshotCompression;
}

interface PushResponse {
  timestamp: string;
  generation?: number;
}

interface SyncStatusResponse {
  available: boolean;
  last_modified: string | null;
  byte_length: number;
  generation?: number;
}

interface CloudSyncState {
  lastSyncedGeneration?: number;
  lastSyncedModified?: string;
  localDirty: boolean;
  conflictModified?: string;
}

export type CloudSyncStatus = "skipped" | "idle" | "uploaded" | "downloaded" | "merged" | "conflict" | "error";

export interface CloudSyncEventDetail {
  status: CloudSyncStatus;
  automatic: boolean;
  message?: string;
}

export type CloudSyncTrigger = "startup" | "login" | "foreground" | "online" | "poll" | "local-change";

interface CloudEntitlements {
  isPro: boolean;
  source: string;
  productId?: ProductId;
  expiresAt?: string;
  updatedAt: string;
}

const API_URL = (import.meta.env.VITE_SYNC_API_URL ?? "").replace(/\/+$/g, "");
const EMAIL_KEY = "mn_cloud_sync_email";
const EMAIL_VERIFIED_KEY = "mn_cloud_sync_email_verified";
const DISPLAY_NAME_KEY = "mn_cloud_display_name";
const AUTH_PROVIDERS_KEY = "mn_cloud_auth_providers";
const SYNC_STATE_KEY_PREFIX = "mn_cloud_sync_state:";
const LOCAL_SYNC_OWNER_KEY = "mn_cloud_sync_owner_email";
export const CLOUD_SYNC_EVENT = "master-nihongo-cloud-sync";
export const CLOUD_SYNC_REQUEST_EVENT = "master-nihongo-cloud-sync-request";
export const CLOUD_AUTH_EVENT = "master-nihongo-cloud-auth";
// 当前同步传输的是整份 SQLite 快照。先等待用户停止连续操作，再上传；
// 同一前台会话最多每 5 分钟自动上传一次，避免每答一道题都发送整库。
const AUTO_SYNC_DEBOUNCE_MS = 30_000;
const AUTO_SYNC_MIN_UPLOAD_INTERVAL_MS = 5 * 60_000;
const AUTO_SYNC_MIN_CHECK_INTERVAL_MS = 60_000;
const AUTO_SYNC_POLL_MS = 5 * 60_000;

let autoSyncInFlight: Promise<CloudSyncEventDetail> | null = null;
let autoSyncTimer: ReturnType<typeof setTimeout> | null = null;
let localChangePending = false;
let autoSyncLifecycleRegistered = false;
let syncLock: Promise<void> = Promise.resolve();
let lastCloudUploadAt = 0;
let lastAutoSyncCheckAt = 0;
let autoSyncBlockedUntil = 0;

type CloudSyncLifecycleWindow = Window & {
  __masterNihongoCloudSyncCleanup?: () => void;
};

export class CloudRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly data: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = "CloudRequestError";
  }
}

export const isCloudErrorCode = (error: unknown, code: string): boolean => (
  error instanceof CloudRequestError && error.data.code === code
);

export const getCloudApiUrl = () => API_URL;

const base64ToBytes = (base64: string): Uint8Array => {
  const binary = atob(base64);
  const data = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    data[index] = binary.charCodeAt(index);
  }
  return data;
};

const bytesToArrayBuffer = (data: Uint8Array): ArrayBuffer => (
  data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer
);

const requireConfigured = () => {
  if (!API_URL) {
    throw new Error("还没有配置云同步地址。请先设置 VITE_SYNC_API_URL。");
  }
};

const requestJson = async <T>(path: string, init: RequestInit = {}, timeoutMs = 15_000): Promise<T> => {
  requireConfigured();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${API_URL}${path}`, {
      ...init,
      signal: init.signal ?? controller.signal,
      headers: {
        "content-type": "application/json",
        ...init.headers
      }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new CloudRequestError(
        response.status,
        typeof data?.detail === "string" ? data.detail : `请求失败：${response.status}`,
        data as Record<string, unknown>
      );
    }
    return data as T;
  } finally {
    clearTimeout(timeout);
  }
};

const requestCloudSnapshot = async (session: CloudSession): Promise<CloudSnapshotPayload> => {
  if (!session.token) throw new Error("请先登录云同步账号。");
  requireConfigured();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);
  try {
    const response = await fetch(`${API_URL}/api/sync/pull`, {
      method: "GET",
      headers: {
        authorization: `Bearer ${session.token}`,
        accept: "application/octet-stream"
      },
      signal: controller.signal
    });
    const contentType = response.headers.get("content-type") ?? "";
    if (!response.ok) {
      const data = contentType.includes("application/json")
        ? await response.json().catch(() => ({})) as Record<string, unknown>
        : {};
      throw new CloudRequestError(
        response.status,
        typeof data.detail === "string" ? data.detail : `请求失败：${response.status}`,
        data
      );
    }

    // 兼容尚未升级的 Worker：旧接口返回 Base64 JSON；新接口直接返回压缩二进制。
    if (contentType.includes("application/json")) {
      const legacy = await response.json() as PullResponse;
      return {
        bytes: base64ToBytes(legacy.db_data),
        lastModified: legacy.last_modified,
        generation: legacy.generation,
        format: "legacy-full-sqlite",
        compression: "none"
      };
    }

    const compressionHeader = response.headers.get("x-sync-compression");
    const compression: SyncSnapshotCompression = compressionHeader === "gzip" ? "gzip" : "none";
    const compressed = new Uint8Array(await response.arrayBuffer());
    const lastModified = response.headers.get("x-sync-last-modified") ?? "";
    if (!lastModified) throw new Error("云端学习数据缺少版本时间，已保留本机数据。");
    const generationHeader = response.headers.get("x-sync-generation");
    const parsedGeneration = generationHeader === null ? NaN : Number(generationHeader);
    return {
      bytes: await decompressSyncSnapshot(compressed, compression),
      lastModified,
      generation: Number.isFinite(parsedGeneration) ? parsedGeneration : undefined,
      format: response.headers.get("x-sync-format") ?? "legacy-full-sqlite",
      compression
    };
  } finally {
    clearTimeout(timeout);
  }
};

const syncStateKey = (email: string) => `${SYNC_STATE_KEY_PREFIX}${encodeURIComponent(email)}`;

const getSyncState = async (email: string): Promise<CloudSyncState> => {
  const { value } = await Preferences.get({ key: syncStateKey(email) });
  if (!value) return { localDirty: false };
  try {
    const state = JSON.parse(value) as Partial<CloudSyncState>;
    return {
      lastSyncedGeneration: Number.isFinite(Number(state.lastSyncedGeneration))
        ? Number(state.lastSyncedGeneration)
        : undefined,
      lastSyncedModified: typeof state.lastSyncedModified === "string" ? state.lastSyncedModified : undefined,
      localDirty: state.localDirty === true,
      conflictModified: typeof state.conflictModified === "string" ? state.conflictModified : undefined
    };
  } catch {
    return { localDirty: false };
  }
};

const saveSyncState = async (email: string, state: CloudSyncState): Promise<void> => {
  await Preferences.set({ key: syncStateKey(email), value: JSON.stringify(state) });
};

const getLocalSyncOwner = async (): Promise<string | undefined> => {
  const { value } = await Preferences.get({ key: LOCAL_SYNC_OWNER_KEY });
  return value || undefined;
};

const setLocalSyncOwner = async (email: string): Promise<void> => {
  await Preferences.set({ key: LOCAL_SYNC_OWNER_KEY, value: email });
};

const clearLocalSyncOwner = async (): Promise<void> => {
  await Preferences.remove({ key: LOCAL_SYNC_OWNER_KEY });
};

/**
 * 自动同步、手动上传、手动拉取共用同一把锁。
 * 否则设置页点击“拉取”恰好撞上后台轮询时,两个完整数据库操作会互相覆盖。
 */
const withSyncLock = async <T>(operation: () => Promise<T>): Promise<T> => {
  const previous = syncLock;
  let release!: () => void;
  syncLock = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await operation();
  } finally {
    release();
  }
};

const emitCloudSyncEvent = (detail: CloudSyncEventDetail): void => {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent<CloudSyncEventDetail>(CLOUD_SYNC_EVENT, { detail }));
  }
};

const markLocalSyncDirty = async (): Promise<void> => {
  const session = await getCloudSession();
  if (!session.email) return;
  const state = await getSyncState(session.email);
  if (!state.localDirty) {
    await saveSyncState(session.email, { ...state, localDirty: true });
  }
};

export function requestCloudAutoSync(reason: CloudSyncTrigger = "local-change"): void {
  if (reason === "local-change") {
    localChangePending = true;
    void markLocalSyncDirty().catch(() => undefined);
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent<{ reason: CloudSyncTrigger }>(CLOUD_SYNC_REQUEST_EVENT, { detail: { reason } }));
  }
}

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
  const [
    storedToken,
    { value: storedEmail },
    { value: emailVerified },
    { value: displayName },
    { value: authProviders }
  ] = await Promise.all([
    getCloudAccessToken(),
    Preferences.get({ key: EMAIL_KEY }),
    Preferences.get({ key: EMAIL_VERIFIED_KEY }),
    Preferences.get({ key: DISPLAY_NAME_KEY }),
    Preferences.get({ key: AUTH_PROVIDERS_KEY })
  ]);
  let parsedProviders: Array<"email" | "apple"> | undefined;
  try {
    const parsed = authProviders ? JSON.parse(authProviders) : undefined;
    if (Array.isArray(parsed)) parsedProviders = parsed.filter((item) => item === "email" || item === "apple");
  } catch {
    parsedProviders = undefined;
  }
  return {
    configured: Boolean(API_URL),
    token: storedToken,
    email: storedEmail ?? undefined,
    emailVerified: emailVerified === "true",
    displayName: displayName ?? undefined,
    authProviders: parsedProviders
  };
}

async function saveCloudSession(data: TokenResponse) {
  await setCloudAccessToken(data.access_token);
  await Preferences.set({ key: EMAIL_KEY, value: data.email });
  await Preferences.set({ key: EMAIL_VERIFIED_KEY, value: data.emailVerified ? "true" : "false" });
  if (data.displayName) await Preferences.set({ key: DISPLAY_NAME_KEY, value: data.displayName });
  else await Preferences.remove({ key: DISPLAY_NAME_KEY });
  await Preferences.set({ key: AUTH_PROVIDERS_KEY, value: JSON.stringify(data.authProviders ?? ["email"]) });
  applyCloudEntitlements(data.entitlements);
  emitCloudAuthEvent(await getCloudSession());
}

const emitCloudAuthEvent = (session: CloudSession): void => {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent<CloudSession>(CLOUD_AUTH_EVENT, { detail: session }));
  }
};

export async function getCloudAuthConfig(): Promise<CloudAuthConfig> {
  if (!API_URL) return { appleEnabled: false, turnstileEnabled: false };
  return requestJson<CloudAuthConfig>("/api/auth/config", { method: "GET" });
}

export async function cloudRegister(
  email: string,
  password: string,
  displayName?: string,
  turnstileToken?: string
): Promise<CloudSession> {
  return withSyncLock(async () => {
    const data = await requestJson<TokenResponse>("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({
        email,
        password,
        display_name: displayName,
        terms_version: USER_AGREEMENT_VERSION,
        privacy_version: PRIVACY_POLICY_VERSION,
        turnstile_token: turnstileToken
      })
    });
    await saveCloudSession(data);
    requestCloudAutoSync("login");
    return { ...(await getCloudSession()), isNewAccount: data.isNewAccount };
  });
}

export async function cloudLogin(email: string, password: string, turnstileToken?: string): Promise<CloudSession> {
  return withSyncLock(async () => {
    const data = await requestJson<TokenResponse>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password, turnstile_token: turnstileToken })
    });
    await saveCloudSession(data);
    requestCloudAutoSync("login");
    return { ...(await getCloudSession()), isNewAccount: data.isNewAccount };
  });
}

export interface AppleLoginCredential {
  identityToken: string;
  nonce: string;
  email?: string;
  displayName?: string;
  consentAccepted?: boolean;
}

export async function cloudAppleLogin(credential: AppleLoginCredential): Promise<CloudSession> {
  return withSyncLock(async () => {
    const data = await requestJson<TokenResponse>("/api/auth/apple", {
      method: "POST",
      body: JSON.stringify({
        identity_token: credential.identityToken,
        nonce: credential.nonce,
        email: credential.email,
        display_name: credential.displayName,
        terms_version: credential.consentAccepted ? USER_AGREEMENT_VERSION : undefined,
        privacy_version: credential.consentAccepted ? PRIVACY_POLICY_VERSION : undefined
      })
    });
    await saveCloudSession(data);
    requestCloudAutoSync("login");
    return { ...(await getCloudSession()), isNewAccount: data.isNewAccount };
  });
}

export async function linkCloudApple(credential: AppleLoginCredential): Promise<CloudSession> {
  const { token } = await getCloudSession();
  if (!token) throw new Error("请先用邮箱密码登录。");
  const result = await requestJson<{ authProviders?: Array<"email" | "apple"> }>("/api/auth/link-apple", {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify({ identity_token: credential.identityToken, nonce: credential.nonce })
  });
  await Preferences.set({ key: AUTH_PROVIDERS_KEY, value: JSON.stringify(result.authProviders ?? ["email", "apple"]) });
  const session = await getCloudSession();
  emitCloudAuthEvent(session);
  return session;
}

export async function cloudLogout(): Promise<CloudSession> {
  return withSyncLock(async () => {
    const { token } = await getCloudSession();
    if (token) {
      await requestJson("/api/auth/logout", {
        method: "POST",
        headers: { authorization: `Bearer ${token}` }
      }).catch(() => undefined);
    }
    await removeCloudAccessToken();
    await Preferences.remove({ key: EMAIL_KEY });
    await Preferences.remove({ key: EMAIL_VERIFIED_KEY });
    await Preferences.remove({ key: DISPLAY_NAME_KEY });
    await Preferences.remove({ key: AUTH_PROVIDERS_KEY });
    localChangePending = false;
    const session = await getCloudSession();
    emitCloudAuthEvent(session);
    return session;
  });
}

export async function deleteCloudAccount(
  password: string,
  appleCredential?: Pick<AppleLoginCredential, "identityToken" | "nonce">
): Promise<CloudSession> {
  return withSyncLock(async () => {
    const { token } = await getCloudSession();
    if (!token) throw new Error("请先登录云同步账号。");
    await requestJson("/api/auth/delete-account", {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: JSON.stringify({
        password,
        apple_identity_token: appleCredential?.identityToken,
        apple_nonce: appleCredential?.nonce
      })
    });
    await removeCloudAccessToken();
    await Preferences.remove({ key: EMAIL_KEY });
    await Preferences.remove({ key: EMAIL_VERIFIED_KEY });
    await Preferences.remove({ key: DISPLAY_NAME_KEY });
    await Preferences.remove({ key: AUTH_PROVIDERS_KEY });
    // 云端权益随账号一起删除;本地缓存的 cloud 来源权益也要回退,
    // App Store 购买仍可通过"恢复购买"重新激活。
    if (getEntitlements().source === "cloud") {
      clearEntitlements();
    }
    await clearLocalSyncOwner();
    localChangePending = false;
    const session = await getCloudSession();
    emitCloudAuthEvent(session);
    return session;
  });
}

export async function changeCloudPassword(currentPassword: string, newPassword: string): Promise<string> {
  const { token } = await getCloudSession();
  if (!token) throw new Error("请先登录账号。");
  await requestJson("/api/auth/change-password", {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify({ current_password: currentPassword, new_password: newPassword })
  });
  return "账号密码已修改。";
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
  const session = await getCloudSession();
  emitCloudAuthEvent(session);
  return session;
}

export async function requestCloudPasswordReset(email: string, turnstileToken?: string): Promise<string> {
  await requestJson("/api/auth/request-password-reset", {
    method: "POST",
    body: JSON.stringify({ email, turnstile_token: turnstileToken })
  });
  return "如果该邮箱已注册，验证码会发送到邮箱。";
}

export async function getCloudUserProfile(): Promise<CloudUserProfile> {
  const { token } = await getCloudSession();
  if (!token) throw new Error("请先登录账号。");
  return requestJson<CloudUserProfile>("/api/user/profile", {
    method: "GET",
    headers: { authorization: `Bearer ${token}` }
  });
}

export async function updateCloudUserProfile(profile: {
  displayName: string;
  bio: string;
  targetLevel: string;
  avatar?: string | null;
}): Promise<CloudUserProfile> {
  const { token } = await getCloudSession();
  if (!token) throw new Error("请先登录账号。");
  const result = await requestJson<CloudUserProfile>("/api/user/profile", {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify({
      display_name: profile.displayName,
      bio: profile.bio,
      target_level: profile.targetLevel,
      avatar: profile.avatar
    })
  }, 30_000);
  if (result.display_name) await Preferences.set({ key: DISPLAY_NAME_KEY, value: result.display_name });
  emitCloudAuthEvent(await getCloudSession());
  return result;
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

const hasLocalLearningData = (): boolean => {
  const db = getDatabase();
  const tables = new Set(
    db.exec("SELECT name FROM sqlite_master WHERE type = 'table'")[0]?.values.map((row) => String(row[0])) ?? []
  );
  const checks: Array<[string, string]> = [
    ["reviews", "1"],
    ["grammar_reviews", "1"],
    ["word_notes", "1"],
    ["content_favorites", "1"],
    ["checkins", "1"],
    ["progress", "seen_count > 0 OR known_forever = 1"],
    ["grammar_progress", "seen_count > 0 OR known_forever = 1"],
    ["kanji_memory", "seen_count > 0"]
  ];
  return checks.some(([table, condition]) => {
    if (!tables.has(table)) return false;
    const result = db.exec(`SELECT COUNT(*) FROM ${table} WHERE ${condition}`);
    return Number(result[0]?.values[0]?.[0] ?? 0) > 0;
  });
};

const pushCloudDatabase = async (
  session: CloudSession,
  baseGeneration: number | undefined,
  baseModified: string | undefined,
  automatic: boolean
): Promise<CloudSyncEventDetail> => {
  if (!session.token || !session.email) throw new Error("请先登录云同步账号。");
  ensureSyncSchema();
  const localRevisionAtUpload = getLocalDataRevision();
  const snapshot = await exportSyncSnapshot();
  const { bytes, compression } = await compressSyncSnapshot(snapshot);

  const operationId = crypto.randomUUID();
  const headers: Record<string, string> = {
    authorization: `Bearer ${session.token}`,
    "content-type": "application/octet-stream",
    "x-sync-format": SYNC_SNAPSHOT_FORMAT,
    "x-sync-compression": compression,
    "x-sync-operation-id": operationId,
    "x-sync-device-id": getDeviceId()
  };
  if (typeof baseGeneration === "number") headers["x-sync-base-generation"] = String(baseGeneration);
  if (baseModified) headers["x-sync-base-modified"] = baseModified;

  const response = await requestJson<PushResponse>("/api/sync/push", {
    method: "POST",
    headers,
    body: bytesToArrayBuffer(bytes)
  }, 60_000);
  let changedDuringUpload = getLocalDataRevision() !== localRevisionAtUpload;
  await saveSyncState(session.email, {
    lastSyncedGeneration: response.generation,
    lastSyncedModified: response.timestamp,
    localDirty: changedDuringUpload,
    conflictModified: undefined
  });
  await setLocalSyncOwner(session.email);
  // Preferences 写入本身也是异步的；再次检查，覆盖“响应回来后、状态落盘时”
  // 恰好新增答案的窄竞态窗口。
  if (!changedDuringUpload && getLocalDataRevision() !== localRevisionAtUpload) {
    changedDuringUpload = true;
    await saveSyncState(session.email, {
      lastSyncedGeneration: response.generation,
      lastSyncedModified: response.timestamp,
      localDirty: true,
      conflictModified: undefined
    });
  }
  localChangePending = changedDuringUpload;
  lastCloudUploadAt = Date.now();
  if (changedDuringUpload) {
    // 上传期间又产生了答案：重新按“静默 30 秒 + 5 分钟上传间隔”排队，
    // 不能让旧计时器在本次上传刚结束时立刻再发一整份数据库。
    requestCloudAutoSync("local-change");
  } else if (autoSyncTimer !== null) {
    clearTimeout(autoSyncTimer);
    autoSyncTimer = null;
  }
  if (automatic) emitCloudSyncEvent({ status: "uploaded", automatic: true });
  return { status: "uploaded", automatic };
};

const pullCloudDatabase = async (
  session: CloudSession,
  automatic: boolean,
  generation?: number,
  expectedLocalRevision?: number
): Promise<CloudSyncEventDetail> => {
  if (!session.token || !session.email) throw new Error("请先登录云同步账号。");
  const data = await requestCloudSnapshot(session);
  if (expectedLocalRevision !== undefined && getLocalDataRevision() !== expectedLocalRevision) {
    throw new Error("同步期间本机产生了新学习记录，已保留本机数据，稍后会自动重试。");
  }
  // 新格式只含用户表；旧格式虽然是整库，也只取其中用户表合并，永不再用
  // 云端快照覆盖本机随 App 版本发布的 words / grammar_points 等内容。
  await mergeDatabaseBytes(data.bytes);
  await ensureSeedData();
  ensureSyncSchema();
  await saveDatabase({ notifyCloud: false });
  await saveSyncState(session.email, {
    lastSyncedGeneration: generation ?? data.generation,
    lastSyncedModified: data.lastModified,
    localDirty: localChangePending,
    conflictModified: undefined
  });
  await setLocalSyncOwner(session.email);
  notifyProgressUpdated();
  const message = `已恢复云端备份：${new Date(data.lastModified).toLocaleString()}`;
  if (automatic) emitCloudSyncEvent({ status: "downloaded", automatic: true, message });
  return { status: "downloaded", automatic, message };
};

export async function pushCloudBackup(): Promise<string> {
  return withSyncLock(async () => {
    await flushPendingSave();
    const session = await getCloudSession();
    await pushCloudDatabase(session, undefined, undefined, false);
    return "云端备份已上传。";
  });
}

export async function pullCloudBackup(): Promise<string> {
  return withSyncLock(async () => {
    await flushPendingSave();
    const localRevision = getLocalDataRevision();
    const session = await getCloudSession();
    const result = await pullCloudDatabase(session, false, undefined, localRevision);
    return result.message ?? "云端备份已恢复。";
  });
}

const mergeCloudDatabase = async (
  session: CloudSession,
  automatic: boolean,
  expectedLocalRevision?: number
): Promise<CloudSyncEventDetail> => {
  if (!session.token || !session.email) throw new Error("请先登录云同步账号。");
  const data = await requestCloudSnapshot(session);
  if (expectedLocalRevision !== undefined && getLocalDataRevision() !== expectedLocalRevision) {
    throw new Error("同步期间本机产生了新学习记录，已保留本机数据，稍后会自动重试。");
  }
  await mergeDatabaseBytes(data.bytes);
  await ensureSeedData();
  ensureSyncSchema();
  await saveDatabase({ notifyCloud: false });
  notifyProgressUpdated();
  const message = "已合并两台设备的学习进度，正在上传合并结果。";
  if (automatic) emitCloudSyncEvent({ status: "merged", automatic: true, message });
  return { status: "merged", automatic, message };
};

export async function autoSyncCloudDatabase(trigger: CloudSyncTrigger = "startup"): Promise<CloudSyncEventDetail> {
  if (autoSyncInFlight) return autoSyncInFlight;

  const now = Date.now();
  if (now < autoSyncBlockedUntil) {
    return { status: "skipped", automatic: true };
  }
  // 高频切换前后台或网络抖动不应反复查询服务端。登录、启动和本地修改
  // 仍可立即进入各自的同步流程。
  if (
    (trigger === "foreground" || trigger === "online" || trigger === "poll")
    && now - lastAutoSyncCheckAt < AUTO_SYNC_MIN_CHECK_INTERVAL_MS
  ) {
    return { status: "idle", automatic: true };
  }
  lastAutoSyncCheckAt = now;

  autoSyncInFlight = (async () => {
    return withSyncLock(async () => {
      try {
        const session = await getCloudSession();
        if (!session.token || !session.email) return { status: "skipped", automatic: true } as CloudSyncEventDetail;

        // 前台同步不能抢在 2 秒自动保存之前导入云端,否则内存里的最后一个答案会被覆盖。
        await flushPendingSave();
        const localRevisionAtSyncStart = getLocalDataRevision();
        ensureSyncSchema();
        let state = await getSyncState(session.email);
        let owner = await getLocalSyncOwner();
        // 兼容旧版本:旧同步状态按邮箱保存,虽然没有 owner 标记,但它能证明
        // 这份本地库曾经成功同步到当前账号,可以安全地完成一次绑定迁移。
        if (!owner && (typeof state.lastSyncedGeneration === "number" || state.lastSyncedModified)) {
          await setLocalSyncOwner(session.email);
          owner = session.email;
        }
        const localHasData = hasLocalLearningData();
        if ((owner && owner !== session.email) || (!owner && localHasData)) {
          const detail: CloudSyncEventDetail = {
            status: "conflict",
            automatic: true,
            message: owner && owner !== session.email
              ? "检测到本机仍保留另一个账号的学习数据，请在设置中手动选择上传或拉取。"
              : "检测到本机已有未绑定账号的学习数据，请先在设置中选择上传或拉取。"
          };
          emitCloudSyncEvent(detail);
          return detail;
        }

        if (localChangePending) {
          state = { ...state, localDirty: true };
          localChangePending = false;
          await saveSyncState(session.email, state);
        }

        const remote = await requestJson<SyncStatusResponse>("/api/sync/status", {
          method: "GET",
          headers: { authorization: `Bearer ${session.token}` }
        });
        const remoteModified = remote.last_modified;
        if (!remote.available || !remoteModified) {
          return pushCloudDatabase(session, undefined, undefined, true);
        }

        const remoteGeneration = remote.generation;
        const hasSyncedVersion = typeof state.lastSyncedGeneration === "number" || Boolean(state.lastSyncedModified);
        const remoteChanged = typeof remoteGeneration === "number" && typeof state.lastSyncedGeneration === "number"
          ? remoteGeneration !== state.lastSyncedGeneration
          : state.lastSyncedModified !== remoteModified;

        if (hasSyncedVersion && !remoteChanged && !state.localDirty) {
          return { status: "idle", automatic: true };
        }

        if (!hasSyncedVersion) {
          if (!localHasData) return pullCloudDatabase(session, true, remoteGeneration, localRevisionAtSyncStart);
          // 同一账号已绑定但旧同步状态丢失时,按行合并而不是整库覆盖。
          if (owner === session.email) {
            await mergeCloudDatabase(session, true, localRevisionAtSyncStart);
            return pushCloudDatabase(session, remoteGeneration, remoteModified, true);
          }
          const detail: CloudSyncEventDetail = {
            status: "conflict",
            automatic: true,
            message: "本机和云端都有学习记录，请在设置中手动选择上传或拉取。"
          };
          emitCloudSyncEvent(detail);
          return detail;
        }

        if (state.localDirty && remoteChanged) {
          await mergeCloudDatabase(session, true, localRevisionAtSyncStart);
          return pushCloudDatabase(session, remoteGeneration, remoteModified, true);
        }
        if (state.localDirty) {
          const uploadTooSoon = lastCloudUploadAt > 0
            && Date.now() - lastCloudUploadAt < AUTO_SYNC_MIN_UPLOAD_INTERVAL_MS
            && trigger !== "startup"
            && trigger !== "login";
          if (uploadTooSoon) return { status: "idle", automatic: true };
          return pushCloudDatabase(session, remoteGeneration, remoteModified, true);
        }
        return pullCloudDatabase(session, true, remoteGeneration, localRevisionAtSyncStart);
      } catch (error) {
        if (error instanceof CloudRequestError && error.status === 429) {
          const retryAfterSeconds = Number(error.data.retryAfterSeconds);
          const retryDelay = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
            ? retryAfterSeconds * 1000
            : AUTO_SYNC_POLL_MS;
          autoSyncBlockedUntil = Date.now() + retryDelay;
        }
        if (!(error instanceof CloudRequestError && error.status === 409)) {
          console.warn(`[cloud-sync] 自动同步失败(${trigger}):`, error);
        }
        return { status: "error", automatic: true, message: error instanceof Error ? error.message : "自动同步失败。" };
      } finally {
        autoSyncInFlight = null;
      }
    });
  })();

  return autoSyncInFlight;
}

const runAutoSync = (trigger: CloudSyncTrigger): void => {
  void autoSyncCloudDatabase(trigger).catch((error) => {
    console.warn(`[cloud-sync] 自动同步未完成(${trigger}):`, error);
  });
};

export function registerCloudAutoSyncLifecycle(): void {
  if (autoSyncLifecycleRegistered || typeof window === "undefined") return;
  autoSyncLifecycleRegistered = true;

  const lifecycleWindow = window as CloudSyncLifecycleWindow;
  lifecycleWindow.__masterNihongoCloudSyncCleanup?.();

  const scheduleLocalSync = () => {
    if (autoSyncTimer) clearTimeout(autoSyncTimer);
    const now = Date.now();
    const uploadThrottleDelay = Math.max(0, lastCloudUploadAt + AUTO_SYNC_MIN_UPLOAD_INTERVAL_MS - now);
    const serverBackoffDelay = Math.max(0, autoSyncBlockedUntil - now);
    const delay = Math.max(AUTO_SYNC_DEBOUNCE_MS, uploadThrottleDelay, serverBackoffDelay);
    autoSyncTimer = setTimeout(() => {
      autoSyncTimer = null;
      runAutoSync("local-change");
    }, delay);
  };
  const handleRequest = (event: Event) => {
    const trigger = (event as CustomEvent<{ reason?: CloudSyncTrigger }>).detail?.reason ?? "local-change";
    if (trigger === "local-change") scheduleLocalSync();
    else runAutoSync(trigger);
  };
  const handleOnline = () => runAutoSync("online");
  const handleVisibility = () => {
    if (document.visibilityState === "visible") runAutoSync("foreground");
  };
  const interval = window.setInterval(() => runAutoSync("poll"), AUTO_SYNC_POLL_MS);

  window.addEventListener(CLOUD_SYNC_REQUEST_EVENT, handleRequest);
  window.addEventListener("online", handleOnline);
  document.addEventListener("visibilitychange", handleVisibility);

  const cleanup = () => {
    window.removeEventListener(CLOUD_SYNC_REQUEST_EVENT, handleRequest);
    window.removeEventListener("online", handleOnline);
    document.removeEventListener("visibilitychange", handleVisibility);
    window.clearInterval(interval);
    if (autoSyncTimer !== null) {
      window.clearTimeout(autoSyncTimer);
      autoSyncTimer = null;
    }
    if (lifecycleWindow.__masterNihongoCloudSyncCleanup === cleanup) {
      lifecycleWindow.__masterNihongoCloudSyncCleanup = undefined;
    }
    autoSyncLifecycleRegistered = false;
  };

  lifecycleWindow.__masterNihongoCloudSyncCleanup = cleanup;
  import.meta.hot?.dispose(cleanup);
}

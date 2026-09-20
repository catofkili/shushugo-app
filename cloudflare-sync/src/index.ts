import {
  PRIVACY_POLICY_EFFECTIVE_DATE,
  PRIVACY_POLICY_SECTIONS,
  PRIVACY_POLICY_TITLE,
  PRIVACY_POLICY_VERSION
} from "../../frontend/src/lib/privacy-policy-content";
import {
  USER_AGREEMENT_EFFECTIVE_DATE,
  USER_AGREEMENT_SECTIONS,
  USER_AGREEMENT_TITLE,
  USER_AGREEMENT_VERSION
} from "../../frontend/src/lib/user-agreement-content";
import { entitlementStrength } from "./entitlement-rules";
import {
  configured as wechatPayConfigured,
  createOrder as createWechatOrder,
  expiresAtFor as wechatExpiresAtFor,
  notifyProvideGoods as wechatNotifyProvideGoods,
  queryOrderPaid as wechatQueryOrderPaid,
  verifyPushSignature as wechatVerifyPushSignature,
  type WechatPayProduct,
  type WechatSession
} from "./wechat-pay";
import {
  currentSubscriptionFromStatus,
  type AppleTransactionPayload,
  type CurrentAppleSubscription,
  type SubscriptionStatusResponse
} from "./apple-subscription";

export interface Env {
  DB: D1Database;
  SYNC_DATA: KVNamespace;
  SYNC_BUCKET: R2Bucket;
  SYNC_PUSH_LIMITER?: RateLimit;
  SYNC_PULL_LIMITER?: RateLimit;
  SYNC_STATUS_LIMITER?: RateLimit;
  APP_STORE_ISSUER_ID?: string;
  APP_STORE_KEY_ID?: string;
  APP_STORE_PRIVATE_KEY?: string;
  APP_BUNDLE_ID?: string;
  APP_STORE_ENVIRONMENT?: "Sandbox" | "Production";
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
  APPLE_SIGN_IN_CLIENT_ID?: string;
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
  WECHAT_APP_ID?: string;
  WECHAT_APP_SECRET?: string;
  /** 虚拟支付（个人主体）：小程序后台「支付与交易」自助开通后给的 */
  WECHAT_OFFER_ID?: string;
  WECHAT_PAY_APP_KEY?: string;
  WECHAT_PAY_ENV?: string;
  WECHAT_PAY_PRICES?: string;
  /** 小程序后台「消息推送」配的 Token，校验 xpay_* 推送用 */
  WECHAT_MSG_TOKEN?: string;
  /** "1" = 生产模式:Turnstile 和邮件服务必须配好,否则认证路由直接 503。 */
  REQUIRE_AUTH_HARDENING?: string;
  /**
   * 云端周报的保存期限（天）。**不配 = 永不清理**，见 cleanupExpiredWeeklyReports。
   * 产品未确认期限前不要打开：先承诺再清理是计划明确禁止的做法。
   */
  WEEKLY_REPORT_RETENTION_DAYS?: string;
}

interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  password_salt: string;
  display_name: string | null;
  email_verified_at?: string | null;
  bio?: string | null;
  target_level?: string | null;
  profile_updated_at?: string | null;
  terms_version?: string | null;
  privacy_version?: string | null;
  consented_at?: string | null;
}

interface AppleIdentityClaims {
  iss?: string;
  aud?: string | string[];
  exp?: number;
  sub?: string;
  email?: string;
  email_verified?: string | boolean;
  nonce?: string;
}

interface AuthIdentityRow {
  provider: "email" | "apple" | "wechat";
  provider_subject: string;
  user_id: string;
  email: string | null;
}

interface SessionRow {
  user_id: string;
  expires_at: string;
}

interface SyncRow {
  object_key: string;
  last_modified: string;
  byte_length: number;
  generation: number;
  payload_hash?: string | null;
  storage_backend: "kv" | "r2";
  snapshot_format: string;
  compression: "none" | "gzip";
}

interface SyncHead {
  user_id: string;
  generation: number;
  object_key: string | null;
  last_modified: string | null;
  payload_hash: string | null;
  updated_at: string;
}

interface EntitlementRow {
  is_pro: number;
  product_id: string | null;
  source: string;
  original_transaction_id: string | null;
  transaction_id: string | null;
  environment: string | null;
  expires_at: string | null;
  updated_at: string;
}

const PRODUCT_IDS = new Set(["shushugo_pro_monthly", "shushugo_pro_yearly", "shushugo_pro_lifetime"]);
const SUBSCRIPTION_PRODUCT_IDS = new Set(["shushugo_pro_monthly", "shushugo_pro_yearly"]);

const TOKEN_TTL_DAYS = 30;
// Cloudflare Workers Web Crypto rejects PBKDF2 iteration counts above 100,000.
const PASSWORD_ITERATIONS = 100_000;
const EMAIL_CODE_TTL_MINUTES = 30;
const PASSWORD_RESET_TTL_MINUTES = 15;
const PROFILE_AVATAR_PREFIX = "profile-avatar:";
const WEEKLY_REPORT_PREFIX = "weekly/";
const WEEKLY_REPORT_MAX_BYTES = 128 * 1024;

/**
 * 云端周报的保存期限（天）。**未配置时不做任何删除。**
 *
 * 计划明确要求：期限未定不得售卖「云端历史」这项能力，也禁止先承诺永久、
 * 以后再决定清理。所以这里默认是「不清理」，由部署方按已确认的期限显式打开；
 * `/api/health` 会回报它有没有配好，上线检查时能直接看到。
 */
const weeklyReportRetentionDays = (env: Env): number => {
  const parsed = Number(env.WEEKLY_REPORT_RETENTION_DAYS ?? "");
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
};

/** 单次定时任务最多清多少个对象，避免一次列出/删除过多。 */
const WEEKLY_REPORT_CLEANUP_LIMIT = 500;

const cleanupExpiredWeeklyReports = async (env: Env, now: number): Promise<void> => {
  const days = weeklyReportRetentionDays(env);
  if (!days) return;
  const cutoff = now - days * 24 * 60 * 60 * 1000;
  const listed = await env.SYNC_BUCKET.list({ prefix: WEEKLY_REPORT_PREFIX, limit: WEEKLY_REPORT_CLEANUP_LIMIT });
  const expired = (listed.objects ?? [])
    .filter((object) => object.uploaded.getTime() < cutoff)
    .map((object) => object.key);
  if (expired.length) await env.SYNC_BUCKET.delete(expired);
};
const TURNSTILE_ACTIONS = new Set(["register", "login", "password_reset"]);
// 6 位数字验证码,必须限制尝试次数,否则可被暴力枚举。
const MAX_CODE_ATTEMPTS = 5;
// KV 单值上限 25MB;base64 后 20M 约对应 15MB 数据库,词库全量也远小于此。
const SYNC_MAX_BASE64_LENGTH = 20_000_000;
const SYNC_MAX_REQUEST_BODY_LENGTH = SYNC_MAX_BASE64_LENGTH + 100_000;
// 每个用户只保留最近 N 份云备份,旧的连 KV 对象一起清掉。
const SYNC_KEEP_GENERATIONS = 3;
const encoder = new TextEncoder();

const json = (body: unknown, status = 200) => (
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...corsHeaders()
    }
  })
);

const corsHeaders = () => ({
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,PUT,DELETE,OPTIONS",
  "access-control-allow-headers": "authorization,content-type,x-sync-format,x-sync-protocol-version,x-sync-compression,x-sync-operation-id,x-sync-device-id,x-sync-base-generation,x-sync-base-modified",
  "access-control-expose-headers": "x-sync-format,x-sync-compression,x-sync-generation,x-sync-last-modified,x-sync-byte-length",
  "access-control-max-age": "86400"
});

const base64Url = (bytes: ArrayBuffer | Uint8Array) => {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (let index = 0; index < data.length; index += 1) {
    binary += String.fromCharCode(data[index]);
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
};

const randomToken = (bytes = 32) => {
  const data = new Uint8Array(bytes);
  crypto.getRandomValues(data);
  return base64Url(data);
};

const sha256 = async (value: string) => base64Url(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
const sha256Bytes = async (value: ArrayBuffer | Uint8Array) => {
  const buffer = value instanceof Uint8Array
    ? value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer
    : value;
  return base64Url(await crypto.subtle.digest("SHA-256", buffer));
};

const base64UrlToJson = <T>(value: string): T => {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return JSON.parse(new TextDecoder().decode(bytes)) as T;
};

const base64UrlToBytes = (value: string) => {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
};

const bytesToBase64 = (value: ArrayBuffer | Uint8Array) => {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.slice(index, index + chunkSize));
  }
  return btoa(binary);
};

const pemToArrayBuffer = (pem: string) => {
  const base64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s/g, "");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes.buffer;
};

const hashPassword = async (password: string, salt: string) => {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: encoder.encode(salt),
      iterations: PASSWORD_ITERATIONS
    },
    key,
    256
  );
  return base64Url(bits);
};

const normalizeEmail = (email: unknown) => String(email ?? "").trim().toLowerCase();

const verificationPayload = (env: Env, user?: Pick<UserRow, "email_verified_at"> | null) => ({
  emailVerified: Boolean(user?.email_verified_at),
  // 没有邮件服务时云同步仍可用；客户端据此隐藏无效的验证码入口。
  emailVerificationRequired: Boolean(env.RESEND_API_KEY)
});

const randomEmailCode = () => {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  const value = new DataView(bytes.buffer).getUint32(0);
  return String(value % 1_000_000).padStart(6, "0");
};

const clientIp = (request: Request) => request.headers.get("cf-connecting-ip") ?? "unknown";

const rateLimitExceeded = (retryAfterSeconds: number) => new Response(JSON.stringify({
  detail: "请求过于频繁，请稍后再试。",
  retryAfterSeconds
}), {
  status: 429,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "retry-after": String(retryAfterSeconds),
    ...corsHeaders()
  }
});

/**
 * 认证类限速。**必须是原子的**。
 *
 * ⚠️ 原来走 KV 的 `get → put`:两个节点同时读到 4、同时写回 5,实际放过了两次。
 * 对同步接口那种"别刷爆账单"的场景够用,但登录爆破和验证码枚举要的是真上限。
 * 改成和 enforceAccountQuota 同一条 D1 UPSERT —— 计数和上限判断在一条语句里,
 * 跨节点并发也不可能突破。
 */
const rateLimitSubject = async (
  env: Env,
  scope: string,
  subject: string,
  limit: number,
  windowSeconds: number
) => {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const windowStart = Math.floor(nowSeconds / windowSeconds) * windowSeconds;
  const accepted = await env.DB.prepare(`
    INSERT INTO auth_rate_limits (subject, scope, window_start, request_count, updated_at)
    VALUES (?, ?, ?, 1, ?)
    ON CONFLICT(subject, scope, window_start) DO UPDATE SET
      request_count = auth_rate_limits.request_count + 1,
      updated_at = excluded.updated_at
    WHERE auth_rate_limits.request_count < ?
    RETURNING request_count
  `).bind(subject, scope, windowStart, new Date().toISOString(), limit).first<{ request_count: number }>();
  if (!accepted) throw rateLimitExceeded(Math.max(1, windowStart + windowSeconds - nowSeconds));
};

const rateLimit = async (
  env: Env,
  request: Request,
  scope: string,
  limit: number,
  windowSeconds: number
) => rateLimitSubject(env, scope, `ip:${clientIp(request)}`, limit, windowSeconds);

const enforceAccountQuota = async (
  env: Env,
  userId: string,
  scope: "push" | "pull" | "status",
  limit: number,
  windowSeconds: number
) => {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const windowStart = Math.floor(nowSeconds / windowSeconds) * windowSeconds;
  // D1 的单条 UPSERT 原子递增，和最终一致的边缘限速器不同：即使账号从
  // 多个地区/IP 同时请求，也不能突破这个账号额度。
  const accepted = await env.DB.prepare(`
    INSERT INTO sync_rate_limits (user_id, scope, window_start, request_count, updated_at)
    VALUES (?, ?, ?, 1, ?)
    ON CONFLICT(user_id, scope, window_start) DO UPDATE SET
      request_count = sync_rate_limits.request_count + 1,
      updated_at = excluded.updated_at
    WHERE sync_rate_limits.request_count < ?
    RETURNING request_count
  `).bind(userId, scope, windowStart, new Date().toISOString(), limit).first<{ request_count: number }>();
  if (!accepted) {
    throw rateLimitExceeded(Math.max(1, windowStart + windowSeconds - nowSeconds));
  }
};

const enforceSyncRateLimit = async (
  env: Env,
  request: Request,
  userId: string,
  limiter: RateLimit | undefined,
  scope: "push" | "pull" | "status",
  hourlyLimit: number
) => {
  // Rate Limiting binding 拦截秒级/分钟级突发；D1 的账号小时额度再限制
  // 长时间持续滥用。账号和 IP 同时计数，既防单账号多 IP，也防单 IP 多账号。
  if (limiter) {
    const [account, ip] = await Promise.all([
      limiter.limit({ key: `user:${userId}` }),
      limiter.limit({ key: `ip:${clientIp(request)}` })
    ]);
    if (!account.success || !ip.success) throw rateLimitExceeded(60);
  }
  await enforceAccountQuota(env, userId, scope, hourlyLimit, 3600);
};

/**
 * 边读边数，超了当场断开。
 *
 * ⚠️ 不能只看 `content-length`：那个头是可选的,分块传输的请求根本没有它,
 * 于是「先 arrayBuffer() 读完、再检查实际长度」这种写法在真正超大的请求上
 * 已经把内存占掉了才发现。
 */
const readBodyBytes = async (request: Request, limit: number): Promise<Uint8Array> => {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) throw json({ detail: "Request body is too large" }, 413);
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      throw json({ detail: "Request body is too large" }, 413);
    }
    chunks.push(value);
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
};

/** 认证这类路由的 JSON 上限。个人资料要带 3MB base64 头像,所以单独放宽。 */
const JSON_BODY_LIMIT = 64 * 1024;
const PROFILE_BODY_LIMIT = 4 * 1024 * 1024;

const readJson = async <T>(request: Request, limit = JSON_BODY_LIMIT): Promise<T> => {
  const bytes = await readBodyBytes(request, limit);
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as T;
  } catch {
    throw new Response(JSON.stringify({ detail: "Invalid JSON body" }), {
      status: 400,
      headers: { "content-type": "application/json; charset=utf-8", ...corsHeaders() }
    });
  }
};

const turnstileEnabled = (env: Env) => Boolean(env.TURNSTILE_SITE_KEY && env.TURNSTILE_SECRET_KEY);

/**
 * 配置缺一半就整个关掉,是给本地开发用的;部署时打错一个变量名就变成
 * **静默降级**:人机验证没了、邮箱验证没了,而接口一切正常、没有任何告警。
 *
 * 生产把 `REQUIRE_AUTH_HARDENING` 设成 "1":该开的没开就直接 503,
 * 让部署当场失败,而不是安静地少一道防线。
 */
const assertAuthHardening = (env: Env) => {
  if (env.REQUIRE_AUTH_HARDENING !== "1") return;
  const missing = [
    turnstileEnabled(env) ? "" : "TURNSTILE_SITE_KEY/TURNSTILE_SECRET_KEY",
    env.RESEND_API_KEY ? "" : "RESEND_API_KEY"
  ].filter(Boolean);
  if (missing.length) {
    throw json({ detail: `服务端认证配置不完整：${missing.join("、")}`, code: "AUTH_CONFIG_INCOMPLETE" }, 503);
  }
};

const verifyTurnstile = async (
  env: Env,
  request: Request,
  token: string | undefined,
  action: "register" | "login" | "password_reset"
) => {
  if (!turnstileEnabled(env)) return;
  if (!token || token.length > 2048) {
    throw json({ detail: "请完成人机验证。", code: "TURNSTILE_REQUIRED", action }, 403);
  }
  const form = new FormData();
  form.set("secret", env.TURNSTILE_SECRET_KEY!);
  form.set("response", token);
  const ip = clientIp(request);
  if (ip !== "unknown") form.set("remoteip", ip);
  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    body: form
  });
  const result: { success?: boolean; action?: string; hostname?: string } = await response
    .json<{ success?: boolean; action?: string; hostname?: string }>()
    .catch(() => ({}));
  const expectedHostname = new URL(request.url).hostname;
  if (
    !response.ok
    || !result.success
    || result.action !== action
    || result.hostname !== expectedHostname
  ) {
    throw json({ detail: "人机验证已失效，请重试。", code: "TURNSTILE_REQUIRED", action }, 403);
  }
};

const loginFailureKey = async (request: Request, email: string) => (
  `auth-fail:${await sha256(`${clientIp(request)}:${email}`)}`
);

const getLoginFailures = async (env: Env, request: Request, email: string) => (
  Number(await env.SYNC_DATA.get(await loginFailureKey(request, email))) || 0
);

const recordLoginFailure = async (env: Env, request: Request, email: string) => {
  const key = await loginFailureKey(request, email);
  const count = Number(await env.SYNC_DATA.get(key)) || 0;
  await env.SYNC_DATA.put(key, String(count + 1), { expirationTtl: 900 });
};

const clearLoginFailures = async (env: Env, request: Request, email: string) => {
  await env.SYNC_DATA.delete(await loginFailureKey(request, email));
};

/** 允许用于 Apple 身份 token 的算法。严格白名单:不接受 none,也不接受 JWK 没声明的算法。 */
const ALLOWED_APPLE_JWT_ALGORITHMS: Record<string, {
  kty: string;
  importParams: RsaHashedImportParams | EcKeyImportParams;
  verifyParams: AlgorithmIdentifier | EcdsaParams;
}> = {
  RS256: {
    kty: "RSA",
    importParams: { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    verifyParams: { name: "RSASSA-PKCS1-v1_5" }
  },
  ES256: {
    kty: "EC",
    importParams: { name: "ECDSA", namedCurve: "P-256" },
    verifyParams: { name: "ECDSA", hash: "SHA-256" }
  }
};

const verifyAppleIdentityToken = async (identityToken: string, env: Env, expectedNonce?: string) => {
  const parts = identityToken.split(".");
  if (parts.length !== 3) throw json({ detail: "Apple 登录凭据格式无效。" }, 401);
  const header = base64UrlToJson<{ alg?: string; kid?: string }>(parts[0]);
  const claims = base64UrlToJson<AppleIdentityClaims>(parts[1]);
  if (!header.alg || !header.kid || !claims.sub) {
    throw json({ detail: "Apple 登录凭据无效。" }, 401);
  }
  const clientId = env.APPLE_SIGN_IN_CLIENT_ID ?? env.APP_BUNDLE_ID;
  if (!clientId) throw json({ detail: "服务端尚未配置 Apple 登录 Client ID。" }, 501);
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (claims.iss !== "https://appleid.apple.com" || !audiences.includes(clientId)) {
    throw json({ detail: "Apple 登录凭据不属于此应用。" }, 401);
  }
  if (!claims.exp || claims.exp * 1000 <= Date.now()) {
    throw json({ detail: "Apple 登录凭据已过期，请重试。" }, 401);
  }
  if (expectedNonce && claims.nonce !== expectedNonce) {
    throw json({ detail: "Apple 登录校验失败，请重试。" }, 401);
  }

  const keysResponse = await fetch("https://appleid.apple.com/auth/keys");
  if (!keysResponse.ok) throw json({ detail: "暂时无法连接 Apple 登录服务。" }, 502);
  const keys = await keysResponse.json<{ keys?: Array<JsonWebKey & { kid?: string; alg?: string }> }>();
  const jwk = keys.keys?.find((item) => item.kid === header.kid);
  if (!jwk) throw json({ detail: "无法验证 Apple 登录凭据。" }, 401);

  // ⚠️ 算法必须跟着 Apple 的公钥走,不能写死。
  // https://appleid.apple.com/auth/keys 当前返回的三把 key 全是 kty=RSA / alg=RS256;
  // 老代码只认 ES256 并按 ECDSA P-256 导入,于是每一次 Apple 登录都在 importKey
  // 之前就 401 —— 关联 Apple、删号后重新认证走的也是这个函数。
  // (App Store Server API 的**开发者签名 JWT** 才是 ES256,那是另一件事,见 createAppleJwt。)
  const algorithm = jwk.alg && jwk.alg !== header.alg ? undefined : ALLOWED_APPLE_JWT_ALGORITHMS[header.alg];
  if (!algorithm || algorithm.kty !== jwk.kty) throw json({ detail: "Apple 登录凭据算法不受支持。" }, 401);
  const key = await crypto.subtle.importKey("jwk", jwk, algorithm.importParams, false, ["verify"]);
  const valid = await crypto.subtle.verify(
    algorithm.verifyParams,
    key,
    base64UrlToBytes(parts[2]),
    encoder.encode(`${parts[0]}.${parts[1]}`)
  );
  if (!valid) throw json({ detail: "Apple 登录签名无效。" }, 401);

  // 重放防护:nonce 是客户端自己给的、还能整个省略,所以它挡不住「把同一份
  // identity token 再发一次」。这里改成让 token 本身一次性 —— 记下它的哈希,
  // 有效期内再来第二次就拒。过了 exp 之后上面的过期检查已经会拦。
  const replayKey = `apple-id-token:${await sha256(identityToken)}`;
  if (await env.SYNC_DATA.get(replayKey)) throw json({ detail: "Apple 登录凭据已被使用，请重试。" }, 401);
  await env.SYNC_DATA.put(replayKey, "1", {
    expirationTtl: Math.max(60, Math.ceil(claims.exp! - Date.now() / 1000) + 60)
  });
  return claims;
};

const identityProviders = async (env: Env, userId: string) => {
  const rows = await env.DB.prepare("SELECT provider FROM auth_identities WHERE user_id = ? ORDER BY provider")
    .bind(userId)
    .all<{ provider: "email" | "apple" | "wechat" }>();
  return (rows.results ?? []).map((row) => row.provider);
};

const sessionPayload = async (env: Env, user: UserRow, token: string) => ({
  access_token: token,
  token_type: "bearer",
  user_id: user.id,
  email: user.email,
  displayName: user.display_name ?? undefined,
  authProviders: await identityProviders(env, user.id),
  ...verificationPayload(env, user),
  entitlements: entitlementPayload(await getEntitlementRow(env, user.id))
});

const createToken = async (env: Env, userId: string) => {
  const token = randomToken();
  const tokenHash = await sha256(token);
  const now = new Date();
  const expires = new Date(now.getTime() + TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
  await env.DB.prepare(`
    INSERT INTO sessions (token_hash, user_id, created_at, expires_at)
    VALUES (?, ?, ?, ?)
  `).bind(tokenHash, userId, now.toISOString(), expires.toISOString()).run();
  return token;
};

const emailHtml = (title: string, code: string, minutes: number) => `
  <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;line-height:1.6;color:#163f35">
    <h1 style="font-size:22px;margin:0 0 12px">收集日</h1>
    <p style="margin:0 0 12px">${title}</p>
    <p style="font-size:28px;font-weight:800;letter-spacing:6px;margin:18px 0;color:#1f7469">${code}</p>
    <p style="margin:0 0 12px">验证码 ${minutes} 分钟内有效。若不是你本人操作，可以忽略这封邮件。</p>
  </div>
`;

const sendEmail = async (env: Env, to: string, subject: string, html: string) => {
  if (!env.RESEND_API_KEY) {
    throw json({ detail: "Email service is not configured. Set RESEND_API_KEY first." }, 501);
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.RESEND_API_KEY}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      from: env.EMAIL_FROM ?? "收集日 <onboarding@resend.dev>",
      to,
      subject,
      html
    })
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw json({ detail: `Email send failed: ${response.status}${detail ? ` ${detail}` : ""}` }, 502);
  }
};

const createEmailToken = async (
  env: Env,
  userId: string,
  purpose: "verify_email" | "password_reset",
  minutes: number
) => {
  const code = randomEmailCode();
  const now = new Date();
  const expires = new Date(now.getTime() + minutes * 60 * 1000);

  await env.DB.prepare(`
    UPDATE auth_email_tokens
    SET used_at = ?
    WHERE user_id = ? AND purpose = ? AND used_at IS NULL
  `).bind(now.toISOString(), userId, purpose).run();

  await env.DB.prepare(`
    INSERT INTO auth_email_tokens (id, user_id, purpose, token_hash, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(
    crypto.randomUUID(),
    userId,
    purpose,
    await sha256(code),
    now.toISOString(),
    expires.toISOString()
  ).run();

  return code;
};

const verifyEmailToken = async (
  env: Env,
  userId: string,
  purpose: "verify_email" | "password_reset",
  code: string
) => {
  const row = await env.DB.prepare(`
    SELECT id, token_hash, expires_at, attempts
    FROM auth_email_tokens
    WHERE user_id = ? AND purpose = ? AND used_at IS NULL
    ORDER BY created_at DESC
    LIMIT 1
  `).bind(userId, purpose).first<{ id: string; token_hash: string; expires_at: string; attempts: number }>();

  if (!row || Date.parse(row.expires_at) <= Date.now()) {
    return null;
  }
  if (row.attempts >= MAX_CODE_ATTEMPTS) {
    return null;
  }

  const tokenHash = await sha256(code.trim());
  if (tokenHash !== row.token_hash) {
    await env.DB.prepare("UPDATE auth_email_tokens SET attempts = attempts + 1 WHERE id = ?")
      .bind(row.id)
      .run();
    return null;
  }

  await env.DB.prepare("UPDATE auth_email_tokens SET used_at = ? WHERE id = ?")
    .bind(new Date().toISOString(), row.id)
    .run();
  return row.id;
};

const entitlementPayload = (row?: EntitlementRow | null) => {
  const expired = row?.expires_at ? Date.parse(row.expires_at) <= Date.now() : false;
  const isPro = Boolean(row?.is_pro) && !expired;
  return {
    isPro,
    source: isPro ? row?.source ?? "cloud" : "free",
    productId: isPro ? row?.product_id ?? undefined : undefined,
    expiresAt: isPro ? row?.expires_at ?? undefined : undefined,
    updatedAt: row?.updated_at ?? new Date().toISOString()
  };
};

const getEntitlementRow = async (env: Env, userId: string) => (
  env.DB.prepare(`
    SELECT is_pro, product_id, source, original_transaction_id, transaction_id, environment, expires_at, updated_at
    FROM entitlements
    WHERE user_id = ?
  `).bind(userId).first<EntitlementRow>()
);

/**
 * 沙盒交易能给的最长权益。
 *
 * TestFlight 和 App 审核用的都是沙盒交易，所以不能直接拒；但一笔沙盒的
 * **永久**购买不该变成正式账号上永不过期的 Pro（实测确实会）。给一个短上限：
 * 审核期够用，泄漏出去也会自己过期。
 */
const SANDBOX_ENTITLEMENT_MAX_MS = 30 * 24 * 60 * 60 * 1000;

/** 这笔交易被撤销/退款时，如果账号当前的权益正是它给的，就一并撤掉。 */
const revokeEntitlementForTransaction = async (env: Env, userId: string, originalTransactionId?: string) => {
  if (!originalTransactionId) return;
  await env.DB.prepare(`
    UPDATE entitlements
    SET is_pro = 0, product_id = NULL, source = 'free', expires_at = NULL, updated_at = ?
    WHERE user_id = ? AND original_transaction_id = ?
  `).bind(new Date().toISOString(), userId, originalTransactionId).run();
};

const saveEntitlement = async (
  env: Env,
  userId: string,
  data: {
    productId: string;
    source: string;
    transactionId?: string;
    originalTransactionId?: string;
    environment?: string;
    expiresAt?: string | null;
  }
) => {
  const now = new Date().toISOString();
  const current = await getEntitlementRow(env, userId);
  const candidate = { is_pro: 1, product_id: data.productId, expires_at: data.expiresAt ?? null };
  // 同一笔原始交易的新消息（续费、到期、退款）永远可以改写自己那一行，
  // 包括往下改；别的交易只有更强时才准覆盖。
  const sameTransaction = Boolean(
    data.originalTransactionId
    && current?.original_transaction_id
    && data.originalTransactionId === current.original_transaction_id
  );
  if (!sameTransaction && entitlementStrength(candidate) < entitlementStrength(current)) {
    // 还是要盖一下时间戳:updated_at 兼作「上次向 Apple 核对是什么时候」,
    // 不动的话 /api/entitlements 的每日重查会认为这行永远是陈的,每次请求都打一次 Apple。
    await env.DB.prepare("UPDATE entitlements SET updated_at = ? WHERE user_id = ?").bind(now, userId).run();
    return entitlementPayload(await getEntitlementRow(env, userId));
  }
  await env.DB.prepare(`
    INSERT INTO entitlements (
      user_id, is_pro, product_id, source, original_transaction_id, transaction_id, environment, expires_at, updated_at
    )
    VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      is_pro = excluded.is_pro,
      product_id = excluded.product_id,
      source = excluded.source,
      original_transaction_id = excluded.original_transaction_id,
      transaction_id = excluded.transaction_id,
      environment = excluded.environment,
      expires_at = excluded.expires_at,
      updated_at = excluded.updated_at
  `).bind(
    userId,
    data.productId,
    data.source,
    data.originalTransactionId ?? null,
    data.transactionId ?? null,
    data.environment ?? null,
    data.expiresAt ?? null,
    now
  ).run();
  return entitlementPayload(await getEntitlementRow(env, userId));
};

const createAppleJwt = async (env: Env) => {
  if (!env.APP_STORE_ISSUER_ID || !env.APP_STORE_KEY_ID || !env.APP_STORE_PRIVATE_KEY || !env.APP_BUNDLE_ID) {
    return null;
  }
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(encoder.encode(JSON.stringify({ alg: "ES256", kid: env.APP_STORE_KEY_ID, typ: "JWT" })));
  const payload = base64Url(encoder.encode(JSON.stringify({
    iss: env.APP_STORE_ISSUER_ID,
    iat: now,
    exp: now + 15 * 60,
    aud: "appstoreconnect-v1",
    bid: env.APP_BUNDLE_ID
  })));
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(env.APP_STORE_PRIVATE_KEY),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, encoder.encode(`${header}.${payload}`));
  return `${header}.${payload}.${base64Url(signature)}`;
};

// Apple 从 2026-05-05 起推荐不带 `itunes` 的域名；旧域名仍兼容，
// 但新部署直接使用推荐地址，避免以后在 Apple 停止兼容时才被动迁移。
const APPLE_PRODUCTION_HOST = "https://api.storekit.apple.com";
const APPLE_SANDBOX_HOST = "https://api.storekit-sandbox.apple.com";

const appleHosts = (env: Env) => env.APP_STORE_ENVIRONMENT === "Sandbox"
  ? [APPLE_SANDBOX_HOST, APPLE_PRODUCTION_HOST]
  : [APPLE_PRODUCTION_HOST, APPLE_SANDBOX_HOST];

const fetchAppleTransaction = async (jwt: string, host: string, transactionId: string) => (
  fetch(`${host}/inApps/v1/transactions/${encodeURIComponent(transactionId)}`, {
    headers: { authorization: `Bearer ${jwt}` }
  })
);

const getAppleTransaction = async (env: Env, transactionId: string) => {
  const jwt = await createAppleJwt(env);
  if (!jwt) return null;

  // Apple 官方建议:先查正式环境,404(交易不存在)再回退沙盒。
  // TestFlight 和审核用的都是沙盒交易,固定环境会让审核走不通。
  const hosts = appleHosts(env);

  let response = await fetchAppleTransaction(jwt, hosts[0], transactionId);
  if (response.status === 404) {
    response = await fetchAppleTransaction(jwt, hosts[1], transactionId);
  }
  if (!response.ok) {
    throw new Error(`Apple verification failed: ${response.status}`);
  }
  const data = await response.json<{ signedTransactionInfo?: string }>();
  if (!data.signedTransactionInfo) throw new Error("Apple response is missing signedTransactionInfo");
  const [, payload] = data.signedTransactionInfo.split(".");
  if (!payload) throw new Error("Apple signed transaction is malformed");
  return { payload: base64UrlToJson<AppleTransactionPayload>(payload), raw: data };
};

/**
 * 单笔交易接口只会把那一笔原样查回来，漏掉续费通知时永远看不到后续 T2/T3。
 * 订阅重查改用 Apple 的当前状态接口；它接受任意旧交易号并返回每个订阅的最新交易。
 */
const getCurrentAppleSubscription = async (
  env: Env,
  transactionId: string,
  originalTransactionId: string
): Promise<CurrentAppleSubscription | null> => {
  const jwt = await createAppleJwt(env);
  if (!jwt) return null;
  const hosts = appleHosts(env);
  const request = (host: string) => fetch(
    `${host}/inApps/v1/subscriptions/${encodeURIComponent(transactionId)}`,
    { headers: { authorization: `Bearer ${jwt}` } }
  );
  let response = await request(hosts[0]);
  if (response.status === 404) response = await request(hosts[1]);
  if (!response.ok) throw new Error(`Apple subscription status failed: ${response.status}`);
  const raw = await response.json<SubscriptionStatusResponse>();
  const current = currentSubscriptionFromStatus(raw, originalTransactionId, SUBSCRIPTION_PRODUCT_IDS);
  if (!current) throw new Error("Apple subscription status did not contain the owned subscription");
  return current;
};

const bearerTokenHash = async (request: Request) => {
  const match = (request.headers.get("authorization") ?? "").match(/^Bearer\s+(.+)$/i);
  return match ? await sha256(match[1]) : null;
};

const currentUser = async (request: Request, env: Env) => {
  const tokenHash = await bearerTokenHash(request);
  if (!tokenHash) return null;

  const session = await env.DB.prepare(`
    SELECT user_id, expires_at
    FROM sessions
    WHERE token_hash = ?
  `).bind(tokenHash).first<SessionRow>();

  if (!session || new Date(session.expires_at).getTime() <= Date.now()) return null;
  return session.user_id;
};

const requireUser = async (request: Request, env: Env) => {
  const userId = await currentUser(request, env);
  if (!userId) {
    throw json({ detail: "Invalid or expired token" }, 401);
  }
  return userId;
};

// 云备份上传/下载要求邮箱已验证:防止用拼错/他人邮箱的账号占存储,
// 也保证找回密码通道可用后才托管用户数据。邮件服务未配置时不强制,
// 否则用户永远无法通过验证。
const requireVerifiedUser = async (request: Request, env: Env) => {
  const userId = await requireUser(request, env);
  if (!env.RESEND_API_KEY) return userId;
  const user = await env.DB.prepare("SELECT email_verified_at FROM users WHERE id = ?")
    .bind(userId)
    .first<{ email_verified_at: string | null }>();
  const wechatIdentity = await env.DB.prepare(
    "SELECT 1 FROM auth_identities WHERE user_id = ? AND provider = 'wechat' LIMIT 1"
  ).bind(userId).first();
  if (!user?.email_verified_at && !wechatIdentity) {
    throw json({ detail: "请先在设置中完成邮箱验证，再使用云同步。" }, 403);
  }
  return userId;
};

const requireProUser = async (request: Request, env: Env): Promise<string> => {
  const userId = await requireVerifiedUser(request, env);
  const entitlement = await getEntitlementRow(env, userId);
  const active = entitlement?.is_pro === 1
    && (!entitlement.expires_at || new Date(entitlement.expires_at).getTime() > Date.now());
  if (!active) throw json({ detail: "云端历史需要有效的 Pro 权益。", code: "PRO_REQUIRED" }, 403);
  return userId;
};

const register = async (request: Request, env: Env) => {
  assertAuthHardening(env);
  await rateLimit(env, request, "register", 5, 3600);
  const body = await readJson<{
    email?: string;
    password?: string;
    display_name?: string;
    terms_version?: string;
    privacy_version?: string;
    turnstile_token?: string;
  }>(request);
  await verifyTurnstile(env, request, body.turnstile_token, "register");
  const email = normalizeEmail(body.email);
  const password = String(body.password ?? "");
  const displayName = String(body.display_name ?? "").trim() || null;

  if (!email.includes("@")) return json({ detail: "Email is invalid" }, 400);
  if (password.length < 8) return json({ detail: "Password must be at least 8 characters" }, 400);
  if (body.terms_version !== USER_AGREEMENT_VERSION || body.privacy_version !== PRIVACY_POLICY_VERSION) {
    return json({ detail: "请阅读并同意当前版本的用户协议和隐私政策。", code: "CONSENT_REQUIRED" }, 400);
  }

  const existing = await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first();
  if (existing) return json({ detail: "Email already registered" }, 400);

  const id = crypto.randomUUID();
  const salt = randomToken(16);
  const passwordHash = await hashPassword(password, salt);
  const now = new Date().toISOString();

  await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO users (
        id, email, password_hash, password_salt, display_name, created_at, last_login,
        profile_updated_at, terms_version, privacy_version, consented_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id, email, passwordHash, salt, displayName, now, now,
      now, USER_AGREEMENT_VERSION, PRIVACY_POLICY_VERSION, now
    ),
    env.DB.prepare(`
      INSERT INTO auth_identities (provider, provider_subject, user_id, email, created_at)
      VALUES ('email', ?, ?, ?, ?)
    `).bind(email, id, email, now)
  ]);

  let emailVerificationSent = false;
  if (env.RESEND_API_KEY) {
    const emailCode = await createEmailToken(env, id, "verify_email", EMAIL_CODE_TTL_MINUTES);
    try {
      await sendEmail(
        env,
        email,
        "收集日邮箱验证码",
        emailHtml("请使用下面的验证码完成邮箱验证：", emailCode, EMAIL_CODE_TTL_MINUTES)
      );
      emailVerificationSent = true;
    } catch (error) {
      console.error("Initial verification email failed", error);
    }
  }

  const token = await createToken(env, id);
  const user = await env.DB.prepare(`
    SELECT id, email, password_hash, password_salt, display_name, email_verified_at
    FROM users WHERE id = ?
  `).bind(id).first<UserRow>();
  return json({ ...(await sessionPayload(env, user!, token)), emailVerificationSent, isNewAccount: true });
};

const login = async (request: Request, env: Env) => {
  assertAuthHardening(env);
  await rateLimit(env, request, "login", 10, 300);
  const body = await readJson<{ email?: string; password?: string; turnstile_token?: string }>(request);
  const email = normalizeEmail(body.email);
  const password = String(body.password ?? "");
  if (await getLoginFailures(env, request, email) >= 3) {
    await verifyTurnstile(env, request, body.turnstile_token, "login");
  }
  const user = await env.DB.prepare(`
    SELECT u.id, u.email, u.password_hash, u.password_salt, u.display_name, u.email_verified_at
    FROM users u
    JOIN auth_identities i ON i.user_id = u.id AND i.provider = 'email'
    WHERE u.email = ?
  `).bind(email).first<UserRow>();

  // 账号不存在时也要走一遍同样的 PBKDF2:直接返回的话，10 万轮哈希的时间差
  // 就是一个「这个邮箱注册没注册」的旁路,可以被批量拿来枚举用户。
  const passwordHash = await hashPassword(password, user?.password_salt ?? "decoy-salt");
  if (!user || passwordHash !== user.password_hash) {
    await recordLoginFailure(env, request, email);
    return json({ detail: "邮箱或密码不正确。" }, 401);
  }

  await clearLoginFailures(env, request, email);
  await env.DB.prepare("UPDATE users SET last_login = ? WHERE id = ?").bind(new Date().toISOString(), user.id).run();
  const token = await createToken(env, user.id);
  return json({ ...(await sessionPayload(env, user, token)), isNewAccount: false });
};

const appleLogin = async (request: Request, env: Env) => {
  await rateLimit(env, request, "apple-login", 10, 300);
  const body = await readJson<{
    identity_token?: string;
    nonce?: string;
    display_name?: string;
    terms_version?: string;
    privacy_version?: string;
  }>(request);
  const identityToken = String(body.identity_token ?? "");
  const claims = await verifyAppleIdentityToken(identityToken, env, body.nonce);
  const subject = claims.sub!;
  const identity = await env.DB.prepare(`
    SELECT provider, provider_subject, user_id, email
    FROM auth_identities
    WHERE provider = 'apple' AND provider_subject = ?
  `).bind(subject).first<AuthIdentityRow>();

  if (identity) {
    const user = await env.DB.prepare(`
      SELECT id, email, password_hash, password_salt, display_name, email_verified_at
      FROM users WHERE id = ?
    `).bind(identity.user_id).first<UserRow>();
    if (!user) return json({ detail: "Apple 账号关联的用户不存在。" }, 404);
    await env.DB.prepare("UPDATE users SET last_login = ? WHERE id = ?")
      .bind(new Date().toISOString(), user.id)
      .run();
    return json({ ...(await sessionPayload(env, user, await createToken(env, user.id))), isNewAccount: false });
  }

  if (body.terms_version !== USER_AGREEMENT_VERSION || body.privacy_version !== PRIVACY_POLICY_VERSION) {
    return json({ detail: "请阅读并同意当前版本的用户协议和隐私政策。", code: "CONSENT_REQUIRED" }, 400);
  }
  const email = normalizeEmail(claims.email);
  const appleEmailVerified = claims.email_verified === true || claims.email_verified === "true";
  if (!email.includes("@") || !appleEmailVerified) {
    return json({ detail: "Apple 没有返回可用邮箱，请在 Apple 账号设置中撤销授权后重试。" }, 400);
  }
  const existing = await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first<{ id: string }>();
  if (existing) {
    return json({
      detail: "这个邮箱已经注册。请先用邮箱密码登录，再关联 Apple 登录。",
      code: "ACCOUNT_LINK_REQUIRED",
      email
    }, 409);
  }

  const id = crypto.randomUUID();
  const salt = randomToken(16);
  const now = new Date().toISOString();
  const displayName = String(body.display_name ?? "").trim() || null;
  const inaccessiblePasswordHash = await hashPassword(randomToken(32), salt);
  await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO users (
        id, email, password_hash, password_salt, display_name, email_verified_at,
        created_at, last_login, profile_updated_at, terms_version, privacy_version, consented_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id, email, inaccessiblePasswordHash, salt, displayName, now,
      now, now, now, USER_AGREEMENT_VERSION, PRIVACY_POLICY_VERSION, now
    ),
    env.DB.prepare(`
      INSERT INTO auth_identities (provider, provider_subject, user_id, email, created_at)
      VALUES ('apple', ?, ?, ?, ?)
    `).bind(subject, id, email, now)
  ]);
  const user = await env.DB.prepare(`
    SELECT id, email, password_hash, password_salt, display_name, email_verified_at
    FROM users WHERE id = ?
  `).bind(id).first<UserRow>();
  return json({ ...(await sessionPayload(env, user!, await createToken(env, id))), isNewAccount: true });
};

// 微信小程序登录：code 只在服务端向微信换取 openid/unionid，永不把 app
// secret 放进小程序代码包。没有配置凭据时明确返回 501，而不是签发一个
// 看似成功但无法续期的本地 token。
const wechatLogin = async (request: Request, env: Env) => {
  await rateLimit(env, request, "wechat-login", 10, 300);
  if (!env.WECHAT_APP_ID || !env.WECHAT_APP_SECRET) {
    return json({ detail: "微信登录尚未在服务端配置。", code: "WECHAT_LOGIN_NOT_CONFIGURED" }, 501);
  }
  const body = await readJson<{
    code?: string;
    display_name?: string;
    terms_version?: string;
    privacy_version?: string;
  }>(request);
  const code = String(body.code ?? "").trim();
  if (!code) return json({ detail: "微信登录 code 缺失。" }, 400);
  const response = await fetch(
    `https://api.weixin.qq.com/sns/jscode2session?appid=${encodeURIComponent(env.WECHAT_APP_ID)}&secret=${encodeURIComponent(env.WECHAT_APP_SECRET)}&js_code=${encodeURIComponent(code)}&grant_type=authorization_code`
  );
  if (!response.ok) return json({ detail: "微信登录服务暂时不可用。" }, 502);
  const result = await response.json<{ openid?: string; unionid?: string; session_key?: string; errcode?: number; errmsg?: string }>();
  if (result.errcode || !result.openid) {
    console.warn("WeChat code2session failed", result.errcode, result.errmsg);
    return json({ detail: "微信登录凭证无效或已过期。", code: "WECHAT_CODE_INVALID" }, 401);
  }
  const subject = result.unionid ? `unionid:${result.unionid}` : `openid:${result.openid}`;
  // 虚拟支付的 signature 要用 session_key 签、查单要 openid：登录那一刻记下来，
  // 每次登录覆盖（session_key 随 wx.login 刷新）。KV 30 天，过期了让用户重新登录一次。
  const rememberWechatSession = (userId: string) => env.SYNC_DATA.put(
    wechatSessionKey(userId),
    JSON.stringify({ openid: result.openid, sessionKey: result.session_key ?? "" } satisfies WechatSession),
    { expirationTtl: 30 * 24 * 60 * 60 }
  );
  const identity = await env.DB.prepare(`
    SELECT provider, provider_subject, user_id, email
    FROM auth_identities
    WHERE provider = 'wechat' AND provider_subject = ?
  `).bind(subject).first<AuthIdentityRow>();
  if (identity) {
    const user = await env.DB.prepare(`
      SELECT id, email, password_hash, password_salt, display_name, email_verified_at
      FROM users WHERE id = ?
    `).bind(identity.user_id).first<UserRow>();
    if (!user) return json({ detail: "微信账号关联的用户不存在。" }, 404);
    await env.DB.prepare("UPDATE users SET last_login = ? WHERE id = ?")
      .bind(new Date().toISOString(), user.id).run();
    await rememberWechatSession(user.id);
    return json({ ...(await sessionPayload(env, user, await createToken(env, user.id))), isNewAccount: false });
  }

  if (body.terms_version !== USER_AGREEMENT_VERSION || body.privacy_version !== PRIVACY_POLICY_VERSION) {
    return json({ detail: "请阅读并同意当前版本的用户协议和隐私政策。", code: "CONSENT_REQUIRED" }, 400);
  }
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const salt = randomToken(16);
  const inaccessiblePasswordHash = await hashPassword(randomToken(32), salt);
  const email = `wechat-${(await sha256(subject)).slice(0, 32)}@wechat.invalid`;
  const displayName = String(body.display_name ?? "").trim() || null;
  await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO users (
        id, email, password_hash, password_salt, display_name, email_verified_at,
        created_at, last_login, profile_updated_at, terms_version, privacy_version, consented_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id, email, inaccessiblePasswordHash, salt, displayName, now,
      now, now, now, USER_AGREEMENT_VERSION, PRIVACY_POLICY_VERSION, now
    ),
    env.DB.prepare(`
      INSERT INTO auth_identities (provider, provider_subject, user_id, email, created_at)
      VALUES ('wechat', ?, ?, ?, ?)
    `).bind(subject, id, email, now)
  ]);
  const user = await env.DB.prepare(`
    SELECT id, email, password_hash, password_salt, display_name, email_verified_at
    FROM users WHERE id = ?
  `).bind(id).first<UserRow>();
  await rememberWechatSession(id);
  return json({ ...(await sessionPayload(env, user!, await createToken(env, id))), isNewAccount: true });
};

const wechatSessionKey = (userId: string) => `wechat-session:${userId}`;

const loadWechatSession = async (env: Env, userId: string): Promise<WechatSession | null> => {
  const raw = await env.SYNC_DATA.get(wechatSessionKey(userId));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as WechatSession;
    return parsed.openid && parsed.sessionKey ? parsed : null;
  } catch {
    return null;
  }
};

/** 小程序服务端接口的 access_token（cgi-bin/token），KV 缓存到过期前 5 分钟。 */
const wechatAccessToken = async (env: Env) => {
  const cached = await env.SYNC_DATA.get("wechat-access-token");
  if (cached) return cached;
  const response = await fetch(
    `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${encodeURIComponent(env.WECHAT_APP_ID ?? "")}&secret=${encodeURIComponent(env.WECHAT_APP_SECRET ?? "")}`
  );
  const result = await response.json<{ access_token?: string; expires_in?: number; errcode?: number; errmsg?: string }>();
  if (!result.access_token) throw json({ detail: `微信 access_token 获取失败：${result.errmsg ?? result.errcode ?? "unknown"}` }, 502);
  await env.SYNC_DATA.put("wechat-access-token", result.access_token, { expirationTtl: Math.max(60, (result.expires_in ?? 7200) - 300) });
  return result.access_token;
};

interface WechatOrderRow {
  out_trade_no: string;
  user_id: string;
  openid: string;
  product_id: string;
  price_cents: number;
  status: string;
  wx_order_id: string | null;
}

/** 客户端要一张订单：先入库再签（签名里带着 out_trade_no）。 */
const createWechatPayOrder = async (request: Request, env: Env) => {
  const userId = await requireUser(request, env);
  await rateLimit(env, request, `wechat-order:${userId}`, 10, 300);
  if (!wechatPayConfigured(env)) return json({ detail: "微信支付尚未在服务端配置。", code: "WECHAT_PAY_NOT_CONFIGURED" }, 501);
  const session = await loadWechatSession(env, userId);
  if (!session) return json({ detail: "请重新用微信登录后再购买。", code: "WECHAT_SESSION_MISSING" }, 401);
  const body = await readJson<{ productId?: string }>(request);
  const outTradeNo = crypto.randomUUID().replace(/-/g, "");
  let order;
  try {
    order = await createWechatOrder(env, session, String(body.productId ?? ""), outTradeNo);
  } catch (error) {
    const code = error instanceof Error ? error.message : "ORDER_FAILED";
    return json({ detail: code === "UNKNOWN_PRODUCT" ? "未知商品。" : code === "PRICE_NOT_CONFIGURED" ? "商品价格未配置。" : "下单失败。", code }, 400);
  }
  const now = new Date().toISOString();
  await env.DB.prepare(`
    INSERT INTO wechat_orders (out_trade_no, user_id, openid, product_id, price_cents, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'created', ?, ?)
  `).bind(outTradeNo, userId, session.openid, order.productId, order.priceCents, now, now).run();
  return json({ outTradeNo, productId: order.productId, priceCents: order.priceCents, ...order.payload });
};

/**
 * 「这单付了没」→ 付了才写权益 → 最后向微信确认发货。客户端付完喊一次；
 * 微信的 xpay_goods_deliver_notify 推送也走这里，客户端没喊也能补发。
 */
const settleWechatOrder = async (env: Env, order: WechatOrderRow, payload: unknown) => {
  const accessToken = await wechatAccessToken(env);
  const result = await wechatQueryOrderPaid(env, accessToken, { openid: order.openid }, order.out_trade_no);
  const now = new Date().toISOString();
  if (!result.paid) {
    await recordPurchaseEvent(env, order.user_id, order.product_id, order.out_trade_no, "unpaid", { query: result, payload }, order.out_trade_no, "wechat");
    return { paid: false as const, detail: result.errmsg ?? "订单尚未支付。" };
  }
  const productId = order.product_id as WechatPayProduct;
  const sandbox = Number(env.WECHAT_PAY_ENV ?? "0") === 1;
  const paidAtMs = result.order?.paid_time ? result.order.paid_time * 1000 : Date.now();
  let expiresAt = wechatExpiresAtFor(productId, paidAtMs);
  // 沙箱同 Apple 那条：一笔沙箱的永久购买不能变成正式账号上永不过期的 Pro。
  if (sandbox) {
    const cap = new Date(Date.now() + SANDBOX_ENTITLEMENT_MAX_MS).toISOString();
    expiresAt = expiresAt && expiresAt < cap ? expiresAt : cap;
  }
  const wxOrderId = result.order?.wx_order_id ?? order.out_trade_no;
  const entitlement = await saveEntitlement(env, order.user_id, {
    productId,
    source: "wechat",
    transactionId: wxOrderId,
    originalTransactionId: order.out_trade_no,
    environment: sandbox ? "sandbox" : "production",
    expiresAt
  });
  await recordPurchaseEvent(env, order.user_id, productId, wxOrderId, "verified", { order: result.order, payload }, order.out_trade_no, sandbox ? "sandbox" : "production");
  await env.DB.prepare("UPDATE wechat_orders SET status = 'paid', wx_order_id = ?, updated_at = ? WHERE out_trade_no = ?")
    .bind(wxOrderId, now, order.out_trade_no).run();
  // 发货确认放最后：权益已经写好，这一步失败只是微信那边会催，下次 verify 再喊。
  try {
    const delivered = await wechatNotifyProvideGoods(env, accessToken, { openid: order.openid }, order.out_trade_no);
    if (!delivered.errcode) {
      await env.DB.prepare("UPDATE wechat_orders SET status = 'delivered', updated_at = ? WHERE out_trade_no = ?")
        .bind(new Date().toISOString(), order.out_trade_no).run();
    }
  } catch (error) {
    console.warn("wechat notify_provide_goods failed", error);
  }
  return { paid: true as const, entitlement };
};

const verifyWechatPayOrder = async (request: Request, env: Env) => {
  const userId = await requireUser(request, env);
  await rateLimit(env, request, `wechat-verify:${userId}`, 20, 300);
  if (!wechatPayConfigured(env)) return json({ detail: "微信支付尚未在服务端配置。", code: "WECHAT_PAY_NOT_CONFIGURED" }, 501);
  const body = await readJson<{ outTradeNo?: string }>(request);
  const outTradeNo = String(body.outTradeNo ?? "").trim();
  if (!/^[0-9a-f]{32}$/.test(outTradeNo)) return json({ detail: "订单号无效。" }, 400);
  const order = await env.DB.prepare("SELECT * FROM wechat_orders WHERE out_trade_no = ?").bind(outTradeNo).first<WechatOrderRow>();
  if (!order) return json({ detail: "订单不存在。" }, 404);
  // 一笔订单只能给下单的那个账号（同 apple_transaction_owners 的道理）。
  if (order.user_id !== userId) return json({ detail: "这笔订单属于另一个账号。" }, 409);
  if (order.status === "delivered" || order.status === "paid") {
    return json({ paid: true, entitlement: entitlementPayload(await getEntitlementRow(env, userId)) });
  }
  const result = await settleWechatOrder(env, order, { via: "client" });
  if (!result.paid) return json({ paid: false, detail: result.detail }, 402);
  return json({ paid: true, entitlement: result.entitlement });
};

/**
 * 小程序后台「消息推送」的接收端（JSON 模式）。GET 是握手，POST 是事件。
 * ⚠️ 推送内容一个字都不信：只取 OutTradeNo，然后照常去问微信这单付了没。
 */
const wechatNotification = async (request: Request, env: Env) => {
  const url = new URL(request.url);
  const token = env.WECHAT_MSG_TOKEN ?? "";
  const signature = url.searchParams.get("signature") ?? "";
  const timestamp = url.searchParams.get("timestamp") ?? "";
  const nonce = url.searchParams.get("nonce") ?? "";
  if (!token || !(await wechatVerifyPushSignature(token, timestamp, nonce, signature))) {
    return new Response("forbidden", { status: 403 });
  }
  if (request.method === "GET") return new Response(url.searchParams.get("echostr") ?? "", { status: 200 });
  const event = await readJson<{ Event?: string; OutTradeNo?: string; OpenId?: string }>(request);
  const outTradeNo = String(event.OutTradeNo ?? "").trim();
  const order = outTradeNo
    ? await env.DB.prepare("SELECT * FROM wechat_orders WHERE out_trade_no = ?").bind(outTradeNo).first<WechatOrderRow>()
    : null;
  if (event.Event === "xpay_goods_deliver_notify" && order && order.status === "created") {
    await settleWechatOrder(env, order, { via: "push", event });
  } else if (event.Event === "xpay_refund_notify" && order) {
    await revokeEntitlementForTransaction(env, order.user_id, order.out_trade_no);
    await recordPurchaseEvent(env, order.user_id, order.product_id, order.wx_order_id ?? order.out_trade_no, "revoked", event, order.out_trade_no, "wechat");
    await env.DB.prepare("UPDATE wechat_orders SET status = 'refunded', updated_at = ? WHERE out_trade_no = ?")
      .bind(new Date().toISOString(), order.out_trade_no).run();
  }
  // 微信要求这个格式；不认识的事件也回 0，否则它会一直重投。
  return json({ ErrCode: 0 });
};

const linkApple = async (request: Request, env: Env) => {
  await rateLimit(env, request, "link-apple", 10, 300);
  const userId = await requireUser(request, env);
  const body = await readJson<{ identity_token?: string; nonce?: string }>(request);
  const claims = await verifyAppleIdentityToken(String(body.identity_token ?? ""), env, body.nonce);
  const existingIdentity = await env.DB.prepare(`
    SELECT user_id FROM auth_identities WHERE provider = 'apple' AND provider_subject = ?
  `).bind(claims.sub).first<{ user_id: string }>();
  if (existingIdentity && existingIdentity.user_id !== userId) {
    return json({ detail: "这个 Apple 账号已关联其他收集日账号。" }, 409);
  }
  const user = await env.DB.prepare("SELECT email FROM users WHERE id = ?")
    .bind(userId)
    .first<{ email: string }>();
  if (!user) return json({ detail: "User not found" }, 404);
  const appleEmail = normalizeEmail(claims.email);
  // 当前会话证明用户掌握原账号，Apple identity token 证明用户掌握 Apple 账号；
  // 两边都重新验证后才能关联，因此允许用户选择“隐藏邮箱”。不能仅凭邮箱相同静默合并。
  await env.DB.prepare(`
    INSERT OR IGNORE INTO auth_identities (provider, provider_subject, user_id, email, created_at)
    VALUES ('apple', ?, ?, ?, ?)
  `).bind(claims.sub, userId, appleEmail || user.email, new Date().toISOString()).run();
  const linkedIdentity = await env.DB.prepare(`
    SELECT user_id FROM auth_identities WHERE provider = 'apple' AND provider_subject = ?
  `).bind(claims.sub).first<{ user_id: string }>();
  if (!linkedIdentity || linkedIdentity.user_id !== userId) {
    return json({ detail: "这个 Apple 账号已关联其他收集日账号。" }, 409);
  }
  return json({ status: "linked", authProviders: await identityProviders(env, userId) });
};

const profile = async (request: Request, env: Env) => {
  const userId = await requireUser(request, env);
  const user = await env.DB.prepare(`
    SELECT email, display_name, bio, target_level, profile_updated_at,
           created_at, last_login, email_verified_at, terms_version, privacy_version, consented_at
    FROM users
    WHERE id = ?
  `).bind(userId).first<Record<string, unknown>>();
  if (!user) return json({ detail: "User not found" }, 404);
  return json({
    ...user,
    avatar: await env.SYNC_DATA.get(`${PROFILE_AVATAR_PREFIX}${userId}`),
    authProviders: await identityProviders(env, userId)
  });
};

const updateProfile = async (request: Request, env: Env) => {
  const userId = await requireUser(request, env);
  // 头像最大 3MB 直接写 KV,不限速就能被反复调用刷爆写入配额和账单。
  await rateLimitSubject(env, "profile-update", `user:${userId}`, 20, 3600);
  const body = await readJson<{
    display_name?: string;
    bio?: string;
    target_level?: string;
    avatar?: string | null;
  }>(request, PROFILE_BODY_LIMIT);
  const displayName = String(body.display_name ?? "").trim();
  const bio = String(body.bio ?? "").trim();
  const targetLevel = String(body.target_level ?? "N5").trim();
  if (!displayName || displayName.length > 20) return json({ detail: "昵称需要为 1 至 20 个字符。" }, 400);
  if (bio.length > 100) return json({ detail: "个人简介不能超过 100 个字符。" }, 400);
  if (!["N5", "N4", "N3", "N2", "N1", "旅游", "没有目标"].includes(targetLevel)) {
    return json({ detail: "学习目标无效。" }, 400);
  }
  if (typeof body.avatar === "string") {
    if (body.avatar.length > 3_000_000 || !/^data:image\/(?:png|jpe?g|webp|gif);base64,/i.test(body.avatar)) {
      return json({ detail: "头像格式无效或文件过大。" }, 400);
    }
    await env.SYNC_DATA.put(`${PROFILE_AVATAR_PREFIX}${userId}`, body.avatar);
  } else if (body.avatar === null) {
    await env.SYNC_DATA.delete(`${PROFILE_AVATAR_PREFIX}${userId}`);
  }
  const now = new Date().toISOString();
  await env.DB.prepare(`
    UPDATE users
    SET display_name = ?, bio = ?, target_level = ?, profile_updated_at = ?
    WHERE id = ?
  `).bind(displayName, bio, targetLevel, now, userId).run();
  return json({
    display_name: displayName,
    bio,
    target_level: targetLevel,
    profile_updated_at: now,
    // 只有这次真的动过头像才把它放进响应。没动的话客户端本来就有,
    // 为了改个昵称从 KV 读一遍 3MB 再原样发回去是纯浪费。
    ...(typeof body.avatar === "undefined" ? {} : { avatar: body.avatar })
  });
};

const logout = async (request: Request, env: Env) => {
  const tokenHash = await bearerTokenHash(request);
  if (tokenHash) {
    await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(tokenHash).run();
  }
  return json({ status: "success" });
};

const changePassword = async (request: Request, env: Env) => {
  const userId = await requireUser(request, env);
  // 改密要跑一次加盐哈希(故意很贵),而且是拿旧密码在线试错的入口。
  // 认证之后的路由同样需要按账号限速,不能只挡未登录那半边。
  await rateLimitSubject(env, "change-password", `user:${userId}`, 10, 900);
  const body = await readJson<{ current_password?: string; new_password?: string }>(request);
  const currentPassword = String(body.current_password ?? "");
  const newPassword = String(body.new_password ?? "");
  if (newPassword.length < 8) return json({ detail: "New password must be at least 8 characters" }, 400);
  const emailIdentity = await env.DB.prepare(`
    SELECT provider_subject FROM auth_identities WHERE user_id = ? AND provider = 'email'
  `).bind(userId).first();
  if (!emailIdentity) return json({ detail: "这个账号使用 Apple 登录，没有可修改的邮箱密码。" }, 400);

  const user = await env.DB.prepare(`
    SELECT id, email, password_hash, password_salt, display_name, email_verified_at
    FROM users
    WHERE id = ?
  `).bind(userId).first<UserRow>();
  if (!user) return json({ detail: "User not found" }, 404);

  const currentHash = await hashPassword(currentPassword, user.password_salt);
  if (currentHash !== user.password_hash) return json({ detail: "Current password is invalid" }, 401);

  const salt = randomToken(16);
  await env.DB.prepare("UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?")
    .bind(await hashPassword(newPassword, salt), salt, userId)
    .run();
  // 「我怀疑被盗号 → 改密码」必须真的把别处的登录踢掉，否则攻击者手里那个
  // 30 天 token 完全不受影响。保留当前这台设备的会话，不然自己也被踢出去。
  const currentTokenHash = await bearerTokenHash(request);
  await env.DB.prepare("DELETE FROM sessions WHERE user_id = ? AND token_hash IS NOT ?")
    .bind(userId, currentTokenHash)
    .run();
  return json({ status: "success" });
};

const sendVerificationEmail = async (request: Request, env: Env) => {
  await rateLimit(env, request, "send-code", 5, 900);
  const userId = await requireUser(request, env);
  const user = await env.DB.prepare(`
    SELECT id, email, password_hash, password_salt, display_name, email_verified_at
    FROM users
    WHERE id = ?
  `).bind(userId).first<UserRow>();
  if (!user) return json({ detail: "User not found" }, 404);
  if (user.email_verified_at) return json({ status: "already_verified", ...verificationPayload(env, user) });

  const code = await createEmailToken(env, user.id, "verify_email", EMAIL_CODE_TTL_MINUTES);
  await sendEmail(
    env,
    user.email,
    "收集日邮箱验证码",
    emailHtml("请使用下面的验证码完成邮箱验证：", code, EMAIL_CODE_TTL_MINUTES)
  );
  return json({ status: "sent", expiresInMinutes: EMAIL_CODE_TTL_MINUTES, ...verificationPayload(env, user) });
};

const verifyEmail = async (request: Request, env: Env) => {
  await rateLimit(env, request, "verify-email", 10, 900);
  const userId = await requireUser(request, env);
  const body = await readJson<{ code?: string }>(request);
  const code = String(body.code ?? "").trim();
  if (!/^\d{6}$/.test(code)) return json({ detail: "Verification code must be 6 digits" }, 400);

  const ok = await verifyEmailToken(env, userId, "verify_email", code);
  if (!ok) return json({ detail: "Verification code is invalid or expired" }, 400);

  await env.DB.prepare("UPDATE users SET email_verified_at = ? WHERE id = ?")
    .bind(new Date().toISOString(), userId)
    .run();
  return json({ status: "success", emailVerified: true });
};

const requestPasswordReset = async (request: Request, env: Env) => {
  assertAuthHardening(env);
  await rateLimit(env, request, "pwreset-request", 5, 900);
  const body = await readJson<{ email?: string; turnstile_token?: string }>(request);
  await verifyTurnstile(env, request, body.turnstile_token, "password_reset");
  const email = normalizeEmail(body.email);
  const user = await env.DB.prepare(`
    SELECT u.id, u.email, u.password_hash, u.password_salt, u.display_name, u.email_verified_at
    FROM users u
    JOIN auth_identities i ON i.user_id = u.id AND i.provider = 'email'
    WHERE u.email = ?
  `).bind(email).first<UserRow>();

  if (user) {
    const code = await createEmailToken(env, user.id, "password_reset", PASSWORD_RESET_TTL_MINUTES);
    await sendEmail(
      env,
      user.email,
      "收集日重置密码验证码",
      emailHtml("请使用下面的验证码重置你的收集日密码：", code, PASSWORD_RESET_TTL_MINUTES)
    );
  }

  return json({ status: "sent_if_account_exists", expiresInMinutes: PASSWORD_RESET_TTL_MINUTES });
};

const resetPassword = async (request: Request, env: Env) => {
  await rateLimit(env, request, "pwreset-verify", 10, 900);
  const body = await readJson<{ email?: string; code?: string; new_password?: string }>(request);
  const email = normalizeEmail(body.email);
  const code = String(body.code ?? "").trim();
  const newPassword = String(body.new_password ?? "");

  if (!/^\d{6}$/.test(code)) return json({ detail: "Verification code must be 6 digits" }, 400);
  if (newPassword.length < 8) return json({ detail: "New password must be at least 8 characters" }, 400);

  const user = await env.DB.prepare(`
    SELECT u.id, u.email, u.password_hash, u.password_salt, u.display_name, u.email_verified_at
    FROM users u
    JOIN auth_identities i ON i.user_id = u.id AND i.provider = 'email'
    WHERE u.email = ?
  `).bind(email).first<UserRow>();
  if (!user) return json({ detail: "Verification code is invalid or expired" }, 400);

  const ok = await verifyEmailToken(env, user.id, "password_reset", code);
  if (!ok) return json({ detail: "Verification code is invalid or expired" }, 400);

  const salt = randomToken(16);
  await env.DB.prepare("UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?")
    .bind(await hashPassword(newPassword, salt), salt, user.id)
    .run();
  await env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(user.id).run();
  return json({ status: "success" });
};

// App Store Guideline 5.1.1(v):提供账号创建就必须提供 App 内删除账号。
// 删除是不可逆的:云备份(KV/R2+D1)、权益、会话、验证码全部清除。
const deleteAccount = async (request: Request, env: Env) => {
  await rateLimit(env, request, "delete-account", 5, 900);
  const userId = await requireUser(request, env);
  const body = await readJson<{ password?: string; apple_identity_token?: string; apple_nonce?: string }>(request);

  const user = await env.DB.prepare(`
    SELECT id, email, password_hash, password_salt, display_name, email_verified_at
    FROM users
    WHERE id = ?
  `).bind(userId).first<UserRow>();
  if (!user) return json({ detail: "User not found" }, 404);

  const providers = await identityProviders(env, userId);
  if (body.apple_identity_token) {
    const claims = await verifyAppleIdentityToken(body.apple_identity_token, env, body.apple_nonce);
    const identity = await env.DB.prepare(`
      SELECT user_id FROM auth_identities WHERE provider = 'apple' AND provider_subject = ?
    `).bind(claims.sub).first<{ user_id: string }>();
    if (!identity || identity.user_id !== userId) return json({ detail: "Apple 账号验证失败。" }, 401);
  } else if (providers.includes("email")) {
    const passwordHash = await hashPassword(String(body.password ?? ""), user.password_salt);
    if (passwordHash !== user.password_hash) {
      return json({ detail: "账号密码不正确。" }, 401);
    }
  } else if (providers.includes("wechat")) {
    // 当前请求已经通过该微信会话认证；微信身份本身没有可再次输入的密码。
    // 账号删除仍要求有效 Bearer 会话，且后端会清理该身份的全部云数据。
  } else {
    return json({ detail: "请使用 Apple 重新验证身份后再删除账号。", code: "APPLE_REAUTH_REQUIRED" }, 401);
  }

  const objects = await env.DB.prepare("SELECT object_key, storage_backend FROM sync_objects WHERE user_id = ?")
    .bind(userId)
    .all<{ object_key: string; storage_backend: "kv" | "r2" }>();
  for (const row of objects.results ?? []) {
    await deleteSyncObject(env, row.object_key, row.storage_backend);
  }
  // 周报对象不进 sync_objects，删号时按用户前缀清理，避免云端历史成为孤儿。
  const weeklyObjects = await listAllWeeklyObjects(env, userId);
  for (let index = 0; index < weeklyObjects.length; index += 1000) {
    const keys = weeklyObjects.slice(index, index + 1000).map((object) => object.key);
    if (keys.length) await env.SYNC_BUCKET.delete(keys);
  }

  // 显式逐表删除,不依赖 FK 级联配置。purchase_events 一并删除:
  // 交易记录以 Apple 侧为准,服务端不保留可关联到用户的副本。
  for (const table of ["sessions", "auth_email_tokens", "auth_identities", "sync_rate_limits", "sync_uploads", "sync_heads", "sync_objects", "entitlements", "purchase_events"]) {
    await env.DB.prepare(`DELETE FROM ${table} WHERE user_id = ?`).bind(userId).run();
  }
  await env.SYNC_DATA.delete(`${PROFILE_AVATAR_PREFIX}${userId}`);
  await env.DB.prepare("DELETE FROM users WHERE id = ?").bind(userId).run();

  return json({ status: "deleted" });
};

type PurchaseOutcome =
  | { ok: true; entitlement: ReturnType<typeof entitlementPayload> }
  | { ok: false; status: number; detail: string };

const recordPurchaseEvent = async (
  env: Env,
  userId: string,
  productId: string,
  transactionId: string,
  status: string,
  payload: unknown,
  originalTransactionId?: string | null,
  environment?: string | null
) => {
  await env.DB.prepare(`
    INSERT OR IGNORE INTO purchase_events (id, user_id, product_id, transaction_id, original_transaction_id, environment, status, raw_payload, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    crypto.randomUUID(), userId, productId, transactionId,
    originalTransactionId ?? null, environment ?? null, status,
    JSON.stringify(payload), new Date().toISOString()
  ).run();
};

/**
 * 用 Apple 的 App Store Server API 重新确认一笔交易，然后把权益落到某个账号上。
 *
 * 购买校验、退款/续费通知、以及权益接口上的定期重查全部走这一条路 ——
 * 「这笔交易现在到底算不算数」只能有一份判断。
 */
const applyAppleTransaction = async (
  env: Env,
  userId: string,
  transactionId: string,
  expectedProductId?: string,
  currentSubscription?: CurrentAppleSubscription
): Promise<PurchaseOutcome> => {
  const apple = currentSubscription ?? await getAppleTransaction(env, transactionId);
  if (!apple) {
    await recordPurchaseEvent(env, userId, expectedProductId ?? "", transactionId, "missing_apple_config", {
      reason: "App Store Server API config is missing"
    });
    return { ok: false, status: 501, detail: "Apple verification is not configured on the server yet." };
  }

  const tx = apple.payload;
  const productId = tx.productId ?? expectedProductId ?? "";
  const originalTransactionId = tx.originalTransactionId ?? tx.transactionId ?? transactionId;
  const bundleMatches = !env.APP_BUNDLE_ID || tx.bundleId === env.APP_BUNDLE_ID;
  const productMatches = PRODUCT_IDS.has(productId) && (!expectedProductId || productId === expectedProductId);
  const transactionMatches = tx.transactionId === transactionId || tx.originalTransactionId === transactionId;

  // 撤权也属于写操作；先确认这确实是本应用、目标商品和同一条交易链，不能因为
  // 一个不相干或畸形响应就清掉账号已有权益。
  if (!bundleMatches || !productMatches || !transactionMatches) {
    await recordPurchaseEvent(env, userId, productId, transactionId, "rejected", apple.raw, originalTransactionId, tx.environment);
    return { ok: false, status: 400, detail: "Apple transaction did not match this app or product." };
  }

  // 订阅状态 2=过期、3=账单重试且无宽限、5=撤销。只看旧交易的 expiresDate
  // 无法区分这些状态；当前状态接口已经替 Apple 做了这个判断。
  if (currentSubscription && ![1, 4].includes(currentSubscription.status)) {
    await revokeEntitlementForTransaction(env, userId, originalTransactionId);
    await recordPurchaseEvent(
      env, userId, productId, tx.transactionId ?? transactionId,
      `subscription_status_${currentSubscription.status}`, apple.raw,
      originalTransactionId, tx.environment
    );
    return { ok: false, status: 400, detail: "Apple subscription is no longer active." };
  }

  // ⚠️ 被撤销的交易不只是「拒绝这次请求」：账号上那份靠它拿到的权益也必须撤掉，
  // 否则退款之后 Pro 一直留着（永久购买尤其明显，它根本不会自己过期）。
  if (tx.revocationDate) {
    await revokeEntitlementForTransaction(env, userId, originalTransactionId);
    await recordPurchaseEvent(env, userId, productId, transactionId, "revoked", apple.raw, originalTransactionId, tx.environment);
    return { ok: false, status: 400, detail: "Apple transaction has been revoked." };
  }
  // 归属先定下来，再谈权益。INSERT OR IGNORE 是一条原子语句，并发的第二个账号
  // 读回来的一定是先到的那个 user_id。
  const claimedAt = new Date().toISOString();
  await env.DB.prepare(`
    INSERT OR IGNORE INTO apple_transaction_owners (original_transaction_id, user_id, claimed_at)
    VALUES (?, ?, ?)
  `).bind(originalTransactionId, userId, claimedAt).run();
  const owner = await env.DB.prepare(
    "SELECT user_id FROM apple_transaction_owners WHERE original_transaction_id = ?"
  ).bind(originalTransactionId).first<{ user_id: string }>();
  if (owner && owner.user_id !== userId) {
    await recordPurchaseEvent(env, userId, productId, transactionId, "owned_by_other_account", apple.raw, originalTransactionId, tx.environment);
    return {
      ok: false,
      status: 409,
      detail: "这笔购买已经绑定到另一个收集日账号。请用那个账号登录，或联系支持转移。"
    };
  }

  let expiresAt = tx.expiresDate ? new Date(tx.expiresDate).toISOString() : null;
  const isSandbox = (tx.environment ?? "").toLowerCase() === "sandbox";
  if (isSandbox) {
    const cap = Date.now() + SANDBOX_ENTITLEMENT_MAX_MS;
    expiresAt = new Date(Math.min(expiresAt ? Date.parse(expiresAt) : cap, cap)).toISOString();
  }

  const entitlement = await saveEntitlement(env, userId, {
    productId,
    source: "app_store",
    transactionId: tx.transactionId ?? transactionId,
    originalTransactionId,
    environment: tx.environment,
    expiresAt
  });
  await recordPurchaseEvent(env, userId, productId, tx.transactionId ?? transactionId, "verified", apple.raw, originalTransactionId, tx.environment);
  return { ok: true, entitlement };
};

const recheckAppleEntitlement = async (env: Env, userId: string, row: EntitlementRow) => {
  const transactionId = row.original_transaction_id ?? row.transaction_id;
  if (!transactionId) return null;
  if (row.original_transaction_id && row.product_id && SUBSCRIPTION_PRODUCT_IDS.has(row.product_id)) {
    const current = await getCurrentAppleSubscription(env, transactionId, row.original_transaction_id);
    if (current) return applyAppleTransaction(env, userId, transactionId, undefined, current);
  }
  return applyAppleTransaction(env, userId, transactionId);
};

const verifyPurchase = async (request: Request, env: Env) => {
  const userId = await requireUser(request, env);
  // 每次校验都会往 Apple 发一次请求,不限速等于把出网调用敞开给任何登录账号。
  await rateLimitSubject(env, "purchase-verify", `user:${userId}`, 30, 3600);
  const body = await readJson<{ product_id?: string; transaction_id?: string }>(request);
  const productId = String(body.product_id ?? "");
  const transactionId = String(body.transaction_id ?? "");
  if (!PRODUCT_IDS.has(productId)) return json({ detail: "Unknown product_id" }, 400);
  if (!transactionId) return json({ detail: "transaction_id is required" }, 400);

  const result = await applyAppleTransaction(env, userId, transactionId, productId);
  return result.ok ? json(result.entitlement) : json({ detail: result.detail }, result.status);
};

/**
 * App Store Server Notifications V2。
 *
 * ⚠️ **这里一个字都不信 signedPayload**：只从里面取出交易号，然后照常用带鉴权的
 * App Store Server API 把这笔交易查一遍，用查回来的结果做决定。这样就不用在
 * Worker 里实现 x5c 证书链校验，也天然免疫重复投递和乱序 —— 每次都是「现在
 * Apple 怎么说」，不是「这条通知怎么说」。
 */
const appleNotification = async (request: Request, env: Env) => {
  await rateLimit(env, request, "apple-notification", 120, 300);
  const body = await readJson<{ signedPayload?: string }>(request);
  const signedPayload = String(body.signedPayload ?? "");
  const payloadPart = signedPayload.split(".")[1];

  // ⚠️ 每一次投递都留痕,包括看不懂的和无人认领的。
  // 没有这一步,Apple 的「Request a Test Notification」打进来就是零痕迹 ——
  // 「通知地址到底配对了没有」只能等真实退款发生时才发现,那时已经晚了。
  const record = async (fields: {
    outcome: string;
    notificationType?: string;
    subtype?: string;
    transactionId?: string;
    originalTransactionId?: string;
    environment?: string;
    userId?: string;
  }) => {
    await env.DB.prepare(`
      INSERT INTO apple_notifications (
        id, notification_type, subtype, transaction_id, original_transaction_id,
        environment, outcome, user_id, received_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      crypto.randomUUID(), fields.notificationType ?? null, fields.subtype ?? null,
      fields.transactionId ?? null, fields.originalTransactionId ?? null,
      fields.environment ?? null, fields.outcome, fields.userId ?? null,
      new Date().toISOString()
    ).run().catch(() => undefined);
  };

  if (!payloadPart) {
    await record({ outcome: "ignored" });
    return json({ detail: "signedPayload is required" }, 400);
  }

  let transactionId = "";
  let notificationType: string | undefined;
  let subtype: string | undefined;
  try {
    const payload = base64UrlToJson<{
      notificationType?: string;
      subtype?: string;
      data?: { signedTransactionInfo?: string };
    }>(payloadPart);
    notificationType = payload.notificationType;
    subtype = payload.subtype;
    const info = payload.data?.signedTransactionInfo?.split(".")[1];
    if (info) transactionId = String(base64UrlToJson<AppleTransactionPayload>(info).transactionId ?? "");
  } catch {
    transactionId = "";
  }

  // TEST 通知没有交易信息 —— 它唯一的作用就是证明这条链路是通的,所以到这儿就够了。
  if (!transactionId) {
    await record({ outcome: "ignored", notificationType, subtype });
    return json({ status: "ignored", notificationType: notificationType ?? null });
  }

  // 通知只是「去看看这笔交易」的提示;真假由下面的 Apple 查询决定。
  const apple = await getAppleTransaction(env, transactionId).catch(() => null);
  if (!apple) {
    await record({ outcome: "apple_lookup_failed", notificationType, subtype, transactionId });
    return json({ status: "apple_lookup_failed" });
  }
  const originalTransactionId = apple.payload.originalTransactionId ?? apple.payload.transactionId ?? transactionId;
  const owner = await env.DB.prepare(
    "SELECT user_id FROM apple_transaction_owners WHERE original_transaction_id = ?"
  ).bind(originalTransactionId).first<{ user_id: string }>();
  // 没人认领过这笔交易(还没登录就买的)——客户端登录后会自己补报。
  if (!owner) {
    await record({
      outcome: "unclaimed", notificationType, subtype, transactionId,
      originalTransactionId, environment: apple.payload.environment
    });
    return json({ status: "unclaimed" });
  }

  await applyAppleTransaction(env, owner.user_id, transactionId);
  await record({
    outcome: "applied", notificationType, subtype, transactionId,
    originalTransactionId, environment: apple.payload.environment, userId: owner.user_id
  });
  return json({ status: "ok" });
};

/**
 * 权益接口上的兜底重查。
 *
 * 通知可能没配、可能投递失败，而缓存自己发现不了退款(实测:写入永久权益后
 * 模拟退款，再查权益仍然返回 Pro，Apple 重查次数 0)。所以每个账号每天
 * 最多向 Apple 重查一次自己那笔交易。
 */
const ENTITLEMENT_RECHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
/** Apple 查不通时把下次重查推后这么久,而不是留在「陈的」状态被每次请求重试。 */
const RECHECK_BACKOFF_MS = 60 * 60 * 1000;

const getEntitlements = async (request: Request, env: Env) => {
  const userId = await requireUser(request, env);
  const row = await getEntitlementRow(env, userId);
  const stale = row?.is_pro
    && row.source === "app_store"
    && row.transaction_id
    && Date.parse(row.updated_at) + ENTITLEMENT_RECHECK_INTERVAL_MS < Date.now();
  if (stale) {
    try {
      const result = await recheckAppleEntitlement(env, userId, row!);
      if (result?.ok) return json(result.entitlement);
    } catch {
      // ⚠️ Apple 不通时按现有缓存回答,但**必须把下次重查往后推**。
      // 只 catch 不推的话 updated_at 一直是陈的,于是 Apple 挂着的时候
      // 这个账号的每一次 GET 都会再去撞一次 —— 客户端每次启动都调它。
      await env.DB.prepare("UPDATE entitlements SET updated_at = ? WHERE user_id = ?")
        .bind(new Date(Date.now() - ENTITLEMENT_RECHECK_INTERVAL_MS + RECHECK_BACKOFF_MS).toISOString(), userId)
        .run();
    }
    return json(entitlementPayload(await getEntitlementRow(env, userId)));
  }
  return json(entitlementPayload(row));
};

const deleteSyncObject = async (
  env: Env,
  objectKey: string,
  storageBackend: "kv" | "r2"
) => {
  if (storageBackend === "r2") await env.SYNC_BUCKET.delete(objectKey);
  else await env.SYNC_DATA.delete(objectKey);
};

const pushSync = async (request: Request, env: Env) => {
  const contentLengthHeader = request.headers.get("content-length");
  const contentLength = contentLengthHeader === null ? undefined : Number(contentLengthHeader);
  if (contentLength !== undefined && Number.isFinite(contentLength) && contentLength > SYNC_MAX_REQUEST_BODY_LENGTH) {
    return json({ detail: "Backup is too large" }, 413);
  }
  const userId = await requireVerifiedUser(request, env);
  // 客户端自动上传最快每 5 分钟一次 = 12 次/小时，配额必须留出余量：
  // 手动上传、以及「合并后立刻推送」(一次同步算两次 push) 都会叠在上面。
  // 配额定在 12 等于让正常使用必然撞 429。
  await enforceSyncRateLimit(env, request, userId, env.SYNC_PUSH_LIMITER, "push", 30);

  const binaryUpload = (request.headers.get("content-type") ?? "").includes("application/octet-stream");
  let snapshotBytes: Uint8Array;
  let snapshotFormat: string;
  let compression: "none" | "gzip";
  let operationId: string;
  let baseModified: string;
  let baseGeneration: number | undefined;

  if (binaryUpload) {
    snapshotFormat = String(request.headers.get("x-sync-format") ?? "").trim();
    if (snapshotFormat !== "master-nihongo-user-sqlite-v1") {
      return json({ detail: "Unsupported sync snapshot format" }, 400);
    }
    const compressionHeader = request.headers.get("x-sync-compression");
    if (compressionHeader !== "gzip" && compressionHeader !== "none") {
      return json({ detail: "Unsupported sync compression" }, 400);
    }
    compression = compressionHeader;
    snapshotBytes = await readBodyBytes(request, SYNC_MAX_REQUEST_BODY_LENGTH);
    operationId = String(request.headers.get("x-sync-operation-id") ?? crypto.randomUUID()).trim();
    baseModified = String(request.headers.get("x-sync-base-modified") ?? "").trim();
    const generationHeader = request.headers.get("x-sync-base-generation");
    const parsedGeneration = generationHeader === null ? NaN : Number(generationHeader);
    baseGeneration = Number.isInteger(parsedGeneration) ? parsedGeneration : undefined;
  } else {
    // 兼容旧客户端。收到整库 Base64 后也转换成二进制存入 R2，避免继续新增 KV 大对象。
    const body = await readJson<{
      db_data?: string;
      base_modified?: string;
      base_generation?: number;
      operation_id?: string;
    }>(request, SYNC_MAX_REQUEST_BODY_LENGTH);
    const dbData = String(body.db_data ?? "");
    if (!dbData) return json({ detail: "db_data is required" }, 400);
    if (dbData.length > SYNC_MAX_BASE64_LENGTH) return json({ detail: "Backup is too large" }, 413);
    try {
      snapshotBytes = base64UrlToBytes(dbData);
    } catch {
      return json({ detail: "db_data is not valid Base64" }, 400);
    }
    snapshotFormat = "legacy-full-sqlite";
    compression = "none";
    operationId = String(body.operation_id ?? crypto.randomUUID()).trim();
    baseModified = String(body.base_modified ?? "").trim();
    baseGeneration = Number.isInteger(body.base_generation) ? Number(body.base_generation) : undefined;
  }
  if (!snapshotBytes.byteLength || snapshotBytes.byteLength > SYNC_MAX_BASE64_LENGTH) {
    return json({ detail: "Backup is too large" }, 413);
  }
  if (operationId.length < 8 || operationId.length > 255) {
    return json({ detail: "operation_id is invalid" }, 400);
  }
  const payloadHash = await sha256Bytes(snapshotBytes);
  const previousOperation = await env.DB.prepare(`
    SELECT payload_hash, generation, last_modified
    FROM sync_uploads
    WHERE operation_id = ? AND user_id = ?
  `).bind(operationId, userId).first<{ payload_hash: string; generation: number; last_modified: string }>();
  if (previousOperation) {
    if (previousOperation.payload_hash !== payloadHash) {
      return json({ detail: "同一个 operation_id 不能对应不同的备份内容。" }, 409);
    }
    return json({
      status: "success",
      message: "Sync data was already uploaded",
      timestamp: previousOperation.last_modified,
      generation: previousOperation.generation,
      idempotent_replay: true
    });
  }

  const now = new Date().toISOString();
  await env.DB.prepare(`
    INSERT OR IGNORE INTO sync_heads (user_id, generation, updated_at)
    VALUES (?, 0, ?)
  `).bind(userId, now).run();
  const head = await env.DB.prepare(`
    SELECT user_id, generation, object_key, last_modified, payload_hash, updated_at
    FROM sync_heads
    WHERE user_id = ?
  `).bind(userId).first<SyncHead>();
  if (!head) return json({ detail: "无法读取同步版本。" }, 503);

  const hasBaseGeneration = typeof baseGeneration === "number";
  // 同一内容的超时重试即使换了 operation_id 也不应制造新版本。
  // 这覆盖了“服务端已写入但响应在网络中丢失”的常见重试场景。
  if (head.payload_hash === payloadHash && head.object_key) {
    return json({
      status: "success",
      message: "Sync data is already current",
      timestamp: head.last_modified,
      generation: head.generation,
      idempotent_replay: true
    });
  }
  // 自动上传带上服务端版本。版本已变化时拒绝覆盖,让客户端先合并/拉取;
  // 这是乐观并发控制,不能只靠客户端在写入前 SELECT 一次。
  if (hasBaseGeneration && head.generation !== baseGeneration) {
    return json({
      detail: "云端已有更新，请先同步云端进度后再上传。",
      conflict: true,
      last_modified: head.last_modified,
      generation: head.generation
    }, 409);
  }
  if (!hasBaseGeneration && baseModified && head.last_modified !== baseModified) {
    return json({
      detail: "云端已有更新，请先同步云端进度后再上传。",
      conflict: true,
      last_modified: head.last_modified,
      generation: head.generation
    }, 409);
  }

  // 由 Worker 统一生成时间戳,不信任设备时钟,便于多端比较版本。
  const lastModified = now;
  const generation = head.generation + 1;
  const id = crypto.randomUUID();
  const objectKey = `${userId}/${id}.${compression === "gzip" ? "sqlite.gz" : "sqlite"}`;
  await env.SYNC_BUCKET.put(objectKey, snapshotBytes, {
    customMetadata: { userId, lastModified, snapshotFormat, compression }
  });

  // R2 对象先写入,D1 再用条件 UPDATE 原子抢占版本。D1 失败或并发失败时
  // 立即删除孤儿对象，避免对象存储缓慢泄漏。
  let batch: D1Result[];
  try {
    batch = await env.DB.batch([
      env.DB.prepare(`
        UPDATE sync_heads
        SET generation = ?, object_key = ?, last_modified = ?, payload_hash = ?, updated_at = ?
        WHERE user_id = ? AND generation = ?
      `).bind(generation, objectKey, lastModified, payloadHash, now, userId, head.generation),
      env.DB.prepare(`
        INSERT INTO sync_objects (
          id, user_id, object_key, last_modified, generation, created_at, byte_length, payload_hash,
          storage_backend, snapshot_format, compression
        )
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, 'r2', ?, ?
        WHERE EXISTS (
          SELECT 1 FROM sync_heads
          WHERE user_id = ? AND generation = ? AND object_key = ?
        )
      `).bind(
        id, userId, objectKey, lastModified, generation, now, snapshotBytes.byteLength, payloadHash,
        snapshotFormat, compression, userId, generation, objectKey
      ),
      env.DB.prepare(`
        INSERT INTO sync_uploads (
          operation_id, user_id, payload_hash, generation, object_key, last_modified, created_at
        )
        SELECT ?, ?, ?, ?, ?, ?, ?
        WHERE EXISTS (
          SELECT 1 FROM sync_heads
          WHERE user_id = ? AND generation = ? AND object_key = ?
        )
      `).bind(
        operationId, userId, payloadHash, generation, objectKey, lastModified, now,
        userId, generation, objectKey
      )
    ]);
  } catch (error) {
    await env.SYNC_BUCKET.delete(objectKey);
    throw error;
  }

  const headChanged = Number(batch[0]?.meta?.changes ?? 0) > 0;
  if (!headChanged) {
    await env.SYNC_BUCKET.delete(objectKey);
    const latest = await env.DB.prepare(`
      SELECT generation, last_modified, payload_hash
      FROM sync_heads
      WHERE user_id = ?
    `).bind(userId).first<{ generation: number; last_modified: string | null; payload_hash: string | null }>();
    if (latest?.payload_hash === payloadHash) {
      return json({ status: "success", timestamp: latest.last_modified, generation: latest.generation, idempotent_replay: true });
    }
    return json({
      detail: "云端已有更新，请先同步云端进度后再上传。",
      conflict: true,
      last_modified: latest?.last_modified ?? null,
      generation: latest?.generation ?? null
    }, 409);
  }

  // 只保留最近几代备份；升级期间旧 KV 与新 R2 对象按各自后端清理。
  const stale = await env.DB.prepare(`
    SELECT id, object_key, storage_backend
    FROM sync_objects
    WHERE user_id = ?
    ORDER BY generation DESC, created_at DESC
    LIMIT -1 OFFSET ?
  `).bind(userId, SYNC_KEEP_GENERATIONS).all<{
    id: string;
    object_key: string;
    storage_backend: "kv" | "r2";
  }>();
  for (const row of stale.results ?? []) {
    await deleteSyncObject(env, row.object_key, row.storage_backend);
    await env.DB.prepare("DELETE FROM sync_objects WHERE id = ?").bind(row.id).run();
  }

  return json({ status: "success", message: "Sync data uploaded", timestamp: now, generation });
};

const syncStatus = async (request: Request, env: Env) => {
  const userId = await requireVerifiedUser(request, env);
  await enforceSyncRateLimit(env, request, userId, env.SYNC_STATUS_LIMITER, "status", 120);
  const head = await env.DB.prepare(`
    SELECT generation, object_key, last_modified
    FROM sync_heads
    WHERE user_id = ?
  `).bind(userId).first<Pick<SyncHead, "generation" | "object_key" | "last_modified">>();

  if (!head?.object_key || !head.last_modified) {
    return json({ available: false, last_modified: null, byte_length: 0, generation: head?.generation ?? 0 });
  }
  const row = await env.DB.prepare(`
    SELECT byte_length
    FROM sync_objects
    WHERE user_id = ? AND object_key = ?
    LIMIT 1
  `).bind(userId, head.object_key).first<{ byte_length: number }>();
  return json({
    available: Boolean(row),
    last_modified: head.last_modified,
    byte_length: row?.byte_length ?? 0,
    generation: head.generation
  });
};

const pullSync = async (request: Request, env: Env) => {
  const userId = await requireVerifiedUser(request, env);
  await enforceSyncRateLimit(env, request, userId, env.SYNC_PULL_LIMITER, "pull", 30);
  const head = await env.DB.prepare(`
    SELECT generation, object_key, last_modified
    FROM sync_heads
    WHERE user_id = ?
  `).bind(userId).first<Pick<SyncHead, "generation" | "object_key" | "last_modified">>();
  if (!head?.object_key || !head.last_modified) return json({ detail: "No sync data found" }, 404);
  const row = await env.DB.prepare(`
    SELECT object_key, last_modified, generation, byte_length,
           storage_backend, snapshot_format, compression
    FROM sync_objects
    WHERE user_id = ? AND object_key = ?
    LIMIT 1
  `).bind(userId, head.object_key).first<SyncRow>();

  if (!row) return json({ detail: "No sync data found" }, 404);
  const wantsBinary = (request.headers.get("accept") ?? "").includes("application/octet-stream");
  if (!wantsBinary) {
    // 旧客户端只认识 { db_data: Base64 }，且会把它当完整 App 数据库导入。
    // 新用户快照不含词典，绝不能伪装成旧整库返回；明确要求升级最安全。
    if (row.snapshot_format !== "legacy-full-sqlite" || row.compression !== "none") {
      return json({
        detail: "云同步格式已升级，请更新收集日后继续同步。",
        code: "SYNC_CLIENT_UPDATE_REQUIRED"
      }, 426);
    }
    let legacyBase64: string | null = null;
    if (row.storage_backend === "r2") {
      const object = await env.SYNC_BUCKET.get(row.object_key);
      if (object) legacyBase64 = bytesToBase64(await object.arrayBuffer());
    } else {
      legacyBase64 = await env.SYNC_DATA.get(row.object_key);
    }
    if (!legacyBase64) return json({ detail: "Sync object is missing" }, 404);
    return json({
      db_data: legacyBase64,
      last_modified: row.last_modified,
      byte_length: row.byte_length,
      generation: row.generation
    });
  }

  const headers = {
    "content-type": "application/octet-stream",
    "cache-control": "no-store",
    "x-sync-format": row.snapshot_format,
    "x-sync-compression": row.compression,
    "x-sync-generation": String(row.generation),
    "x-sync-last-modified": row.last_modified,
    "x-sync-byte-length": String(row.byte_length),
    ...corsHeaders()
  };
  if (row.storage_backend === "r2") {
    const object = await env.SYNC_BUCKET.get(row.object_key);
    if (!object) return json({ detail: "Sync object is missing" }, 404);
    return new Response(object.body, { headers });
  }

  // 存量 KV 对象是 Base64 文本。读取时转换成原始 SQLite 二进制，客户端仍按
  // legacy-full-sqlite 合并；下一次上传后该账号会自然迁到 R2 用户快照。
  const legacyBase64 = await env.SYNC_DATA.get(row.object_key);
  if (!legacyBase64) return json({ detail: "Sync object is missing" }, 404);
  try {
    return new Response(base64UrlToBytes(legacyBase64), { headers });
  } catch {
    return json({ detail: "Sync object is corrupted" }, 500);
  }
};

const validateWeekStart = (value: unknown): string => {
  const weekStart = String(value ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) throw json({ detail: "week_start is invalid" }, 400);
  const parsed = new Date(`${weekStart}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== weekStart || parsed.getUTCDay() !== 0) {
    throw json({ detail: "week_start is invalid" }, 400);
  }
  return weekStart;
};

const weeklyReportKey = (userId: string, weekStart: string) => `${WEEKLY_REPORT_PREFIX}${userId}/${weekStart}.json`;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const validWeeklyReport = (value: unknown, weekStart: string): boolean => {
  if (!isRecord(value) || !isRecord(value.window) || !isRecord(value.metrics)) return false;
  const window = value.window;
  const metrics = value.metrics;
  if (window.start !== weekStart || typeof window.end !== "string" || !isFiniteNumber(window.startAt) || !isFiniteNumber(window.endAt)) return false;
  const numericMetrics = [
    "days", "minutes", "totalSeconds", "totalReviews", "wordReviews", "grammarReviews",
    "kanjiReviews", "newWords", "reviewCount", "streak", "cumulativeDays", "cumulativeWords"
  ];
  if (numericMetrics.some((key) => !isFiniteNumber(metrics[key]) || Number(metrics[key]) < 0)) return false;
  if (!Array.isArray(metrics.daily) || !metrics.daily.every((item) =>
    isRecord(item) && typeof item.date === "string" && isFiniteNumber(item.reviews) && isFiniteNumber(item.newWords)
  )) return false;
  return Array.isArray(value.keywordCandidates) && Array.isArray(value.references);
};

const listAllWeeklyObjects = async (env: Env, userId: string): Promise<R2Object[]> => {
  const objects: R2Object[] = [];
  let cursor: string | undefined;
  do {
    const page = await env.SYNC_BUCKET.list({ prefix: `${WEEKLY_REPORT_PREFIX}${userId}/`, limit: 1000, ...(cursor ? { cursor } : {}) });
    objects.push(...(page.objects ?? []));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return objects;
};

const listWeeklyReports = async (request: Request, env: Env) => {
  const userId = await requireProUser(request, env);
  const listed = await listAllWeeklyObjects(env, userId);
  const reports = listed.map((object) => ({
    week_start: object.key.split("/").pop()?.replace(/\.json$/, "") ?? "",
    uploaded_at: object.uploaded.toISOString(),
    byte_length: object.size
  })).filter((item) => /^\d{4}-\d{2}-\d{2}$/.test(item.week_start));
  reports.sort((a, b) => b.week_start.localeCompare(a.week_start));
  return json({ reports });
};

const getWeeklyReportCloud = async (request: Request, env: Env) => {
  const userId = await requireProUser(request, env);
  const weekStart = validateWeekStart(new URL(request.url).searchParams.get("week_start"));
  const object = await env.SYNC_BUCKET.get(weeklyReportKey(userId, weekStart));
  if (!object) return json({ detail: "Weekly report not found" }, 404);
  return new Response(object.body, {
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...corsHeaders() }
  });
};

const putWeeklyReportCloud = async (request: Request, env: Env) => {
  const userId = await requireProUser(request, env);
  const body = await readJson<{ week_start?: string; report?: unknown }>(request, WEEKLY_REPORT_MAX_BYTES);
  const weekStart = validateWeekStart(body.week_start);
  if (!body.report || typeof body.report !== "object" || Array.isArray(body.report)) throw json({ detail: "report is required" }, 400);
  if (!validWeeklyReport(body.report, weekStart)) {
    throw json({ detail: "report shape is invalid" }, 400);
  }
  const content = JSON.stringify({ schemaVersion: 2, weekStart, report: body.report });
  const bytes = new TextEncoder().encode(content);
  if (bytes.byteLength > WEEKLY_REPORT_MAX_BYTES) throw json({ detail: "Weekly report is too large" }, 413);
  const key = weeklyReportKey(userId, weekStart);
  const existing = await env.SYNC_BUCKET.get(key);
  if (existing) {
    const old = new Uint8Array(await existing.arrayBuffer());
    const same = old.byteLength === bytes.byteLength && old.every((value, index) => value === bytes[index]);
    if (same) return json({ status: "success", week_start: weekStart, byte_length: bytes.byteLength });
    throw json({ detail: "Weekly report already exists with different content", code: "WEEKLY_REPORT_CONFLICT" }, 409);
  }
  const created = await env.SYNC_BUCKET.put(key, bytes, {
    onlyIf: { etagDoesNotMatch: "*" },
    httpMetadata: { contentType: "application/json; charset=utf-8", cacheControl: "no-store" },
    customMetadata: { userId, weekStart, kind: "weekly-report" }
  });
  if (!created) {
    const raced = await env.SYNC_BUCKET.get(key);
    if (raced) {
      const old = new Uint8Array(await raced.arrayBuffer());
      if (old.byteLength === bytes.byteLength && old.every((value, index) => value === bytes[index])) {
        return json({ status: "success", week_start: weekStart, byte_length: bytes.byteLength });
      }
    }
    throw json({ detail: "Weekly report already exists with different content", code: "WEEKLY_REPORT_CONFLICT" }, 409);
  }
  return json({ status: "success", week_start: weekStart, byte_length: bytes.byteLength });
};

const deleteWeeklyReportCloud = async (request: Request, env: Env) => {
  const userId = await requireProUser(request, env);
  const weekStart = validateWeekStart(new URL(request.url).searchParams.get("week_start"));
  await env.SYNC_BUCKET.delete(weeklyReportKey(userId, weekStart));
  return json({ status: "success", week_start: weekStart });
};

const escapeHtml = (value: string) => value
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#39;");

const legalPage = (
  title: string,
  effectiveDate: string,
  sections: Array<{ title: string; body: string[] }>
) => {
  const sectionsHtml = sections.map((section) => `
    <section>
      <h2>${escapeHtml(section.title)}</h2>
      ${section.body.map((line) => `<p>${escapeHtml(line)}</p>`).join("\n")}
    </section>
  `).join("\n");
  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; line-height: 1.75; color: #1c3a34; max-width: 720px; margin: 0 auto; padding: 32px 20px 64px; }
    h1 { font-size: 26px; margin-bottom: 4px; }
    h2 { font-size: 18px; margin: 28px 0 8px; color: #16564d; }
    p { margin: 8px 0; }
    .date { color: #1f7469; font-weight: 700; font-size: 14px; }
  </style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <p class="date">生效日期：${escapeHtml(effectiveDate)}</p>
  ${sectionsHtml}
</body>
</html>`;
  return new Response(html, {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=3600" }
  });
};

// 隐私政策公开页,填入 App Store Connect 的 Privacy Policy URL。
// 内容与 App 内页面共享同一份 privacy-policy-content.ts。
const privacyPolicyPage = () => {
  return legalPage(PRIVACY_POLICY_TITLE, PRIVACY_POLICY_EFFECTIVE_DATE, PRIVACY_POLICY_SECTIONS);
};

const userAgreementPage = () => (
  legalPage(USER_AGREEMENT_TITLE, USER_AGREEMENT_EFFECTIVE_DATE, USER_AGREEMENT_SECTIONS)
);

const turnstileChallengePage = (request: Request, env: Env) => {
  if (!turnstileEnabled(env)) return json({ detail: "Turnstile is not configured" }, 404);
  const requestedAction = new URL(request.url).searchParams.get("action") ?? "login";
  const action = TURNSTILE_ACTIONS.has(requestedAction) ? requestedAction : "login";
  const html = `<!doctype html>
<html lang="zh-CN"><head>
  <meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <style>html,body{margin:0;min-height:70px;background:transparent;display:grid;place-items:center}</style>
  <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
</head><body>
  <div class="cf-turnstile" data-sitekey="${escapeHtml(env.TURNSTILE_SITE_KEY!)}"
    data-action="${action}" data-theme="auto" data-size="flexible"
    data-appearance="interaction-only" data-callback="verified" data-expired-callback="expired"></div>
  <script>
    function send(payload){ parent.postMessage(Object.assign({type:'mn-turnstile',action:'${action}'},payload),'*'); }
    function verified(token){ send({token:token}); }
    function expired(){ send({token:''}); }
  </script>
</body></html>`;
  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "content-security-policy": "default-src 'none'; script-src 'unsafe-inline' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; connect-src https://challenges.cloudflare.com; style-src 'unsafe-inline'; img-src https://challenges.cloudflare.com data:"
    }
  });
};

/**
 * 部署自检。**只返回布尔量**，不吐任何密钥、计数或用户信息。
 *
 * 它回答的是三个「本地仓库里看不出来」的问题：
 *   - 远端到底有没有把 `REQUIRE_AUTH_HARDENING` 打开、Turnstile / 邮件配没配；
 *   - 远端 D1 到底有没有应用 0009–0012（少一张表 = 内购归属、限速、通知留痕静默失效）；
 *   - Apple 的 App Store Server API 凭据齐不齐。
 *
 * 没有这个接口，上面这些只能靠"应该配了吧"，而它们全都是**静默失效**：
 * 接口一切正常、返回 200，直到某天有人用同一笔交易开了两个账号。
 */
const health = async (env: Env) => {
  const required = [
    "apple_transaction_owners", // 0009
    "auth_rate_limits",         // 0010
    "apple_notifications",      // 0012
    "wechat_orders"             // 0013
  ];
  const found = await env.DB.prepare(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (${required.map(() => "?").join(", ")})`
  ).bind(...required).all<{ name: string }>();
  const present = new Set((found.results ?? []).map((row) => row.name));
  // 0011 换的是索引不是表，单独看。
  const purchaseIndex = await env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_purchase_events_transaction_status'"
  ).first<{ name: string }>();

  const migrations = Object.fromEntries(required.map((table) => [table, present.has(table)]));
  migrations.idx_purchase_events_transaction_status = Boolean(purchaseIndex);
  const migrationsApplied = Object.values(migrations).every(Boolean);
  const authHardening = env.REQUIRE_AUTH_HARDENING === "1";
  const turnstile = turnstileEnabled(env);
  const email = Boolean(env.RESEND_API_KEY);

  return json({
    ok: migrationsApplied && (!authHardening || (turnstile && email)),
    migrationsApplied,
    migrations,
    authHardening,
    turnstileConfigured: turnstile,
    emailConfigured: email,
    appStoreConfigured: Boolean(
      env.APP_STORE_ISSUER_ID && env.APP_STORE_KEY_ID && env.APP_STORE_PRIVATE_KEY && env.APP_BUNDLE_ID
    ),
    appStoreEnvironment: env.APP_STORE_ENVIRONMENT ?? "Production",
    wechatPayConfigured: wechatPayConfigured(env),
    wechatPushConfigured: Boolean(env.WECHAT_MSG_TOKEN),
    // 云端周报的保存期限。为 0 表示「未配置 = 不清理」：可以继续本地使用，
    // 但按计划不该在期限未定前售卖云端历史。
    weeklyReportRetentionDays: weeklyReportRetentionDays(env),
    // ⚠️ 这里为 false 就是"生产在裸奔"：注册/登录/找回密码没有人机验证或邮箱验证兜底，
    // 而接口不会报任何错。打开 REQUIRE_AUTH_HARDENING=1 会让这种情况直接 503。
    productionReady: migrationsApplied && turnstile && email && authHardening
  });
};

const route = async (request: Request, env: Env) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders() });

  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/") {
    return json({ message: "ShuShuGo Sync API", version: "0.1.0", status: "running" });
  }
  if (request.method === "GET" && url.pathname === "/privacy") return privacyPolicyPage();
  // 小程序里打不开外链（web-view 要备案域名），协议正文以 JSON 给它自己渲染；和 /privacy、/terms 同一份内容源。
  if (request.method === "GET" && url.pathname === "/api/legal") return json({
    privacy: { title: PRIVACY_POLICY_TITLE, version: PRIVACY_POLICY_VERSION, effectiveDate: PRIVACY_POLICY_EFFECTIVE_DATE, sections: PRIVACY_POLICY_SECTIONS },
    terms: { title: USER_AGREEMENT_TITLE, version: USER_AGREEMENT_VERSION, effectiveDate: USER_AGREEMENT_EFFECTIVE_DATE, sections: USER_AGREEMENT_SECTIONS }
  });
  if (request.method === "GET" && url.pathname === "/terms") return userAgreementPage();
  if (request.method === "GET" && url.pathname === "/auth/challenge") return turnstileChallengePage(request, env);
  if (request.method === "GET" && url.pathname === "/api/health") return health(env);
  if (request.method === "GET" && url.pathname === "/api/auth/config") return json({
    appleEnabled: Boolean(env.APPLE_SIGN_IN_CLIENT_ID ?? env.APP_BUNDLE_ID),
    appleClientId: env.APPLE_SIGN_IN_CLIENT_ID ?? env.APP_BUNDLE_ID ?? null,
    turnstileEnabled: turnstileEnabled(env)
  });
  if (request.method === "POST" && url.pathname === "/api/auth/register") return register(request, env);
  if (request.method === "POST" && url.pathname === "/api/auth/login") return login(request, env);
  if (request.method === "POST" && url.pathname === "/api/auth/apple") return appleLogin(request, env);
  if (request.method === "POST" && url.pathname === "/api/auth/wechat") return wechatLogin(request, env);
  if (request.method === "POST" && url.pathname === "/api/auth/link-apple") return linkApple(request, env);
  if (request.method === "POST" && url.pathname === "/api/auth/logout") return logout(request, env);
  if (request.method === "POST" && url.pathname === "/api/auth/change-password") return changePassword(request, env);
  if (request.method === "POST" && url.pathname === "/api/auth/send-verification-email") return sendVerificationEmail(request, env);
  if (request.method === "POST" && url.pathname === "/api/auth/verify-email") return verifyEmail(request, env);
  if (request.method === "POST" && url.pathname === "/api/auth/request-password-reset") return requestPasswordReset(request, env);
  if (request.method === "POST" && url.pathname === "/api/auth/reset-password") return resetPassword(request, env);
  if (request.method === "POST" && url.pathname === "/api/auth/delete-account") return deleteAccount(request, env);
  if (request.method === "GET" && url.pathname === "/api/user/profile") return profile(request, env);
  if (request.method === "POST" && url.pathname === "/api/user/profile") return updateProfile(request, env);
  if (request.method === "GET" && url.pathname === "/api/entitlements") return getEntitlements(request, env);
  if (request.method === "POST" && url.pathname === "/api/purchases/verify") return verifyPurchase(request, env);
  if (request.method === "POST" && url.pathname === "/api/purchases/apple-notifications") return appleNotification(request, env);
  if (request.method === "POST" && url.pathname === "/api/pay/wechat/orders") return createWechatPayOrder(request, env);
  if (request.method === "POST" && url.pathname === "/api/pay/wechat/orders/verify") return verifyWechatPayOrder(request, env);
  if (url.pathname === "/api/purchases/wechat-notifications") return wechatNotification(request, env);
  if (request.method === "POST" && url.pathname === "/api/sync/push") return pushSync(request, env);
  if (request.method === "GET" && url.pathname === "/api/sync/status") return syncStatus(request, env);
  if (request.method === "GET" && url.pathname === "/api/sync/pull") return pullSync(request, env);
  if (request.method === "GET" && url.pathname === "/api/weekly-reports") return listWeeklyReports(request, env);
  if (request.method === "GET" && url.pathname === "/api/weekly-report") return getWeeklyReportCloud(request, env);
  if (request.method === "PUT" && url.pathname === "/api/weekly-report") return putWeeklyReportCloud(request, env);
  if (request.method === "DELETE" && url.pathname === "/api/weekly-report") return deleteWeeklyReportCloud(request, env);
  return json({ detail: "Not found" }, 404);
};

export default {
  async fetch(request, env): Promise<Response> {
    try {
      return await route(request, env);
    } catch (error) {
      if (error instanceof Response) return error;
      return json({ detail: error instanceof Error ? error.message : "Internal server error" }, 500);
    }
  },
  async scheduled(_controller, env): Promise<void> {
    const now = Date.now();
    const iso = (ms: number) => new Date(ms).toISOString();
    // 这几张表都是「只进不出」的短期记录，不清就会一直涨到撞上 D1 容量。
    await env.DB.batch([
      // 限速窗口只用于短期计数，两天前的没有任何意义。
      env.DB.prepare("DELETE FROM sync_rate_limits WHERE window_start < ?")
        .bind(Math.floor(now / 1000) - 2 * 24 * 60 * 60),
      env.DB.prepare("DELETE FROM auth_rate_limits WHERE window_start < ?")
        .bind(Math.floor(now / 1000) - 2 * 24 * 60 * 60),
      // 上传幂等记录只服务「同一次上传的重试」，保留一天足够覆盖任何重试窗口。
      env.DB.prepare("DELETE FROM sync_uploads WHERE created_at < ?")
        .bind(iso(now - 24 * 60 * 60 * 1000)),
      // 过期会话已经登不上，留着只是占空间。
      env.DB.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(iso(now)),
      // 验证码用过或过期就没用了。
      env.DB.prepare("DELETE FROM auth_email_tokens WHERE expires_at < ? OR used_at IS NOT NULL")
        .bind(iso(now - 24 * 60 * 60 * 1000))
    ]);

    // 退款不会自己找上门:通知可能没配、可能投递失败,而**永久购买永远不会过期**,
    // 所以没有任何别的路径会去看它一眼。每次定时任务重查最旧的一小批,
    // 不打开 App 的账号也能在一周内跟上 Apple 的实际状态。批量有上限,
    // 这条不会随用户数把 Apple 请求撑爆。
    const stale = await env.DB.prepare(`
      SELECT user_id, is_pro, product_id, source, original_transaction_id, transaction_id, environment, expires_at, updated_at
      FROM entitlements
      WHERE is_pro = 1 AND source = 'app_store' AND transaction_id IS NOT NULL AND updated_at < ?
      ORDER BY updated_at ASC
      LIMIT 25
    `).bind(iso(now - 7 * 24 * 60 * 60 * 1000)).all<EntitlementRow & { user_id: string }>();
    for (const row of stale.results ?? []) {
      await recheckAppleEntitlement(env, row.user_id, row).catch(() => undefined);
    }

    await cleanupExpiredWeeklyReports(env, now);
  }
} satisfies ExportedHandler<Env>;

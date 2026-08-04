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
  provider: "email" | "apple";
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
  expires_at: string | null;
  updated_at: string;
}

interface AppleTransactionPayload {
  bundleId?: string;
  productId?: string;
  transactionId?: string;
  originalTransactionId?: string;
  environment?: "Sandbox" | "Production";
  expiresDate?: number;
  revocationDate?: number;
  type?: string;
}

const PRODUCT_IDS = new Set(["master_pro_monthly", "master_pro_yearly", "master_pro_lifetime"]);

const TOKEN_TTL_DAYS = 30;
// Cloudflare Workers Web Crypto rejects PBKDF2 iteration counts above 100,000.
const PASSWORD_ITERATIONS = 100_000;
const EMAIL_CODE_TTL_MINUTES = 30;
const PASSWORD_RESET_TTL_MINUTES = 15;
const PROFILE_AVATAR_PREFIX = "profile-avatar:";
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
  "access-control-allow-methods": "GET,POST,DELETE,OPTIONS",
  "access-control-allow-headers": "authorization,content-type,x-sync-format,x-sync-compression,x-sync-operation-id,x-sync-device-id,x-sync-base-generation,x-sync-base-modified",
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

const verificationPayload = (user?: Pick<UserRow, "email_verified_at"> | null) => ({
  emailVerified: Boolean(user?.email_verified_at)
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

// KV 计数不是原子的,只能做粗粒度限速;对登录爆破和验证码枚举已经足够。
// 复用 SYNC_DATA 命名空间,rl: 前缀不会与 sync 对象键(userId/uuid.base64)冲突。
const rateLimitSubject = async (
  env: Env,
  scope: string,
  subject: string,
  limit: number,
  windowSeconds: number
) => {
  const windowIndex = Math.floor(Date.now() / (windowSeconds * 1000));
  const key = `rl:${scope}:${subject}:${windowIndex}`;
  const count = Number(await env.SYNC_DATA.get(key)) || 0;
  if (count >= limit) {
    const elapsedSeconds = Math.floor(Date.now() / 1000) % windowSeconds;
    throw rateLimitExceeded(Math.max(1, windowSeconds - elapsedSeconds));
  }
  try {
    await env.SYNC_DATA.put(key, String(count + 1), { expirationTtl: Math.max(60, windowSeconds) });
  } catch {
    // KV 同一个 key 每秒最多写一次。并发请求撞到该限制时按限速处理，
    // 不继续执行昂贵的数据库或整库传输操作。
    throw rateLimitExceeded(1);
  }
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

const readJson = async <T>(request: Request): Promise<T> => {
  try {
    return await request.json<T>();
  } catch {
    throw new Response(JSON.stringify({ detail: "Invalid JSON body" }), {
      status: 400,
      headers: { "content-type": "application/json; charset=utf-8", ...corsHeaders() }
    });
  }
};

const turnstileEnabled = (env: Env) => Boolean(env.TURNSTILE_SITE_KEY && env.TURNSTILE_SECRET_KEY);

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

const verifyAppleIdentityToken = async (identityToken: string, env: Env, expectedNonce?: string) => {
  const parts = identityToken.split(".");
  if (parts.length !== 3) throw json({ detail: "Apple 登录凭据格式无效。" }, 401);
  const header = base64UrlToJson<{ alg?: string; kid?: string }>(parts[0]);
  const claims = base64UrlToJson<AppleIdentityClaims>(parts[1]);
  if (header.alg !== "ES256" || !header.kid || !claims.sub) {
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
  const keys = await keysResponse.json<{ keys?: Array<JsonWebKey & { kid?: string }> }>();
  const jwk = keys.keys?.find((item) => item.kid === header.kid);
  if (!jwk) throw json({ detail: "无法验证 Apple 登录凭据。" }, 401);
  const key = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"]
  );
  const valid = await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    base64UrlToBytes(parts[2]),
    encoder.encode(`${parts[0]}.${parts[1]}`)
  );
  if (!valid) throw json({ detail: "Apple 登录签名无效。" }, 401);
  return claims;
};

const identityProviders = async (env: Env, userId: string) => {
  const rows = await env.DB.prepare("SELECT provider FROM auth_identities WHERE user_id = ? ORDER BY provider")
    .bind(userId)
    .all<{ provider: "email" | "apple" }>();
  return (rows.results ?? []).map((row) => row.provider);
};

const sessionPayload = async (env: Env, user: UserRow, token: string) => ({
  access_token: token,
  token_type: "bearer",
  user_id: user.id,
  email: user.email,
  displayName: user.display_name ?? undefined,
  authProviders: await identityProviders(env, user.id),
  ...verificationPayload(user),
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
    <h1 style="font-size:22px;margin:0 0 12px">Master Nihongo</h1>
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
      from: env.EMAIL_FROM ?? "Master Nihongo <onboarding@resend.dev>",
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
    SELECT is_pro, product_id, source, expires_at, updated_at
    FROM entitlements
    WHERE user_id = ?
  `).bind(userId).first<EntitlementRow>()
);

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

const APPLE_PRODUCTION_HOST = "https://api.storekit.itunes.apple.com";
const APPLE_SANDBOX_HOST = "https://api.storekit-sandbox.itunes.apple.com";

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
  const preferSandbox = env.APP_STORE_ENVIRONMENT === "Sandbox";
  const hosts = preferSandbox
    ? [APPLE_SANDBOX_HOST, APPLE_PRODUCTION_HOST]
    : [APPLE_PRODUCTION_HOST, APPLE_SANDBOX_HOST];

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
  if (!user?.email_verified_at) {
    throw json({ detail: "请先在设置中完成邮箱验证，再使用云同步。" }, 403);
  }
  return userId;
};

const register = async (request: Request, env: Env) => {
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
        "Master Nihongo 邮箱验证码",
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

const linkApple = async (request: Request, env: Env) => {
  await rateLimit(env, request, "link-apple", 10, 300);
  const userId = await requireUser(request, env);
  const body = await readJson<{ identity_token?: string; nonce?: string }>(request);
  const claims = await verifyAppleIdentityToken(String(body.identity_token ?? ""), env, body.nonce);
  const existingIdentity = await env.DB.prepare(`
    SELECT user_id FROM auth_identities WHERE provider = 'apple' AND provider_subject = ?
  `).bind(claims.sub).first<{ user_id: string }>();
  if (existingIdentity && existingIdentity.user_id !== userId) {
    return json({ detail: "这个 Apple 账号已关联其他 Master 账号。" }, 409);
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
    return json({ detail: "这个 Apple 账号已关联其他 Master 账号。" }, 409);
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
  }>(request);
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
    avatar: typeof body.avatar === "undefined"
      ? await env.SYNC_DATA.get(`${PROFILE_AVATAR_PREFIX}${userId}`)
      : body.avatar
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
  if (user.email_verified_at) return json({ status: "already_verified", ...verificationPayload(user) });

  const code = await createEmailToken(env, user.id, "verify_email", EMAIL_CODE_TTL_MINUTES);
  await sendEmail(
    env,
    user.email,
    "Master Nihongo 邮箱验证码",
    emailHtml("请使用下面的验证码完成邮箱验证：", code, EMAIL_CODE_TTL_MINUTES)
  );
  return json({ status: "sent", expiresInMinutes: EMAIL_CODE_TTL_MINUTES, ...verificationPayload(user) });
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
      "Master Nihongo 重置密码验证码",
      emailHtml("请使用下面的验证码重置你的 Master Nihongo 密码：", code, PASSWORD_RESET_TTL_MINUTES)
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
  } else {
    return json({ detail: "请使用 Apple 重新验证身份后再删除账号。", code: "APPLE_REAUTH_REQUIRED" }, 401);
  }

  const objects = await env.DB.prepare("SELECT object_key, storage_backend FROM sync_objects WHERE user_id = ?")
    .bind(userId)
    .all<{ object_key: string; storage_backend: "kv" | "r2" }>();
  for (const row of objects.results ?? []) {
    await deleteSyncObject(env, row.object_key, row.storage_backend);
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

const getEntitlements = async (request: Request, env: Env) => {
  const userId = await requireUser(request, env);
  return json(entitlementPayload(await getEntitlementRow(env, userId)));
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

  const now = new Date().toISOString();
  const apple = await getAppleTransaction(env, transactionId);
  if (!apple) {
    await env.DB.prepare(`
      INSERT INTO purchase_events (id, user_id, product_id, transaction_id, status, raw_payload, created_at)
      VALUES (?, ?, ?, ?, 'missing_apple_config', ?, ?)
    `).bind(crypto.randomUUID(), userId, productId, transactionId, JSON.stringify({ reason: "App Store Server API config is missing" }), now).run();
    return json({ detail: "Apple verification is not configured on the server yet." }, 501);
  }

  const tx = apple.payload;
  const bundleMatches = !env.APP_BUNDLE_ID || tx.bundleId === env.APP_BUNDLE_ID;
  const productMatches = tx.productId === productId;
  const transactionMatches = tx.transactionId === transactionId || tx.originalTransactionId === transactionId;
  const notRevoked = !tx.revocationDate;
  if (!bundleMatches || !productMatches || !transactionMatches || !notRevoked) {
    await env.DB.prepare(`
      INSERT INTO purchase_events (id, user_id, product_id, transaction_id, original_transaction_id, environment, status, raw_payload, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'rejected', ?, ?)
    `).bind(
      crypto.randomUUID(),
      userId,
      productId,
      transactionId,
      tx.originalTransactionId ?? null,
      tx.environment ?? null,
      JSON.stringify(apple.raw),
      now
    ).run();
    return json({ detail: "Apple transaction did not match this app or product." }, 400);
  }

  const expiresAt = tx.expiresDate ? new Date(tx.expiresDate).toISOString() : null;
  const entitlement = await saveEntitlement(env, userId, {
    productId,
    source: "app_store",
    transactionId: tx.transactionId ?? transactionId,
    originalTransactionId: tx.originalTransactionId,
    environment: tx.environment,
    expiresAt
  });

  await env.DB.prepare(`
    INSERT OR IGNORE INTO purchase_events (id, user_id, product_id, transaction_id, original_transaction_id, environment, status, raw_payload, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 'verified', ?, ?)
  `).bind(
    crypto.randomUUID(),
    userId,
    productId,
    tx.transactionId ?? transactionId,
    tx.originalTransactionId ?? null,
    tx.environment ?? null,
    JSON.stringify(apple.raw),
    now
  ).run();

  return json(entitlement);
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
    snapshotBytes = new Uint8Array(await request.arrayBuffer());
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
    }>(request);
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
        detail: "云同步格式已升级，请更新 Master Nihongo 后继续同步。",
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

const route = async (request: Request, env: Env) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders() });

  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/") {
    return json({ message: "Master Nihongo Sync API", version: "0.1.0", status: "running" });
  }
  if (request.method === "GET" && url.pathname === "/privacy") return privacyPolicyPage();
  if (request.method === "GET" && url.pathname === "/terms") return userAgreementPage();
  if (request.method === "GET" && url.pathname === "/auth/challenge") return turnstileChallengePage(request, env);
  if (request.method === "GET" && url.pathname === "/api/auth/config") return json({
    appleEnabled: Boolean(env.APPLE_SIGN_IN_CLIENT_ID ?? env.APP_BUNDLE_ID),
    appleClientId: env.APPLE_SIGN_IN_CLIENT_ID ?? env.APP_BUNDLE_ID ?? null,
    turnstileEnabled: turnstileEnabled(env)
  });
  if (request.method === "POST" && url.pathname === "/api/auth/register") return register(request, env);
  if (request.method === "POST" && url.pathname === "/api/auth/login") return login(request, env);
  if (request.method === "POST" && url.pathname === "/api/auth/apple") return appleLogin(request, env);
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
  if (request.method === "POST" && url.pathname === "/api/sync/push") return pushSync(request, env);
  if (request.method === "GET" && url.pathname === "/api/sync/status") return syncStatus(request, env);
  if (request.method === "GET" && url.pathname === "/api/sync/pull") return pullSync(request, env);
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
      // 上传幂等记录只服务「同一次上传的重试」，保留一天足够覆盖任何重试窗口。
      env.DB.prepare("DELETE FROM sync_uploads WHERE created_at < ?")
        .bind(iso(now - 24 * 60 * 60 * 1000)),
      // 过期会话已经登不上，留着只是占空间。
      env.DB.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(iso(now)),
      // 验证码用过或过期就没用了。
      env.DB.prepare("DELETE FROM auth_email_tokens WHERE expires_at < ? OR used_at IS NOT NULL")
        .bind(iso(now - 24 * 60 * 60 * 1000))
    ]);
  }
} satisfies ExportedHandler<Env>;

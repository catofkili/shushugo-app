import {
  PRIVACY_POLICY_EFFECTIVE_DATE,
  PRIVACY_POLICY_SECTIONS,
  PRIVACY_POLICY_TITLE
} from "../../frontend/src/lib/privacy-policy-content";

export interface Env {
  DB: D1Database;
  SYNC_DATA: KVNamespace;
  APP_STORE_ISSUER_ID?: string;
  APP_STORE_KEY_ID?: string;
  APP_STORE_PRIVATE_KEY?: string;
  APP_BUNDLE_ID?: string;
  APP_STORE_ENVIRONMENT?: "Sandbox" | "Production";
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
}

interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  password_salt: string;
  display_name: string | null;
  email_verified_at?: string | null;
}

interface SessionRow {
  user_id: string;
  expires_at: string;
}

interface SyncRow {
  object_key: string;
  last_modified: string;
  byte_length: number;
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
const PASSWORD_ITERATIONS = 120_000;
const EMAIL_CODE_TTL_MINUTES = 30;
const PASSWORD_RESET_TTL_MINUTES = 15;
// 6 位数字验证码,必须限制尝试次数,否则可被暴力枚举。
const MAX_CODE_ATTEMPTS = 5;
// KV 单值上限 25MB;base64 后 20M 约对应 15MB 数据库,词库全量也远小于此。
const SYNC_MAX_BASE64_LENGTH = 20_000_000;
// 每个用户只保留最近 N 份云备份,旧的连 KV 对象一起清掉。
const SYNC_KEEP_GENERATIONS = 3;
const encoder = new TextEncoder();

const json = (body: unknown, status = 200) => (
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...corsHeaders()
    }
  })
);

const corsHeaders = () => ({
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,DELETE,OPTIONS",
  "access-control-allow-headers": "authorization,content-type",
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

const base64UrlToJson = <T>(value: string): T => {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return JSON.parse(new TextDecoder().decode(bytes)) as T;
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

// KV 计数不是原子的,只能做粗粒度限速;对登录爆破和验证码枚举已经足够。
// 复用 SYNC_DATA 命名空间,rl: 前缀不会与 sync 对象键(userId/uuid.base64)冲突。
const rateLimit = async (
  env: Env,
  request: Request,
  scope: string,
  limit: number,
  windowSeconds: number
) => {
  const windowIndex = Math.floor(Date.now() / (windowSeconds * 1000));
  const key = `rl:${scope}:${clientIp(request)}:${windowIndex}`;
  const count = Number(await env.SYNC_DATA.get(key)) || 0;
  if (count >= limit) {
    throw json({ detail: "请求过于频繁，请稍后再试。" }, 429);
  }
  await env.SYNC_DATA.put(key, String(count + 1), { expirationTtl: Math.max(60, windowSeconds) });
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

const currentUser = async (request: Request, env: Env) => {
  const header = request.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;

  const tokenHash = await sha256(match[1]);
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
  const body = await readJson<{ email?: string; password?: string; display_name?: string }>(request);
  const email = normalizeEmail(body.email);
  const password = String(body.password ?? "");
  const displayName = String(body.display_name ?? "").trim() || null;

  if (!email.includes("@")) return json({ detail: "Email is invalid" }, 400);
  if (password.length < 8) return json({ detail: "Password must be at least 8 characters" }, 400);

  const existing = await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first();
  if (existing) return json({ detail: "Email already registered" }, 400);

  const id = crypto.randomUUID();
  const salt = randomToken(16);
  const passwordHash = await hashPassword(password, salt);
  const now = new Date().toISOString();

  await env.DB.prepare(`
    INSERT INTO users (id, email, password_hash, password_salt, display_name, created_at, last_login)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(id, email, passwordHash, salt, displayName, now, now).run();

  let emailVerificationSent = false;
  if (env.RESEND_API_KEY) {
    const emailCode = await createEmailToken(env, id, "verify_email", EMAIL_CODE_TTL_MINUTES);
    await sendEmail(
      env,
      email,
      "Master Nihongo 邮箱验证码",
      emailHtml("请使用下面的验证码完成邮箱验证：", emailCode, EMAIL_CODE_TTL_MINUTES)
    );
    emailVerificationSent = true;
  }

  const token = await createToken(env, id);
  return json({ access_token: token, token_type: "bearer", user_id: id, email, emailVerificationSent, ...verificationPayload(null) });
};

const login = async (request: Request, env: Env) => {
  await rateLimit(env, request, "login", 10, 300);
  const body = await readJson<{ email?: string; password?: string }>(request);
  const email = normalizeEmail(body.email);
  const password = String(body.password ?? "");
  const user = await env.DB.prepare(`
    SELECT id, email, password_hash, password_salt, display_name, email_verified_at
    FROM users
    WHERE email = ?
  `).bind(email).first<UserRow>();

  if (!user) return json({ detail: "Invalid email or password" }, 401);
  const passwordHash = await hashPassword(password, user.password_salt);
  if (passwordHash !== user.password_hash) return json({ detail: "Invalid email or password" }, 401);

  await env.DB.prepare("UPDATE users SET last_login = ? WHERE id = ?").bind(new Date().toISOString(), user.id).run();
  const token = await createToken(env, user.id);
  return json({
    access_token: token,
    token_type: "bearer",
    user_id: user.id,
    email: user.email,
    ...verificationPayload(user),
    entitlements: entitlementPayload(await getEntitlementRow(env, user.id))
  });
};

const profile = async (request: Request, env: Env) => {
  const userId = await requireUser(request, env);
  const user = await env.DB.prepare(`
    SELECT email, display_name, created_at, last_login, email_verified_at
    FROM users
    WHERE id = ?
  `).bind(userId).first();
  return json(user);
};

const logout = async (request: Request, env: Env) => {
  const header = request.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (match) {
    await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256(match[1])).run();
  }
  return json({ status: "success" });
};

const changePassword = async (request: Request, env: Env) => {
  const userId = await requireUser(request, env);
  const body = await readJson<{ current_password?: string; new_password?: string }>(request);
  const currentPassword = String(body.current_password ?? "");
  const newPassword = String(body.new_password ?? "");
  if (newPassword.length < 8) return json({ detail: "New password must be at least 8 characters" }, 400);

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
  const body = await readJson<{ email?: string }>(request);
  const email = normalizeEmail(body.email);
  const user = await env.DB.prepare(`
    SELECT id, email, password_hash, password_salt, display_name, email_verified_at
    FROM users
    WHERE email = ?
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
    SELECT id, email, password_hash, password_salt, display_name, email_verified_at
    FROM users
    WHERE email = ?
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
// 删除是不可逆的:云备份(KV+D1)、权益、会话、验证码全部清除。
const deleteAccount = async (request: Request, env: Env) => {
  await rateLimit(env, request, "delete-account", 5, 900);
  const userId = await requireUser(request, env);
  const body = await readJson<{ password?: string }>(request);

  const user = await env.DB.prepare(`
    SELECT id, email, password_hash, password_salt, display_name, email_verified_at
    FROM users
    WHERE id = ?
  `).bind(userId).first<UserRow>();
  if (!user) return json({ detail: "User not found" }, 404);

  const passwordHash = await hashPassword(String(body.password ?? ""), user.password_salt);
  if (passwordHash !== user.password_hash) {
    return json({ detail: "Password is invalid" }, 401);
  }

  const objects = await env.DB.prepare("SELECT object_key FROM sync_objects WHERE user_id = ?")
    .bind(userId)
    .all<{ object_key: string }>();
  for (const row of objects.results ?? []) {
    await env.SYNC_DATA.delete(row.object_key);
  }

  // 显式逐表删除,不依赖 FK 级联配置。purchase_events 一并删除:
  // 交易记录以 Apple 侧为准,服务端不保留可关联到用户的副本。
  for (const table of ["sessions", "auth_email_tokens", "sync_objects", "entitlements", "purchase_events"]) {
    await env.DB.prepare(`DELETE FROM ${table} WHERE user_id = ?`).bind(userId).run();
  }
  await env.DB.prepare("DELETE FROM users WHERE id = ?").bind(userId).run();

  return json({ status: "deleted" });
};

const getEntitlements = async (request: Request, env: Env) => {
  const userId = await requireUser(request, env);
  return json(entitlementPayload(await getEntitlementRow(env, userId)));
};

const verifyPurchase = async (request: Request, env: Env) => {
  const userId = await requireUser(request, env);
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

const pushSync = async (request: Request, env: Env) => {
  const userId = await requireVerifiedUser(request, env);
  const body = await readJson<{ db_data?: string; last_modified?: string }>(request);
  const dbData = String(body.db_data ?? "");
  const lastModified = String(body.last_modified ?? new Date().toISOString());
  if (!dbData) return json({ detail: "db_data is required" }, 400);
  if (dbData.length > SYNC_MAX_BASE64_LENGTH) {
    return json({ detail: "Backup is too large" }, 413);
  }

  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const objectKey = `${userId}/${id}.base64`;
  await env.SYNC_DATA.put(objectKey, dbData, { metadata: { userId, lastModified } });

  await env.DB.prepare(`
    INSERT INTO sync_objects (id, user_id, object_key, last_modified, created_at, byte_length)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(id, userId, objectKey, lastModified, now, dbData.length).run();

  // 只保留最近几代备份,旧的连同 KV 对象一起清理,避免存储无限增长。
  const stale = await env.DB.prepare(`
    SELECT id, object_key
    FROM sync_objects
    WHERE user_id = ?
    ORDER BY created_at DESC
    LIMIT -1 OFFSET ?
  `).bind(userId, SYNC_KEEP_GENERATIONS).all<{ id: string; object_key: string }>();
  for (const row of stale.results ?? []) {
    await env.SYNC_DATA.delete(row.object_key);
    await env.DB.prepare("DELETE FROM sync_objects WHERE id = ?").bind(row.id).run();
  }

  return json({ status: "success", message: "Sync data uploaded", timestamp: now });
};

const pullSync = async (request: Request, env: Env) => {
  const userId = await requireVerifiedUser(request, env);
  const row = await env.DB.prepare(`
    SELECT object_key, last_modified, byte_length
    FROM sync_objects
    WHERE user_id = ?
    ORDER BY created_at DESC
    LIMIT 1
  `).bind(userId).first<SyncRow>();

  if (!row) return json({ detail: "No sync data found" }, 404);
  const dbData = await env.SYNC_DATA.get(row.object_key);
  if (!dbData) return json({ detail: "Sync object is missing" }, 404);
  return json({ db_data: dbData, last_modified: row.last_modified, byte_length: row.byte_length });
};

const escapeHtml = (value: string) => value
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;");

// 隐私政策公开页,填入 App Store Connect 的 Privacy Policy URL。
// 内容与 App 内页面共享同一份 privacy-policy-content.ts。
const privacyPolicyPage = () => {
  const sectionsHtml = PRIVACY_POLICY_SECTIONS.map((section) => `
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
  <title>${escapeHtml(PRIVACY_POLICY_TITLE)}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; line-height: 1.75; color: #1c3a34; max-width: 720px; margin: 0 auto; padding: 32px 20px 64px; }
    h1 { font-size: 26px; margin-bottom: 4px; }
    h2 { font-size: 18px; margin: 28px 0 8px; color: #16564d; }
    p { margin: 8px 0; }
    .date { color: #1f7469; font-weight: 700; font-size: 14px; }
  </style>
</head>
<body>
  <h1>${escapeHtml(PRIVACY_POLICY_TITLE)}</h1>
  <p class="date">生效日期：${escapeHtml(PRIVACY_POLICY_EFFECTIVE_DATE)}</p>
  ${sectionsHtml}
</body>
</html>`;
  return new Response(html, {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=3600" }
  });
};

const route = async (request: Request, env: Env) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders() });

  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/") {
    return json({ message: "Master Nihongo Sync API", version: "0.1.0", status: "running" });
  }
  if (request.method === "GET" && url.pathname === "/privacy") return privacyPolicyPage();
  if (request.method === "POST" && url.pathname === "/api/auth/register") return register(request, env);
  if (request.method === "POST" && url.pathname === "/api/auth/login") return login(request, env);
  if (request.method === "POST" && url.pathname === "/api/auth/logout") return logout(request, env);
  if (request.method === "POST" && url.pathname === "/api/auth/change-password") return changePassword(request, env);
  if (request.method === "POST" && url.pathname === "/api/auth/send-verification-email") return sendVerificationEmail(request, env);
  if (request.method === "POST" && url.pathname === "/api/auth/verify-email") return verifyEmail(request, env);
  if (request.method === "POST" && url.pathname === "/api/auth/request-password-reset") return requestPasswordReset(request, env);
  if (request.method === "POST" && url.pathname === "/api/auth/reset-password") return resetPassword(request, env);
  if (request.method === "POST" && url.pathname === "/api/auth/delete-account") return deleteAccount(request, env);
  if (request.method === "GET" && url.pathname === "/api/user/profile") return profile(request, env);
  if (request.method === "GET" && url.pathname === "/api/entitlements") return getEntitlements(request, env);
  if (request.method === "POST" && url.pathname === "/api/purchases/verify") return verifyPurchase(request, env);
  if (request.method === "POST" && url.pathname === "/api/sync/push") return pushSync(request, env);
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
  }
} satisfies ExportedHandler<Env>;

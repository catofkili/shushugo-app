#!/usr/bin/env node
/**
 * 开发试用号：建一个能真正登录、并且带 Pro 试用权益的账号。
 *
 * 为什么需要它：权益只有一条写入路径 —— `POST /api/purchases/verify`，
 * 而那条路要一张真的 App Store 收据。所以「注册一个号来试 Pro」在今天做不到，
 * 注册完它就是个免费号。这个脚本补的就是这一段。
 *
 * ⚠️ **密码只从 stdin 读，不接受命令行参数。** argv 会进 shell 历史，也会在
 * `ps` 里对同机器的其他进程可见。脚本本身不生成、不保存、不打印密码；
 * 落到 SQL 里的只有 PBKDF2 哈希。
 *
 * ⚠️ **默认只打印 SQL，不动数据库。** 看一眼再执行；确认无误后加 --apply。
 *
 * 用法：
 *   # 1) 建号（密码从管道进来，或交互式输入）
 *   node scripts/dev-account.mjs create dev2@example.com --days 30
 *   node scripts/dev-account.mjs create dev2@example.com --days 30 --apply
 *
 *   # 2) 已经在 App 里注册过了，只补试用权益
 *   node scripts/dev-account.mjs grant dev2@example.com --days 30 --apply
 *
 *   # 3) 自检：确认这里算出来的哈希和 Worker 的 hashPassword 是同一个算法
 *   node scripts/dev-account.mjs selfcheck
 */
import { webcrypto, pbkdf2Sync, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, unlinkSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..", "..");

/* ---------- 和 Worker 逐字对齐的那几个常量/函数 ---------- */
// src/index.ts 的 PASSWORD_ITERATIONS。Cloudflare Workers 的 Web Crypto 不接受
// 超过 100,000 的 PBKDF2 迭代数，所以这个值不是随便定的，改之前先看那条注释。
const PASSWORD_ITERATIONS = 100_000;
const DEFAULT_PRODUCT = "shushugo_pro_yearly";
const PRODUCT_IDS = new Set(["shushugo_pro_monthly", "shushugo_pro_yearly", "shushugo_pro_lifetime"]);

/** src/index.ts 的 base64Url */
const base64Url = (bytes) =>
  Buffer.from(bytes).toString("base64").replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");

/** src/index.ts 的 randomToken */
const randomToken = (bytes = 32) => base64Url(webcrypto.getRandomValues(new Uint8Array(bytes)));

/** src/index.ts 的 hashPassword */
const hashPassword = async (password, salt) => {
  const encoder = new TextEncoder();
  const key = await webcrypto.subtle.importKey(
    "raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]
  );
  const bits = await webcrypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: encoder.encode(salt), iterations: PASSWORD_ITERATIONS },
    key,
    256
  );
  return base64Url(bits);
};

/**
 * 协议版本从前端那两份文案里读，不在这里抄一份 —— 抄了就会有一天对不上，
 * 而 register 拿它当准入条件（版本不符直接 400 CONSENT_REQUIRED）。
 */
const readVersion = (relativePath, name) => {
  const source = readFileSync(join(repo, relativePath), "utf8");
  const match = source.match(new RegExp(`${name}\\s*=\\s*"([^"]+)"`));
  if (!match) throw new Error(`没能从 ${relativePath} 里读出 ${name}`);
  return match[1];
};

/* ---------- 小工具 ---------- */
const sqlText = (value) =>
  (value === null || value === undefined ? "NULL" : `'${String(value).replaceAll("'", "''")}'`);

const readPassword = async () => {
  if (!process.stdin.isTTY) {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    return Buffer.concat(chunks).toString("utf8").replace(/\r?\n$/, "");
  }
  // 交互式：关掉回显，别让密码留在屏幕上
  const rl = createInterface({ input: process.stdin, output: process.stderr, terminal: true });
  rl._writeToOutput = () => {};
  process.stderr.write("密码（至少 8 位，输入时不显示）：");
  const answer = await new Promise((resolve) => rl.question("", (value) => resolve(value)));
  rl.close();
  process.stderr.write("\n");
  return answer;
};

const runWrangler = (sql) => {
  const dir = mkdtempSync(join(tmpdir(), "shushugo-dev-account-"));
  const file = join(dir, "dev-account.sql");
  writeFileSync(file, sql, { mode: 0o600 });
  try {
    const result = spawnSync(
      "npx",
      ["wrangler", "d1", "execute", "master_nihongo_sync", "--remote", "--file", file],
      { cwd: join(here, ".."), stdio: "inherit" }
    );
    if (result.status !== 0) process.exitCode = result.status ?? 1;
  } finally {
    unlinkSync(file);
  }
};

/* ---------- 两条命令 ---------- */
const entitlementSql = ({ email, days, product }) => {
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + days * 86_400_000).toISOString();
  // source='development' 是给人看的标记：这条权益不是买来的，将来清理试用号按它筛。
  // 走 SELECT ... FROM users 而不是写死 user_id：邮箱写错时它插不进去，
  // 比插出一条挂在空 id 上的孤儿权益强。
  return `INSERT OR REPLACE INTO entitlements
  (user_id, is_pro, product_id, source, expires_at, updated_at)
SELECT id, 1, ${sqlText(product)}, 'development', ${sqlText(expiresAt)}, ${sqlText(now)}
FROM users WHERE email = ${sqlText(email)};`;
};

const createSql = async ({ email, password, displayName, days, product, verifyEmail }) => {
  const terms = readVersion("frontend/src/lib/user-agreement-content.ts", "USER_AGREEMENT_VERSION");
  const privacy = readVersion("frontend/src/lib/privacy-policy-content.ts", "PRIVACY_POLICY_VERSION");
  const id = randomUUID();
  const salt = randomToken(16);
  const hash = await hashPassword(password, salt);
  const now = new Date().toISOString();
  // 邮箱验证直接盖章：requireVerifiedUser 会拦住没验证的账号用云同步，
  // 而试用号多半用的是收不到信的地址。
  const verifiedAt = verifyEmail ? sqlText(now) : "NULL";

  return [
    `-- 开发试用号 ${email}（${days} 天 Pro，source='development'）`,
    `INSERT INTO users (
  id, email, password_hash, password_salt, display_name, created_at, last_login,
  profile_updated_at, terms_version, privacy_version, consented_at, email_verified_at
) VALUES (
  ${sqlText(id)}, ${sqlText(email)}, ${sqlText(hash)}, ${sqlText(salt)}, ${sqlText(displayName)},
  ${sqlText(now)}, ${sqlText(now)}, ${sqlText(now)}, ${sqlText(terms)}, ${sqlText(privacy)},
  ${sqlText(now)}, ${verifiedAt}
);`,
    `INSERT INTO auth_identities (provider, provider_subject, user_id, email, created_at)
VALUES ('email', ${sqlText(email)}, ${sqlText(id)}, ${sqlText(email)}, ${sqlText(now)});`,
    entitlementSql({ email, days, product })
  ].join("\n\n");
};

/**
 * 自检：拿 Node 自己那套完全独立的 pbkdf2Sync 复算一遍。
 * 两个实现给出同一个字符串，才说明这里的参数（迭代数 / 摘要 / 盐的编码 /
 * 输出长度 / base64url）和 Worker 那份是同一个算法 —— 对不上就是建出来登不进去。
 */
const selfcheck = async () => {
  const password = "correct horse battery staple";
  const salt = "AAAAAAAAAAAAAAAAAAAAAA";
  const viaWebCrypto = await hashPassword(password, salt);
  const viaNode = base64Url(pbkdf2Sync(password, salt, PASSWORD_ITERATIONS, 32, "sha256"));
  const ok = viaWebCrypto === viaNode;
  console.log(`WebCrypto : ${viaWebCrypto}`);
  console.log(`pbkdf2Sync: ${viaNode}`);
  console.log(ok
    ? "✓ 两套独立实现一致，参数和 Worker 的 hashPassword 对得上"
    : "✗ 不一致，别用这个脚本建号");
  if (!ok) process.exitCode = 1;
};

/* ---------- 入口 ---------- */
const main = async () => {
  const [command, ...rest] = process.argv.slice(2);
  if (command === "selfcheck") return selfcheck();

  const email = String(rest[0] ?? "").trim().toLowerCase();
  const flag = (name, fallback) => {
    const index = rest.indexOf(`--${name}`);
    return index >= 0 ? rest[index + 1] : fallback;
  };
  const apply = rest.includes("--apply");
  const days = Number(flag("days", 30));
  const product = String(flag("product", DEFAULT_PRODUCT));
  const displayName = flag("name", null);

  if (!["create", "grant"].includes(command) || !email.includes("@")) {
    console.error("用法：node scripts/dev-account.mjs create|grant <email> [--days 30] [--product id] [--name 昵称] [--apply]");
    console.error("     node scripts/dev-account.mjs selfcheck");
    process.exitCode = 1;
    return;
  }
  if (!Number.isFinite(days) || days <= 0) throw new Error("--days 必须是正数");
  if (!PRODUCT_IDS.has(product)) throw new Error(`--product 只能是 ${[...PRODUCT_IDS].join(" / ")}`);

  let sql;
  if (command === "grant") {
    sql = entitlementSql({ email, days, product });
  } else {
    const password = await readPassword();
    // 和 register() 同一条门槛。先在这里挡住，免得建出一个 App 里改不了密码的号。
    if (password.length < 8) throw new Error("密码至少 8 位（和 /api/auth/register 同一条门槛）");
    sql = await createSql({ email, password, displayName, days, product, verifyEmail: true });
  }

  if (!apply) {
    console.log(sql);
    console.error("\n（只是打印，没有执行。确认无误后加 --apply）");
    return;
  }
  runWrangler(sql);
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

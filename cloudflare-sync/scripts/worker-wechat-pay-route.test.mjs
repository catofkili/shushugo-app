// 微信虚拟支付三条路由走一遍真实 Worker（wrangler --dry-run 构建产物）：
// 下单 → verify（微信说付了 → 写权益 → 发货确认）→ 退款推送撤销权益 → 另一个账号来 verify 被 409。
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outdir = mkdtempSync(join(tmpdir(), "shushugo-worker-wechat-"));
const wrangler = join(root, "node_modules", ".bin", "wrangler");
const built = spawnSync(wrangler, ["deploy", "--dry-run", "--outdir", outdir], { cwd: root, encoding: "utf8" });
if (built.status !== 0) throw new Error(`${built.stdout}\n${built.stderr}`);

const futureDate = "2099-01-01T00:00:00.000Z";
// sessions 表存的是 token 的 sha256(base64url)，和 Worker 里的 sha256() 同口径。
const tokenHash = (token) => createHash("sha256").update(token).digest("base64url");

class FakeStatement {
  constructor(db, sql) { this.db = db; this.sql = sql.replace(/\s+/g, " ").trim(); this.params = []; }
  bind(...params) { this.params = params; return this; }
  async first() {
    if (this.sql.includes("FROM sessions")) {
      const token = this.params[0];
      return this.db.sessions[token] ? { user_id: this.db.sessions[token], expires_at: futureDate } : null;
    }
    if (this.sql.includes("FROM entitlements")) return this.db.entitlement ? { ...this.db.entitlement } : null;
    if (this.sql.includes("FROM wechat_orders")) { const row = this.db.orders[this.params[0]]; return row ? { ...row } : null; }
    if (this.sql.includes("FROM users")) return { email_verified_at: null };
    if (this.sql.includes("FROM auth_identities")) return { 1: 1 };
    // 限速的 UPSERT … RETURNING 走 first()：返回一行 = 放行
    if (this.sql.startsWith("INSERT INTO auth_rate_limits")) return { request_count: 1 };
    return null;
  }
  async all() { return { results: [] }; }
  async run() {
    if (this.sql.startsWith("INSERT INTO wechat_orders")) {
      const [out_trade_no, user_id, openid, product_id, price_cents] = this.params;
      this.db.orders[out_trade_no] = { out_trade_no, user_id, openid, product_id, price_cents, status: "created", wx_order_id: null };
    } else if (this.sql.startsWith("UPDATE wechat_orders SET status = 'paid'")) {
      const [wx, , no] = this.params; Object.assign(this.db.orders[no], { status: "paid", wx_order_id: wx });
    } else if (this.sql.startsWith("UPDATE wechat_orders SET status = 'delivered'")) {
      this.db.orders[this.params[1]].status = "delivered";
    } else if (this.sql.startsWith("UPDATE wechat_orders SET status = 'refunded'")) {
      this.db.orders[this.params[1]].status = "refunded";
    } else if (this.sql.startsWith("INSERT INTO entitlements")) {
      const [user_id, product_id, source, original_transaction_id, transaction_id, environment, expires_at, updated_at] = this.params;
      this.db.entitlement = { is_pro: 1, product_id, source, original_transaction_id, transaction_id, environment, expires_at, updated_at, user_id };
    } else if (this.sql.startsWith("UPDATE entitlements SET is_pro = 0")) {
      const [, , originalTransactionId] = this.params;
      if (this.db.entitlement?.original_transaction_id === originalTransactionId) {
        this.db.entitlement = { ...this.db.entitlement, is_pro: 0, product_id: null, source: "free", expires_at: null };
      }
    } else if (this.sql.startsWith("INSERT OR IGNORE INTO purchase_events")) {
      this.db.events.push({ status: this.params[6], transaction_id: this.params[3] });
    } else if (this.sql.startsWith("INSERT INTO auth_rate_limits")) {
      return { success: true, meta: { changes: 1 } };
    }
    return { success: true, meta: { changes: 1 } };
  }
}
class FakeD1 {
  constructor() { this.sessions = { [tokenHash("tok-a")]: "user-a", [tokenHash("tok-b")]: "user-b" }; this.orders = {}; this.entitlement = null; this.events = []; }
  prepare(sql) { return new FakeStatement(this, sql); }
  async batch(statements) { return Promise.all(statements.map((s) => s.run())); }
}
const kv = new Map();
kv.set("wechat-session:user-a", JSON.stringify({ openid: "openid-a", sessionKey: "sk-a" }));
const env = {
  DB: new FakeD1(),
  SYNC_DATA: { get: async (k) => kv.get(k) ?? null, put: async (k, v) => { kv.set(k, v); }, delete: async (k) => { kv.delete(k); } },
  SYNC_BUCKET: { delete: async () => undefined },
  WECHAT_APP_ID: "wx1", WECHAT_APP_SECRET: "sec", WECHAT_OFFER_ID: "1450", WECHAT_PAY_APP_KEY: "appkey",
  WECHAT_PAY_ENV: "0", WECHAT_PAY_PRICES: JSON.stringify({ shushugo_pro_lifetime: 12800 }), WECHAT_MSG_TOKEN: "pushtoken"
};

const wx = { paidStatus: 2, calls: [] };
globalThis.fetch = async (input, init) => {
  const url = String(input);
  wx.calls.push(url.split("?")[0]);
  if (url.includes("/cgi-bin/token")) return Response.json({ access_token: "AT", expires_in: 7200 });
  if (url.includes("/xpay/query_order")) return Response.json({ errcode: 0, order: { status: wx.paidStatus, wx_order_id: "WX-1", paid_time: 1789000000 } });
  if (url.includes("/xpay/notify_provide_goods")) return Response.json({ errcode: 0 });
  throw new Error(`unexpected fetch ${url}`);
};

try {
  const worker = (await import(pathToFileURL(join(outdir, "index.js")).href)).default;
  const call = (path, init) => worker.fetch(new Request(`https://api.test${path}`, init), env, { waitUntil() {} });
  const post = (path, token, body) => call(path, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });

  // 下单
  let res = await post("/api/pay/wechat/orders", "tok-a", { productId: "shushugo_pro_lifetime" });
  assert.equal(res.status, 200, await res.clone().text());
  const order = await res.json();
  assert.match(order.outTradeNo, /^[0-9a-f]{32}$/);
  assert.equal(JSON.parse(order.signData).goodsPrice, 12800);
  assert.equal(env.DB.orders[order.outTradeNo].status, "created");

  // 没登录过微信的账号（KV 里没 session）不能下单
  res = await post("/api/pay/wechat/orders", "tok-b", { productId: "shushugo_pro_lifetime" });
  assert.equal(res.status, 401);

  // 微信说还没付 → 402，不写权益
  wx.paidStatus = 1;
  res = await post("/api/pay/wechat/orders/verify", "tok-a", { outTradeNo: order.outTradeNo });
  assert.equal(res.status, 402);
  assert.equal(env.DB.entitlement, null);

  // 第一次 verify 拿过 access_token 并进了 KV，之后不再打 cgi-bin/token
  assert.ok(kv.has("wechat-access-token"));

  // 付了 → 权益 wechat 来源、永久（expires null）、订单 delivered、发货确认在权益之后
  wx.paidStatus = 2; wx.calls.length = 0;
  res = await post("/api/pay/wechat/orders/verify", "tok-a", { outTradeNo: order.outTradeNo });
  assert.equal(res.status, 200, await res.clone().text());
  const verified = await res.json();
  assert.equal(verified.paid, true);
  assert.equal(env.DB.entitlement.source, "wechat");
  assert.equal(env.DB.entitlement.product_id, "shushugo_pro_lifetime");
  assert.equal(env.DB.entitlement.expires_at, null);
  assert.equal(env.DB.entitlement.original_transaction_id, order.outTradeNo);
  assert.equal(env.DB.orders[order.outTradeNo].status, "delivered");
  assert.deepEqual(wx.calls, ["https://api.weixin.qq.com/xpay/query_order", "https://api.weixin.qq.com/xpay/notify_provide_goods"]);

  // 再 verify 一次是幂等的（不再打微信）
  wx.calls.length = 0;
  res = await post("/api/pay/wechat/orders/verify", "tok-a", { outTradeNo: order.outTradeNo });
  assert.equal(res.status, 200);
  assert.deepEqual(wx.calls, []);

  // 别的账号拿着同一单号来 → 409
  res = await post("/api/pay/wechat/orders/verify", "tok-b", { outTradeNo: order.outTradeNo });
  assert.equal(res.status, 409);

  // 消息推送：签名错 403；GET 握手回 echostr；退款推送撤销权益
  const ts = "1700000000", nonce = "n1";
  const sig = createHash("sha1").update(["pushtoken", ts, nonce].sort().join("")).digest("hex");
  res = await call(`/api/purchases/wechat-notifications?signature=bad&timestamp=${ts}&nonce=${nonce}&echostr=hello`);
  assert.equal(res.status, 403);
  res = await call(`/api/purchases/wechat-notifications?signature=${sig}&timestamp=${ts}&nonce=${nonce}&echostr=hello`);
  assert.equal(await res.text(), "hello");
  res = await post(`/api/purchases/wechat-notifications?signature=${sig}&timestamp=${ts}&nonce=${nonce}`, null, {
    Event: "xpay_refund_notify", OpenId: "openid-a", MchOrderId: order.outTradeNo, RetCode: 0
  });
  assert.deepEqual(await res.json(), { ErrCode: 0 });
  assert.equal(env.DB.entitlement.is_pro, 0);
  assert.equal(env.DB.orders[order.outTradeNo].status, "refunded");
  assert.ok(env.DB.events.some((e) => e.status === "revoked"));

  console.log("OK Worker wechat pay routes: order, verify (unpaid/paid/idempotent/other-account), push handshake and refund");
} finally {
  rmSync(outdir, { recursive: true, force: true });
}

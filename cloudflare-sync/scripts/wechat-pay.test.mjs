// 微信虚拟支付：签名算法、订单形状、查单判据、推送签名。
// 运行：node --experimental-strip-types scripts/wechat-pay.test.mjs
import assert from "node:assert/strict";
import { createHmac, createHash } from "node:crypto";
import {
  createOrder,
  expiresAtFor,
  paySig,
  priceTable,
  queryOrderPaid,
  userSig,
  verifyPushSignature
} from "../src/wechat-pay.ts";

const env = {
  WECHAT_APP_ID: "wx1",
  WECHAT_APP_SECRET: "s",
  WECHAT_OFFER_ID: "1450000000",
  WECHAT_PAY_APP_KEY: "appkey-abc",
  WECHAT_PAY_ENV: "0",
  WECHAT_PAY_PRICES: JSON.stringify({ shushugo_pro_monthly: 1200, shushugo_pro_lifetime: 12800, shushugo_pro_yearly: "bad" })
};
const session = { openid: "oX", sessionKey: "sk-123" };

// 签名 = 文档写的 HMAC-SHA256，用 Node 自己算一遍对拍。
assert.equal(await paySig("k", "requestVirtualPayment", "{\"a\":1}"),
  createHmac("sha256", "k").update("requestVirtualPayment&{\"a\":1}").digest("hex"));
assert.equal(await userSig("sk", "{\"a\":1}"), createHmac("sha256", "sk").update("{\"a\":1}").digest("hex"));

// 价格表：非法值丢掉，不用 NaN 下单。
assert.deepEqual(priceTable(env), { shushugo_pro_monthly: 1200, shushugo_pro_lifetime: 12800 });

// 订单：signData 是字符串，字段齐，两道签名分别对 AppKey 和 session_key。
const order = await createOrder(env, session, "shushugo_pro_monthly", "abc123");
const signData = JSON.parse(order.payload.signData);
assert.deepEqual(signData, {
  offerId: "1450000000", buyQuantity: 1, env: 0, currencyType: "CNY",
  productId: "shushugo_pro_monthly", goodsPrice: 1200, outTradeNo: "abc123", attach: "shushugo_pro_monthly"
});
assert.equal(order.payload.paySig, await paySig("appkey-abc", "requestVirtualPayment", order.payload.signData));
assert.equal(order.payload.signature, await userSig("sk-123", order.payload.signData));
assert.equal(order.payload.mode, "short_series_goods");
await assert.rejects(createOrder(env, session, "shushugo_pro_yearly", "x"), /PRICE_NOT_CONFIGURED/);
await assert.rejects(createOrder(env, session, "shushugo_pro_gold", "x"), /UNKNOWN_PRODUCT/);
await assert.rejects(createOrder({ ...env, WECHAT_PAY_APP_KEY: "" }, session, "shushugo_pro_monthly", "x"), /NOT_CONFIGURED/);

// 到期：月 31 天、年 366 天、永久 null。
const t0 = Date.parse("2026-09-20T00:00:00.000Z");
assert.equal(expiresAtFor("shushugo_pro_monthly", t0), "2026-10-21T00:00:00.000Z");
assert.equal(expiresAtFor("shushugo_pro_yearly", t0), "2027-09-21T00:00:00.000Z");
assert.equal(expiresAtFor("shushugo_pro_lifetime", t0), null);

// 查单：只有 status === 2 算付了；errcode 一律没付；pay_sig 用接口路径签。
const calls = [];
const fakeFetch = (body) => async (url, init) => {
  calls.push({ url: String(url), init });
  return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
};
assert.equal((await queryOrderPaid(env, "tok", session, "abc123", fakeFetch({ errcode: 0, order: { status: 2, wx_order_id: "W1" } }))).paid, true);
assert.equal((await queryOrderPaid(env, "tok", session, "abc123", fakeFetch({ errcode: 0, order: { status: 1 } }))).paid, false);
assert.equal((await queryOrderPaid(env, "tok", session, "abc123", fakeFetch({ errcode: 40001, errmsg: "bad token" }))).paid, false);
const sentBody = calls[0].init.body;
const expectedSig = createHmac("sha256", "appkey-abc").update(`/xpay/query_order&${sentBody}`).digest("hex");
assert.match(calls[0].url, new RegExp(`^https://api\\.weixin\\.qq\\.com/xpay/query_order\\?access_token=tok&pay_sig=${expectedSig}$`));
assert.deepEqual(JSON.parse(sentBody), { openid: "oX", out_trade_no: "abc123", env: 0 });

// 推送签名：sha1(sort(token, timestamp, nonce))。
const sig = createHash("sha1").update(["tokenA", "1700000000", "nonce9"].sort().join("")).digest("hex");
assert.equal(await verifyPushSignature("tokenA", "1700000000", "nonce9", sig), true);
assert.equal(await verifyPushSignature("tokenB", "1700000000", "nonce9", sig), false);

console.log("OK wechat virtual payment: signatures, order shape, query semantics, push signature");

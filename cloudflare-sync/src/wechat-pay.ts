/**
 * 微信小程序虚拟支付（个人主体，2026-08-31 开放）。
 *
 * 流程和 Apple 那条一样是「先校验、再授权、最后发货」：
 *   1. 客户端要一张订单 → 服务端生成 signData + 两道签名（`createOrder`）
 *   2. 客户端 wx.requestVirtualPayment 付钱
 *   3. 客户端喊 verify → 服务端用 /xpay/query_order 问微信「这单付了没」，付了才写权益，
 *      写完再 /xpay/notify_provide_goods 告诉微信「货发了」（`verifyOrder`）
 *   4. 微信的消息推送（xpay_goods_deliver_notify / xpay_refund_notify）走同一个 verify，
 *      客户端没喊也能补发；退款走撤销。
 *
 * ⚠️ 两道签名的 key 不一样：paySig 用 AppKey（虚拟支付后台给的），signature 用用户的
 * session_key（code2session 给的）。所以登录时必须把 session_key 和 openid 存下来
 * （`rememberWechatSession`），不然出不了单。
 *
 * ⚠️ 字段名照文档逐字抄，`signData` 必须是 JSON 字符串且前后端一字不差 —— 签名签的是字节。
 */

export interface WechatPayEnv {
  WECHAT_APP_ID?: string;
  WECHAT_APP_SECRET?: string;
  WECHAT_OFFER_ID?: string;
  WECHAT_PAY_APP_KEY?: string;
  /** "0" 正式 / "1" 沙箱 */
  WECHAT_PAY_ENV?: string;
  /** JSON：{ productId: 分 }。价格写在这里而不是代码里，改价不用发版。 */
  WECHAT_PAY_PRICES?: string;
}

export interface WechatSession {
  openid: string;
  sessionKey: string;
}

export const WECHAT_PAY_PRODUCTS = ["shushugo_pro_monthly", "shushugo_pro_yearly", "shushugo_pro_lifetime"] as const;
export type WechatPayProduct = (typeof WECHAT_PAY_PRODUCTS)[number];

const DAY_MS = 24 * 60 * 60 * 1000;
/** 订阅类商品在微信这边是一次性扣款，到期时间由我们按天数算。 */
export const PRODUCT_DURATION_DAYS: Record<WechatPayProduct, number | null> = {
  shushugo_pro_monthly: 31,
  shushugo_pro_yearly: 366,
  shushugo_pro_lifetime: null
};

const encoder = new TextEncoder();

const hmacSha256Hex = async (key: string, message: string) => {
  const cryptoKey = await crypto.subtle.importKey("raw", encoder.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(message));
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join("");
};

/** paySig = HMAC-SHA256(AppKey, uri + "&" + body)。客户端 uri 是 `requestVirtualPayment`，服务端接口是路径。 */
export const paySig = (appKey: string, uri: string, body: string) => hmacSha256Hex(appKey, `${uri}&${body}`);
/** signature = HMAC-SHA256(session_key, body)。 */
export const userSig = (sessionKey: string, body: string) => hmacSha256Hex(sessionKey, body);

export const configured = (env: WechatPayEnv) => Boolean(env.WECHAT_OFFER_ID && env.WECHAT_PAY_APP_KEY && env.WECHAT_APP_ID && env.WECHAT_APP_SECRET);

export const priceTable = (env: WechatPayEnv): Partial<Record<WechatPayProduct, number>> => {
  try {
    const parsed = JSON.parse(env.WECHAT_PAY_PRICES ?? "{}") as Record<string, unknown>;
    const table: Partial<Record<WechatPayProduct, number>> = {};
    for (const id of WECHAT_PAY_PRODUCTS) {
      const cents = Number(parsed[id]);
      if (Number.isInteger(cents) && cents > 0) table[id] = cents;
    }
    return table;
  } catch {
    return {};
  }
};

export interface CreatedOrder {
  outTradeNo: string;
  productId: WechatPayProduct;
  priceCents: number;
  /** 原样交给 wx.requestVirtualPayment */
  payload: { signData: string; paySig: string; signature: string; mode: "short_series_goods" };
}

/**
 * 生成一张订单。outTradeNo 由调用方给（要先入库再签，签名里带着它）。
 * signData 的字段顺序固定 —— 客户端把这个字符串原样交给微信，签名是对字节签的。
 */
export const createOrder = async (
  env: WechatPayEnv,
  session: WechatSession,
  productId: string,
  outTradeNo: string
): Promise<CreatedOrder> => {
  if (!configured(env)) throw new Error("WECHAT_PAY_NOT_CONFIGURED");
  if (!(WECHAT_PAY_PRODUCTS as readonly string[]).includes(productId)) throw new Error("UNKNOWN_PRODUCT");
  const priceCents = priceTable(env)[productId as WechatPayProduct];
  if (!priceCents) throw new Error("PRICE_NOT_CONFIGURED");
  const signData = JSON.stringify({
    offerId: env.WECHAT_OFFER_ID,
    buyQuantity: 1,
    env: Number(env.WECHAT_PAY_ENV ?? "0") === 1 ? 1 : 0,
    currencyType: "CNY",
    productId,
    goodsPrice: priceCents,
    outTradeNo,
    attach: productId
  });
  return {
    outTradeNo,
    productId: productId as WechatPayProduct,
    priceCents,
    payload: {
      signData,
      paySig: await paySig(env.WECHAT_PAY_APP_KEY!, "requestVirtualPayment", signData),
      signature: await userSig(session.sessionKey, signData),
      mode: "short_series_goods"
    }
  };
};

/** 调用微信服务端接口（/xpay/*）：pay_sig 用接口路径签，access_token 挂 query。 */
export const callXpay = async (
  env: WechatPayEnv,
  accessToken: string,
  path: "/xpay/query_order" | "/xpay/notify_provide_goods" | "/xpay/refund_order",
  body: Record<string, unknown>,
  fetchImpl: typeof fetch = fetch
) => {
  const json = JSON.stringify(body);
  const sig = await paySig(env.WECHAT_PAY_APP_KEY!, path, json);
  const response = await fetchImpl(`https://api.weixin.qq.com${path}?access_token=${encodeURIComponent(accessToken)}&pay_sig=${sig}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: json
  });
  return response.json<{ errcode?: number; errmsg?: string; order?: XpayOrder }>();
};

export interface XpayOrder {
  out_trade_no?: string;
  wx_order_id?: string;
  /** 文档：1 待支付 / 2 已支付 / 3 已退款…（以实际返回为准，只认 2 为付了） */
  status?: number;
  paid_time?: number;
  bizmeta?: Record<string, unknown>;
  product_id?: string;
  quantity?: number;
}

export const expiresAtFor = (productId: WechatPayProduct, paidAtMs: number) => {
  const days = PRODUCT_DURATION_DAYS[productId];
  return days === null ? null : new Date(paidAtMs + days * DAY_MS).toISOString();
};

/**
 * 「这单付了没」。返回 paid=true 时调用方才准写权益。
 * 微信这边的 order.status：2 = 已支付。其它一律当没付（包括查不到）。
 */
export const queryOrderPaid = async (
  env: WechatPayEnv,
  accessToken: string,
  session: { openid: string },
  outTradeNo: string,
  fetchImpl: typeof fetch = fetch
): Promise<{ paid: boolean; order?: XpayOrder; errcode?: number; errmsg?: string }> => {
  const result = await callXpay(env, accessToken, "/xpay/query_order", {
    openid: session.openid,
    out_trade_no: outTradeNo,
    env: Number(env.WECHAT_PAY_ENV ?? "0") === 1 ? 1 : 0
  }, fetchImpl);
  if (result.errcode) return { paid: false, errcode: result.errcode, errmsg: result.errmsg };
  const order = result.order;
  return { paid: order?.status === 2, order };
};

/** 发货确认。失败不影响权益（权益已经写了），只是微信那边会催；下次 verify 会再喊一次。 */
export const notifyProvideGoods = (
  env: WechatPayEnv,
  accessToken: string,
  session: { openid: string },
  outTradeNo: string,
  fetchImpl: typeof fetch = fetch
) => callXpay(env, accessToken, "/xpay/notify_provide_goods", {
  openid: session.openid,
  out_trade_no: outTradeNo,
  env: Number(env.WECHAT_PAY_ENV ?? "0") === 1 ? 1 : 0
}, fetchImpl);

/**
 * 消息推送（小程序后台「消息推送」配的 URL）的签名校验：sha1(sort(token, timestamp, nonce))。
 * GET 握手回 echostr，POST 才是事件。
 */
export const verifyPushSignature = async (token: string, timestamp: string, nonce: string, signature: string) => {
  const joined = [token, timestamp, nonce].sort().join("");
  const digest = await crypto.subtle.digest("SHA-1", encoder.encode(joined));
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return hex === signature;
};

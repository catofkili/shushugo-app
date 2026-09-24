// 微信小程序虚拟支付（个人主体）。三步，签名全在服务端：
//   1. 服务端下单：拿到 signData / paySig / signature（AppKey 和 session_key 都只在服务端）
//   2. wx.requestVirtualPayment 付钱
//   3. 服务端 verify：它去问微信「这单付了没」，付了才写权益、再向微信确认发货
// 客户端从不自己判定「付成功了」——requestVirtualPayment 的 success 只说明用户点完了，
// 权益以 verify 返回的为准。中途断网也没事：订单号在，下次 verify 一样能补发。
const config = require('../config');
const { requestJson } = require('./wx-promise');
const { authHeaders } = require('./auth');
const PENDING_ORDER_KEY = 'wechat_pending_order_no';

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function apiBase() {
  const base = String(config.paymentUrl || config.syncUrl || '').replace(/\/$/, '');
  if (!base) throw new Error('没有配置 paymentUrl / syncUrl；支付必须由服务端下单后才能发起');
  return /\/api$/i.test(base) ? base : `${base}/api`;
}

function requestVirtualPayment(order) {
  return new Promise((resolve, reject) => {
    if (typeof wx.requestVirtualPayment !== 'function') {
      reject(new Error('当前微信版本不支持虚拟支付，请升级微信'));
      return;
    }
    wx.requestVirtualPayment({
      signData: order.signData,
      paySig: order.paySig,
      signature: order.signature,
      mode: order.mode || 'short_series_goods',
      success: resolve,
      fail: reject
    });
  });
}

async function verifyOrder(outTradeNo) {
  return requestJson(`${apiBase()}/pay/wechat/orders/verify`, {
    method: 'POST',
    data: { outTradeNo },
    header: { 'content-type': 'application/json', ...authHeaders() }
  });
}

async function verifyWithRetry(outTradeNo) {
  let lastResult;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      lastResult = await verifyOrder(outTradeNo);
      if (lastResult?.paid) {
        wx.removeStorageSync(PENDING_ORDER_KEY);
        return lastResult;
      }
    } catch (error) {
      if (error?.data?.code === 'ORDER_REFUNDED') {
        wx.removeStorageSync(PENDING_ORDER_KEY);
        throw error;
      }
      const status = Number(error?.statusCode || 0);
      if (status && status !== 402 && status < 500) throw error;
      lastResult = { paid: false };
    }
    if (attempt < 3) await wait(350 * (attempt + 1));
  }
  return { ...(lastResult || {}), paid: false, pending: true };
}

async function requestPayment(productId, expectedPriceCents) {
  const order = await requestJson(`${apiBase()}/pay/wechat/orders`, {
    method: 'POST',
    data: { productId },
    header: { 'content-type': 'application/json', ...authHeaders() }
  });
  for (const field of ['outTradeNo', 'signData', 'paySig', 'signature']) {
    if (!order?.[field]) throw new Error(`支付订单缺少 ${field}`);
  }
  if (order.productId !== productId || order.priceCents !== expectedPriceCents) throw new Error('PAYMENT_PRICE_CHANGED');
  wx.setStorageSync(PENDING_ORDER_KEY, order.outTradeNo);
  try {
    await requestVirtualPayment(order);
  } catch (error) {
    // 回调有歧义时仍以服务端查单为准；沙箱可能没有发货推送，订单号留本机供稍后补查。
    const cancelled = /cancel/i.test(error?.errMsg || '');
    if (cancelled) {
      const verified = await verifyOrder(order.outTradeNo).catch(() => null);
      if (verified?.paid) {
        wx.removeStorageSync(PENDING_ORDER_KEY);
        return { paid: true, outTradeNo: order.outTradeNo, entitlement: verified.entitlement };
      }
      return { paid: false, cancelled: true, pending: true, outTradeNo: order.outTradeNo };
    }
    const verified = await verifyWithRetry(order.outTradeNo).catch(() => null);
    if (verified?.paid) return { paid: true, outTradeNo: order.outTradeNo, entitlement: verified.entitlement };
    if (verified?.pending) return { paid: false, pending: true, outTradeNo: order.outTradeNo };
    throw error;
  }
  const verified = await verifyWithRetry(order.outTradeNo);
  return { paid: Boolean(verified?.paid), pending: Boolean(verified?.pending), outTradeNo: order.outTradeNo, entitlement: verified?.entitlement };
}

async function verifyPendingPayment() {
  const outTradeNo = String(wx.getStorageSync(PENDING_ORDER_KEY) || '');
  if (!outTradeNo) return { paid: false, pending: false };
  return { ...(await verifyWithRetry(outTradeNo)), outTradeNo };
}

function pendingOrderNo() {
  return String(wx.getStorageSync(PENDING_ORDER_KEY) || '');
}

module.exports = { pendingOrderNo, requestPayment, verifyOrder, verifyPendingPayment };

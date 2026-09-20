// 微信小程序虚拟支付（个人主体）。三步，签名全在服务端：
//   1. 服务端下单：拿到 signData / paySig / signature（AppKey 和 session_key 都只在服务端）
//   2. wx.requestVirtualPayment 付钱
//   3. 服务端 verify：它去问微信「这单付了没」，付了才写权益、再向微信确认发货
// 客户端从不自己判定「付成功了」——requestVirtualPayment 的 success 只说明用户点完了，
// 权益以 verify 返回的为准。中途断网也没事：订单号在，下次 verify 一样能补发。
const config = require('../config');
const { requestJson } = require('./wx-promise');
const { authHeaders } = require('./auth');

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

async function requestPayment(productId) {
  const order = await requestJson(`${apiBase()}/pay/wechat/orders`, {
    method: 'POST',
    data: { productId },
    header: { 'content-type': 'application/json', ...authHeaders() }
  });
  for (const field of ['outTradeNo', 'signData', 'paySig', 'signature']) {
    if (!order?.[field]) throw new Error(`支付订单缺少 ${field}`);
  }
  try {
    await requestVirtualPayment(order);
  } catch (error) {
    // 用户取消是正常路径，不当错误抛；其它失败也先问一遍服务端，付了就补发。
    if (/cancel/i.test(error?.errMsg || '')) return { paid: false, cancelled: true, outTradeNo: order.outTradeNo };
    const verified = await verifyOrder(order.outTradeNo).catch(() => null);
    if (verified?.paid) return { paid: true, outTradeNo: order.outTradeNo, entitlement: verified.entitlement };
    throw error;
  }
  const verified = await verifyOrder(order.outTradeNo);
  return { paid: Boolean(verified?.paid), outTradeNo: order.outTradeNo, entitlement: verified?.entitlement };
}

module.exports = { requestPayment, verifyOrder };

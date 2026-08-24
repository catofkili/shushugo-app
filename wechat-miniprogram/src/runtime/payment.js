const config = require('../config');
const { requestJson } = require('./wx-promise');
const { authHeaders } = require('./auth');

function requirePaymentUrl() {
  if (!config.paymentUrl) throw new Error('没有配置 paymentUrl；支付必须由服务端下单后才能发起');
  return config.paymentUrl.replace(/\/$/, '');
}

async function requestPayment(planId) {
  const base = requirePaymentUrl();
  const path = String(config.paymentPath || '/api/pay/orders');
  const normalizedPath = /\/api$/i.test(base) && path.startsWith('/api')
    ? path.slice('/api'.length) || '/'
    : path.startsWith('/') ? path : `/${path}`;
  const order = await requestJson(`${base}${normalizedPath}`, {
    method: 'POST',
    data: { planId },
    header: { 'content-type': 'application/json', ...authHeaders() }
  });
  for (const field of ['timeStamp', 'nonceStr', 'package', 'paySign']) {
    if (!order?.[field]) throw new Error(`支付订单缺少 ${field}`);
  }
  await new Promise((resolve, reject) => {
    wx.requestPayment({
      timeStamp: String(order.timeStamp),
      nonceStr: String(order.nonceStr),
      package: String(order.package),
      signType: String(order.signType || 'RSA'),
      paySign: String(order.paySign),
      success: resolve,
      fail: reject
    });
  });
  return { paid: true, orderId: order.orderId || null };
}

module.exports = { requestPayment };

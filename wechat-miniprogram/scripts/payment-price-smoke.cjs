const assert = require('node:assert/strict');
const paymentPath = require.resolve('../src/runtime/payment');
const requestPath = require.resolve('../src/runtime/wx-promise');
const authPath = require.resolve('../src/runtime/auth');

let response = { outTradeNo: 'o1', productId: 'shushugo_pro_lifetime', priceCents: 29800, signData: '{}', paySig: 'sig', signature: 'sig' };
let paymentCalls = 0;
let verifyCalls = 0;
let verifyResult = null;
const storage = new Map();
require.cache[requestPath] = { exports: { requestJson: async (url) => {
  if (!url.endsWith('/verify')) return response;
  verifyCalls += 1;
  if (verifyResult instanceof Error) throw verifyResult;
  return verifyResult;
} } };
require.cache[authPath] = { exports: { authHeaders: () => ({}) } };
global.wx = {
  requestVirtualPayment: () => { paymentCalls += 1; },
  getStorageSync: (key) => storage.get(key) ?? '',
  setStorageSync: (key, value) => storage.set(key, value),
  removeStorageSync: (key) => storage.delete(key)
};
const { requestPayment, verifyPendingPayment, pendingOrderNo } = require(paymentPath);
const httpError = (statusCode) => Object.assign(new Error(`HTTP ${statusCode}`), { statusCode });

(async () => {
  await assert.rejects(requestPayment('shushugo_pro_lifetime', 2500), /PAYMENT_PRICE_CHANGED/);
  assert.equal(paymentCalls, 0, 'a changed displayed price must not open WeChat payment');
  response = { ...response, productId: 'shushugo_pro_yearly' };
  await assert.rejects(requestPayment('shushugo_pro_lifetime', 29800), /PAYMENT_PRICE_CHANGED/);
  assert.equal(paymentCalls, 0, 'a mismatched product must not open WeChat payment');

  // 启动 / 点「恢复」时补查本机那张没确认的订单：只查一次；有明确结果就清掉，断网 / 5xx 才留着。
  const pendingCases = [
    ['paid', { paid: true }, { paid: true }, ''],
    ['cancelled (402)', httpError(402), { paid: false, pending: false }, ''],
    ['refunded / other account (409)', httpError(409), { paid: false, pending: false }, ''],
    ['server down (503)', httpError(503), { paid: false, pending: true }, 'o9'],
    ['offline', new Error('request:fail'), { paid: false, pending: true }, 'o9']
  ];
  for (const [label, result, expected, remaining] of pendingCases) {
    storage.set('wechat_pending_order_no', 'o9');
    verifyResult = result;
    verifyCalls = 0;
    const outcome = await verifyPendingPayment();
    assert.equal(verifyCalls, 1, `${label}: one verify, no retry loop`);
    assert.equal(outcome.paid, expected.paid, label);
    if ('pending' in expected) assert.equal(outcome.pending, expected.pending, label);
    assert.equal(pendingOrderNo(), remaining, `${label}: pending order kept only when the answer is unknown`);
  }
  storage.clear();
  verifyCalls = 0;
  assert.deepEqual(await verifyPendingPayment(), { paid: false, pending: false });
  assert.equal(verifyCalls, 0, 'nothing pending means no request');

  console.log('OK mini program rejects mismatched payment price and product; pending order verified once, cleared on a definite answer');
})().catch((error) => { console.error(error); process.exitCode = 1; });

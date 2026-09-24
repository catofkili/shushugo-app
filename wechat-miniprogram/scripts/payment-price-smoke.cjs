const assert = require('node:assert/strict');
const paymentPath = require.resolve('../src/runtime/payment');
const requestPath = require.resolve('../src/runtime/wx-promise');
const authPath = require.resolve('../src/runtime/auth');

let response = { outTradeNo: 'o1', productId: 'shushugo_pro_lifetime', priceCents: 29800, signData: '{}', paySig: 'sig', signature: 'sig' };
let paymentCalls = 0;
require.cache[requestPath] = { exports: { requestJson: async () => response } };
require.cache[authPath] = { exports: { authHeaders: () => ({}) } };
global.wx = { requestVirtualPayment: () => { paymentCalls += 1; } };
const { requestPayment } = require(paymentPath);

(async () => {
  await assert.rejects(requestPayment('shushugo_pro_lifetime', 2500), /PAYMENT_PRICE_CHANGED/);
  assert.equal(paymentCalls, 0, 'a changed displayed price must not open WeChat payment');
  response = { ...response, productId: 'shushugo_pro_yearly' };
  await assert.rejects(requestPayment('shushugo_pro_lifetime', 29800), /PAYMENT_PRICE_CHANGED/);
  assert.equal(paymentCalls, 0, 'a mismatched product must not open WeChat payment');
  console.log('OK mini program rejects mismatched payment price and product');
})().catch((error) => { console.error(error); process.exitCode = 1; });

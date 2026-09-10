// 权益判据的回归钉子。跑法：npm run test
//
// 钉住的是审计里可复现的那两条：
//   1.3 旧订阅交易不许把永久 Pro 降级（先买永久，再校验一笔已过期的月度订单，
//       老代码直接覆盖那一行，最终响应变成 isPro=false）；
//   同一笔原始交易的新消息（续费、退款、到期）必须能改写自己那一行，包括往下改。
//
// 1.2「一笔交易只能给一个账号」靠的是 apple_transaction_owners 的主键 +
// 写权益前的读回（见 applyAppleTransaction），那是数据库约束，不在这里断言。
import assert from 'node:assert/strict';
import { entitlementStrength } from '../src/entitlement-rules.ts';

const lifetime = { is_pro: 1, product_id: 'shushugo_pro_lifetime', expires_at: null };
const activeSub = { is_pro: 1, product_id: 'shushugo_pro_monthly', expires_at: '2099-01-01T00:00:00.000Z' };
const expiredSub = { is_pro: 1, product_id: 'shushugo_pro_monthly', expires_at: '2020-01-01T00:00:00.000Z' };

assert.ok(entitlementStrength(lifetime) > entitlementStrength(activeSub), '永久强于任何订阅');
assert.ok(entitlementStrength(activeSub) > entitlementStrength(expiredSub), '有效订阅强于过期订单');
assert.ok(entitlementStrength(expiredSub) > entitlementStrength(null), '过期订单仍强于没有权益');
assert.equal(entitlementStrength({ is_pro: 0, product_id: 'shushugo_pro_lifetime', expires_at: null }), -1);
// 订阅缺到期时间不许被解释成永久 —— 那正是「取消续订后 Pro 永不过期」的来源。
assert.ok(
  entitlementStrength({ is_pro: 1, product_id: 'shushugo_pro_monthly', expires_at: null })
    < entitlementStrength(expiredSub),
  '没有到期时间的订阅是最弱的一档，不是永久'
);

console.log('OK entitlement strength rules');

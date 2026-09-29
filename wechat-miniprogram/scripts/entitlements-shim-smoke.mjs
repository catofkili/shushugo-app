// 小程序里 frontend/src/lib/entitlements 被 scripts/shared/shims/entitlements.js 换掉。
// 2026-09-30 真机：领取首月会员，服务器返回 isPro:true，本地读回 free —— 替身的 saveEntitlements 是只读空操作，
// 云端下发的权益（登录、领赠送、启动对账、购买）从来没落地过。这里钉住：存得下、读得回、通知订阅者。
import assert from 'node:assert/strict';
import Module, { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { normalizeEntitlement } = require('../src/core/entitlements.js');

// 替身里的 require('../runtime/entitlements') 在打包时被重定向到真实 runtime；这里换成内存版。
const store = new Map();
const fakeRuntime = {
  cachedEntitlement: () => {
    const raw = store.get('entitlement_cache');
    return raw ? normalizeEntitlement(JSON.parse(raw)) : normalizeEntitlement({ active: false, source: 'local-default' });
  },
  storeEntitlement: (payload) => store.set('entitlement_cache', JSON.stringify(normalizeEntitlement(payload)))
};
const originalLoad = Module._load;
Module._load = function (request, parent, ...rest) {
  if (request === '../runtime/entitlements' && parent?.filename?.endsWith(path.join('shims', 'entitlements.js'))) return fakeRuntime;
  return originalLoad.call(this, request, parent, ...rest);
};
const shim = require(path.join(here, 'shared/shims/entitlements.js'));

assert.equal(shim.getEntitlements().isPro, false, '一开始是免费版');

shim.saveEntitlements({ isPro: true, source: 'trial', productId: 'shushugo_pro_launch_gift', expiresAt: '2099-01-01T00:00:00.000Z' });
const state = shim.getEntitlements();
assert.equal(state.isPro, true, '云端下发的会员必须存得下');
assert.equal(state.productId, 'shushugo_pro_launch_gift');
assert.equal(state.source, 'trial');
assert.equal(shim.canUseFeature('anything'), true);

const seen = [];
const off = shim.subscribeEntitlements((value) => seen.push(value.isPro));
shim.grantPro('shushugo_pro_lifetime', 'cloud');
assert.deepEqual(seen, [true], '存完要通知订阅者，界面才会解锁');
off();
shim.clearEntitlements();
assert.deepEqual(seen, [true], '取消订阅后不再通知');
assert.equal(shim.getEntitlements().isPro, false);

shim.saveEntitlements({ isPro: true, source: 'cloud', productId: 'shushugo_pro_monthly', expiresAt: '2020-01-01T00:00:00.000Z' });
assert.equal(shim.getEntitlements().isPro, false, '已过期读回是免费');

console.log('entitlements shim smoke passed');

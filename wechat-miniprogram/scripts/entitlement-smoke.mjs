import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { normalizeEntitlement, canUse } = require('../src/core/entitlements.js');
const active = normalizeEntitlement({ isPro: true, productId: 'shushugo_pro_monthly', expiresAt: '2099-01-01T00:00:00.000Z' });
assert.equal(active.active, true);
assert.equal(active.plan, 'shushugo_pro_monthly');
assert.equal(canUse('offline-study', active), true);
assert.equal(canUse('cloud-sync', active), true);
const expired = normalizeEntitlement({ isPro: true, expiresAt: '2020-01-01T00:00:00.000Z' });
assert.equal(expired.active, false);
assert.equal(canUse('cloud-sync', expired), false);
console.log(JSON.stringify({ ok: true, active: active.plan, expired: expired.active }, null, 2));

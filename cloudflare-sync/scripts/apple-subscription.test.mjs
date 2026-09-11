import assert from "node:assert/strict";
import { currentSubscriptionFromStatus } from "../src/apple-subscription.ts";

const jws = (payload) => `e30.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.sig`;
const products = new Set(["shushugo_pro_monthly", "shushugo_pro_yearly"]);
const originalTransactionId = "original-1";

const latest = currentSubscriptionFromStatus({
  data: [{ lastTransactions: [{
    originalTransactionId,
    status: 2,
    signedTransactionInfo: jws({
      originalTransactionId,
      transactionId: "T1",
      productId: "shushugo_pro_monthly",
      expiresDate: 1_000
    })
  }, {
    originalTransactionId,
    status: 1,
    signedTransactionInfo: jws({
      originalTransactionId,
      transactionId: "T2",
      productId: "shushugo_pro_yearly",
      expiresDate: 2_000
    })
  }] }]
}, originalTransactionId, products);
assert.equal(latest?.payload.transactionId, "T2", "missed renewal must replace the old transaction");
assert.equal(latest?.payload.productId, "shushugo_pro_yearly", "subscription upgrades must be accepted");
assert.equal(latest?.status, 1);

const activeBeatsRevokedFutureDate = currentSubscriptionFromStatus({
  data: [{ lastTransactions: [{
    originalTransactionId,
    status: 5,
    signedTransactionInfo: jws({
      originalTransactionId,
      transactionId: "revoked",
      productId: "shushugo_pro_yearly",
      expiresDate: 9_000
    })
  }, {
    originalTransactionId,
    status: 1,
    signedTransactionInfo: jws({
      originalTransactionId,
      transactionId: "active",
      productId: "shushugo_pro_monthly",
      expiresDate: 2_000
    })
  }] }]
}, originalTransactionId, products);
assert.equal(activeBeatsRevokedFutureDate?.payload.transactionId, "active", "active status must beat a revoked future date");

const grace = currentSubscriptionFromStatus({
  data: [{ lastTransactions: [{
    originalTransactionId,
    status: 4,
    signedTransactionInfo: jws({
      originalTransactionId,
      transactionId: "T3",
      productId: "shushugo_pro_monthly",
      expiresDate: 3_000
    }),
    signedRenewalInfo: jws({ gracePeriodExpiresDate: 4_000 })
  }] }]
}, originalTransactionId, products);
assert.equal(grace?.payload.expiresDate, 4_000, "billing grace must use its own expiry");
assert.equal(grace?.status, 4);

assert.equal(currentSubscriptionFromStatus({
  data: [{ lastTransactions: [{
    originalTransactionId: "someone-else",
    status: 1,
    signedTransactionInfo: jws({
      originalTransactionId: "someone-else",
      transactionId: "T4",
      productId: "shushugo_pro_monthly",
      expiresDate: 9_000
    })
  }] }]
}, originalTransactionId, products), null, "another subscription must not be attached to this account");

console.log("OK current Apple subscription selection");

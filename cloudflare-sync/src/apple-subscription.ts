export interface AppleTransactionPayload {
  bundleId?: string;
  productId?: string;
  transactionId?: string;
  originalTransactionId?: string;
  environment?: "Sandbox" | "Production";
  expiresDate?: number;
  purchaseDate?: number;
  revocationDate?: number;
  type?: string;
}

interface AppleRenewalPayload {
  gracePeriodExpiresDate?: number;
}

export interface SubscriptionStatusResponse {
  data?: Array<{
    lastTransactions?: Array<{
      originalTransactionId?: string;
      status?: number;
      signedTransactionInfo?: string;
      signedRenewalInfo?: string;
    }>;
  }>;
}

export interface CurrentAppleSubscription {
  payload: AppleTransactionPayload;
  raw: SubscriptionStatusResponse;
  status: number;
}

const decodeJwsPayload = <T>(jws: string): T => {
  const payload = jws.split(".")[1];
  if (!payload) throw new Error("Apple signed subscription payload is malformed");
  const base64 = payload.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(payload.length / 4) * 4, "=");
  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes)) as T;
};

/** 从 Apple 的当前订阅状态中挑出同一原始交易的最新一笔，而不是重查旧续费单。 */
export const currentSubscriptionFromStatus = (
  raw: SubscriptionStatusResponse,
  originalTransactionId: string,
  productIds: ReadonlySet<string>
): CurrentAppleSubscription | null => {
  const matches: CurrentAppleSubscription[] = [];
  for (const group of raw.data ?? []) {
    for (const item of group.lastTransactions ?? []) {
      if (!item.signedTransactionInfo) continue;
      const payload = decodeJwsPayload<AppleTransactionPayload>(item.signedTransactionInfo);
      const originalId = item.originalTransactionId ?? payload.originalTransactionId;
      if (originalId !== originalTransactionId || !payload.productId || !productIds.has(payload.productId)) continue;
      const status = Number(item.status ?? 0);
      if (status === 4 && item.signedRenewalInfo) {
        const renewal = decodeJwsPayload<AppleRenewalPayload>(item.signedRenewalInfo);
        if (renewal.gracePeriodExpiresDate) payload.expiresDate = renewal.gracePeriodExpiresDate;
      }
      matches.push({ payload, raw, status });
    }
  }
  return matches.sort((left, right) => {
    // 同一订阅组可能同时返回多个商品的最后交易。撤销交易可能还带着原来的
    // 未来 expiresDate，不能让它仅凭日期压过当前有效/宽限中的商品。
    const rightActive = right.status === 1 || right.status === 4 ? 1 : 0;
    const leftActive = left.status === 1 || left.status === 4 ? 1 : 0;
    return rightActive - leftActive || (
      (right.payload.expiresDate ?? right.payload.purchaseDate ?? 0)
      - (left.payload.expiresDate ?? left.payload.purchaseDate ?? 0)
    );
  })[0] ?? null;
};

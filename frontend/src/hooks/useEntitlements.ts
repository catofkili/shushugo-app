import { useEffect, useState } from "react";
import { EntitlementState, getEntitlements, subscribeEntitlements } from "../lib/entitlements";

export function useEntitlements(): EntitlementState {
  const [entitlements, setEntitlements] = useState<EntitlementState>(() => getEntitlements());

  useEffect(() => {
    setEntitlements(getEntitlements());
    return subscribeEntitlements(setEntitlements);
  }, []);

  return entitlements;
}

import { afterEach, describe, expect, it } from "vitest";
import { clearLocalAppData } from "./clear-local-data";

/** node 环境没有 localStorage,拿一个最小实现顶上(只用到 key/length/removeItem)。 */
const installStorage = (entries: Record<string, string>) => {
  const map = new Map(Object.entries(entries));
  const stub = {
    get length() { return map.size; },
    key: (index: number) => [...map.keys()][index] ?? null,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => { map.set(key, value); },
    removeItem: (key: string) => { map.delete(key); },
    clear: () => map.clear()
  };
  Object.defineProperty(globalThis, "localStorage", { value: stub, configurable: true });
  return map;
};

afterEach(() => {
  Reflect.deleteProperty(globalThis as Record<string, unknown>, "localStorage");
});

describe("clearLocalAppData", () => {
  it("清掉所有 mn- / jp-grammar- 前缀的学习数据", () => {
    const map = installStorage({
      "mn-study-preferences": "{}",
      "mn-active-study-mode": "classic",
      "mn-auto-mistakes-mode": "{}",
      "mn-quick-study-draft": "[]",
      "jp-grammar-learned": "[]",
      "jp-grammar-review": "[]",
      "jp-grammar-personal-notes-v1": "{}",
      "jp-grammar-card-order-v2": "[]",
      "jp-grammar-selected-level-v1": "N3"
    });

    clearLocalAppData();

    expect([...map.keys()]).toEqual([]);
  });

  // 之前两处「清除数据」各写各的键名清单,新加的键谁都没想起来补进去。
  // 按前缀扫就是为了让「以后新加的键」自动被覆盖 —— 这条钉住它。
  it("以后新加的 mn- 键不用登记也会被清掉", () => {
    const map = installStorage({ "mn-some-future-feature": "1" });
    expect(clearLocalAppData()).toEqual(["mn-some-future-feature"]);
    expect(map.size).toBe(0);
  });

  it("不碰账号会话、本机口令和通知计划", () => {
    const map = installStorage({
      "mn_cloud_sync_token": "token",
      "mn_local_passcode": "hash",
      "mn_notification_settings": "{}",
      "CapacitorStorage.mn_cloud_sync_email": "a@b.c",
      "mn-study-preferences": "{}"
    });

    clearLocalAppData();

    expect([...map.keys()].sort()).toEqual([
      "CapacitorStorage.mn_cloud_sync_email",
      "mn_cloud_sync_token",
      "mn_local_passcode",
      "mn_notification_settings"
    ]);
  });

  // 已购权益由调用方决定(隐私页的「删除所有数据」会另外调 clearEntitlements)
  it("不碰已购权益", () => {
    const map = installStorage({ "mn-entitlements": "{}", "mn-study-preferences": "{}" });
    clearLocalAppData();
    expect([...map.keys()]).toEqual(["mn-entitlements"]);
  });
});

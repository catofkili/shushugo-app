import { describe, expect, it } from "vitest";
import { duelIdFromUrl } from "./duel-links";

describe("duel deep links", () => {
  it("reads web URLs and Taro page params without a browser URL", () => {
    expect(duelIdFromUrl("https://app.test/study/duel/index?id=abc-123")).toBe("abc-123");
    expect(duelIdFromUrl("https://app.test/?page=duel&id=abc-123")).toBe("abc-123");
    expect(duelIdFromUrl("https://app.test/?id=abc-123")).toBeNull();
    expect(duelIdFromUrl("", { id: "weapp-456" })).toBe("weapp-456");
    expect(duelIdFromUrl("https://app.test/?page=duel&id=old", { id: "new" })).toBe("new");
    expect(duelIdFromUrl("", {})).toBeNull();
  });

  it.each(["", "<script>", "a/b", "a b", "a%2Fb", "あ", "x".repeat(129)])("rejects invalid IDs from both sources: %s", (id) => {
    expect(duelIdFromUrl(`https://app.test/study/duel/index?id=${encodeURIComponent(id)}`)).toBeNull();
    expect(duelIdFromUrl("", { id })).toBeNull();
  });

  it.each([undefined, null, 123, ["abc"], { id: "abc" }])("rejects non-string page IDs: %j", (id) => {
    expect(duelIdFromUrl("", { id })).toBeNull();
  });
});

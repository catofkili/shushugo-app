import { beforeAll, describe, expect, it } from "vitest";
import { loadTransitivity, lookupTransitivity } from "./transitivity";

beforeAll(async () => {
  await loadTransitivity();
});

describe("lookupTransitivity", () => {
  it("成对的自他动词各标各的", () => {
    expect(lookupTransitivity("始まる", "はじまる", "动词")).toBe("自");
    expect(lookupTransitivity("始める", "はじめる", "动词")).toBe("他");
    expect(lookupTransitivity("閉まる", "しまる", "动词")).toBe("自");
    expect(lookupTransitivity("閉める", "しめる", "动词")).toBe("他");
  });

  it("没有配对词的单身动词也标(靠 JMdict 的 vi/vt,不靠配对表)", () => {
    expect(lookupTransitivity("走る", "はしる", "动词")).toBe("自");
    expect(lookupTransitivity("覚える", "おぼえる", "动词")).toBe("他");
    expect(lookupTransitivity("貸す", "かす", "动词")).toBe("他");
    expect(lookupTransitivity("借りる", "かりる", "动词")).toBe("他");
  });

  it("同形异读按读音区分:開く 读 あく 是自动词,读 ひらく 自他兼", () => {
    expect(lookupTransitivity("開く", "あく", "动词")).toBe("自");
    expect(lookupTransitivity("開く", "ひらく", "动词")).toBe("自他");
    expect(lookupTransitivity("開ける", "あける", "动词")).toBe("他");
  });

  it("只写假名的动词也查得到(词库写 なる,JMdict 挂在 成る 上)", () => {
    expect(lookupTransitivity("なる", "なる", "动词")).toBe("自");
    expect(lookupTransitivity("ある", "ある", "动词")).toBe("自");
    expect(lookupTransitivity("できる", "できる", "动词")).toBe("自");
  });

  it("非动词不标", () => {
    expect(lookupTransitivity("本", "ほん", "名词")).toBeNull();
    expect(lookupTransitivity("静か", "しずか", "な形容词")).toBeNull();
  });

  it("查不到就返回 null,不瞎猜", () => {
    expect(lookupTransitivity("架空動詞", "かくうどうし", "动词")).toBeNull();
  });
});

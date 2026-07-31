import { beforeAll, describe, expect, it } from "vitest";
import { loadKanjiReadings, splitFurigana } from "./furigana";

const compact = (surface: string, kana: string) =>
  splitFurigana(surface, kana)?.map((segment) => `${segment.text}=${segment.reading}`).join("/") ?? null;

beforeAll(async () => {
  await loadKanjiReadings();
});

describe("splitFurigana", () => {
  it("按汉字切开音读——初 是 はつ 不是 は", () => {
    expect(compact("初詣", "はつもうで")).toBe("初=はつ/詣=もうで");
  });

  it("送り仮名单独成段", () => {
    expect(compact("食べ物", "たべもの")).toBe("食=た/べ=べ/物=もの");
  });

  it("认促音便和半浊音(出=しゅっ 発=ぱつ)", () => {
    expect(compact("出発", "しゅっぱつ")).toBe("出=しゅっ/発=ぱつ");
  });

  it("认连浊(月=づき)", () => {
    expect(compact("三日月", "みかづき")).toBe("三=み/日=か/月=づき");
  });

  it("三字词逐字切", () => {
    expect(compact("図書館", "としょかん")).toBe("図=と/書=しょ/館=かん");
  });

  it("片假名段按原样保留,不转平假名", () => {
    expect(compact("消しゴム", "けしゴム")).toBe("消=け/し=し/ゴム=ゴム");
  });

  it("熟字训切不开就整词返回 null,交给调用方原样显示", () => {
    expect(compact("明日", "あした")).toBeNull();
    expect(compact("大人", "おとな")).toBeNull();
  });

  it("纯假名词和无汉字表记返回 null", () => {
    expect(compact("ビール", "びーる")).toBeNull();
    expect(compact("たべる", "たべる")).toBeNull();
  });

  it("表记里混英文(词库里的外来语源词行)不硬凑", () => {
    expect(compact("(オ) gom", "ゴム")).toBeNull();
  });

  it("读音没用完不算对上", () => {
    expect(compact("毎日", "まい")).toBeNull();
  });
});

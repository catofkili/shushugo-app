import { expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";

type Stores = Record<string, unknown>;
const shimRoot = new URL("../../../wechat-miniprogram/scripts/shared/shims/", import.meta.url);
const evaluate = (file: URL, require: (name: string) => unknown) => {
  const module = { exports: {} };
  runInNewContext(`(function(require,module,exports){${readFileSync(file, "utf8")}\n})`)(require, module, module.exports);
  return module.exports;
};

it("移出首屏的八份内容在未 ready 时抛错；模块初始化保留的引用在加载后仍然有效", () => {
  const stores: Stores = {};
  const requireStore = () => stores;
  const lazy = evaluate(new URL("lazy-json.js", shimRoot), requireStore) as (name: string) => Record<string, Record<string, unknown>>;
  for (const [name, field] of [["kanjiVariants", "japanese_to_simplified"], ["kanjiReadings", "readings"], ["grammarKeyPoints", "points"]]) {
    expect(() => Object.keys(lazy(name)), name).toThrow(/未 ready/);
    const captured = lazy(name)[field];
    expect(() => captured.key, name).toThrow(/未 ready/);
    expect(() => "key" in captured, name).toThrow(/未 ready/);
    expect(() => Object.keys(captured), name).toThrow(/未 ready/);
    stores[name] = { [field]: { key: "loaded" } };
    expect(captured.key).toBe("loaded");
  }
  for (const [file, name] of [["kanji-unit-runtime.js", "kanjiUnitRuntime"], ["kanji-reading-usage.js", "kanjiReadingUsage"], ["pitch-accent-data.js", "pitchAccent"]]) {
    const payload = evaluate(new URL(file, shimRoot), requireStore) as Record<string, unknown>;
    expect(() => payload.default, name).toThrow(/加载/);
    stores[name] = { version: "ready" };
    expect(payload.default).toBe(stores[name]);
  }
  const distinction = evaluate(new URL("distinction-reviews.js", shimRoot), requireStore) as { distinctionReviewFor: (key: string) => unknown };
  expect(() => distinction.distinctionReviewFor("test")).toThrow(/未 ready/);
  const meanings = evaluate(new URL("question-meaning-overrides.js", shimRoot), requireStore) as { reviewedQuestionMeaning: (kanji: string, kana: string) => string };
  expect(() => meanings.reviewedQuestionMeaning("日本", "にほん")).toThrow(/未 ready/);
  stores.questionMeanings = [{ kanji: "日本", kana: "にほん", questionMeaning: "日本" }];
  expect(meanings.reviewedQuestionMeaning("日本", "にほん")).toBe("日本");
});

it("首页按模式只装必要内容，学习/汉字/辨析/语法直达各自完整等待，不依赖首页来过", async () => {
  const file = new URL("../../../taro-spike-2/scripts/taro-content.cjs", import.meta.url);
  const nativeRequire = createRequire(file);
  const open = () => {
    const stores: Stores = {};
    const prime = vi.fn(async () => undefined);
    const module = { exports: {}, require: (name: string) => name.includes('/grammar.js') ? { grammarPoints: [{ id: name }] } : nativeRequire(name) };
    const require = (name: string) => name.includes('content-store') ? stores : {
      loadPitchAccent: prime, loadKanjiReadings: prime, loadKanjiUnitIndex: prime, loadKanjiReadingUsage: prime
    };
    runInNewContext(`(function(require,module,exports){${readFileSync(file, "utf8")}\n})`)(require, module, module.exports);
    return { stores, prime, content: module.exports as { readyForHomeMode: (mode: string) => Promise<void>; readyForRoute: (page: string, mode?: string) => Promise<void> } };
  };
  for (const mode of ["classic", "quick", "mistakes", "reverse", "picked"]) {
    const { stores, prime, content } = open();
    await content.readyForHomeMode(mode);
    expect(Object.keys(stores).filter(name => stores[name])).toEqual([]);
    expect(prime).not.toHaveBeenCalled();
  }
  const mixed = open();
  await mixed.content.readyForHomeMode("mixed");
  expect(Object.keys(mixed.stores).filter(name => mixed.stores[name]).sort()).toEqual(["distinctionReviews", "kanjiReadingUsage", "kanjiUnitRuntime"]);
  const kanji = open();
  await kanji.content.readyForHomeMode("kanji");
  expect(Object.keys(kanji.stores).filter(name => kanji.stores[name])).toEqual(["kanjiUnitRuntime"]);
  for (const [page, mode, expected] of [
    ["word", "classic", ["questionMeanings", "distinctionReviews", "kanjiVariants", "kanjiReadings", "grammarKeyPoints", "pitchAccent"]],
    ["word", "mixed", ["questionMeanings", "distinctionReviews", "kanjiVariants", "kanjiReadings", "grammarKeyPoints", "pitchAccent", "kanjiUnitRuntime", "kanjiReadingUsage"]],
    ["word", "kanji", ["questionMeanings", "distinctionReviews", "kanjiVariants", "kanjiReadings", "grammarKeyPoints", "pitchAccent", "kanjiUnitRuntime"]],
    ["quick-study", "classic", ["questionMeanings", "distinctionReviews", "kanjiVariants", "kanjiReadings", "grammarKeyPoints", "pitchAccent"]],
    ["vocab-test", "classic", ["questionMeanings", "kanjiVariants", "kanjiReadings"]],
    ["kanji-readings", "classic", ["kanjiUnitRuntime", "kanjiReadingUsage", "kanjiReadings"]],
    ["confusion", "classic", ["questionMeanings", "distinctionReviews", "kanjiVariants", "kanjiReadings"]],
    ["distinction-quiz", "classic", ["questionMeanings", "distinctionReviews", "kanjiVariants", "kanjiReadings"]],
    ["grammar", "classic", ["grammar", "grammarKeyPoints", "kanjiReadings"]],
    ["detail", "classic", ["grammar", "grammarKeyPoints", "kanjiReadings"]],
    ["grammar-foundation", "classic", ["grammar", "grammarKeyPoints", "kanjiReadings"]],
    ["favorites", "classic", ["grammar", "grammarKeyPoints", "kanjiReadings"]],
    ["jlpt-plan", "classic", ["distinctionReviews", "kanjiReadingUsage", "kanjiUnitRuntime"]],
    ["settings", "classic", ["distinctionReviews", "kanjiReadingUsage", "kanjiUnitRuntime"]]
  ] as const) {
    const { stores, content } = open();
    await content.readyForRoute(page, mode);
    expect(Object.keys(stores).filter(name => stores[name]).sort(), page + mode).toEqual([...expected].sort());
  }
});

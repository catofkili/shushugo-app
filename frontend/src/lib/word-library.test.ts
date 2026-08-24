/**
 * 词库页取数层的体检。
 *
 * 这一页要一次面对 11,000 条词，所以分页、筛选、排序全在 SQL 里做 ——
 * 参数位置一错就是「翻到第二页看到同一批词」这种不报错的坏，必须有测试盯着。
 *
 * 默认跑种子库。查真实库（记忆档才有分布，种子库里全是「未学」）：
 *   WL_DB=../../.local/live.db npx vitest run src/lib/word-library.test.ts
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import initSqlJs, { type Database } from "sql.js";

let testDb: Database;

const prefStore = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (key: string) => prefStore.get(key) ?? null,
  setItem: (key: string, value: string) => { prefStore.set(key, String(value)); },
  removeItem: (key: string) => { prefStore.delete(key); },
  clear: () => prefStore.clear()
};
(globalThis as any).window = {
  dispatchEvent: () => true, addEventListener: () => undefined, removeEventListener: () => undefined
};

vi.mock("./database", () => ({
  getDatabase: () => testDb, initDatabase: async () => testDb,
  exportDatabase: () => null, importDatabase: async () => undefined
}));
vi.mock("./storage", () => ({ scheduleSave: () => undefined, persistSoon: () => undefined }));
vi.mock("./progress-events", () => ({ PROGRESS_UPDATED_EVENT: "test", notifyProgressUpdated: () => undefined }));

import {
  DEFAULT_LIBRARY_FILTERS,
  MEMORY_BANDS,
  classifyPos,
  queryWordLibrary,
  tallyWordLibrary,
  wordLibraryDetail,
  wordLibraryIds,
  type WordLibraryFilters
} from "./word-library";
import { ensureProgressInitialized } from "./word-api";

const DB_PATH = process.env.WL_DB ?? "../../public/nihongo.db";

const filters = (patch: Partial<WordLibraryFilters> = {}): WordLibraryFilters => ({
  ...DEFAULT_LIBRARY_FILTERS,
  ...patch
});

beforeAll(async () => {
  const SQL = await initSqlJs();
  testDb = new SQL.Database(new Uint8Array(readFileSync(fileURLToPath(new URL(DB_PATH, import.meta.url)))));
  ensureProgressInitialized();
});

describe("词库取数", () => {
  it("分页不重不漏：两页拼起来 = 一次取双倍", () => {
    const both = queryWordLibrary(filters(), 0, 40).map((row) => row.id);
    const first = queryWordLibrary(filters(), 0, 20).map((row) => row.id);
    const second = queryWordLibrary(filters(), 20, 20).map((row) => row.id);
    expect([...first, ...second]).toEqual(both);
    expect(new Set(both).size).toBe(both.length);
  });

  it("各档条数加起来等于总数", () => {
    const tally = tallyWordLibrary(filters());
    const sum = MEMORY_BANDS.reduce((acc, band) => acc + tally.bands[band.id], 0);
    expect(sum).toBe(tally.total);
    expect(tally.total).toBeGreaterThan(1000);
  });

  it("等级筛选真的只给这一级", () => {
    const rows = queryWordLibrary(filters({ level: "N5" }), 0, 50);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.level === "N5")).toBe(true);
    expect(tallyWordLibrary(filters({ level: "N5" })).total).toBeLessThan(tallyWordLibrary(filters()).total);
  });

  it("记忆档筛选和分布带里的数字对得上", () => {
    const tally = tallyWordLibrary(filters());
    MEMORY_BANDS.forEach((band) => {
      if (!tally.bands[band.id]) return;
      const rows = queryWordLibrary(filters({ band: band.id }), 0, 30);
      expect(rows.every((row) => row.band === band.id)).toBe(true);
      expect(wordLibraryIds(filters({ band: band.id }), 100000).length).toBe(tally.bands[band.id]);
    });
  });

  it("未学的词不算「该复习」——全局口径把 fsrs_due IS NULL 当到期，词库里那会染红八千条没碰过的词", () => {
    const rows = queryWordLibrary(filters({ band: "unseen" }), 0, 50);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((row) => row.isDue)).toBe(false);
  });

  it("搜索命中汉字、假名或释义", () => {
    const rows = queryWordLibrary(filters({ search: "食" }), 0, 20);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => `${row.kanji}${row.kana}${row.meaning}`.includes("食"))).toBe(true);
  });

  it("词性桶把 48 种写法收敛成七类", () => {
    expect(classifyPos("名词・する动词")).toBe("suru");
    expect(classifyPos("名·他动·サ变")).toBe("suru");
    expect(classifyPos("な形容词")).toBe("adj");
    expect(classifyPos("他动·五段")).toBe("verb");
    expect(classifyPos("名词")).toBe("noun");
    expect(classifyPos("名·副词")).toBe("noun");
    expect(classifyPos("副词")).toBe("adv");
    expect(classifyPos("接尾")).toBe("affix");
    expect(classifyPos("成句")).toBe("other");

    const rows = queryWordLibrary(filters({ pos: "verb" }), 0, 40);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.posBucket === "verb")).toBe(true);
  });

  it("「最弱在前」把学过的按记忆强度升序排，没学过的沉底", () => {
    const rows = queryWordLibrary(filters({ sort: "weakest" }), 0, 200);
    const seen = rows.map((row) => row.band !== "unseen");
    // 一旦出现未学，后面不能再有学过的
    const firstUnseen = seen.indexOf(false);
    if (firstUnseen >= 0) expect(seen.slice(firstUnseen).some(Boolean)).toBe(false);
    const studied = rows.filter((row) => row.stability !== null).map((row) => row.stability as number);
    expect([...studied].sort((left, right) => left - right)).toEqual(studied);
  });

  it("详情拿得到例句和记忆状态", () => {
    const first = queryWordLibrary(filters(), 0, 1)[0];
    const detail = wordLibraryDetail(first.id);
    expect(detail?.id).toBe(first.id);
    expect(detail?.band).toBe(first.band);
    expect(typeof detail?.example.jp).toBe("string");
  });

  it("全选有上限，不会一把勾中整个词库", () => {
    expect(wordLibraryIds(filters(), 300).length).toBe(300);
  });
});

describe("词形显示", () => {
  it("外来語行的 kanji 存的是词源，取数层原样返回两列 —— 谁大谁小是页面的事", () => {
    const rows = queryWordLibrary(filters({ search: "カメラ" }), 0, 5);
    const camera = rows.find((row) => row.kana === "カメラ");
    expect(camera).toBeDefined();
    // 库里就是这样存的：kanji = camera，kana = カメラ。页面必须把假名摆大字，
    // 否则学日语的人满屏看到的是英文（用户库里 835 个词是这样）。
    expect(/[A-Za-z]/.test(camera!.kanji)).toBe(true);
    expect(camera!.kana).toBe("カメラ");
  });
});

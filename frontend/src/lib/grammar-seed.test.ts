import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import initSqlJs, { type Database } from "sql.js";

let testDb: Database;
const prefStore = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => prefStore.get(k) ?? null,
  setItem: (k: string, v: string) => { prefStore.set(k, String(v)); },
  removeItem: (k: string) => { prefStore.delete(k); },
  clear: () => prefStore.clear()
};
(globalThis as any).window = { dispatchEvent: () => true };

vi.mock("./database", () => ({
  getDatabase: () => testDb,
  initDatabase: async () => testDb,
  exportDatabase: () => null,
  importDatabase: async () => undefined
}));

// 本测试验证种子迁移与保存请求，不启动真实存储模块及其异步落盘计时器。
// 等待动态 import 回调完成，防止它跨越测试结束或模块清理。
vi.mock("./storage", () => ({ requestFullSnapshot: vi.fn(), scheduleSave: vi.fn() }));
import { requestFullSnapshot, scheduleSave } from "./storage";

import { ensureSeedData, ensureUserTables, GRAMMAR_SEED_VERSION } from "./study-core";
import grammarSeed from "../data/grammar_seed.json";

const SQL = await initSqlJs();
const seedPath = fileURLToPath(new URL("../../public/nihongo.db", import.meta.url));
const one = (sql: string) => testDb.exec(sql)[0]?.values?.[0]?.[0];

describe("语法种子升版本", () => {
  afterEach(async () => {
    await vi.dynamicImportSettled();
    testDb.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    testDb = new SQL.Database(new Uint8Array(readFileSync(seedPath)));
  });

  /**
   * 这条测试的存在理由：ensureGrammarSeed 只在版本变化时才跑，正常跑测试/开发
   * 时永远走不到。它曾经把 13 个占位符配 14 个列名，真升一次版本会让每个已安装
   * 用户启动时崩在 initDatabase —— 而没有任何测试会发现。
   */
  it("从旧版本升级不会炸，语法点全部重建", async () => {
    testDb.run("INSERT OR REPLACE INTO grammar_state (key, value) VALUES ('dataset_version', 'stale-version')");
    await expect(ensureSeedData()).resolves.not.toThrow();
    await vi.dynamicImportSettled();
    expect(requestFullSnapshot).toHaveBeenCalled();
    expect(scheduleSave).toHaveBeenCalled();
    expect(vi.mocked(requestFullSnapshot).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(scheduleSave).mock.invocationCallOrder[0]);

    expect(String(one("SELECT value FROM grammar_state WHERE key='dataset_version'"))).toBe(GRAMMAR_SEED_VERSION);
    // 重建后条数 = 种子 JSON 的行数，而且每一列都真的写进去了
    //（少一个占位符时会直接抛 "13 values for 14 columns"，整个初始化失败）
    expect(Number(one("SELECT COUNT(*) FROM grammar_points"))).toBe(grammarSeed.rows.length);
    expect(Number(one("SELECT COUNT(*) FROM grammar_points WHERE sort_order IS NULL OR sort_order = 0"))).toBe(0);
    expect(Number(one("SELECT COUNT(*) FROM grammar_points WHERE COALESCE(level,'') = ''"))).toBe(0);
  });

  it("用户的语法进度按 pattern 迁移到新 id，不会被重建清掉", async () => {
    const row = testDb.exec("SELECT id, pattern FROM grammar_points ORDER BY sort_order LIMIT 1")[0].values[0];
    const [oldId, pattern] = [Number(row[0]), String(row[1])];
    testDb.run("INSERT OR REPLACE INTO grammar_progress (grammar_id, score, seen_count) VALUES (?, 7, 5)", [oldId]);
    testDb.run("INSERT OR REPLACE INTO grammar_state (key, value) VALUES ('dataset_version', 'stale-version')");

    await ensureSeedData();

    const newId = Number(testDb.exec("SELECT id FROM grammar_points WHERE pattern = ?", [pattern])[0].values[0][0]);
    const kept = testDb.exec("SELECT seen_count FROM grammar_progress WHERE grammar_id = ?", [newId])[0];
    expect(kept?.values?.[0]?.[0]).toBe(5);
  });

  it("重建出来的 id 和出厂库一样是 1..N —— AUTOINCREMENT 不重置的话是 742..", async () => {
    // 实测一台设备重建九次后 id 落在 6600+，而新装用户是 1..741：grammar_progress
    // 按数字 grammar_id 跨设备同步，两边不一样就串号。
    testDb.run("INSERT OR REPLACE INTO grammar_state (key, value) VALUES ('dataset_version', 'stale-version')");
    await ensureSeedData();
    expect(Number(one("SELECT COUNT(*) FROM grammar_points WHERE id != sort_order"))).toBe(0);
    expect(Number(one("SELECT MAX(id) FROM grammar_points"))).toBe(grammarSeed.rows.length);
  });

  it("改过标题的条目按旧名 → 新名迁移进度，拆出来的第二条从零开始", async () => {
    // 老库里是「～てしかた（が）ない／てしようがない」一条；新版拆成两条。
    // 旧进度归第一个写法，第二个写法不该继承 —— 拆的理由正是「看到 A 就点了认识，B 其实不会」。
    const oldId = Number(one("SELECT id FROM grammar_points WHERE pattern = '～てしかた（が）ない'"));
    testDb.run("UPDATE grammar_points SET pattern = '～てしかた（が）ない／てしようがない' WHERE id = ?", [oldId]);
    testDb.run("INSERT OR REPLACE INTO grammar_progress (grammar_id, score, seen_count) VALUES (?, 0, 9)", [oldId]);
    testDb.run("INSERT OR REPLACE INTO grammar_state (key, value) VALUES ('dataset_version', 'stale-version')");

    await ensureSeedData();

    const keptId = Number(one("SELECT id FROM grammar_points WHERE pattern = '～てしかた（が）ない'"));
    const newId = Number(one("SELECT id FROM grammar_points WHERE pattern = '～てしようがない'"));
    expect(Number(one(`SELECT seen_count FROM grammar_progress WHERE grammar_id = ${keptId}`))).toBe(9);
    expect(one(`SELECT seen_count FROM grammar_progress WHERE grammar_id = ${newId}`)).toBeUndefined();
  });

  it("类目清理删除旧卡的三份进度，12 道新题从零开始，其余进度按 pattern 保留", async () => {
    ensureUserTables();
    const rewrites: [string, string][] = [
      ["序数詞（序数词）", "～目／～番目"],
      ["常用助数詞（量词）", "一本・三本・六本・八本・十本"],
      ["常用数量の読み方（常用数量读法）", "一日・二日・三日・四日・五日・六日・七日・八日・九日・十日・二十日"],
      ["自動詞と他動詞（自他动词）", "～が開く／～を開ける"],
      ["動詞「ます形」（敬体形）", "書きます・食べます・します・来ます"],
      ["動詞「て形」", "書いて・泳いで・飲んで・待って・話して・行って"],
      ["動詞「た形」", "聞いた・脱いだ・読んだ・買った・貸した・行った"],
      ["動詞「ない形」", "書かない・買わない・食べない・しない・来ない"],
      ["な形容詞の普通形", "静かだ・静かだった・静かではない・静かではなかった"],
      ["な形容詞の敬体形", "静かです・静かでした・静かではありません・静かではありませんでした"],
      ["い形容詞の普通形", "高い・高かった・高くない・高くなかった"],
      ["い形容詞の敬体形", "高いです・高かったです・高くないです・高くなかったです"],
    ];
    const removed = [
      "三類動詞の区分（动词分类）",
      "動詞の敬体形と普通形",
      "基数詞（基数词）",
      "敬語の特殊形（特殊敬语动词）",
      "な形容詞「で形」",
      "い形容詞「て形」",
      "～をよそに（N1-2）",
      "～をものともせずに（N1-2）",
      "～を余儀なくさせる（N1-2）",
      "～を余儀なくされる（N1-2）",
      "～んがため（に）／んがための（N1-2）",
      "～んじゃなかった（N1-2）",
      "～んだって／んですって（N1-2）",
      "～んばかりに／んばかりの／んばかりだ（N1-2）",
      "～（さ）せてやっていただけませんか（N2-2）",
      "～ていただけるとありがたいんですが（N2-2）",
    ];
    // 模拟升级前的编号，避免只测到 id 未变的路径；所有修改只发生在内存测试库。
    testDb.run("UPDATE grammar_points SET id = id + 10000");
    const oldRows = testDb.exec("SELECT id, pattern FROM grammar_points ORDER BY sort_order")[0].values;
    const retainedPattern = String(oldRows[0][1]);
    const rewrittenPatterns = new Set(rewrites.map(([, pattern]) => pattern));
    const spareIds = oldRows.filter(([, pattern]) => pattern !== retainedPattern && !rewrittenPatterns.has(String(pattern))).map(([id]) => Number(id));
    const retiredIds: number[] = [];
    for (const [oldPattern, newPattern] of rewrites) {
      const id = Number(oldRows.find(([, pattern]) => pattern === newPattern)![0]);
      testDb.run("UPDATE grammar_points SET pattern = ? WHERE id = ?", [oldPattern, id]);
      retiredIds.push(id);
    }
    removed.forEach((pattern, index) => {
      testDb.run("UPDATE grammar_points SET pattern = ? WHERE id = ?", [pattern, spareIds[index]]);
      retiredIds.push(spareIds[index]);
    });
    const retainedId = Number(oldRows[0][0]);
    for (const id of [...retiredIds, retainedId]) {
      testDb.run("INSERT INTO grammar_progress (grammar_id, seen_count) VALUES (?, 9)", [id]);
      testDb.run("INSERT INTO grammar_reviews (grammar_id, answer, score_after, reviewed_on) VALUES (?, 'know', 0, '2026-11-01')", [id]);
      testDb.run("INSERT INTO grammar_mistakes (grammar_id, answer, first_seen_on, last_seen_on) VALUES (?, 'forgot', '2026-11-01', '2026-11-01')", [id]);
    }
    testDb.run("INSERT OR REPLACE INTO grammar_state (key, value) VALUES ('dataset_version', 'before-category-cleanup')");

    await ensureSeedData();

    const newId = Number(testDb.exec("SELECT id FROM grammar_points WHERE pattern = ?", [retainedPattern])[0].values[0][0]);
    expect(newId).not.toBe(retainedId);
    for (const table of ["grammar_progress", "grammar_reviews", "grammar_mistakes"]) {
      expect(testDb.exec(`SELECT grammar_id FROM ${table}`)[0].values).toEqual([[newId]]);
    }
    expect(Number(one(`SELECT seen_count FROM grammar_progress WHERE grammar_id = ${newId}`))).toBe(9);
    for (const [oldPattern, newPattern] of rewrites) {
      expect(testDb.exec("SELECT id FROM grammar_points WHERE pattern = ?", [oldPattern])).toEqual([]);
      expect(testDb.exec("SELECT id FROM grammar_points WHERE pattern = ?", [newPattern])[0].values).toHaveLength(1);
    }
    for (const pattern of removed) expect(testDb.exec("SELECT id FROM grammar_points WHERE pattern = ?", [pattern])).toEqual([]);
  });

  it("条数对不上时自愈重建 —— 版本号三者相等也要修", async () => {
    // 语法条数曾经被写坏过(seed 和出厂库两套重名消歧写法,老用户重建成 731)。
    // 自愈判据是「版本戳相等**且**条数等于常量」才早退,但下一层还有一条
    // 「JSON 版本 == 库版本就 return」—— 不带「常量落后」这个前提的话,
    // 它会把刚判出来的修复原地挡回去,还打一句误导的「常量落后」。
    testDb.run("DELETE FROM grammar_points WHERE id = (SELECT MAX(id) FROM grammar_points)");
    const broken = Number(one("SELECT COUNT(*) FROM grammar_points"));
    expect(broken).toBe(grammarSeed.rows.length - 1);
    // 版本戳保持「已是最新」——被写坏的库正是这个样子
    testDb.run("INSERT OR REPLACE INTO grammar_state (key, value) VALUES ('dataset_version', ?)", [GRAMMAR_SEED_VERSION]);

    await ensureSeedData();

    expect(Number(one("SELECT COUNT(*) FROM grammar_points"))).toBe(grammarSeed.rows.length);
  });
});

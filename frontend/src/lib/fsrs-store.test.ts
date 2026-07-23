/**
 * FSRS 存储 + 回填集成测试:真实种子库 + 合成复习历史。
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import initSqlJs, { type Database } from "sql.js";

let testDb: Database;
vi.mock("./database", () => ({
  getDatabase: () => testDb,
  initDatabase: async () => testDb,
  exportDatabase: () => null,
  importDatabase: async () => undefined
}));

import {
  ensureFsrsColumns,
  backfillFsrsFromHistory,
  readFsrsState,
  recordFsrsReview,
  fsrsDueCount,
  currentSystemBacklogCount,
  isFsrsActive,
  setFsrsActive,
  fsrsDueWordIds
} from "./fsrs-store";

let seq = 0;
const seedReview = (wordId: number, answer: string, day: string) =>
  testDb.run(
    "INSERT INTO reviews (word_id, answer, score_after, reviewed_on, created_at) VALUES (?, ?, 0, ?, ?)",
    [wordId, answer, day, `${day} 12:00:${String(seq++).padStart(2, "0")}`]
  );

describe("fsrs-store", () => {
  beforeAll(async () => {
    const SQL = await initSqlJs();
    const dbPath = fileURLToPath(new URL("../../public/nihongo.db", import.meta.url));
    testDb = new SQL.Database(new Uint8Array(readFileSync(dbPath)));
    testDb.run("INSERT OR IGNORE INTO progress (word_id) SELECT id FROM words");
    testDb.run("DELETE FROM reviews");                 // 种子库自带复习记录,清空隔离
    testDb.run("UPDATE progress SET seen_count = 0, score = 0, known_forever = 0");
    const cols = testDb.exec("PRAGMA table_info(reviews)")[0]?.values.map((v) => v[1]) ?? [];
    if (!cols.includes("created_at")) testDb.run("ALTER TABLE reviews ADD COLUMN created_at TEXT");

    // 词 1:连续答对 5 天(应养出高稳定度、未到期)
    ["2026-07-01", "2026-07-03", "2026-07-08", "2026-07-16", "2026-07-22"].forEach((d) => seedReview(1, "know", d));
    // 词 2:反复忘记(应稳定度低、到期)
    ["2026-07-01", "2026-07-02", "2026-07-04", "2026-07-06"].forEach((d) => seedReview(2, "forgot", d));
    // 词 3:同日多次复习(只应取当日首条)
    seedReview(3, "know", "2026-07-01");
    seedReview(3, "fuzzy", "2026-07-01");
    seedReview(3, "know", "2026-07-05");
    testDb.run("UPDATE progress SET seen_count = 3, score = 5 WHERE word_id IN (1,2,3)");
    // 让词 2 在现行系统里算积压
    testDb.run("UPDATE progress SET score = 0 WHERE word_id = 2");
  });

  afterAll(() => vi.useRealTimers());

  it("加列幂等,不报错", () => {
    ensureFsrsColumns();
    ensureFsrsColumns();
    const cols = testDb.exec("PRAGMA table_info(progress)")[0].values.map((v) => String(v[1]));
    expect(cols).toContain("fsrs_stability");
    expect(cols).toContain("fsrs_due");
  });

  it("回填把历史重放进 FSRS 列", () => {
    const res = backfillFsrsFromHistory();
    expect(res.migrated).toBe(true);
    expect(res.words).toBe(3);

    const w1 = readFsrsState(1)!;
    const w2 = readFsrsState(2)!;
    expect(w1).not.toBeNull();
    // 连对的词稳定度明显高于反复忘的词
    expect(w1.stability).toBeGreaterThan(w2.stability);
  });

  it("回填幂等:第二次不再跑", () => {
    expect(backfillFsrsFromHistory().migrated).toBe(false);
  });

  it("同日多次复习只算当日首条(词3 两个学习日)", () => {
    // 词3 有 2 个学习日,回填后 lastReview 应落在 07-05
    const w3 = readFsrsState(3)!;
    expect(w3.lastReview.slice(0, 10)).toBe("2026-07-05");
  });

  it("FSRS 到期数与现行积压数都能算,且量级合理", () => {
    const now = new Date("2026-07-23T04:00:00Z");
    const fsrsDue = fsrsDueCount(now);
    const legacyBacklog = currentSystemBacklogCount();
    expect(fsrsDue).toBeGreaterThanOrEqual(1);   // 词2 反复忘,必到期
    expect(legacyBacklog).toBeGreaterThanOrEqual(1);
  });

  it("影子写:单次作答即时更新 FSRS 列", () => {
    const before = readFsrsState(1)!;
    recordFsrsReview(1, "forgot", new Date("2026-07-24T04:00:00Z"));
    const after = readFsrsState(1)!;
    expect(after.stability).toBeLessThan(before.stability); // 忘了 → 稳定度下降
    expect(after.stability).toBeGreaterThan(0);             // 但没清零
  });

  describe("P1 切换开关 + FSRS 选词", () => {
    const now = new Date("2026-07-23T04:00:00Z");
    beforeAll(() => {
      // 造三个受控词:200 已过期、201 未到期(将来)、202 已见但从未调度(due 空)
      testDb.run("UPDATE progress SET seen_count = 1, known_forever = 0 WHERE word_id IN (200,201,202)");
      testDb.run("UPDATE progress SET fsrs_stability=10, fsrs_difficulty=5, fsrs_last_review='2026-07-01T04:00:00Z', fsrs_due='2026-07-10T04:00:00Z' WHERE word_id=200");
      testDb.run("UPDATE progress SET fsrs_stability=30, fsrs_difficulty=5, fsrs_last_review='2026-07-20T04:00:00Z', fsrs_due='2026-08-20T04:00:00Z' WHERE word_id=201");
      testDb.run("UPDATE progress SET fsrs_stability=NULL, fsrs_due=NULL WHERE word_id=202");
    });

    it("开关默认开(老算法已关闭但保留),可持久化切换", () => {
      expect(isFsrsActive()).toBe(true); // 未设置时默认开
      setFsrsActive(false);
      expect(isFsrsActive()).toBe(false);
      setFsrsActive(true);
      expect(isFsrsActive()).toBe(true);
    });

    it("fsrsDueWordIds:只取到期词,未调度的排最前,已到期按 due 升序", () => {
      const ids = fsrsDueWordIds(50, now);
      expect(ids).toContain(200);   // 已过期
      expect(ids).toContain(202);   // 从未调度视同到期
      expect(ids).not.toContain(201); // 未到期不出现
      // 从未调度(202)优先级高于已到期(200)
      expect(ids.indexOf(202)).toBeLessThan(ids.indexOf(200));
    });

    it("开关打开后,积压计数改用 FSRS 到期数", async () => {
      const { reviewBacklogCount } = await import("./comeback");
      setFsrsActive(false);
      const legacy = reviewBacklogCount();
      setFsrsActive(true);
      const viaFsrs = reviewBacklogCount();
      setFsrsActive(false);
      expect(viaFsrs).toBe(fsrsDueCount(new Date()));
      expect(legacy).not.toBe(undefined);
    });
  });
});

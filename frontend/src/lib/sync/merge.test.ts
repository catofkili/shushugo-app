import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import initSqlJs, { type Database } from "sql.js";

let testDb: Database;
let SQL: Awaited<ReturnType<typeof initSqlJs>>;

vi.mock("../database", () => ({
  getDatabase: () => testDb,
  exportDatabase: () => testDb.export(),
  openDatabase: async (data: Uint8Array) => new SQL.Database(data),
  createDatabase: async () => new SQL.Database(),
  initDatabase: async () => testDb
}));

import { mergeDatabaseBytes } from "./merge";
import { ensureSyncSchema } from "./schema";
import { recordStudySeconds } from "./study-time";
import { ensureUserTables } from "../study-core";
import { compressSyncSnapshot, decompressSyncSnapshot, exportSyncSnapshot, isUserSyncSnapshot, SYNC_PROTOCOL_VERSION } from "./snapshot";
import { createKanjiUnitTasks, materializeKanjiUnitIndex, recordKanjiUnitReview } from "../kanji-unit-scheduler";
import { loadKanjiUnitIndex } from "../kanji-unit-index";

const seedPath = fileURLToPath(new URL("../../../public/nihongo.db", import.meta.url));

const rows = (db: Database, sql: string) => {
  const result = db.exec(sql)[0];
  if (!result) return [] as Record<string, unknown>[];
  return result.values.map((value) => Object.fromEntries(
    result.columns.map((column, index) => [column, value[index]])
  ));
};

beforeAll(async () => {
  await loadKanjiUnitIndex();
  SQL = await initSqlJs();
});

beforeEach(() => {
  testDb = new SQL.Database(new Uint8Array(readFileSync(seedPath)));
  ensureSyncSchema();
});

describe("database snapshot merge", () => {
  it("云同步快照只包含用户数据，不重复打包出厂词典", async () => {
    testDb.run("INSERT OR REPLACE INTO progress (word_id, score, seen_count) VALUES (1, 10, 1)");
    testDb.run("INSERT INTO reviews (word_id, answer, score_after, reviewed_on) VALUES (1, 'know', 10, '2026-08-03')");
    testDb.run("INSERT OR REPLACE INTO app_state (key, value) VALUES ('sync_cursor', 'device-only')");

    const fullBytes = testDb.export();
    const snapshotBytes = await exportSyncSnapshot();
    const snapshot = new SQL.Database(snapshotBytes);
    const tables = new Set(rows(snapshot, "SELECT name FROM sqlite_master WHERE type = 'table'").map((row) => row.name));

    expect(tables.has("sync_snapshot_meta")).toBe(true);
    expect(rows(snapshot, "SELECT format, protocol_version FROM sync_snapshot_meta")).toEqual([
      { format: "master-nihongo-user-sqlite-v1", protocol_version: SYNC_PROTOCOL_VERSION }
    ]);
    expect(isUserSyncSnapshot(snapshot)).toBe(true);
    expect(tables.has("progress")).toBe(true);
    expect(tables.has("reviews")).toBe(true);
    expect(tables.has("words")).toBe(false);
    expect(tables.has("grammar_points")).toBe(false);
    expect(rows(snapshot, "SELECT key FROM app_state WHERE key = 'sync_cursor'")).toHaveLength(0);
    expect(snapshotBytes.byteLength).toBeLessThan(fullBytes.byteLength / 4);
    snapshot.close();
  });

  it("当日任务表只上传最近 14 天,而且不会因此删掉对端的历史行", async () => {
    const day = (offset: number) => new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10);
    const today = day(0);
    const old = day(60);
    testDb.run("INSERT OR REPLACE INTO stage1_tasks (reviewed_on, word_id, task_type, order_index) VALUES (?, 1, 'new', 1)", [today]);
    testDb.run("INSERT OR REPLACE INTO stage1_tasks (reviewed_on, word_id, task_type, order_index) VALUES (?, 2, 'review', 1)", [old]);

    const fromDeviceA = await exportSyncSnapshot();
    const snapshot = new SQL.Database(fromDeviceA);
    const shipped = rows(snapshot, "SELECT reviewed_on FROM stage1_tasks").map((row) => row.reviewed_on);
    expect(shipped).toContain(today);
    expect(shipped).not.toContain(old);
    snapshot.close();

    // 关键:另一台设备上那条 60 天前的任务行不能因为快照里没有就被删掉。
    // 合并是按键取并集,删除只走墓碑 —— 这条测试就是钉住这一点。
    const deviceB = new SQL.Database(new Uint8Array(readFileSync(seedPath)));
    testDb = deviceB;
    ensureSyncSchema();
    deviceB.run("INSERT OR REPLACE INTO stage1_tasks (reviewed_on, word_id, task_type, order_index) VALUES (?, 2, 'review', 1)", [old]);
    await mergeDatabaseBytes(fromDeviceA);
    expect(rows(deviceB, "SELECT reviewed_on FROM stage1_tasks WHERE word_id = 2").map((r) => r.reviewed_on)).toEqual([old]);
    // A 那条今天的任务也确实合并进来了
    expect(rows(deviceB, "SELECT reviewed_on FROM stage1_tasks WHERE word_id = 1").map((r) => r.reviewed_on)).toEqual([today]);
  });

  it("用户手改的题面跨设备同步,清除时靠墓碑传播", async () => {
    // 出厂词库里还没有这张表 —— 生产上由 ensureSeedData 先建表再挂触发器
    // (main.tsx 的顺序),这里照抄那个顺序,顺带把「触发器有没有挂上」一起测了。
    const bootDevice = (db: Database) => {
      testDb = db;
      ensureUserTables();
      ensureSyncSchema();
    };

    const deviceA = testDb;
    bootDevice(deviceA);
    deviceA.run("INSERT OR REPLACE INTO word_question_meanings (word_id, prompt_meaning) VALUES (1, '相当（书面·程度高）')");
    const fromA = await exportSyncSnapshot();

    const deviceB = new SQL.Database(new Uint8Array(readFileSync(seedPath)));
    bootDevice(deviceB);
    await mergeDatabaseBytes(fromA);
    expect(rows(deviceB, "SELECT prompt_meaning FROM word_question_meanings WHERE word_id = 1"))
      .toEqual([{ prompt_meaning: "相当（书面·程度高）" }]);

    // B 上「恢复原文」= 删行。删除必须留墓碑,否则 A 那份更早的旧值合并回来会把它复活。
    deviceB.run("DELETE FROM word_question_meanings WHERE word_id = 1");
    expect(rows(deviceB, "SELECT row_key FROM sync_tombstones WHERE table_name = 'word_question_meanings'"))
      .toHaveLength(1);
    const fromB = await exportSyncSnapshot();

    bootDevice(deviceA);
    await mergeDatabaseBytes(fromB);
    expect(rows(deviceA, "SELECT prompt_meaning FROM word_question_meanings")).toHaveLength(0);
  });

  it("划重点和语法阅读位置随用户快照跨设备合并", async () => {
    testDb = new SQL.Database(new Uint8Array(readFileSync(seedPath)));
    ensureUserTables();
    ensureSyncSchema();
    testDb.run(`
      INSERT INTO grammar_highlights
        (grammar_id, block, start, end, text, dataset_version, sync_updated_at, sync_origin_device)
      VALUES ('pdf-n3-001', 'example-0', 0, 2, '風か', 'grammar-v1', '2030-01-01T00:00:01.000Z', 'source')
    `);
    testDb.run(`
      INSERT INTO grammar_reading_positions
        (kind, level, grammar_id, updated_at, sync_updated_at, sync_origin_device)
      VALUES ('immersive', 'N3', 'pdf-n3-041', CURRENT_TIMESTAMP, '2030-01-01T00:00:01.000Z', 'source')
    `);
    const snapshotBytes = await exportSyncSnapshot();

    testDb = new SQL.Database(new Uint8Array(readFileSync(seedPath)));
    ensureUserTables();
    ensureSyncSchema();
    await mergeDatabaseBytes(snapshotBytes);

    expect(rows(testDb, "SELECT grammar_id, block, start, end FROM grammar_highlights")).toEqual([
      { grammar_id: "pdf-n3-001", block: "example-0", start: 0, end: 2 }
    ]);
    expect(rows(testDb, "SELECT kind, level, grammar_id FROM grammar_reading_positions")).toEqual([
      { kind: "immersive", level: "N3", grammar_id: "pdf-n3-041" }
    ]);
  });

  it("新汉字读音记忆跨设备同步，旧汉字记忆仍作为归档保留", async () => {
    testDb = new SQL.Database(new Uint8Array(readFileSync(seedPath)));
    ensureUserTables();
    ensureSyncSchema();
    testDb.run(`
      INSERT INTO kanji_reading_memory
        (word_id, seen_count, right_count, sync_updated_at, sync_origin_device)
      VALUES (1, 2, 2, '2030-01-01T00:00:01.000Z', 'source')
    `);
    const snapshotBytes = await exportSyncSnapshot();

    testDb = new SQL.Database(new Uint8Array(readFileSync(seedPath)));
    ensureUserTables();
    ensureSyncSchema();
    await mergeDatabaseBytes(snapshotBytes);

    expect(rows(testDb, "SELECT word_id, seen_count, right_count FROM kanji_reading_memory")).toEqual([
      { word_id: 1, seen_count: 2, right_count: 2 }
    ]);
    expect(rows(testDb, "SELECT COUNT(*) AS count FROM kanji_memory WHERE seen_count > 0")).toEqual([
      { count: 0 }
    ]);
  });

  it("unit 事件跨设备取并集，并重放为新的记忆 checkpoint", async () => {
    testDb = new SQL.Database(new Uint8Array(readFileSync(seedPath)));
    ensureUserTables();
    ensureSyncSchema();
    materializeKanjiUnitIndex();
    const [unitKey] = createKanjiUnitTasks("2026-08-22", 1).units;
    recordKanjiUnitReview(unitKey, "know", new Date("2026-08-22T10:00:00.000Z"));
    const snapshotBytes = await exportSyncSnapshot();

    testDb = new SQL.Database(new Uint8Array(readFileSync(seedPath)));
    ensureUserTables();
    ensureSyncSchema();
    materializeKanjiUnitIndex();
    await mergeDatabaseBytes(snapshotBytes);

    expect(rows(testDb, "SELECT unit_key, seen_count FROM kanji_unit_memory WHERE unit_key = '" + unitKey.replace(/'/g, "''") + "'")).toEqual([
      { unit_key: unitKey, seen_count: 1 }
    ]);
    expect(rows(testDb, "SELECT unit_key, answer FROM kanji_unit_reviews")).toEqual([
      { unit_key: unitKey, answer: "know" }
    ]);
  });

  it("压缩后的用户快照可无损解压并合并到新设备", async () => {
    testDb.run("INSERT OR REPLACE INTO progress (word_id, score, seen_count) VALUES (7, 21, 2)");
    testDb.run(`
      INSERT INTO word_study_time_by_device (studied_on, device_id, seconds)
      VALUES ('2026-08-03', 'source-device', 300)
    `);
    const snapshotBytes = await exportSyncSnapshot();
    const compressed = await compressSyncSnapshot(snapshotBytes);
    const repeatedSnapshot = await exportSyncSnapshot();
    const repeatedCompressed = await compressSyncSnapshot(repeatedSnapshot);
    expect(repeatedSnapshot).toEqual(snapshotBytes);
    expect(repeatedCompressed.bytes).toEqual(compressed.bytes);
    const restored = await decompressSyncSnapshot(compressed.bytes, compressed.compression);

    testDb = new SQL.Database(new Uint8Array(readFileSync(seedPath)));
    ensureSyncSchema();
    testDb.run(`
      INSERT INTO word_study_time_by_device (studied_on, device_id, seconds)
      VALUES ('2026-08-03', 'target-device', 120)
    `);
    await mergeDatabaseBytes(restored);

    expect(rows(testDb, "SELECT word_id, score FROM progress WHERE word_id = 7")).toEqual([
      { word_id: 7, score: 21 }
    ]);
    expect(rows(testDb, `
      SELECT device_id, seconds FROM word_study_time_by_device
      WHERE studied_on = '2026-08-03' ORDER BY device_id
    `)).toEqual([
      { device_id: "source-device", seconds: 300 },
      { device_id: "target-device", seconds: 120 }
    ]);
  });

  it("保留两台设备对不同单词的修改", async () => {
    testDb.run("INSERT OR REPLACE INTO progress (word_id, score, seen_count) VALUES (1, 10, 1)");
    testDb.run("INSERT OR REPLACE INTO progress (word_id, score, seen_count) VALUES (2, 20, 1)");

    const remote = new SQL.Database(testDb.export());
    testDb.run("UPDATE progress SET score = 11, seen_count = 2, sync_updated_at = '2030-01-01T00:00:01.000Z' WHERE word_id = 1");
    remote.run("UPDATE progress SET score = 22, seen_count = 2, sync_updated_at = '2030-01-01T00:00:02.000Z', sync_origin_device = 'remote' WHERE word_id = 2");

    await mergeDatabaseBytes(new Uint8Array(remote.export()));
    const result = rows(testDb, "SELECT word_id, score FROM progress WHERE word_id IN (1, 2) ORDER BY word_id");
    expect(result).toEqual([
      { word_id: 1, score: 11 },
      { word_id: 2, score: 22 }
    ]);
  });

  it("复习流水按 sync_uid 取并集", async () => {
    testDb.run("INSERT INTO reviews (word_id, answer, score_after, reviewed_on) VALUES (1, 'know', 5, '2026-08-02')");
    const remote = new SQL.Database(testDb.export());
    remote.run("INSERT INTO reviews (word_id, answer, score_after, reviewed_on) VALUES (2, 'fuzzy', 3, '2026-08-02')");

    await mergeDatabaseBytes(new Uint8Array(remote.export()));
    expect(rows(testDb, "SELECT word_id FROM reviews ORDER BY word_id")).toHaveLength(2);
  });

  it("同一秒的两次作答不会因 created_at 撞键而丢失", async () => {
    testDb.run("DELETE FROM sync_device");
    testDb.run("INSERT INTO sync_device (id) VALUES ('local-device')");
    testDb.run(`
      INSERT INTO reviews (word_id, answer, score_after, reviewed_on, created_at, direction)
      VALUES (1, 'know', 0, '2026-08-22', '2026-08-22 10:00:00', 'forward')
    `);
    const remote = new SQL.Database(testDb.export());
    remote.run("DELETE FROM sync_device");
    remote.run("INSERT INTO sync_device (id) VALUES ('remote-device')");
    remote.run(`
      INSERT INTO reviews (word_id, answer, score_after, reviewed_on, created_at, direction)
      VALUES (1, 'forgot', 0, '2026-08-22', '2026-08-22 10:00:00', 'forward')
    `);
    testDb.run(`
      INSERT INTO reviews (word_id, answer, score_after, reviewed_on, created_at, direction)
      VALUES (1, 'fuzzy', 0, '2026-08-22', '2026-08-22 10:00:00', 'forward')
    `);

    await mergeDatabaseBytes(new Uint8Array(remote.export()));
    expect(rows(testDb, "SELECT answer FROM reviews ORDER BY sync_uid").map((row) => row.answer))
      .toEqual(["know", "fuzzy", "forgot"]);
    const countAfterFirstMerge = rows(testDb, "SELECT sync_uid FROM reviews").length;
    await mergeDatabaseBytes(new Uint8Array(remote.export()));
    expect(rows(testDb, "SELECT sync_uid FROM reviews")).toHaveLength(countAfterFirstMerge);
  });

  it("两端各自自增的复习 id 撞车时，本机记录不会被顶掉", async () => {
    // 两台设备从同一份备份分头学习：各自的 reviews.id 一定会撞车。
    // 曾经的实现照抄云端 id 做 INSERT OR REPLACE，本机那条会被静默删掉
    // （REPLACE 不触发 DELETE 触发器，所以连墓碑都没有）。
    const remote = new SQL.Database(new Uint8Array(testDb.export()));
    remote.run(`
      INSERT INTO reviews (id, word_id, answer, score_after, reviewed_on, sync_uid)
      VALUES (9001, 11, 'know', 5, '2026-08-03', 'remote-device:9001')
    `);
    testDb.run("INSERT INTO reviews (id, word_id, answer, score_after, reviewed_on) VALUES (9001, 22, 'forgot', 0, '2026-08-03')");

    await mergeDatabaseBytes(new Uint8Array(remote.export()));

    const merged = rows(testDb, "SELECT word_id FROM reviews ORDER BY word_id");
    expect(merged).toEqual([{ word_id: 11 }, { word_id: 22 }]);
  });

  it("学习时长记进本设备那行，并按天汇总回 word_study_time", async () => {
    // 换一份「还没建过同步结构」的库，才能覆盖到首次建表时的存量迁移
    testDb = new SQL.Database(new Uint8Array(readFileSync(seedPath)));
    testDb.run("INSERT INTO word_study_time (studied_on, seconds) VALUES ('2026-08-01', 600)");
    ensureSyncSchema();
    // 存量历史要先补进 by_device，否则第一次汇总就把它清零
    expect(rows(testDb, "SELECT SUM(seconds) AS s FROM word_study_time_by_device WHERE studied_on = '2026-08-01'"))
      .toEqual([{ s: 600 }]);

    recordStudySeconds("2026-08-03", 120);
    recordStudySeconds("2026-08-03", 60);
    expect(rows(testDb, "SELECT seconds FROM word_study_time WHERE studied_on = '2026-08-03'"))
      .toEqual([{ seconds: 180 }]);

    // 对端同一天也学了：合并后应当是两台设备求和，而不是互相覆盖
    const remote = new SQL.Database(new Uint8Array(testDb.export()));
    remote.run(`
      INSERT INTO word_study_time_by_device (studied_on, device_id, seconds, sync_updated_at)
      VALUES ('2026-08-03', 'remote-device', 240, '2026-08-03T10:00:00.000Z')
    `);
    await mergeDatabaseBytes(new Uint8Array(remote.export()));

    expect(rows(testDb, "SELECT seconds FROM word_study_time WHERE studied_on = '2026-08-03'"))
      .toEqual([{ seconds: 420 }]);
  });

  it("较新的墓碑会阻止旧数据复活", async () => {
    testDb.run("INSERT OR REPLACE INTO progress (word_id, score, seen_count) VALUES (42, 10, 1)");
    const remote = new SQL.Database(testDb.export());
    testDb.run("DELETE FROM progress WHERE word_id = 42");
    remote.run("UPDATE progress SET sync_updated_at = '2000-01-01T00:00:00.000Z', sync_origin_device = 'remote' WHERE word_id = 42");

    await mergeDatabaseBytes(new Uint8Array(remote.export()));
    expect(rows(testDb, "SELECT word_id FROM progress WHERE word_id = 42")).toHaveLength(0);
    expect(rows(testDb, "SELECT row_key FROM sync_tombstones WHERE table_name = 'progress' AND row_key = '42'")).toHaveLength(1);
  });
});

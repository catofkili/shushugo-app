import { beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import initSqlJs, { type Database } from "sql.js";

let SQL: Awaited<ReturnType<typeof initSqlJs>>;
let testDb: Database;

vi.mock("../database", () => ({
  getDatabase: () => testDb,
  exportDatabase: () => testDb.export(),
  openDatabase: async (data: Uint8Array) => new SQL.Database(data),
  createDatabase: async () => new SQL.Database(),
  initDatabase: async () => testDb
}));

import { ensureUserTables } from "../study-core";
import { ensureFsrsColumns } from "../fsrs-store";
import { mergeDatabaseBytes } from "./merge";
import { ensureSyncSchema } from "./schema";

const seedPath = fileURLToPath(new URL("../../../public/nihongo.db", import.meta.url));
const suppliedAncestorPath = process.env.SIM_PROPERTY_ANCESTOR?.trim();
const reviewKey = (row: Record<string, unknown>): string => [
  row.word_id,
  row.created_at,
  row.direction ?? "forward"
].join("|");

const rows = (db: Database, sql: string): Record<string, unknown>[] => {
  const result = db.exec(sql)[0];
  if (!result) return [];
  return result.values.map((value) => Object.fromEntries(
    result.columns.map((column, index) => [column, value[index]])
  ));
};

const reviews = (bytes: Uint8Array): Record<string, unknown>[] => {
  const db = new SQL.Database(bytes);
  try {
    return rows(db, `SELECT id, word_id, answer, score_after, reviewed_on, created_at,
      COALESCE(direction, 'forward') AS direction, sync_uid
      FROM reviews ORDER BY word_id, created_at, direction, sync_uid`);
  } finally {
    db.close();
  }
};

const progress = (bytes: Uint8Array, wordId = 1): Record<string, unknown>[] => {
  const db = new SQL.Database(bytes);
  try {
    return rows(db, `SELECT * FROM progress WHERE word_id = ${wordId}`);
  } finally {
    db.close();
  }
};

const logicalState = (bytes: Uint8Array) => ({
  reviews: reviews(bytes).map(({ id: _id, sync_uid: _uid, ...row }) => row),
  progress: progress(bytes).map(({ sync_updated_at: _at, sync_origin_device: _origin, ...row }) => row)
});

const setDevice = (db: Database, id: string): void => {
  db.run("DELETE FROM sync_device");
  db.run("INSERT INTO sync_device (id) VALUES (?)", [id]);
};

const setRemoteState = (db: Database, sql: string, params: unknown[]): void => {
  db.run("INSERT OR REPLACE INTO sync_context (key, value) VALUES ('applying_remote', '1')");
  db.run(sql, params as never);
  db.run("DELETE FROM sync_context WHERE key = 'applying_remote'");
};

const ancestorBytes = (): Uint8Array => {
  testDb = new SQL.Database(new Uint8Array(readFileSync(suppliedAncestorPath || seedPath)));
  ensureUserTables();
  ensureFsrsColumns();
  ensureSyncSchema();
  if (suppliedAncestorPath) {
    const bytes = new Uint8Array(testDb.export());
    testDb.close();
    return bytes;
  }
  setDevice(testDb, "ancestor");
  // 分叉点有一条既属于 A 也属于 B 的历史，测试合并不会复制它。
  testDb.run(`INSERT INTO reviews
    (word_id, answer, score_after, reviewed_on, created_at, direction)
    VALUES (1, 'know', 4, '2026-08-01', '2026-08-01T10:00:00.000Z', 'forward')`);
  testDb.run(`INSERT OR REPLACE INTO progress
    (word_id, seen_count, right_count, last_seen_on,
     fsrs_stability, fsrs_difficulty, fsrs_last_review, fsrs_due, fsrs_state, fsrs_reps,
     sync_updated_at, sync_origin_device)
    VALUES (1, 1, 1, '2026-08-01', 2, 5, '2026-08-01T10:00:00.000Z',
      '2026-08-01T23:00:00.000Z', 2, 1, '2026-08-01T10:00:00.000Z', 'ancestor')`);
  const bytes = new Uint8Array(testDb.export());
  testDb.close();
  return bytes;
};

const branchBytes = (ancestor: Uint8Array, device: string, wordId: number, at: string, answer: string, seenCount: number): Uint8Array => {
  const db = new SQL.Database(ancestor);
  setDevice(db, device);
  db.run(`INSERT INTO reviews
    (word_id, answer, score_after, reviewed_on, created_at, direction)
    VALUES (?, ?, ?, ?, ?, 'forward')`, [wordId, answer, seenCount, at.slice(0, 10), at]);
  db.run(`INSERT OR REPLACE INTO progress
    (word_id, seen_count, right_count, last_seen_on,
     fsrs_stability, fsrs_difficulty, fsrs_last_review, fsrs_due,
     fsrs_state, fsrs_reps, sync_updated_at, sync_origin_device)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 2, ?, ?, ?)`, [
    wordId,
    seenCount,
    answer === "know" ? seenCount : Math.max(0, seenCount - 1),
    at.slice(0, 10),
    seenCount + 1,
    5,
    at,
    `${at.slice(0, 10)}T23:00:00.000Z`,
    seenCount,
    at,
    device
  ]);
  setRemoteState(db, `UPDATE progress SET sync_updated_at = ?, sync_origin_device = ? WHERE word_id = ?`, [at, device, wordId]);
  const bytes = new Uint8Array(db.export());
  db.close();
  return bytes;
};

const mergeInto = async (local: Uint8Array, remote: Uint8Array): Promise<Uint8Array> => {
  testDb = new SQL.Database(local);
  ensureSyncSchema();
  await mergeDatabaseBytes(remote);
  const merged = new Uint8Array(testDb.export());
  testDb.close();
  return merged;
};

beforeAll(async () => {
  SQL = await initSqlJs();
});

describe("real sync merge properties", () => {
  it("reviews 不丢且不使用自增 id：结果正好是 A ∪ B", async () => {
    const ancestor = ancestorBytes();
    const a = branchBytes(ancestor, "device-a", 2, "2026-08-02T10:00:00.000Z", "forgot", 1);
    const b = branchBytes(ancestor, "device-b", 3, "2026-08-03T10:00:00.000Z", "know", 2);
    const merged = await mergeInto(a, b);
    const expected = new Set([...reviews(a), ...reviews(b)].map(reviewKey));
    const actual = new Set(reviews(merged).map(reviewKey));
    expect(actual).toEqual(expected);
    expect(reviews(merged).some((row) => Number(row.id) === 9001)).toBe(false);
  });

  it("同一同步重试幂等，A→B 与 B→A 的逻辑状态一致", async () => {
    const ancestor = ancestorBytes();
    const a = branchBytes(ancestor, "device-a", 2, "2026-08-02T10:00:00.000Z", "forgot", 1);
    const b = branchBytes(ancestor, "device-b", 3, "2026-08-03T10:00:00.000Z", "know", 2);
    const once = await mergeInto(a, b);
    const twice = await mergeInto(once, b);
    const reverse = await mergeInto(b, a);
    expect(logicalState(twice)).toEqual(logicalState(once));
    expect(logicalState(reverse)).toEqual(logicalState(once));
  });

  it("同一词的 FSRS 状态取较晚写入，并且流水与 progress 不出现半截", async () => {
    const ancestor = ancestorBytes();
  const a = branchBytes(ancestor, "device-a", 1, "2026-08-02T10:00:00.000Z", "forgot", 2);
  const b = branchBytes(ancestor, "device-b", 1, "2026-08-03T10:00:00.000Z", "know", 3);
    const merged = await mergeInto(a, b);
    const state = progress(merged)[0];
    expect(state?.sync_origin_device).toBe("device-b");
    expect(state?.sync_updated_at).toBe("2026-08-03T10:00:00.000Z");
    const wordReviews = reviews(merged).filter((row) => Number(row.word_id) === 1);
    // 真实快照可能有历史迁移流水，其总数不一定等于 progress.seen_count；
    // 合并判据是不能回退任一分叉的状态，且新增流水对应的 progress 行仍存在。
    const branchSeenCount = Math.max(Number(progress(a)[0]?.seen_count ?? 0), Number(progress(b)[0]?.seen_count ?? 0));
    expect(wordReviews.length).toBeGreaterThan(0);
    expect(Number(state?.seen_count)).toBeGreaterThanOrEqual(branchSeenCount);
    expect(Number(state?.fsrs_reps)).toBe(3);
  });

  it("三方从同一祖先分叉后，先后合并仍然是集合并集", async () => {
    const ancestor = ancestorBytes();
    const a = branchBytes(ancestor, "device-a", 4, "2026-08-02T10:00:00.000Z", "know", 1);
    const b = branchBytes(ancestor, "device-b", 5, "2026-08-03T10:00:00.000Z", "fuzzy", 1);
    const fromB = await mergeInto(ancestor, b);
    const all = await mergeInto(fromB, a);
    const expected = new Set([...reviews(a), ...reviews(b), ...reviews(ancestor)].map(reviewKey));
    expect(new Set(reviews(all).map(reviewKey))).toEqual(expected);
    expect(logicalState(await mergeInto(all, a))).toEqual(logicalState(all));
  });
});

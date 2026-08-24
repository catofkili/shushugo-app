/**
 * 同步地基:触发器变更追踪 + 墓碑。用真实种子库跑,确保在存量结构上可迁移。
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import initSqlJs, { type Database } from "sql.js";

let testDb: Database;
vi.mock("../database", () => ({
  getDatabase: () => testDb,
  initDatabase: async () => testDb,
  exportDatabase: () => null,
  importDatabase: async () => undefined
}));

import { ensureSyncSchema, getDeviceId, resetDeviceId, SYNC_UPDATED_COL } from "./schema";

const seedPath = fileURLToPath(new URL("../../../public/nihongo.db", import.meta.url));

const rows = (sql: string, params: unknown[] = []) => {
  const result = testDb.exec(sql, params as never)[0];
  if (!result) return [] as Record<string, unknown>[];
  return result.values.map((value) =>
    Object.fromEntries(result.columns.map((column, index) => [column, value[index]]))
  );
};

const stampOf = (table: string, where: string, params: unknown[] = []) =>
  String(rows(`SELECT ${SYNC_UPDATED_COL} AS s FROM ${table} WHERE ${where}`, params)[0]?.s ?? "");

const tombstones = () => rows("SELECT table_name, row_key FROM sync_tombstones");

let SQL: Awaited<ReturnType<typeof initSqlJs>>;

beforeAll(async () => {
  SQL = await initSqlJs();
});

beforeEach(() => {
  testDb = new SQL.Database(new Uint8Array(readFileSync(seedPath)));
  getDeviceId();
  ensureSyncSchema();
});

describe("ensureSyncSchema", () => {
  it("可在存量库上重复执行", () => {
    expect(() => {
      ensureSyncSchema();
      ensureSyncSchema();
    }).not.toThrow();
  });

  it("从云端合并进来的无 uid 流水,下次启动会被补上 —— 否则删它会掀翻整个事务", () => {
    // 复现路径:云端合并全程开着 applying_remote,insert 触发器不跑,
    // 对端快照里没带 uid 的行就永远是 NULL。实测用户库 36,759 条里中了 1 条,
    // 「合并重复词条」每次都在它上面回滚。
    testDb.run("INSERT INTO reviews (word_id, answer, score_after, reviewed_on) VALUES (1, 'know', 0, '2026-08-02')");
    testDb.run("UPDATE reviews SET sync_uid = NULL WHERE word_id = 1");
    expect(rows("SELECT COUNT(*) AS n FROM reviews WHERE sync_uid IS NULL")[0].n).toBe(1);

    // 下一次启动(新的 db 实例才会重跑 ensureSyncSchema)
    const carried = testDb.export();
    testDb = new SQL.Database(carried);
    ensureSyncSchema();
    expect(rows("SELECT COUNT(*) AS n FROM reviews WHERE sync_uid IS NULL")[0].n).toBe(0);

    // 补上之后删行留得下墓碑
    testDb.run("DELETE FROM reviews WHERE word_id = 1");
    expect(tombstones().filter((row) => row.table_name === "reviews")).toHaveLength(1);
  });

  it("算不出 row_key 的行被删时跳过墓碑,而不是抛错", () => {
    // 万一还是漏了一条(比如以后新增的 append 表),删它只能不写墓碑,
    // 绝不能让调用方那一整个批量迁移失败。
    testDb.run("INSERT INTO reviews (word_id, answer, score_after, reviewed_on) VALUES (2, 'know', 0, '2026-08-02')");
    testDb.run("UPDATE reviews SET sync_uid = NULL WHERE word_id = 2");
    const before = tombstones().length;
    expect(() => testDb.run("DELETE FROM reviews WHERE word_id = 2")).not.toThrow();
    expect(tombstones().length).toBe(before);
  });

  it("给同步表补上 sync_updated_at,给事件日志补上 sync_uid", () => {
    const progressCols = rows("PRAGMA table_info(progress)").map((r) => String(r.name));
    expect(progressCols).toContain(SYNC_UPDATED_COL);

    const reviewCols = rows("PRAGMA table_info(reviews)").map((r) => String(r.name));
    expect(reviewCols).toContain("sync_uid");
  });
});

describe("变更追踪触发器", () => {
  it("INSERT 自动盖时间戳", () => {
    testDb.run("INSERT INTO progress (word_id, score) VALUES (1, 3)");
    expect(stampOf("progress", "word_id = 1")).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("UPDATE 会把时间戳推到更新的值", async () => {
    testDb.run("INSERT INTO progress (word_id, score) VALUES (1, 3)");
    const before = stampOf("progress", "word_id = 1");

    await new Promise((resolve) => setTimeout(resolve, 5));
    testDb.run("UPDATE progress SET score = 7 WHERE word_id = 1");

    expect(stampOf("progress", "word_id = 1") > before).toBe(true);
  });

  it("显式写入 sync_updated_at 时不再二次盖章(同步落盘用)", () => {
    testDb.run("INSERT INTO progress (word_id, score) VALUES (1, 3)");
    const remote = "2030-01-01T00:00:00.000Z";

    // 模拟把对端较新的一行合并进来:时间戳必须原样保留,
    // 否则本机会认为这行是自己刚改的,又推回给对端,来回打乒乓。
    testDb.run(
      `UPDATE progress SET score = 9, ${SYNC_UPDATED_COL} = ? WHERE word_id = 1`,
      [remote]
    );

    expect(stampOf("progress", "word_id = 1")).toBe(remote);
  });

  it("事件日志的 sync_uid 带设备号,两端不会撞车", () => {
    testDb.run("INSERT INTO reviews (word_id, answer, score_after, reviewed_on) VALUES (1,'know',5,'2026-07-28')");
    const uid = String(rows("SELECT sync_uid AS u FROM reviews WHERE word_id = 1")[0]?.u ?? "");
    expect(uid).toContain(getDeviceId());
    expect(uid).toMatch(/:\d+$/);
  });
});

describe("墓碑", () => {
  it("DELETE 留下墓碑,避免对端旧数据把删掉的行复活", () => {
    testDb.run("INSERT INTO progress (word_id, score) VALUES (42, 3)");
    testDb.run("DELETE FROM progress WHERE word_id = 42");

    expect(tombstones()).toContainEqual({ table_name: "progress", row_key: "42" });
  });

  it("复合主键的墓碑带上全部主键列", () => {
    testDb.run("INSERT INTO stage1_tasks (reviewed_on, word_id, task_type, order_index) VALUES ('2026-07-28', 7, 'new', 1)");
    testDb.run("DELETE FROM stage1_tasks WHERE word_id = 7");

    const key = tombstones().find((t) => t.table_name === "stage1_tasks")?.row_key;
    expect(String(key).split(String.fromCharCode(31))).toEqual(["2026-07-28", "7"]);
  });

  it("重新插入同一行会撤销墓碑", () => {
    testDb.run("INSERT INTO progress (word_id, score) VALUES (42, 3)");
    testDb.run("DELETE FROM progress WHERE word_id = 42");
    expect(tombstones()).toHaveLength(1);

    testDb.run("INSERT INTO progress (word_id, score) VALUES (42, 5)");
    expect(tombstones()).toHaveLength(0);
  });
});

describe("设备标识", () => {
  it("同一库上稳定不变", () => {
    expect(getDeviceId()).toBe(getDeviceId());
  });

  it("resetDeviceId 换号,供导入他人备份后使用", () => {
    const before = getDeviceId();
    const after = resetDeviceId();
    expect(after).not.toBe(before);
    expect(getDeviceId()).toBe(after);
  });

  it("换号后新记录用新设备号,不与备份来源撞车", () => {
    testDb.run("INSERT INTO reviews (word_id, answer, score_after, reviewed_on) VALUES (1,'know',5,'2026-07-28')");
    const fromSource = String(rows("SELECT sync_uid AS u FROM reviews WHERE word_id = 1")[0]?.u);

    const fresh = resetDeviceId();
    testDb.run("INSERT INTO reviews (word_id, answer, score_after, reviewed_on) VALUES (2,'know',5,'2026-07-28')");
    const afterReset = String(rows("SELECT sync_uid AS u FROM reviews WHERE word_id = 2")[0]?.u);

    expect(afterReset).toContain(fresh);
    expect(afterReset.split(":")[0]).not.toBe(fromSource.split(":")[0]);
  });
});

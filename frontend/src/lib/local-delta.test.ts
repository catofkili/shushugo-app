/**
 * 增量落盘的往返:改动 → 收增量 → 在「旧快照」那份库上回放 → 两边一致。
 *
 * 这条路上出错是**静默丢数据**(下次启动才发现,而且没人知道丢了什么),
 * 所以每条判据都拿两份真实的库对着比,不看中间结构。
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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

const { ensureSyncSchema, getDeviceId, SYNC_UPDATED_COL } = await import("./sync/schema");
const { applyDelta, collectDelta, currentMark, readSnapshotMark, stampSnapshotMark } =
  await import("./local-delta");

const seedPath = fileURLToPath(new URL("../../public/nihongo.db", import.meta.url));

let SQL: Awaited<ReturnType<typeof initSqlJs>>;
let origin: Database;
let snapshot: Uint8Array;
let snapshotMark: string;

const rows = (db: Database, sql: string, params: unknown[] = []) => {
  const result = db.exec(sql, params as never)[0];
  if (!result) return [] as Record<string, unknown>[];
  return result.values.map((value) =>
    Object.fromEntries(result.columns.map((column, index) => [column, value[index]]))
  );
};

/** 在原库上改,收增量,回放到快照那份库上,把回放后的库交出来。 */
const roundTrip = (mutate: () => void) => {
  testDb = origin;
  mutate();
  const delta = collectDelta(snapshotMark);
  const restored = new SQL.Database(snapshot);
  testDb = restored;
  ensureSyncSchema();
  applyDelta(delta);
  return { restored, delta };
};

beforeAll(async () => {
  SQL = await initSqlJs();
});

beforeEach(() => {
  origin = new SQL.Database(new Uint8Array(readFileSync(seedPath)));
  testDb = origin;
  getDeviceId();
  ensureSyncSchema();
  // 出厂库的 progress 是空的(种子库只有词条),先给几个词建行,
  // 否则下面的 UPDATE 一行都匹配不到,测试会「全都相等」地假通过。
  origin.run("INSERT INTO progress (word_id) SELECT id FROM words WHERE id <= 10");
  // 把建行那一下的时间戳按到很早:collectDelta 用的是 `>=`(同一毫秒宁可多带),
  // 不这么按的话建行和取水位线可能落在同一毫秒,「没碰过的行一个都不带」会偶发失败。
  // 显式写 sync_updated_at 不会被 update 触发器改回去(它的 WHEN 只在这一列没动时成立)。
  origin.run("UPDATE progress SET sync_updated_at = '2000-01-01T00:00:00.000Z'");
  // 先落一份「快照」,水位线写进库里 —— 和 storage.saveDatabase 里的顺序一致。
  snapshotMark = currentMark();
  stampSnapshotMark(snapshotMark);
  snapshot = origin.export();
});

describe("collectDelta / applyDelta", () => {
  it("快照自带水位线,回放前读得回来", () => {
    const restored = new SQL.Database(snapshot);
    testDb = restored;
    expect(readSnapshotMark()).toBe(snapshotMark);
  });

  it("改过的行会被带上,回放后与原库一致", () => {
    const { restored } = roundTrip(() => {
      origin.run("UPDATE progress SET seen_count = 7, forgot_count = 3 WHERE word_id = 1");
      origin.run(
        "INSERT INTO reviews (word_id, answer, score_after, reviewed_on, direction) VALUES (1, 'forgot', 0, '2026-09-06', 'forward')"
      );
      origin.run("INSERT OR REPLACE INTO app_state (key, value) VALUES ('phase', 'stage1')");
    });
    expect(rows(restored, "SELECT seen_count, forgot_count FROM progress WHERE word_id = 1"))
      .toEqual(rows(origin, "SELECT seen_count, forgot_count FROM progress WHERE word_id = 1"));
    expect(rows(restored, "SELECT word_id, answer, reviewed_on FROM reviews ORDER BY id"))
      .toEqual(rows(origin, "SELECT word_id, answer, reviewed_on FROM reviews ORDER BY id"));
    expect(rows(restored, "SELECT value FROM app_state WHERE key = 'phase'")[0]?.value).toBe("stage1");
  });

  it("没碰过的行一个都不带 —— 增量必须只有改动量", () => {
    const { delta } = roundTrip(() => {
      origin.run("UPDATE progress SET seen_count = 1 WHERE word_id = 2");
    });
    expect(delta.rows.progress).toHaveLength(1);
    expect(Number(delta.rows.progress[0].word_id)).toBe(2);
  });

  it("删掉的行靠墓碑回放,不会在快照那边原样活着", () => {
    testDb = origin;
    origin.run("INSERT INTO word_notes (word_id, note) VALUES (5, '删我')");
    // 先做一份含这一行的快照,再删 —— 否则「删」在快照里本来就不存在,测不出东西
    snapshotMark = currentMark();
    stampSnapshotMark(snapshotMark);
    snapshot = origin.export();

    const { restored } = roundTrip(() => {
      origin.run("DELETE FROM word_notes WHERE word_id = 5");
    });
    expect(rows(restored, "SELECT word_id FROM word_notes WHERE word_id = 5")).toHaveLength(0);
    expect(rows(restored, "SELECT table_name FROM sync_tombstones WHERE table_name = 'word_notes'"))
      .toHaveLength(1);
  });

  it("同一条增量里删了又插回来,最终是「在」", () => {
    testDb = origin;
    origin.run("INSERT INTO word_notes (word_id, note) VALUES (6, '旧')");
    snapshotMark = currentMark();
    stampSnapshotMark(snapshotMark);
    snapshot = origin.export();

    const { restored } = roundTrip(() => {
      origin.run("DELETE FROM word_notes WHERE word_id = 6");
      origin.run("INSERT INTO word_notes (word_id, note) VALUES (6, '新')");
    });
    expect(rows(restored, "SELECT note FROM word_notes WHERE word_id = 6")[0]?.note).toBe("新");
    // 行活过来了,墓碑就不能留 —— 留着的话下次云同步会把它再删一次
    expect(rows(restored, "SELECT row_key FROM sync_tombstones WHERE table_name = 'word_notes'"))
      .toHaveLength(0);
  });

  it("回放不重新盖时间戳 —— 否则每次重启都像整库刚改过", () => {
    const { restored } = roundTrip(() => {
      origin.run("UPDATE progress SET seen_count = 9 WHERE word_id = 3");
    });
    const before = rows(origin, `SELECT ${SYNC_UPDATED_COL} AS s FROM progress WHERE word_id = 3`)[0]?.s;
    const after = rows(restored, `SELECT ${SYNC_UPDATED_COL} AS s FROM progress WHERE word_id = 3`)[0]?.s;
    expect(after).toBe(before);
  });

  it("回放是幂等的:同一条增量放两遍结果不变", () => {
    const { restored, delta } = roundTrip(() => {
      origin.run("UPDATE progress SET seen_count = 4 WHERE word_id = 4");
      origin.run(
        "INSERT INTO reviews (word_id, answer, score_after, reviewed_on, direction) VALUES (4, 'know', 0, '2026-09-06', 'forward')"
      );
    });
    const once = rows(restored, "SELECT COUNT(*) AS n FROM reviews")[0]?.n;
    testDb = restored;
    applyDelta(delta);
    expect(rows(restored, "SELECT COUNT(*) AS n FROM reviews")[0]?.n).toBe(once);
  });

  it("兼容没有 sync_uid 的旧增量,回放后仍有稳定事件身份", () => {
    const restored = new SQL.Database(snapshot);
    testDb = restored;
    applyDelta({
      from: snapshotMark,
      to: currentMark(),
      rows: {
        reviews: [{
          id: 777,
          word_id: 1,
          answer: "know",
          score_after: 1,
          reviewed_on: "2026-09-06",
          direction: "forward"
        }]
      },
      tombstones: []
    });
    expect(rows(restored, "SELECT sync_uid FROM reviews WHERE id = 777")[0]?.sync_uid)
      .toBe("legacy:777");
  });

  it("中途写不下去时整条回滚,不留一份「放了一半」的库", () => {
    // 前半段能写(progress),后半段一定写不下去(reviews 少一列)。
    // 没有事务的话,前半段会留在库里 —— 而启动代码只在控制台说一句
    // 「已按快照那一刻启动」,用户看到的是一份自己都不知道拼过的库。
    testDb = origin;
    origin.run("UPDATE progress SET seen_count = 77 WHERE word_id = 3");
    origin.run(
      "INSERT INTO reviews (word_id, answer, score_after, reviewed_on, direction) VALUES (3, 'know', 0, '2026-09-06', 'forward')"
    );
    const delta = collectDelta(snapshotMark);

    const restored = new SQL.Database(snapshot);
    testDb = restored;
    ensureSyncSchema();
    const before = rows(restored, "SELECT seen_count AS n FROM progress WHERE word_id = 3")[0]?.n;
    restored.run("DROP TABLE reviews");
    restored.run("CREATE TABLE reviews (id INTEGER PRIMARY KEY AUTOINCREMENT, unrelated TEXT NOT NULL)");

    expect(() => applyDelta(delta)).toThrow();
    expect(rows(restored, "SELECT seen_count AS n FROM progress WHERE word_id = 3")[0]?.n).toBe(before);
  });
});

/**
 * 错题本判据的两份实现必须完全一致。
 *
 * `mistakeCandidateSql`(SQL,错题本选词/统计用)和 `isLongTermWeak`(TS,排片热路径用)
 * 是同一套口径的两份代码。历史上 CLAUDE.md 就特意警告过「改口径要一起改」,
 * 但没有任何东西在漂移时报警 —— 这个测试拿一张真表把两版跑在同一批行上逐行比对。
 */
import { beforeAll, describe, expect, it } from "vitest";
import initSqlJs, { type Database } from "sql.js";
import {
  MISTAKE_MAX_STABILITY,
  MISTAKE_MIN_LAPSES,
  MISTAKE_MIN_REVIEWS,
  isLongTermWeak,
  mistakeCandidateSql
} from "./filters";

type Row = {
  word_id: number;
  seen_count: number;
  right_count: number;
  fuzzy_count: number;
  forgot_count: number;
  fsrs_stability: number | null;
  fsrs_difficulty: number | null;
  fsrs_reps: number;
  fsrs_lapses: number;
};

let db: Database;
let rows: Row[];

/** 覆盖每个阈值的两侧 + NULL,笛卡尔积铺开 */
const buildRows = (): Row[] => {
  const out: Row[] = [];
  let id = 1;
  const seenCounts = [0, MISTAKE_MIN_REVIEWS - 1, MISTAKE_MIN_REVIEWS, 20];
  const stabilities = [null, 0.5, MISTAKE_MAX_STABILITY - 1, MISTAKE_MAX_STABILITY, 400];
  const difficulties = [null, 5, 8.4, 8.5, 10];
  const lapseReps: [number, number][] = [
    [0, 0], [0, 20], [2, 16], [MISTAKE_MIN_LAPSES, 30], [MISTAKE_MIN_LAPSES, 10], [6, 12], [8, 8]
  ];
  const answers: [number, number, number][] = [
    [0, 0, 0], [10, 1, 1], [2, 2, 2], [1, 0, 5], [20, 1, 0]
  ];
  seenCounts.forEach((seen_count) => {
    stabilities.forEach((fsrs_stability) => {
      difficulties.forEach((fsrs_difficulty) => {
        lapseReps.forEach(([fsrs_lapses, fsrs_reps]) => {
          answers.forEach(([right_count, fuzzy_count, forgot_count]) => {
            out.push({
              word_id: id++,
              seen_count,
              right_count,
              fuzzy_count,
              forgot_count,
              fsrs_stability,
              fsrs_difficulty,
              fsrs_reps,
              fsrs_lapses
            });
          });
        });
      });
    });
  });
  return out;
};

beforeAll(async () => {
  const SQL = await initSqlJs();
  db = new SQL.Database();
  db.run(`CREATE TABLE progress (
    word_id INTEGER PRIMARY KEY,
    seen_count INTEGER, right_count INTEGER, fuzzy_count INTEGER, forgot_count INTEGER,
    fsrs_stability REAL, fsrs_difficulty REAL, fsrs_reps INTEGER, fsrs_lapses INTEGER
  )`);
  rows = buildRows();
  rows.forEach((r) => {
    db.run(
      "INSERT INTO progress VALUES (?,?,?,?,?,?,?,?,?)",
      [r.word_id, r.seen_count, r.right_count, r.fuzzy_count, r.forgot_count,
        r.fsrs_stability, r.fsrs_difficulty, r.fsrs_reps, r.fsrs_lapses]
    );
  });
});

const sqlMatches = (): Set<number> => {
  const result = db.exec(`SELECT word_id FROM progress p WHERE ${mistakeCandidateSql("p")}`);
  return new Set((result[0]?.values ?? []).map((v) => Number(v[0])));
};

describe("错题本判据:SQL 版和 TS 版必须一致", () => {
  it("在覆盖所有阈值边界的行上逐行相同", () => {
    const fromSql = sqlMatches();
    const disagreements = rows.filter(
      (row) => fromSql.has(row.word_id) !== isLongTermWeak(row as unknown as Record<string, unknown>)
    );
    expect(disagreements).toEqual([]);
  });

  it("样本里两边都不是全中或全不中(否则这个测试没有意义)", () => {
    const hits = sqlMatches().size;
    expect(hits).toBeGreaterThan(0);
    expect(hits).toBeLessThan(rows.length);
  });
});

describe("错题本判据:门槛要挡住「复习很多次、偶尔错几次」的正常词", () => {
  const row = (over: Partial<Row>): Record<string, unknown> => ({
    seen_count: 20, right_count: 14, fuzzy_count: 1, forgot_count: 1,
    fsrs_stability: 10, fsrs_difficulty: 5, fsrs_reps: 16, fsrs_lapses: 2,
    ...over
  }) as unknown as Record<string, unknown>;

  it("复习 16 次错 2 次 = 正常,不进错题本", () => {
    // 这正是旧口径(lapses >= 2)把 64% 的词全扫进来的原因
    expect(isLongTermWeak(row({}))).toBe(false);
  });

  it("复习 10 次错 4 次 = 占比 40%,进错题本", () => {
    expect(isLongTermWeak(row({ fsrs_reps: 10, fsrs_lapses: 4 }))).toBe(true);
  });

  it("错得多但复习次数更多(30 次错 4 次)不算:占比没到", () => {
    expect(isLongTermWeak(row({ fsrs_reps: 30, fsrs_lapses: 4 }))).toBe(false);
  });

  it("已经记牢的词(stability 超过上限)一律排除,哪怕历史很难看", () => {
    expect(isLongTermWeak(row({
      fsrs_stability: MISTAKE_MAX_STABILITY, fsrs_reps: 10, fsrs_lapses: 8, fsrs_difficulty: 10
    }))).toBe(false);
  });

  it("还没进过调度(stability 为空)按不牢处理", () => {
    expect(isLongTermWeak(row({ fsrs_stability: null, fsrs_reps: 10, fsrs_lapses: 4 }))).toBe(true);
  });

  it("复习次数不够的新词不算错题,再难看也不算", () => {
    expect(isLongTermWeak(row({
      seen_count: MISTAKE_MIN_REVIEWS - 1, fsrs_reps: 10, fsrs_lapses: 8, fsrs_difficulty: 10
    }))).toBe(false);
  });
});

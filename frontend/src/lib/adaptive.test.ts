import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import initSqlJs, { type Database } from "sql.js";

// 用真实的 sql.js 内存库替换全局单例,复现 adaptive 的 SQL 行为。
let db: Database;
vi.mock("./database", () => ({
  getDatabase: () => db
}));

const { getMemoryStrengthLabel, getUserMemoryProfile, updateMemoryProfileIfNeeded } =
  await import("./adaptive");

const insertReviews = (count: number) => {
  for (let index = 0; index < count; index += 1) {
    db.run("INSERT INTO reviews (word_id, answer, reviewed_on, direction) VALUES (?, 'know', date('now'), 'forward')", [index + 1]);
  }
};

beforeAll(async () => {
  const SQL = await initSqlJs();
  db = new SQL.Database();
});

beforeEach(() => {
  db.run("DROP TABLE IF EXISTS app_state");
  db.run("DROP TABLE IF EXISTS reviews");
  db.run("DROP TABLE IF EXISTS progress");
  db.run("CREATE TABLE app_state (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  db.run(`CREATE TABLE reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    word_id INTEGER NOT NULL,
    answer TEXT NOT NULL,
    reviewed_on TEXT NOT NULL,
    direction TEXT NOT NULL DEFAULT 'forward'
  )`);
  // 保持率现在读 FSRS 的 fsrs_due,合成表要跟真实 schema 一致
  db.run(`CREATE TABLE progress (
    word_id INTEGER PRIMARY KEY,
    score REAL NOT NULL DEFAULT 0,
    seen_count INTEGER NOT NULL DEFAULT 0,
    known_forever INTEGER NOT NULL DEFAULT 0,
    last_seen_on TEXT,
    fsrs_stability REAL,
    fsrs_difficulty REAL,
    fsrs_due TEXT,
    fsrs_last_review TEXT,
    fsrs_state INTEGER,
    fsrs_steps INTEGER,
    fsrs_reps INTEGER,
    fsrs_lapses INTEGER
  )`);
});

describe("getUserMemoryProfile", () => {
  it("returns the default profile for a fresh database", () => {
    const profile = getUserMemoryProfile();
    expect(profile.memoryStrength).toBe(1.0);
    expect(profile.totalReviews).toBe(0);
  });

  it("survives corrupted stored profiles", () => {
    db.run("INSERT INTO app_state (key, value) VALUES ('user_memory_profile', 'oops')");
    expect(getUserMemoryProfile().memoryStrength).toBe(1.0);
  });
});

describe("updateMemoryProfileIfNeeded", () => {
  it("does nothing below the 100-review threshold", () => {
    insertReviews(50);
    updateMemoryProfileIfNeeded();
    expect(getUserMemoryProfile().totalReviews).toBe(0);
  });

  it("computes and stores a profile once enough reviews accumulate", () => {
    insertReviews(150);
    // 「已掌握」= FSRS 排的间隔 >= 180 天(不再看 score)。两个词分别复习了 4 次和 6 次 → 均值 5
    db.run(`INSERT INTO progress (word_id, seen_count, fsrs_last_review, fsrs_due)
            VALUES (1, 4, '2026-01-01T00:00:00Z', '2026-07-20T00:00:00Z'),
                   (2, 6, '2026-01-01T00:00:00Z', '2026-08-01T00:00:00Z')`);
    db.run("INSERT INTO reviews (word_id, answer, reviewed_on, direction) VALUES (1, 'know', date('now'), 'forward'), (1, 'know', date('now'), 'forward'), (1, 'know', date('now'), 'forward'), (2, 'know', date('now'), 'forward'), (2, 'know', date('now'), 'forward'), (2, 'know', date('now'), 'forward'), (2, 'know', date('now'), 'forward'), (2, 'know', date('now'), 'forward')");
    updateMemoryProfileIfNeeded();
    const profile = getUserMemoryProfile();
    expect(profile.totalReviews).toBe(158);
    expect(profile.avgReviewsToMaster).toBe(5);
    expect(profile.memoryStrength).toBeGreaterThanOrEqual(0.5);
    expect(profile.memoryStrength).toBeLessThanOrEqual(2.0);
  });

  it("waits 50 reviews between profile refreshes", () => {
    insertReviews(150);
    updateMemoryProfileIfNeeded();
    const first = getUserMemoryProfile();
    insertReviews(10);
    updateMemoryProfileIfNeeded();
    expect(getUserMemoryProfile().totalReviews).toBe(first.totalReviews);
  });
});

describe("getMemoryStrengthLabel", () => {
  it("maps strength bands to labels", () => {
    expect(getMemoryStrengthLabel(1.6)).toBe("优秀");
    expect(getMemoryStrengthLabel(1.3)).toBe("良好");
    expect(getMemoryStrengthLabel(1.0)).toBe("正常");
    expect(getMemoryStrengthLabel(0.6)).toBe("需加强");
  });
});

/**
 * 窗口函数改写的对拍。
 *
 * 保持率和首次正确率原来都是相关子查询,在真实库(46,618 条 reviews)上分别要
 * 3.8 秒和 0.5 秒 —— 而它们每 50 次作答就在评分的同步栈里跑一次。改写成窗口函数
 * 之后必须**逐字段等于旧写法**,否则就是悄悄改了统计口径。
 *
 * 所以这里把旧 SQL 原样抄进来当基准,新旧跑同一份数据比结果。
 * 造数据专挑三种边界:同一天答好几次、间隔差一天跨过 7 天线、非 forward 的流水。
 */
const OLD_RETENTION_SQL = `
  SELECT
    COUNT(CASE WHEN r.answer IN ('know', 'known_forever') THEN 1 END) AS retained,
    COUNT(*) AS total
  FROM reviews r
  WHERE r.direction = 'forward'
    AND EXISTS (
      SELECT 1 FROM reviews prior
      WHERE prior.word_id = r.word_id AND prior.direction = 'forward'
        AND (julianday(r.reviewed_on) - julianday(prior.reviewed_on)) >= 7
    )
    AND NOT EXISTS (
      SELECT 1 FROM reviews same_day
      WHERE same_day.word_id = r.word_id AND same_day.direction = 'forward'
        AND same_day.reviewed_on = r.reviewed_on AND same_day.id < r.id
        AND EXISTS (
          SELECT 1 FROM reviews sdp
          WHERE sdp.word_id = same_day.word_id AND sdp.direction = 'forward'
            AND (julianday(same_day.reviewed_on) - julianday(sdp.reviewed_on)) >= 7
        )
    )
`;

const NEW_RETENTION_SQL = `
  WITH first_day AS (
    SELECT word_id, MIN(reviewed_on) AS d0 FROM reviews WHERE direction = 'forward' GROUP BY word_id
  ), day_firsts AS (
    SELECT r.word_id, r.reviewed_on, r.answer,
           ROW_NUMBER() OVER (PARTITION BY r.word_id, r.reviewed_on ORDER BY r.id) AS rn
    FROM reviews r WHERE r.direction = 'forward'
  )
  SELECT
    COUNT(CASE WHEN f.answer IN ('know', 'known_forever') THEN 1 END) AS retained,
    COUNT(*) AS total
  FROM day_firsts f JOIN first_day fd ON fd.word_id = f.word_id
  WHERE f.rn = 1 AND julianday(f.reviewed_on) - julianday(fd.d0) >= 7
`;

const OLD_FIRST_TIME_SQL = `
  SELECT
    COUNT(CASE WHEN r.answer IN ('know', 'known_forever') THEN 1 END) AS correct,
    COUNT(*) AS total
  FROM reviews r
  WHERE r.direction = 'forward'
    AND r.reviewed_on BETWEEN date('2026-09-06', '-30 days') AND '2026-09-06'
    AND NOT EXISTS (
      SELECT 1 FROM reviews prior
      WHERE prior.word_id = r.word_id AND prior.direction = 'forward'
        AND (prior.reviewed_on < r.reviewed_on OR (prior.reviewed_on = r.reviewed_on AND prior.id < r.id))
    )
`;

const NEW_FIRST_TIME_SQL = `
  WITH ranked AS (
    SELECT r.reviewed_on, r.answer,
           ROW_NUMBER() OVER (PARTITION BY r.word_id ORDER BY r.reviewed_on, r.id) AS rn
    FROM reviews r WHERE r.direction = 'forward'
  )
  SELECT
    COUNT(CASE WHEN answer IN ('know', 'known_forever') THEN 1 END) AS correct,
    COUNT(*) AS total
  FROM ranked
  WHERE rn = 1 AND reviewed_on BETWEEN date('2026-09-06', '-30 days') AND '2026-09-06'
`;

const pair = (sql: string) => {
  const result = db.exec(sql)[0];
  return result ? result.values[0].map(Number) : [];
};

describe("adaptive 的窗口函数改写", () => {
  const addReview = (wordId: number, day: string, answer: string, direction = "forward") => {
    db.run("INSERT INTO reviews (word_id, answer, reviewed_on, direction) VALUES (?, ?, ?, ?)",
      [wordId, answer, day, direction]);
  };

  it("边界数据上与旧 SQL 逐字段一致", () => {
    // 词 1:第一次 → 隔 1 天(不到 7 天)→ 隔 15 天(过线),过线那天答了两次
    addReview(1, "2026-08-01", "forgot");
    addReview(1, "2026-08-02", "know");
    addReview(1, "2026-08-17", "know");
    addReview(1, "2026-08-17", "forgot");
    // 词 2:只答过一次,永远没有「7 天前的那一次」
    addReview(2, "2026-08-20", "know");
    // 词 3:同一天连答三次,且这天已经过线
    addReview(3, "2026-07-10", "know");
    addReview(3, "2026-08-30", "forgot");
    addReview(3, "2026-08-30", "know");
    addReview(3, "2026-08-30", "known_forever");
    // 词 4:整整 7 天,正好卡在判据的等号上
    addReview(4, "2026-08-01", "forgot");
    addReview(4, "2026-08-08", "know");
    // 非正向的流水一条都不许算进来
    addReview(5, "2026-07-01", "know", "reverse");
    addReview(5, "2026-08-25", "know", "reverse");

    expect(pair(NEW_RETENTION_SQL)).toEqual(pair(OLD_RETENTION_SQL));
    expect(pair(NEW_FIRST_TIME_SQL)).toEqual(pair(OLD_FIRST_TIME_SQL));
    // 光「相等」可能是两边都返回 0;确认这份数据真的选出了东西
    expect(pair(NEW_RETENTION_SQL)[1]).toBeGreaterThan(0);
  });

  it("随机数据上也一致", () => {
    let seed = 20260906;
    const rand = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    const answers = ["know", "fuzzy", "forgot", "known_forever"];
    for (let i = 0; i < 400; i += 1) {
      const day = new Date(Date.UTC(2026, 6, 1) + rand(60) * 86400000).toISOString().slice(0, 10);
      addReview(rand(12) + 1, day, answers[rand(answers.length)], rand(6) === 0 ? "reverse" : "forward");
    }
    expect(pair(NEW_RETENTION_SQL)).toEqual(pair(OLD_RETENTION_SQL));
    expect(pair(NEW_FIRST_TIME_SQL)).toEqual(pair(OLD_FIRST_TIME_SQL));
  });
});

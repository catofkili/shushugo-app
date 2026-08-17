import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import initSqlJs, { type Database } from "sql.js";

let db: Database;

vi.mock("../database", () => ({
  getDatabase: () => db
}));

const { getStudyAnalytics } = await import("./stats");

beforeAll(async () => {
  const SQL = await initSqlJs();
  db = new SQL.Database();
});

beforeEach(() => {
  db.run("DROP TABLE IF EXISTS app_state");
  db.run("DROP TABLE IF EXISTS reviews");
  db.run("DROP TABLE IF EXISTS progress");
  db.run("DROP TABLE IF EXISTS words");
  db.run("DROP TABLE IF EXISTS word_study_time");
  db.run("DROP TABLE IF EXISTS checkins");
  db.run("CREATE TABLE app_state (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  db.run(`CREATE TABLE words (
    id INTEGER PRIMARY KEY,
    kanji TEXT NOT NULL,
    kana TEXT NOT NULL,
    meaning TEXT NOT NULL,
    pos TEXT NOT NULL,
    jlpt_level TEXT
  )`);
  db.run(`CREATE TABLE progress (
    word_id INTEGER PRIMARY KEY,
    seen_count INTEGER NOT NULL DEFAULT 0,
    known_forever INTEGER NOT NULL DEFAULT 0,
    last_seen_on TEXT,
    right_count INTEGER NOT NULL DEFAULT 0,
    fuzzy_count INTEGER NOT NULL DEFAULT 0,
    forgot_count INTEGER NOT NULL DEFAULT 0,
    fsrs_stability REAL,
    fsrs_due TEXT,
    fsrs_last_review TEXT,
    fsrs_lapses INTEGER NOT NULL DEFAULT 0
  )`);
  db.run(`CREATE TABLE reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    word_id INTEGER NOT NULL,
    answer TEXT NOT NULL,
    score_after REAL NOT NULL DEFAULT 0,
    reviewed_on TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    direction TEXT NOT NULL DEFAULT 'forward'
  )`);
  db.run("CREATE TABLE word_study_time (studied_on TEXT PRIMARY KEY, seconds INTEGER NOT NULL DEFAULT 0)");
  db.run("CREATE TABLE checkins (checked_on TEXT PRIMARY KEY)");

  db.run(`INSERT INTO words (id, kanji, kana, meaning, pos, jlpt_level) VALUES
    (1, '一', 'いち', '一', '名词', 'N5'),
    (2, '二', 'に', '二', '名词', 'N5'),
    (3, '三', 'さん', '三', '名词', 'N4'),
    (4, '四', 'よん', '四', '名词', 'N4')`);
  db.run(`INSERT INTO progress (
    word_id, seen_count, fsrs_stability, fsrs_due, fsrs_last_review
  ) VALUES
    (1, 3, 30, date('now', '+200 days'), date('now', '-10 days')),
    (2, 1, 1, date('now', '+1 day'), date('now')),
    (3, 0, NULL, NULL, NULL),
    (4, 0, NULL, NULL, NULL)`);
  db.run(`INSERT INTO reviews (word_id, answer, reviewed_on, direction) VALUES
    (1, 'know', date('now', '-20 days'), 'forward'),
    (1, 'know', date('now', '-10 days'), 'forward'),
    (1, 'know', date('now'), 'forward'),
    (2, 'forgot', date('now'), 'forward'),
    (3, 'know', date('now'), 'reverse')`);
  db.run("INSERT INTO word_study_time (studied_on, seconds) VALUES (date('now'), 3600)");
});

describe("学习分析统计口径", () => {
  it("不把全库 progress 行算成已学习,掌握只看 FSRS,保持率只看真实复习样本", () => {
    const analytics = getStudyAnalytics();
    const n5 = analytics.mastery.byLevel.find((level) => level.level === "N5");
    const n4 = analytics.mastery.byLevel.find((level) => level.level === "N4");

    expect(n5).toMatchObject({ total: 2, studied: 2, mastered: 1 });
    expect(n4).toMatchObject({ total: 2, studied: 0, mastered: 0 });
    expect(analytics.errors.errorTypeDistribution.forgot).toBe(1);
    expect(analytics.efficiency.avgReviewsToMaster).toBe(3);
    expect(analytics.efficiency.retentionSampleSize).toBe(2);
    expect(analytics.efficiency.retentionRate7Days).toBe(100);
    expect(analytics.efficiency.memorySampleSize).toBe(4);
  });

  it("分析页会触发已有历史记录的记忆画像刷新", () => {
    for (let index = 0; index < 96; index += 1) {
      db.run("INSERT INTO reviews (word_id, answer, reviewed_on, direction) VALUES (2, 'know', date('now'), 'forward')");
    }

    const analytics = getStudyAnalytics();
    const profile = db.exec("SELECT value FROM app_state WHERE key = 'user_memory_profile'");

    expect(analytics.efficiency.memorySampleSize).toBe(100);
    expect(profile[0].values.length).toBe(1);
    expect(JSON.parse(String(profile[0].values[0][0])).totalReviews).toBe(100);
  });
});

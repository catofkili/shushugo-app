import { beforeEach, describe, expect, it, vi } from "vitest";
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
vi.mock("./storage", () => ({ scheduleSave: () => undefined }));

import { dailyStudyLoad } from "./study-load";
import { ensureUserTables, studyDate } from "./study-core";
import { ensureFsrsColumns, WORD_FSRS } from "./fsrs-store";

const SQL = await initSqlJs();
const seedPath = fileURLToPath(new URL("../../public/nihongo.db", import.meta.url));

/** 固定在下午两点：学习日边界（凌晨四点）就是明天 04:00 */
const NOW = new Date("2026-08-28T14:00:00");
const DAY = studyDate(NOW);
const shift = (delta: number) => {
  const date = new Date(`${DAY}T12:00:00`);
  date.setDate(date.getDate() + delta);
  return studyDate(date);
};

const addReview = (wordId: number, direction: string, day: string) => {
  testDb.run(
    "INSERT INTO reviews (word_id, answer, score_after, reviewed_on, direction) VALUES (?, 'know', 0, ?, ?)",
    [wordId, day, direction]
  );
};

/** 给一个词写一份「学过、下次到期在 due」的 FSRS 状态 */
const scheduleWord = (wordId: number, due: Date) => {
  testDb.run(`
    UPDATE progress
    SET seen_count = 1, known_forever = 0,
        fsrs_stability = 10, fsrs_difficulty = 5, fsrs_due = ?, fsrs_last_review = ?,
        fsrs_state = 2, fsrs_steps = 0, fsrs_reps = 1, fsrs_lapses = 0
    WHERE word_id = ?
  `, [due.toISOString(), NOW.toISOString(), wordId]);
};

const wordIds = (count: number): number[] => {
  const rows = testDb.exec(`SELECT id FROM words ORDER BY id LIMIT ${count}`)[0];
  return rows.values.map((row) => Number(row[0]));
};

const barFor = (load: ReturnType<typeof dailyStudyLoad>, date: string) =>
  load.bars.find((bar) => bar.date === date)!;

describe("每日学习数量", () => {
  beforeEach(() => {
    testDb = new SQL.Database(new Uint8Array(readFileSync(seedPath)));
    prefStore.clear();
    // 真实启动路径也是先 ensureUserTables 再干活：reviews.direction 和 fsrs_* 都是
    // 运行期补上的列，出厂库里没有。
    ensureUserTables();
    ensureFsrsColumns(WORD_FSRS);
    testDb.run("INSERT OR IGNORE INTO progress (word_id) SELECT id FROM words");
  });

  it("过去每天数的是「张卡」：同一天答十次同一张只算一张", () => {
    const [word] = wordIds(1);
    for (let i = 0; i < 10; i += 1) addReview(word, "forward", shift(-3));
    const bar = barFor(dailyStudyLoad({ now: NOW }), shift(-3));
    expect(bar.fresh + bar.review).toBe(1);
  });

  it("⚠️ 同一个词的不同方向是两张卡，不去重成一个词", () => {
    const [word] = wordIds(1);
    addReview(word, "forward", shift(-2));
    addReview(word, "reverse", shift(-2));
    const bar = barFor(dailyStudyLoad({ now: NOW }), shift(-2));
    expect(bar.fresh + bar.review).toBe(2);
  });

  it("第一次露面算新学，以后算复习", () => {
    const [word] = wordIds(1);
    addReview(word, "forward", shift(-5));
    addReview(word, "forward", shift(-1));
    const load = dailyStudyLoad({ now: NOW });
    expect(barFor(load, shift(-5))).toMatchObject({ fresh: 1, review: 0 });
    expect(barFor(load, shift(-1))).toMatchObject({ fresh: 0, review: 1 });
  });

  it("语法流水也算进来 —— 那天学的东西不分单词还是语法", () => {
    const grammarId = Number(testDb.exec("SELECT id FROM grammar_points LIMIT 1")[0].values[0][0]);
    testDb.run(
      "INSERT INTO grammar_reviews (grammar_id, answer, score_after, reviewed_on) VALUES (?, 'know', 0, ?)",
      [grammarId, shift(-4)]
    );
    expect(barFor(dailyStudyLoad({ now: NOW }), shift(-4))).toMatchObject({ fresh: 1, review: 0 });
  });

  it("没学的那些天是 0，不是缺一根柱子", () => {
    const load = dailyStudyLoad({ now: NOW, pastDays: 14, futureDays: 7 });
    expect(load.bars).toHaveLength(21);
    expect(load.bars.filter((bar) => bar.forecast)).toHaveLength(7);
    expect(load.bars[0].date).toBe(shift(-13));
    expect(load.bars.find((bar) => bar.today)!.date).toBe(DAY);
    expect(barFor(load, shift(-7))).toMatchObject({ fresh: 0, review: 0 });
  });

  it("⚠️ 未来按学习日（凌晨四点换日）分桶，不是按 UTC 日期切", () => {
    const [a, b, c] = wordIds(3);
    // 明天 03:00 还属于**今天**这个学习日 → 不进未来任何一桶
    scheduleWord(a, new Date("2026-08-29T03:00:00"));
    // 明天 05:00 → 明天那一桶
    scheduleWord(b, new Date("2026-08-29T05:00:00"));
    // 后天 03:00 仍然是**明天**那个学习日 → 也进明天那一桶（按 UTC 日切就会错一天）
    scheduleWord(c, new Date("2026-08-30T03:00:00"));

    const load = dailyStudyLoad({ now: NOW, futureDays: 7 });
    expect(barFor(load, shift(1)).review).toBe(2);
    expect(barFor(load, shift(2)).review).toBe(0);
  });

  it("未来每天照发新词额度，直到没学过的词发完为止", () => {
    prefStore.set("mn-study-preferences", JSON.stringify({ dailyGoal: 10 }));
    testDb.run("UPDATE progress SET seen_count = 1, fsrs_due = NULL");
    const ids = wordIds(25);
    testDb.run(
      `UPDATE progress SET seen_count = 0 WHERE word_id IN (${ids.map(() => "?").join(",")})`,
      ids
    );

    const load = dailyStudyLoad({ now: NOW, futureDays: 3 });
    // 25 个没学过的词、每天 10 个：今天先领 10，剩下 15 分给后面三天 → 10 / 5 / 0
    expect(load.bars.filter((bar) => bar.forecast).map((bar) => bar.fresh)).toEqual([10, 5, 0]);
  });

  it("⚠️ 今天那根要把「还没做的」也画出来 —— 不然早上打开是一根 0，右边预计却是满的", () => {
    prefStore.set("mn-study-preferences", JSON.stringify({ dailyGoal: 10 }));
    testDb.run("UPDATE progress SET seen_count = 1, fsrs_due = NULL");
    const [a, b] = wordIds(2);
    // 只留两张「学过但还没排过期」的卡 —— 全局口径里 fsrs_due IS NULL 视同到期
    testDb.run(
      "UPDATE progress SET seen_count = 0 WHERE word_id NOT IN (?, ?)",
      [a, b]
    );

    const load = dailyStudyLoad({ now: NOW, futureDays: 0 });
    const todayBar = load.bars.find((bar) => bar.today)!;
    expect(todayBar.fresh + todayBar.review).toBe(0);   // 今天一张还没答
    expect(todayBar.pending).toBe(2 + 10);              // 但欠着两张到期 + 十个新词
  });

  it("⚠️ 过去的日均不含今天 —— 今天才过了一半，算进去就是拿半天拉低平均", () => {
    const ids = wordIds(30);
    // 前三天各 10 张，今天只有 1 张
    [shift(-3), shift(-2), shift(-1)].forEach((day, dayIndex) => {
      ids.slice(dayIndex * 10, dayIndex * 10 + 10).forEach((id) => addReview(id, "forward", day));
    });
    addReview(ids[0], "forward", DAY);

    const load = dailyStudyLoad({ now: NOW, pastDays: 4, futureDays: 0 });
    expect(barFor(load, DAY).review).toBe(1);
    expect(load.pastAverage).toBe(10);
  });
});

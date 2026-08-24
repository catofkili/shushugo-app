/**
 * 排片器的端到端验证:用**真实词库**(11057 个真词条,真假名)造一个上千词的积压,
 * 跑完整场 getWordSession → submitWordAnswer,再检查整条序列。
 *
 * 合成数据证明不了「音近隔离」——那条规则的输入是真实假名。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import initSqlJs, { type Database } from "sql.js";

let testDb: Database;
let SQL: Awaited<ReturnType<typeof initSqlJs>>;

const prefStore = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (key: string) => prefStore.get(key) ?? null,
  setItem: (key: string, value: string) => { prefStore.set(key, String(value)); },
  removeItem: (key: string) => { prefStore.delete(key); },
  clear: () => prefStore.clear()
};
(globalThis as any).window = {
  dispatchEvent: () => true, addEventListener: () => undefined, removeEventListener: () => undefined
};

vi.mock("./database", () => ({
  getDatabase: () => testDb, initDatabase: async () => testDb,
  exportDatabase: () => null, importDatabase: async () => undefined
}));
vi.mock("./storage", () => ({ scheduleSave: () => undefined, persistSoon: () => undefined }));
vi.mock("./progress-events", () => ({ PROGRESS_UPDATED_EVENT: "test", notifyProgressUpdated: () => undefined }));

import { ensureProgressInitialized, getWordSession, submitWordAnswer } from "./word-api";
import { buildInterferenceIndex, resetInterferenceCache, INTERFERENCE_WINDOW } from "./scheduler/interference";
import { LEECH_DAILY_INTAKE } from "./fsrs-store";
import { LEECH_LAPSE_THRESHOLD } from "./fsrs-scheduler";
import { OPENING_CARDS } from "./scheduler/sequencer";
import { saveStudyPreferences, defaultStudyPreferences } from "./studyPreferences";

const seedPath = fileURLToPath(new URL("../../public/nihongo.db", import.meta.url));

/** 造一个真实形态的积压:1200 个到期词,其中 80 个是顽固词 */
const seedBacklog = () => {
  const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
  testDb.run("DELETE FROM stage1_tasks");
  testDb.run("DELETE FROM reviews");
  testDb.run(`
    UPDATE progress SET
      seen_count = 5,
      known_forever = 0,
      right_count = 3, fuzzy_count = 1, forgot_count = 1,
      fsrs_stability = 3.0 + (word_id % 20),
      fsrs_difficulty = 4.0 + (word_id % 6),
      fsrs_state = 2,
      fsrs_reps = 5,
      fsrs_lapses = CASE WHEN word_id % 15 = 0 THEN 9 ELSE word_id % 3 END,
      fsrs_last_review = ?,
      fsrs_due = ?
    WHERE word_id <= 1200
  `, [daysAgo(30), daysAgo(2)]);
};

beforeEach(async () => {
  SQL = SQL ?? await initSqlJs();
  testDb = new SQL.Database(new Uint8Array(readFileSync(seedPath)));
  prefStore.clear();
  resetInterferenceCache();
  saveStudyPreferences({ ...defaultStudyPreferences, dailyGoal: 1, reviewCap: 120 });
  ensureProgressInitialized();
  seedBacklog();
});

/** 跑 n 张:每张都点「认识」,记录出现顺序 */
const runSession = (cards: number): number[] => {
  const order: number[] = [];
  for (let index = 0; index < cards; index += 1) {
    const card = getWordSession().card;
    if (!card) break;
    order.push(card.id);
    submitWordAnswer(card.id, "know");
  }
  return order;
};

const rowsOf = (sql: string, params: unknown[] = []) => {
  const result = testDb.exec(sql, params as never)[0];
  if (!result) return [] as Record<string, unknown>[];
  return result.values.map((values) => Object.fromEntries(
    result.columns.map((column, index) => [column, values[index]])
  ));
};

describe("真实词库上的整场序列", () => {
  it("开场几张不给顽固词", () => {
    const order = runSession(OPENING_CARDS);
    const leeches = new Set(rowsOf(
      "SELECT word_id FROM progress WHERE COALESCE(fsrs_lapses,0) >= ?",
      [LEECH_LAPSE_THRESHOLD]
    ).map((row) => Number(row.word_id)));
    expect(order.length).toBe(OPENING_CARDS);
    expect(order.filter((id) => leeches.has(id))).toEqual([]);
  });

  it("当日计划里的顽固词不超过每日配额", () => {
    getWordSession(); // 触发当日计划生成
    const planned = rowsOf(`
      SELECT COUNT(*) AS n
      FROM stage1_tasks t JOIN progress p ON p.word_id = t.word_id
      WHERE COALESCE(p.fsrs_lapses, 0) >= ?
    `, [LEECH_LAPSE_THRESHOLD]);
    expect(Number(planned[0]?.n ?? 0)).toBeLessThanOrEqual(LEECH_DAILY_INTAKE);
  });

  // 跑 80 张真卡本来就要四秒多,贴着 5 秒的默认上限;并行跑整套时抢 CPU 会挂。
  it("整场里同一混淆组的词不会挨着出", () => {
    const order = runSession(80);
    expect(order.length).toBe(80);

    const rows = rowsOf(
      `SELECT id, kana, kanji, pos, verb_type FROM words WHERE id IN (${order.join(",")})`
    );
    const interference = buildInterferenceIndex(rows);

    const violations: Array<[number, number]> = [];
    for (let index = 0; index < order.length; index += 1) {
      for (let back = 1; back <= INTERFERENCE_WINDOW && index - back >= 0; back += 1) {
        if (interference.conflicts(order[index], order[index - back])) {
          violations.push([order[index - back], order[index]]);
        }
      }
    }
    expect(violations).toEqual([]);
  }, 20_000);

  it("同一场里不会反复出同一个词(答对即毕业)", () => {
    const order = runSession(80);
    expect(new Set(order).size).toBe(order.length);
  });
});

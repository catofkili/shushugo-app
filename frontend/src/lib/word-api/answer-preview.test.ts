/**
 * 预算下一张（previewNextWordCard 那一套）的两条判据：
 *   1. 预算完库里一个字都不变（它是在 SAVEPOINT 里真的把作答走一遍再回滚）；
 *   2. 预算出的下一张 = 真答完之后正式选卡会选的那一张（随机数用同一串固定种子）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import initSqlJs, { type Database } from "sql.js";

let testDb: Database;
const prefStore = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (key: string) => prefStore.get(key) ?? null,
  setItem: (key: string, value: string) => { prefStore.set(key, String(value)); },
  removeItem: (key: string) => { prefStore.delete(key); },
  clear: () => prefStore.clear()
};
const dispatched: string[] = [];
(globalThis as any).window = { dispatchEvent: (event: Event) => { dispatched.push(event.type); return true; } };

vi.mock("../database", () => ({
  getDatabase: () => testDb,
  initDatabase: async () => testDb,
  exportDatabase: () => null,
  importDatabase: async () => undefined
}));
vi.mock("../storage", () => ({ scheduleSave: () => undefined, requestFullSnapshot: () => undefined }));

import type { WordAnswer } from "../../types/vocabulary";
import {
  addAnswerPreview,
  getWordSession,
  startAnswerPreviews,
  submitWordAnswer,
  submitWordAnswerWithPreview,
  takeAnswerPreview
} from "../word-api";
import { ensureProgressInitialized } from "./bootstrap";
import { ensureFsrsColumns, WORD_FSRS } from "../fsrs-store";

// mulberry32：预算和真答各自从同一个种子起跑，消耗的随机数序列一模一样
let seed = 1;
const reseed = (value: number) => { seed = value; };
const seeded = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const one = (sql: string) => {
  const result = testDb.exec(sql)[0];
  return result?.values?.[0]?.[0] ?? null;
};
// 预算会碰到的所有表：进度、流水、当天任务、会话状态（当前卡 / 排队 / 撤销栈都在 app_state）、墓碑
const fingerprint = () => JSON.stringify([
  one("SELECT COUNT(*) || ':' || COALESCE(MAX(id), 0) FROM reviews"),
  one("SELECT group_concat(word_id || ',' || seen_count || ',' || known_forever || ',' || COALESCE(fsrs_due, '') || ',' || mistake_streak, ';') FROM progress WHERE seen_count > 0 OR fsrs_due IS NOT NULL"),
  one("SELECT group_concat(key || '=' || value, ';') FROM (SELECT key, value FROM app_state ORDER BY key)"),
  one("SELECT COUNT(*) FROM stage1_tasks"),
  one("SELECT COUNT(*) FROM sync_tombstones")
]);

beforeEach(async () => {
  const SQL = await initSqlJs();
  testDb = new SQL.Database(new Uint8Array(readFileSync(fileURLToPath(new URL("../../../public/nihongo.db", import.meta.url)))));
  prefStore.clear();
  prefStore.set("mn-study-preferences", JSON.stringify({ dailyGoal: 15 }));
  ensureProgressInitialized();
  ensureFsrsColumns(WORD_FSRS);
  // 堆一批今天到期的复习，让复习道、新词道、重刷排队都有东西
  testDb.run(`
    UPDATE progress
    SET known_forever = 0, seen_count = 5, fsrs_stability = 2, fsrs_difficulty = 5,
        fsrs_due = '2026-01-01T00:00:00.000Z', fsrs_last_review = '2025-12-30T00:00:00.000Z',
        fsrs_state = 2, fsrs_steps = 0, fsrs_reps = 5, fsrs_lapses = 0
    WHERE word_id IN (SELECT word_id FROM progress ORDER BY word_id LIMIT 60)
  `);
  vi.spyOn(Math, "random").mockImplementation(seeded);
});
afterEach(() => { vi.restoreAllMocks(); });

describe("预算下一张", () => {
  it("预算不改库；预算的下一张就是真答完选出的那一张", () => {
    reseed(7);
    let session = getWordSession({});
    const answers: WordAnswer[] = ["know", "forgot", "know", "fuzzy", "know", "known_forever", "forgot", "know"];
    let matched = 0;
    for (let step = 0; step < 30 && session.card; step += 1) {
      const wordId = session.card.id;
      const previews = startAnswerPreviews(wordId);
      const before = fingerprint();
      dispatched.length = 0;
      for (const [index, answer] of (["know", "forgot"] as const).entries()) {
        reseed(1000 + step * 10 + index);
        addAnswerPreview(previews, answer, {}, true);
      }
      expect(fingerprint(), `step ${step}: 预算之后库变了`).toBe(before);
      expect(dispatched, "预算期间不许派发进度事件（监听者会读到回滚前的假状态）").toEqual([]);

      const answer = answers[step % answers.length];
      const preview = takeAnswerPreview(previews, wordId, answer);
      const exact = answer === "know" || answer === "forgot";
      if (exact) expect(preview, `step ${step}: ${answer} 应当有预算`).not.toBeNull();
      // 真答：从预算这种答法时同一个种子起跑
      reseed(1000 + step * 10 + (answer === "know" || answer === "known_forever" ? 0 : 1));
      if (preview && (!exact || step % 2 === 0)) {
        session = submitWordAnswerWithPreview(wordId, answer, preview, {});
        expect(session.card?.id).toBe(preview.card?.id);
        expect(one("SELECT value FROM app_state WHERE key = 'current_card'")).toBe(String(preview.card?.id));
        // 借同类答法那份（模糊借忘记、熟知借认识）：两种答法之后候选池只差当前这张，抽的是同一个分布，
        // 但随机数消耗不同（比如模糊直接毕业、少排一次重刷），不要求和另一次抽签撞上同一张——只要求它真答完之后仍是合法候选。
        expect(preview.card?.id).not.toBe(wordId);
        expect(one(`SELECT COUNT(*) FROM stage1_tasks t JOIN progress p ON p.word_id = t.word_id
          WHERE t.word_id = ${preview.card?.id} AND p.known_forever = 0 AND (p.fsrs_due IS NULL OR p.fsrs_due <= '9999')`)).toBe(1);
      } else {
        session = submitWordAnswer(wordId, answer, {});
        if (preview) expect(session.card?.id, `step ${step}: ${answer} 预算和真选不一致`).toBe(preview.card?.id);
      }
      if (preview) matched += 1;
    }
    expect(matched).toBeGreaterThan(15);
  });

  it("预算之后库里有别的写入，预算就作废", () => {
    reseed(3);
    const session = getWordSession({});
    const previews = startAnswerPreviews(session.card!.id);
    addAnswerPreview(previews, "know", {});
    expect(takeAnswerPreview(previews, session.card!.id, "know")).not.toBeNull();
    expect(takeAnswerPreview(previews, session.card!.id + 1, "know"), "别的卡不能用").toBeNull();
    testDb.run("INSERT OR REPLACE INTO app_state (key, value) VALUES ('unrelated', '1')");
    expect(takeAnswerPreview(previews, session.card!.id, "know")).toBeNull();
  });
});

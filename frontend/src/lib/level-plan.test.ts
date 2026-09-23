import { beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import initSqlJs, { type Database } from "sql.js";

const store = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => store.set(key, String(value)), removeItem: (key: string) => store.delete(key) };
(globalThis as any).window = { dispatchEvent: () => true, addEventListener: () => undefined, removeEventListener: () => undefined };
let testDb: Database;
vi.mock("./database", () => ({ getDatabase: () => testDb, initDatabase: async () => testDb, exportDatabase: () => null, importDatabase: async () => undefined }));
vi.mock("./storage", () => ({ requestFullSnapshot: vi.fn(), scheduleSave: vi.fn() }));

import { ensureUserTables } from "./study-core";
import { applyLevelStartingPoint, effectiveStartingLevel, getLevelPlanSettings, hydrateLevelPlanPreferences, recalibrateLevelStartingPoint, saveLevelPlanSettings, stabilityFor } from "./level-plan";
import { setState } from "./database/db-utils";
import { getStudyPreferences } from "./studyPreferences";
import { examPreset } from "./daily-plan";
import { recordKanjiCharReview, replayKanjiCharReviews, undoLastKanjiCharReview } from "./kanji-char-cards";
import { getProgressOverview } from "./progress-api";

const one = (sql: string, params: Array<string | number> = []) => testDb.exec(sql, params)[0]?.values?.[0]?.[0];

describe("起点水平计划", () => {
  beforeAll(async () => {
    const SQL = await initSqlJs();
    testDb = new SQL.Database(new Uint8Array(readFileSync(fileURLToPath(new URL("../../public/nihongo.db", import.meta.url)))));
    ensureUserTables();
    await saveLevelPlanSettings({
      startingLevel: "N4",
      familiarity: { words: 75, grammar: 75, kanji: 75, confusion: 75 },
      target: "N3",
      examDate: "2026-12-06",
      startedOn: "2026-09-22"
    });
  });

  it("写入可识别的基线，不伪造真实作答，且到期日被摊开", () => {
    expect(Number(one("SELECT COUNT(*) FROM level_prior_baselines WHERE entity='words'"))).toBeGreaterThan(1000);
    expect(Number(one("SELECT COUNT(*) FROM reviews"))).toBe(0);
    expect(Number(one("SELECT COUNT(DISTINCT substr(due,1,10)) FROM level_prior_baselines WHERE entity='words'"))).toBeGreaterThan(14);
    expect(Number(one("SELECT COUNT(*) FROM level_prior_baselines WHERE entity='words' AND starting_level='N4' AND familiarity=75"))).toBeGreaterThan(0);
    const overview = getProgressOverview();
    expect(overview.words.seen).toBe(0);
    expect(overview.grammar.reduce((sum, row) => sum + row.seen, 0)).toBe(0);
    expect(examPreset("N3").remaining.words).toBe(2144);
  });

  it("重新保存完全相同的设定不会重置备考窗口", async () => {
    const before = getLevelPlanSettings()!;
    const saved = await saveLevelPlanSettings({
      startingLevel: before.startingLevel,
      familiarity: before.familiarity,
      target: before.target,
      examDate: before.examDate
    });
    expect(saved.startedOn).toBe("2026-09-22");
    expect(getLevelPlanSettings()?.startedOn).toBe("2026-09-22");
  });

  it("相同设置重跑稳定，真实答过的行不被起点重写", async () => {
    const wordId = Number(one("SELECT entity_key FROM level_prior_baselines WHERE entity='words' LIMIT 1"));
    testDb.run("INSERT INTO reviews (word_id, answer, score_after, reviewed_on) VALUES (?, 'know', 1, '2026-09-22')", [wordId]);
    testDb.run("UPDATE progress SET fsrs_stability=123 WHERE word_id=?", [wordId]);
    await applyLevelStartingPoint(getLevelPlanSettings()!, new Date("2026-09-22T12:00:00Z"));
    expect(Number(one("SELECT fsrs_stability FROM progress WHERE word_id=?", [wordId]))).toBe(123);
    expect(Number(one("SELECT COUNT(*) FROM level_prior_baselines WHERE entity='words' AND entity_key=?", [wordId]))).toBe(1);
  });

  it("汉字流水重放和撤销都回到自报基线，而不是全新卡", () => {
    const char = String(one("SELECT entity_key FROM level_prior_baselines WHERE entity='kanji' LIMIT 1"));
    const baseline = Number(one("SELECT stability FROM level_prior_baselines WHERE entity='kanji' AND entity_key=?", [char]));
    const yesterday = new Date(Date.now() - 86_400_000).toISOString();
    testDb.run("UPDATE level_prior_baselines SET due=? WHERE entity='kanji' AND entity_key=?", [yesterday, char]);
    testDb.run("UPDATE kanji_char_memory SET fsrs_due=? WHERE char=?", [yesterday, char]);
    recordKanjiCharReview(char, "fuzzy", new Date());
    const after = Number(one("SELECT fsrs_stability FROM kanji_char_memory WHERE char=?", [char]));
    testDb.run("UPDATE kanji_char_memory SET fsrs_stability=NULL WHERE char=?", [char]);
    replayKanjiCharReviews([char]);
    expect(Number(one("SELECT fsrs_stability FROM kanji_char_memory WHERE char=?", [char]))).toBeCloseTo(after, 6);
    expect(undoLastKanjiCharReview()).toBe(char);
    expect(Number(one("SELECT fsrs_stability FROM kanji_char_memory WHERE char=?", [char]))).toBeCloseTo(baseline, 6);
    expect(Number(one("SELECT seen_count FROM kanji_char_memory WHERE char=?", [char]))).toBe(1);
  });

  it("计划锚点来自可同步 SQLite，并能恢复本机显示偏好", () => {
    store.clear();
    hydrateLevelPlanPreferences();
    expect(getStudyPreferences().jlptTarget).toBe("N3");
    expect(getStudyPreferences().jlptExamDate).toBe("2026-12-06");
    expect(stabilityFor(75)).toBe(30);
  });

  it("满两周且同级首次作答够 50 道才调整未答卡的起点", async () => {
    const now = new Date();
    const old = new Date(now.getTime() - 20 * 86_400_000);
    setState("jlpt_plan_started_on", `${old.getFullYear()}-${String(old.getMonth() + 1).padStart(2, "0")}-${String(old.getDate()).padStart(2, "0")}`);
    const reviewedOn = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const ids = testDb.exec("SELECT p.word_id FROM progress p JOIN words w ON w.id=p.word_id WHERE w.jlpt_level='N3' AND p.seen_count=0 LIMIT 50")[0].values.map(([id]) => Number(id));
    expect(ids).toHaveLength(50);
    for (const id of ids.slice(0, 49)) testDb.run("INSERT INTO reviews (word_id,answer,score_after,reviewed_on,direction) VALUES (?, 'know', 1, ?, 'forward')", [id, reviewedOn]);
    expect(effectiveStartingLevel(now)).toBe("N4");
    testDb.run("INSERT INTO reviews (word_id,answer,score_after,reviewed_on,direction) VALUES (?, 'know', 1, ?, 'forward')", [ids[49], reviewedOn]);
    expect(effectiveStartingLevel(now)).toBe("N3");
    expect(await recalibrateLevelStartingPoint(now)).toBe(true);
    expect(await recalibrateLevelStartingPoint(now)).toBe(false);
    expect(getLevelPlanSettings()?.startingLevel).toBe("N4");
    expect(Number(one("SELECT COUNT(*) FROM level_prior_baselines b JOIN progress p ON p.word_id=CAST(b.entity_key AS INTEGER) JOIN words w ON w.id=p.word_id WHERE b.entity='words' AND w.jlpt_level='N3'"))).toBeGreaterThan(0);
    expect(Number(one("SELECT COUNT(*) FROM level_prior_baselines WHERE entity='words' AND entity_key=?", [ids[0]]))).toBe(0);
  });
});

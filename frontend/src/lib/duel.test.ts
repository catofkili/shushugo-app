import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import initSqlJs, { type Database } from "sql.js";

let db: Database;
let SQL: Awaited<ReturnType<typeof initSqlJs>>;
vi.mock("./database", () => ({ getDatabase: () => db }));
vi.mock("./storage", () => ({ scheduleSave: () => undefined, requestFullSnapshot: () => undefined }));
import { buildDuelQuestions, duelDuration, ensureDuelToken, readDuelToken } from "./duel";
import { duelIdFromUrl, duelSharePath } from "./duel-links";

beforeEach(async () => {
  SQL = SQL ?? await initSqlJs();
  db = new SQL.Database();
  db.run("CREATE TABLE words (id INTEGER PRIMARY KEY, kanji TEXT, kana TEXT, meaning TEXT, jlpt_level TEXT, pos TEXT); CREATE TABLE app_state (key TEXT PRIMARY KEY, value TEXT);");
  db.run("INSERT INTO app_state VALUES ('vocab_test_session_v1', 'previous-vocab-run')");
  for (const [index, level] of ["N5", "N4", "N3", "N2", "N1"].entries()) {
    for (let i = 0; i < 35; i++) db.run("INSERT INTO words VALUES (?, ?, ?, ?, ?, '名词')", [index * 100 + i + 1, `${level}漢字${i}`, `${level.toLowerCase()}かな${i}`, `${level} meaning ${i}`, level]);
  }
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) });
});
afterEach(() => { db.close(); vi.unstubAllGlobals(); });

describe("duel client", () => {
  it("builds the requested full snapshot from selected levels only", () => {
    const questions = buildDuelQuestions(["N3", "N2"], 20, () => 0.25);
    expect(questions).toHaveLength(20);
    expect(new Set(questions.map((question) => question.level))).toEqual(new Set(["N3", "N2"]));
    expect(new Set(questions.map((question) => question.id)).size).toBe(20);
    for (const question of questions) {
      expect(question.options).toHaveLength(4);
      expect(question.options[question.answerIndex]).toBe(question.answer);
      expect(question.limitMs).toBe(question.kind === "reading" ? 15000 : 10000);
    }
  });
  it("does not change the vocabulary-test session or write any database state", () => {
    const before = db.export();
    buildDuelQuestions(["N5"], 10, () => 0.25);
    expect(db.export()).toEqual(before);
  });
  it("rejects unsupported question counts and empty/duplicate levels", () => {
    expect(() => buildDuelQuestions([], 10)).toThrow();
    expect(() => buildDuelQuestions(["N3", "N3"], 10)).toThrow();
    expect(() => buildDuelQuestions(["N3"], 15)).toThrow();
  });
  it("keeps a random claim token only on this device and reuses it", () => {
    expect(readDuelToken("duel-1")).toBeUndefined();
    const token = ensureDuelToken("duel-1");
    expect(token).toMatch(/^[a-zA-Z0-9_-]{32,128}$/);
    expect(ensureDuelToken("duel-1")).toBe(token);
    expect(ensureDuelToken("duel-2")).not.toBe(token);
  });
  it("refuses to start anonymously if the token cannot be stored", () => {
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => { throw new Error("blocked"); } });
    expect(() => ensureDuelToken("duel-1")).toThrow("无法保存应战凭据");
  });
  it("recognizes the public deep link without treating unrelated IDs as duels", () => {
    expect(duelSharePath("abc-123")).toBe("/study/duel/index?id=abc-123");
    expect(duelIdFromUrl("https://app.test/study/duel/index?id=abc-123")).toBe("abc-123");
    expect(duelIdFromUrl("https://app.test/?page=duel&id=abc-123")).toBe("abc-123");
    expect(duelIdFromUrl("https://app.test/?id=abc-123")).toBeNull();
    expect(duelIdFromUrl("https://app.test/study/duel/index?id=<script>")).toBeNull();
  });
  it("formats the challenge's active duration", () => { expect(duelDuration(92500)).toBe("1:32"); });
});

import { rowsFor } from "./database/db-utils";
import { buildVocabTestQuestions, secondsForQuestion, VOCAB_TEST_LEVELS, type VocabTestWordRow } from "./vocab-test";
import type { CloudDuel } from "./sync-api";
import type { DuelQuestion } from "./team-rules";

export const buildDuelQuestions = (levels: string[], count: number, random = Math.random): DuelQuestion[] => {
  if (!levels.length || new Set(levels).size !== levels.length || levels.some((level) => !VOCAB_TEST_LEVELS.includes(level as typeof VOCAB_TEST_LEVELS[number]))
    || ![10, 20, 30].includes(count)) throw new Error("请选择级别和题数。");
  const rows: VocabTestWordRow[] = rowsFor(`SELECT id, kanji, kana, meaning, jlpt_level AS level, pos FROM words
    WHERE jlpt_level IN (${levels.map(() => "?").join(", ")}) AND TRIM(COALESCE(meaning, '')) <> '' AND TRIM(COALESCE(kana, '')) <> ''`, levels)
    .map((row) => ({ id: Number(row.id), kanji: String(row.kanji ?? ""), kana: String(row.kana), meaning: String(row.meaning), level: String(row.level), pos: String(row.pos ?? "") }));
  const targets = Object.fromEntries(levels.map((level, index) => [level, Math.floor(count / levels.length) + (index < count % levels.length ? 1 : 0)]));
  const { questions } = buildVocabTestQuestions(rows, random, { targets, total: count });
  if (questions.length !== count) throw new Error("这些级别的题目不足，换个级别再试。");
  return questions.map((question) => ({ ...question, limitMs: secondsForQuestion(question) * 1000 }));
};

const tokenKey = (id: string) => `mn-duel-token:${id}`;
export const readDuelToken = (id: string): string | undefined => {
  try {
    const token = localStorage.getItem(tokenKey(id));
    return token && /^[a-zA-Z0-9_-]{32,128}$/.test(token) ? token : undefined;
  } catch { return undefined; }
};

/** 先落在答题设备，再开始答题；它不进入学习数据库或云同步。 */
export const ensureDuelToken = (id: string): string => {
  const saved = readDuelToken(id);
  if (saved) return saved;
  const token = crypto.randomUUID().replace(/-/g, "");
  try {
    localStorage.setItem(tokenKey(id), token);
    if (localStorage.getItem(tokenKey(id)) !== token) throw new Error();
  } catch { throw new Error("无法保存应战凭据，请允许本机存储后再试。"); }
  return token;
};

export const duelDuration = (ms: number): string => {
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};

export const duelShareTitle = (duel: CloudDuel): string => `${duel.creatorName} 向你发起挑战 · ${duel.levels.join(" / ")} · ${duel.questionCount} 题 · 答对 ${duel.creatorScore.correct}，用时 ${duelDuration(duel.creatorScore.totalMs)}`;

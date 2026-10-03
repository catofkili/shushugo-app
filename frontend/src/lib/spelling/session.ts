/**
 * 会话层：把 forms / check / grade / store 接成「出一张卡 → 判一次输入 → 结算一轮」。
 * UI 只和这里说话（经 index.ts）。依赖词库、题面口径和 FSRS 存储，所以是最后一层。
 */
import { moraCount } from "../../features/word-study/word-study-utils";
import { getDatabase } from "../database";
import { rowsFor } from "../database/db-utils";
import { displayedPromptPeers } from "../models/question-meaning-index";
import { questionMeaning } from "../models/word-card";
import { preferredWordSurface } from "../orthography";
import { today } from "../study-core";
import type { WordAnswer } from "../../types/vocabulary";
import { checkSpelling } from "./check";
import { spellingClozeForWordId } from "./modes";
import { spellingTargetForWord } from "./forms";
import { gradeRound, REVEAL_HINT_LEVEL, roundOutcome } from "./grade";
import { ensureSpellingTables, recordSpellingAnswer, undoLastSpelling } from "./store";
import type { SpellingCard, SpellingLookup, SpellingMode, SpellingRound, SpellingVerdict } from "./types";

const wordRow = (wordId: number) =>
  rowsFor("SELECT id, kanji, kana, meaning, pos, jlpt_level FROM words WHERE id = ?", [wordId])[0];

const hit = (row: Record<string, unknown>) => {
  const word = { kanji: String(row.kanji ?? ""), kana: String(row.kana ?? "") };
  return { wordId: Number(row.id), surface: preferredWordSurface(word), kana: word.kana, meaning: questionMeaning(String(row.meaning ?? ""), word.kanji, word.kana, Number(row.id)) };
};

export const spellingCard = (wordId: number, mode: SpellingMode = "meaning"): SpellingCard | null => {
  const row = wordRow(wordId);
  if (!row) return null;
  const kanji = String(row.kanji ?? "");
  const kana = String(row.kana ?? "");
  const cloze = mode === "cloze" ? spellingClozeForWordId(wordId) : null;
  if (mode === "cloze" && !cloze) throw new Error("这个词没有可用的挖空例句");
  const target = cloze?.target ?? spellingTargetForWord({ id: wordId, kanji, kana });
  return {
    wordId,
    meaning: questionMeaning(String(row.meaning ?? ""), kanji, kana, wordId),
    pos: String(row.pos ?? ""),
    moraCount: moraCount(target.kana),
    jlptLevel: String(row.jlpt_level ?? ""),
    mode,
    ...(cloze ? { cloze: cloze.cloze } : {}),
    target
  };
};

/** 同音词 / 同题面词要查词库；每张卡建一次，peers 惰性算。 */
export const spellingLookup = (wordId: number): SpellingLookup => ({
  bySurface: (surface) => rowsFor(
    "SELECT id, kanji, kana, meaning FROM words WHERE kanji = ? OR kanji LIKE ? LIMIT 6", [surface, `${surface}[%`]
  ).map(hit),
  peers: () => {
    const ids = displayedPromptPeers(wordId);
    if (!ids.length) return [];
    return rowsFor(`SELECT id, kanji, kana, meaning FROM words WHERE id IN (${ids.map(() => "?").join(",")})`, ids).map(hit);
  }
});

export const checkCardInput = (card: SpellingCard, input: string, lookup = spellingLookup(card.wordId)): SpellingVerdict => {
  const verdict = checkSpelling(card.target, input, lookup);
  return card.mode === "audio" && !verdict.correct && verdict.problems.some((problem) => problem.code === "homophone")
    ? { ...verdict, nearMiss: true }
    : verdict;
};

/** 结算一轮：评分 → 写 FSRS 和流水。轮没结束会抛错（gradeRound）。返回这一轮的评分。 */
export const recordSpellingRound = (wordId: number, round: SpellingRound, now = new Date()): WordAnswer => {
  const answer = gradeRound(round);
  const outcome = roundOutcome(round);
  const { tries } = outcome;
  const last = round.attempts[round.attempts.length - 1];
  recordSpellingAnswer(wordId, answer, {
    typed: last?.typed ?? "",
    form: last?.verdict.form ?? "empty",
    hints: round.hintsUsed,
    tries,
    ms: Math.max(0, Math.round(round.elapsedMs)),
    problem: round.gaveUp ? "gave_up" : last && !last.verdict.correct ? (last.verdict.problems[0]?.code ?? "") : "",
    override: outcome.overridden ? round.override : "",
    mode: round.mode ?? "meaning"
  }, now);
  return answer;
};

/** 改已结算的裁决；只允许撤回本学习日最后一条拼写流水，避免撤掉另一张卡。 */
export const amendSpellingRound = (wordId: number, round: SpellingRound, now = new Date()): void => {
  const outcome = roundOutcome(round);
  if (round.override && (!outcome.overridden || (round.override === "correct" && round.hintsUsed >= REVEAL_HINT_LEVEL))) {
    throw new Error("这次裁决不适用");
  }

  ensureSpellingTables();
  const db = getDatabase();
  db.run("SAVEPOINT amend_spelling_round");
  try {
    const latest = rowsFor(`
      SELECT word_id FROM spelling_reviews
      WHERE reviewed_on = ?
      ORDER BY reviewed_at DESC, id DESC
      LIMIT 1
    `, [today()])[0];
    if (Number(latest?.word_id) !== wordId) throw new Error("这张卡已不是最后一条拼写记录");

    if (undoLastSpelling() !== wordId) throw new Error("没有可撤销的拼写记录");
    // 第一次错答时可先裁决为对；改回后这一轮还没结束，撤掉旧结算，等用户继续作答。
    if (outcome.done) recordSpellingRound(wordId, round, now);
    db.run("RELEASE amend_spelling_round");
  } catch (error) {
    db.run("ROLLBACK TO amend_spelling_round");
    db.run("RELEASE amend_spelling_round");
    throw error;
  }
};

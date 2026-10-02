/**
 * 会话层：把 forms / check / grade / store 接成「出一张卡 → 判一次输入 → 结算一轮」。
 * UI 只和这里说话（经 index.ts）。依赖词库、题面口径和 FSRS 存储，所以是最后一层。
 */
import { moraCount } from "../../features/word-study/word-study-utils";
import { rowsFor } from "../database/db-utils";
import { displayedPromptPeers } from "../models/question-meaning-index";
import { questionMeaning } from "../models/word-card";
import { preferredWordSurface } from "../orthography";
import type { WordAnswer } from "../../types/vocabulary";
import { checkSpelling } from "./check";
import { spellingTargetForWord } from "./forms";
import { gradeRound, roundOutcome } from "./grade";
import { recordSpellingAnswer } from "./store";
import type { SpellingCard, SpellingLookup, SpellingRound, SpellingVerdict } from "./types";

const wordRow = (wordId: number) =>
  rowsFor("SELECT id, kanji, kana, meaning, pos, jlpt_level FROM words WHERE id = ?", [wordId])[0];

const hit = (row: Record<string, unknown>) => {
  const word = { kanji: String(row.kanji ?? ""), kana: String(row.kana ?? "") };
  return { wordId: Number(row.id), surface: preferredWordSurface(word), kana: word.kana, meaning: questionMeaning(String(row.meaning ?? ""), word.kanji, word.kana, Number(row.id)) };
};

export const spellingCard = (wordId: number): SpellingCard | null => {
  const row = wordRow(wordId);
  if (!row) return null;
  const kanji = String(row.kanji ?? "");
  const kana = String(row.kana ?? "");
  const target = spellingTargetForWord({ id: wordId, kanji, kana });
  return {
    wordId,
    meaning: questionMeaning(String(row.meaning ?? ""), kanji, kana, wordId),
    pos: String(row.pos ?? ""),
    moraCount: moraCount(target.kana),
    jlptLevel: String(row.jlpt_level ?? ""),
    mode: "meaning",
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

export const checkCardInput = (card: SpellingCard, input: string, lookup = spellingLookup(card.wordId)): SpellingVerdict =>
  checkSpelling(card.target, input, lookup);

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
    override: outcome.overridden ? round.override : ""
  }, now);
  return answer;
};

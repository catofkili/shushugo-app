/**
 * 会话层：把 forms / check / grade / store 接成「出一张卡 → 判一次输入 → 结算一轮」。
 * UI 只和这里说话（经 index.ts）。依赖词库、题面口径和 FSRS 存储，所以是最后一层。
 */
import { moraCount } from "../../features/word-study/word-study-utils";
import { rowsFor } from "../database/db-utils";
import { displayedPromptPeers } from "../models/question-meaning-index";
import { questionMeaning } from "../models/word-card";
import { preferredWordSurface } from "../orthography";
import { checkSpelling } from "./check";
import { spellingClozeForWordId } from "./modes";
import { spellingTargetForWord } from "./forms";
import { recordSpellingAnswer } from "./store";
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

export const checkCardInput = (card: SpellingCard, input: string, lookup = spellingLookup(card.wordId)): SpellingVerdict =>
  checkSpelling(card.target, input, lookup);

/** 结算一轮：评分是用户选的档位，引擎判定只进流水。 */
export const recordSpellingRound = (
  wordId: number, round: SpellingRound, source: "page" | "inline" = "page", now = new Date()
): void => {
  recordSpellingAnswer(wordId, round.grade, {
    typed: round.typed,
    form: round.verdict?.form ?? "empty",
    hints: round.hintsUsed,
    ms: Math.max(0, Math.round(round.elapsedMs)),
    // 引擎认为哪里不对（诊断用，界面不显示）；没写、或引擎认为写对了是 ''。
    problem: round.verdict && !round.verdict.correct ? (round.verdict.problems[0]?.code ?? "") : "",
    mode: round.mode ?? "meaning",
    source
  }, now);
};

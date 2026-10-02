/**
 * 一轮拼写 → FSRS 的一次评分（docs/SPELLING_SPEC.md §3）。
 * 形式（罗马音 / 假名 / 汉字）不参与评分，只在流水里记录；评分只看「几次提交对的、用没用提示、有没有放弃」。
 */
import type { WordAnswer } from "../../types/vocabulary";
import type { SpellingRound } from "./types";

/** 一轮最多几次有效提交。nearMiss 的那一次也算一次，所以「差一点」的改写机会就是第二次。 */
export const MAX_TRIES = 2;

/** 提示的最高一级 = 揭晓书写（规格 §4）：到这一级再答对也算没记住。 */
export const REVEAL_HINT_LEVEL = 3;

export interface RoundOutcome {
  /** 这一轮是否已经结束（对了、放弃、或次数用完）。没结束时 UI 继续让用户答。 */
  done: boolean;
  /** done 时才有。 */
  answer: WordAnswer | null;
  /** 还能再提交几次（done 时为 0）。 */
  triesLeft: number;
  /** 有效提交次数（peer_word 不算）。 */
  tries: number;
}

/**
 * 写成了「题面完全相同的另一个词」不算一次提交：用户没答错，是题面本来就有两个答案，
 * 让他再写一次。每轮只豁免第一次——否则可以靠连写同义词无限拖下去。
 */
const countedAttempts = (round: SpellingRound) => {
  let peerForgiven = false;
  return round.attempts.filter((attempt) => {
    const isPeer = !attempt.verdict.correct && attempt.verdict.problems[0]?.code === "peer_word";
    if (isPeer && !peerForgiven) { peerForgiven = true; return false; }
    return true;
  });
};

export const roundOutcome = (round: SpellingRound, maxTries = MAX_TRIES): RoundOutcome => {
  const counted = countedAttempts(round);
  const tries = counted.length;
  const firstCorrect = counted.findIndex((attempt) => attempt.verdict.correct);
  if (firstCorrect >= 0) {
    const revealed = round.hintsUsed >= REVEAL_HINT_LEVEL;
    const answer: WordAnswer = revealed ? "forgot" : firstCorrect === 0 && round.hintsUsed === 0 ? "know" : "fuzzy";
    return { done: true, answer, triesLeft: 0, tries: firstCorrect + 1 };
  }
  if (round.gaveUp || tries >= maxTries) return { done: true, answer: "forgot", triesLeft: 0, tries };
  return { done: false, answer: null, triesLeft: maxTries - tries, tries };
};

/** 结束了的一轮的评分；没结束就抛错，免得调用方把「还在答」当成 forgot 写进流水。 */
export const gradeRound = (round: SpellingRound, maxTries = MAX_TRIES): WordAnswer => {
  const outcome = roundOutcome(round, maxTries);
  if (!outcome.done || !outcome.answer) throw new Error("拼写这一轮还没结束，不能评分");
  return outcome.answer;
};

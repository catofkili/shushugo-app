// 单词拼写（实验功能）的唯一入口。允许引用本目录的页面和功能目录由 isolation.test.ts 钉住。
// 规格见 docs/SPELLING_SPEC.md；页面（pages/SpellingPage、features/spelling）只从这里取。

export * from "./types";

/** 小程序 check:release 和 iOS 发版脚本认这个指纹；页面里要用到它，免得被摇掉。 */
export const SPELLING_MARKER = "__SHUSHUGO_EXP_SPELLING__";

export { classifyInput, splitMoras } from "./kana";
export { kanaToRomaji, matchRomaji } from "./romaji";
export { spellingTargetForWord } from "./forms";
export { checkSpelling } from "./check";
export { gradeRound, roundOutcome, MAX_TRIES, REVEAL_HINT_LEVEL, type RoundOutcome } from "./grade";
export { spellingHints, type SpellingHint } from "./hints";
export { problemMessage, problemLabel } from "./messages";
export { spellingLookup, checkCardInput, recordSpellingRound } from "./session";
export {
  ensureSpellingTables, seedSpellingCards, createSpellingTasks, pickSpellingNext, spellingProgress,
  undoLastSpelling, clearSpellingTasks, lastEncounterToday, seedSpellingCardFor,
  spellingDoneToday, spellingInlineToday, recordSpellingAnswer
} from "./store";

export { getSpellingPrefs, saveSpellingPrefs, DEFAULT_SPELLING_PREFS, SPELLING_PREFS_EVENT, type SpellingPrefs } from "./prefs";
export { spellingErrorStats } from "./stats";
export { inlineSpellingDecision, askedToday, markAskedToday } from "./inline";

// B1 / B2 合并时丢弃以下临时桩，换成它们的真实导出。
import { spellingCard as meaningCard } from "./session";
import type { SpellingMode, SpellingRound } from "./types";
export const spellingCard = (wordId: number, _mode: SpellingMode = "meaning") => meaningCard(wordId);
export const chooseSpellingMode = (
  _wordId: number, _prefs: { modes: SpellingMode[]; modeStrategy: "random" | "rotate" },
  _available?: SpellingMode[], _rng?: () => number
): SpellingMode => "meaning";
export const availableSpellingModes = (_wordId: number): SpellingMode[] => ["meaning"];
export const spellingOverrideStats = (_days = 14): { toCorrect: number; toWrong: number } => ({ toCorrect: 0, toWrong: 0 });
export const amendSpellingRound = (_wordId: number, _round: SpellingRound): void => {
  throw new Error("待合并 B1 的 amendSpellingRound");
};

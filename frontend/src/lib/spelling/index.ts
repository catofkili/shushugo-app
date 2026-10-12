// 单词拼写引擎；学习卡面复用判定和标红，作答记账由 word-api 负责。
// 规格见 docs/SPELLING_SPEC.md 的 2026-10-12 落地方式。

export * from "./types";

export { classifyInput, splitMoras } from "./kana";
export { kanaToRomaji, matchRomaji } from "./romaji";
export { spellingTargetForWord } from "./forms";
export { checkSpelling } from "./check";
export { markDifferences, type MarkedText, type SpellingDiff } from "./diff";
export { spellingHints, type SpellingHint } from "./hints";
export { clozeFor, type ClozeWord } from "./cloze";
export { availableSpellingModes, chooseSpellingMode } from "./modes";
export { spellingCard, spellingLookup, checkCardInput, recordSpellingRound } from "./session";
export {
  ensureSpellingTables, seedSpellingCards, createSpellingTasks, pickSpellingNext, spellingProgress,
  undoLastSpelling, clearSpellingTasks, lastEncounterToday, seedSpellingCardFor,
  spellingDoneToday, spellingInlineToday, recordSpellingAnswer
} from "./store";

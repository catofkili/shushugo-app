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
export { clozeFor, type ClozeWord } from "./cloze";
export { availableSpellingModes, chooseSpellingMode } from "./modes";
export { problemMessage } from "./messages";
export { spellingCard, spellingLookup, checkCardInput, recordSpellingRound } from "./session";
export {
  ensureSpellingTables, seedSpellingCards, createSpellingTasks, pickSpellingNext, spellingProgress,
  undoLastSpelling, clearSpellingTasks, lastEncounterToday
} from "./store";

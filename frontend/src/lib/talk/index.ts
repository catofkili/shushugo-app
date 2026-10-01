export const TALK_MARKER = "__SHUSHUGO_EXP_TALK__";

export { loadTalkContent, talkContentLoaded, talkContent, talkFurigana } from "./content";
export type { TalkContent, TalkFormula, TalkScene, TalkFiller } from "./content";
export { allCardKeys, sceneSessionKeys, talkCard } from "./cards";
export type { TalkCard, TalkHintLevel, TalkCardOptions } from "./cards";
export {
  ensureTalkTables,
  materializeTalkCards,
  canUndoTalk,
  talkEverAnswered,
  talkSceneSets,
  talkDueKeys,
  answerForHints,
  recordTalkAnswer,
  undoLastTalkAnswer,
  replayTalkReviews
} from "./schedule";

export { createTalkSession, advanceTalkSession, talkSessionProgress } from "./session";
export type { TalkSession } from "./session";

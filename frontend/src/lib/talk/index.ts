export const TALK_MARKER = "__SHUSHUGO_EXP_TALK__";

export { loadTalkContent, talkContentLoaded, talkContent, talkFurigana } from "./content";
export type { TalkContent, TalkFormula, TalkScene, TalkFiller } from "./content";
export { allCardKeys, newCardOrder, talkCard } from "./cards";
export type { TalkCard, TalkHintLevel, TalkCardOptions } from "./cards";
export {
  TALK_NEW_PER_DAY,
  ensureTalkTables,
  materializeTalkCards,
  createTalkTasks,
  canUndoTalk,
  talkEverAnswered,
  talkSceneCollection,
  canExtendTalkTasks,
  extendTalkTasks,
  pickTalkNext,
  talkProgress,
  answerForHints,
  recordTalkAnswer,
  undoLastTalkAnswer,
  replayTalkReviews
} from "./schedule";

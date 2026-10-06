import type { SpellingRound, SpellingVerdict } from "../../lib/spelling";
import type { WordAnswer } from "../../types/vocabulary";

/** 一张卡的过程：答题中 → 提交（或看答案）后露出答案 → 用户选档位结束。 */
export interface RoundState {
  startedAt: number;
  hintsUsed: number;
  revealed: boolean;
  /** 提交的内容；直接看答案是 ""。 */
  typed: string;
  verdict: SpellingVerdict | null;
}

export const MAX_HINTS = 3;

export const createRoundState = (startedAt: number): RoundState => ({
  startedAt, hintsUsed: 0, revealed: false, typed: "", verdict: null
});

/** 提交一次：露出答案，之后不再改。 */
export const submit = (state: RoundState, typed: string, verdict: SpellingVerdict): RoundState =>
  state.revealed ? state : { ...state, revealed: true, typed, verdict };

/** 不写、直接看答案。 */
export const reveal = (state: RoundState): RoundState =>
  state.revealed ? state : { ...state, revealed: true };

export const addHint = (state: RoundState): RoundState =>
  state.revealed || state.hintsUsed >= MAX_HINTS ? state : { ...state, hintsUsed: state.hintsUsed + 1 };

export const toRound = (state: RoundState, grade: WordAnswer, now: number): SpellingRound => ({
  typed: state.typed,
  verdict: state.verdict,
  hintsUsed: state.hintsUsed,
  grade,
  elapsedMs: Math.max(0, now - state.startedAt)
});

/** 网页 IME 的确认键不是提交；Taro HTML 插件把 input 的 keypress 映成 confirm，没有 nativeEvent。 */
export const confirmsInput = (event: {
  type: string;
  key?: string;
  keyCode?: number;
  repeat?: boolean;
  nativeEvent?: { isComposing?: boolean; keyCode?: number };
}, composing = false): boolean =>
  !composing && !event.repeat && !event.nativeEvent?.isComposing
  && event.keyCode !== 229 && event.nativeEvent?.keyCode !== 229
  && (event.key === "Enter" || event.type === "confirm");

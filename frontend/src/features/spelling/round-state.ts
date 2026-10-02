import { roundOutcome, type SpellingAttempt, type SpellingRound, type SpellingVerdict } from "../../lib/spelling";

export interface RoundState {
  attempts: SpellingAttempt[];
  hintsUsed: number;
  gaveUp: boolean;
  startedAt: number;
}

export const createRoundState = (startedAt: number): RoundState => ({
  attempts: [], hintsUsed: 0, gaveUp: false, startedAt
});

export const toRound = (state: RoundState, now: number): SpellingRound => ({
  attempts: [...state.attempts],
  hintsUsed: state.hintsUsed,
  gaveUp: state.gaveUp,
  elapsedMs: Math.max(0, now - state.startedAt)
});

const ended = (state: RoundState) => roundOutcome(toRound(state, state.startedAt)).done;

export const submit = (state: RoundState, typed: string, verdict: SpellingVerdict): RoundState =>
  ended(state) ? state : { ...state, attempts: [...state.attempts, { typed, verdict }] };

export const useHint = (state: RoundState): RoundState =>
  ended(state) || state.hintsUsed >= 3 ? state : { ...state, hintsUsed: state.hintsUsed + 1 };

export const giveUp = (state: RoundState): RoundState => ended(state) ? state : { ...state, gaveUp: true };

export const visibleHintCount = (state: RoundState): number => state.hintsUsed;
export const lastVerdict = (state: RoundState): SpellingVerdict | null =>
  state.attempts[state.attempts.length - 1]?.verdict ?? null;

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

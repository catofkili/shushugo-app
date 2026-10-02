import { REVEAL_HINT_LEVEL, roundOutcome, type SpellingAttempt, type SpellingRound, type SpellingVerdict } from "../../lib/spelling";

export interface RoundState {
  attempts: SpellingAttempt[];
  hintsUsed: number;
  gaveUp: boolean;
  startedAt: number;
  override?: SpellingRound["override"];
  reopenedAtTries?: number;
}

export const createRoundState = (startedAt: number): RoundState => ({
  attempts: [], hintsUsed: 0, gaveUp: false, startedAt
});

export const toRound = (state: RoundState, now: number): SpellingRound => ({
  attempts: [...state.attempts],
  hintsUsed: state.hintsUsed,
  gaveUp: state.gaveUp,
  elapsedMs: Math.max(0, now - state.startedAt),
  ...(state.override ? { override: state.override } : {})
});

const ended = (state: RoundState) => roundOutcome(toRound(state, state.startedAt)).done;

export const submit = (state: RoundState, typed: string, verdict: SpellingVerdict): RoundState => {
  if (ended(state)) return state;
  const next = { ...state, attempts: [...state.attempts, { typed, verdict }] };
  if (next.reopenedAtTries !== undefined && roundOutcome(toRound(next, next.startedAt)).tries > next.reopenedAtTries) {
    delete next.reopenedAtTries;
  }
  return next;
};

export const useHint = (state: RoundState): RoundState =>
  ended(state) || state.hintsUsed >= 3 ? state : { ...state, hintsUsed: state.hintsUsed + 1 };

export const giveUp = (state: RoundState): RoundState => ended(state) ? state : { ...state, gaveUp: true };

const withoutOverride = (state: RoundState): RoundState => {
  const next = { ...state };
  delete next.override;
  return next;
};

export const canOverrideCorrect = (state: RoundState): boolean => {
  if (state.override === "correct") return true;
  if (state.override || state.hintsUsed >= REVEAL_HINT_LEVEL) return false;
  const round = toRound(state, state.startedAt);
  if (state.reopenedAtTries !== undefined && roundOutcome(round).tries <= state.reopenedAtTries) return false;
  return roundOutcome({ ...round, override: "correct" }).overridden === true;
};

export const canOverrideWrong = (state: RoundState): boolean => {
  if (state.override === "wrong") return true;
  if (state.override) return false;
  return roundOutcome({ ...toRound(state, state.startedAt), override: "wrong" }).overridden === true;
};

/** 再点同一裁决就是改回；另一种裁决先回到原判，再由用户重新选择。 */
export const overrideCorrect = (state: RoundState): RoundState => {
  if (state.override === "correct") {
    const next = withoutOverride(state);
    const baseOutcome = roundOutcome(toRound(next, next.startedAt));
    if (!baseOutcome.done) next.reopenedAtTries = baseOutcome.tries;
    return next;
  }
  return canOverrideCorrect(state) ? { ...state, override: "correct" } : state;
};

export const overrideWrong = (state: RoundState): RoundState => {
  if (state.override === "wrong") return withoutOverride(state);
  return canOverrideWrong(state) ? { ...state, override: "wrong" } : state;
};

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

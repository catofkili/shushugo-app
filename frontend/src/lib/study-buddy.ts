import type { StudyFocusSnapshot } from "./study-focus";

export type BuddyFrame = "idle" | "blink" | "happy" | "cheer" | "worried" | "sad" | "think" | "sleepy" | "surprised" | "shy" | "wave" | "eat" | "dizzy";
export type BuddyAction = BuddyFrame | "hop" | "spin";
export type BuddyEvent =
  | { type: "start" | "reveal" | "idle" | "interaction" | "undo" | "tap" | "dismiss" }
  | { type: "answer"; correct: boolean }
  | { type: "tick"; now: number; motion?: boolean }
  | { type: "focus"; snapshot: Pick<StudyFocusSnapshot, "status" | "focusWindowId" | "remainingSeconds" | "activeMs"> }
  | { type: "remaining"; n: number };

const LINES = {
  start: ["今天也一起。", "来了来了。"],
  low: ["慢一点也没关系。", "这批有点难，稳住。"],
  ten: ["十连对！"], twenty: ["二十连对，厉害。"],
  wrong: ["这几个难缠，标个收藏？", "没事，下一个。"],
  end: ["还剩最后几个。"], half: ["过半了。"], minute: ["最后一分钟。"]
} as const;
type Cue = { key: string; line: keyof typeof LINES };
export interface StudyBuddyState {
  frame: BuddyFrame;
  action: BuddyAction;
  actionId: number;
  frameUntil: number;
  feedbackUntil: number;
  speech: string | null;
  speechUntil: number;
  spoken: number;
  lastSpoken: number;
  lastInteraction: number;
  nextBlink: number;
  correctStreak: number;
  wrongStreak: number;
  recent: boolean[];
  seen: string[];
  pending: Cue[];
  taps: number[];
  lastTap: number;
  started: boolean;
}

export const initialStudyBuddy = (now: number): StudyBuddyState => ({
  frame: "idle", action: "idle", actionId: 0, frameUntil: 0, feedbackUntil: 0,
  speech: null, speechUntil: 0, spoken: 0, lastSpoken: -Infinity,
  lastInteraction: now, nextBlink: now + 4000, correctStreak: 0, wrongStreak: 0,
  recent: [], seen: [], pending: [], taps: [], lastTap: -1, started: false
});

/** All deadlines share the component's single timeout; no timers or platform APIs here. */
export function studyBuddyStep(previous: StudyBuddyState, event: BuddyEvent, now: number, random: () => number): StudyBuddyState {
  if (event.type === "tick") now = event.now;
  const s = { ...previous, pending: [...previous.pending], seen: [...previous.seen] };
  const pose = (frame: BuddyFrame, ms = 0, action: BuddyAction = frame) => {
    s.frame = frame; s.action = action; s.frameUntil = ms ? now + ms : 0; s.actionId++;
  };
  const cue = (line: Cue["line"], key: string = line) => {
    if (!s.seen.includes(key) && !s.pending.some((item) => item.key === key)) s.pending.push({ key, line });
  };
  if (s.speech && now >= s.speechUntil) s.speech = null;
  if (s.frameUntil && now >= s.frameUntil) pose(s.wrongStreak >= 3 ? "sad" : "idle");
  const active = ["start", "answer", "reveal", "interaction", "undo", "tap", "dismiss"].includes(event.type);
  if (active) {
    s.lastInteraction = now;
    if (s.frame === "sleepy") pose("surprised", 300);
    s.nextBlink = now + 4000 + random() * 3000;
  }
  switch (event.type) {
    case "start":
      if (!s.started) { s.started = true; cue("start"); }
      break;
    case "answer": {
      s.speech = null;
      s.recent = [...s.recent, event.correct].slice(-10);
      s.correctStreak = event.correct ? s.correctStreak + 1 : 0;
      s.wrongStreak = event.correct ? 0 : s.wrongStreak + 1;
      s.pending = s.pending.filter((item) => event.correct ? item.line !== "wrong" : item.line !== "ten" && item.line !== "twenty");
      if (event.correct) {
        const cheer = [5, 10, 20].includes(s.correctStreak);
        pose(cheer ? "cheer" : "happy", cheer ? 1200 : 320);
        if (s.correctStreak === 10) cue("ten", `ten:${s.actionId}`);
        if (s.correctStreak === 20) cue("twenty", `twenty:${s.actionId}`);
      } else {
        pose(s.wrongStreak >= 3 ? "sad" : "worried", s.wrongStreak >= 3 ? 0 : 900);
        if (s.wrongStreak === 3) cue("wrong", `wrong:${s.actionId}`);
      }
      // Feedback includes the page's stamp as well as the buddy's own reaction.
      s.feedbackUntil = now + Math.max(900, s.frameUntil - now);
      if (s.recent.length === 10 && s.recent.filter(Boolean).length < 5) cue("low");
      break;
    }
    case "reveal": if (s.wrongStreak < 3) pose("think", 300); break;
    case "undo":
      s.correctStreak = 0; s.wrongStreak = 0; s.recent = s.recent.slice(0, -1);
      s.pending = s.pending.filter((item) => !["ten", "twenty", "wrong", "low"].includes(item.line));
      pose("idle"); break;
    case "remaining": if (event.n > 0 && event.n <= 5) cue("end"); break;
    case "focus": {
      const f = event.snapshot;
      if (f.status !== "running" || !f.focusWindowId) {
        s.pending = s.pending.filter((item) => item.line !== "half" && item.line !== "minute");
        break;
      }
      s.pending = s.pending.filter((item) => !["half", "minute"].includes(item.line) || item.key.endsWith(`:${f.focusWindowId}`));
      if (f.activeMs >= (f.activeMs + f.remainingSeconds * 1000) / 2) cue("half", `half:${f.focusWindowId}`);
      if (f.remainingSeconds > 0 && f.remainingSeconds <= 60) cue("minute", `minute:${f.focusWindowId}`);
      break;
    }
    case "dismiss": s.speech = null; break;
    case "tap": {
      s.speech = null;
      s.taps = [...s.taps.filter((at) => now - at <= 2000), now];
      if (s.taps.length >= 5) { pose("dizzy", 2000); break; }
      const choices = [0, 1, 2, 3, 4].filter((id) => id !== s.lastTap);
      s.lastTap = choices[Math.min(choices.length - 1, Math.floor(random() * choices.length))];
      const reactions: [BuddyFrame, number, BuddyAction][] = [
        ["happy", 320, "hop"], ["idle", 520, "spin"], ["shy", 900, "shy"], ["wave", 700, "wave"], ["eat", 1000, "eat"]
      ];
      pose(...reactions[s.lastTap]); break;
    }
    case "idle": if (now - s.lastInteraction >= 60000) pose("sleepy"); break;
    case "tick":
      if (now - s.lastInteraction >= 60000 && !s.frameUntil && s.frame !== "sleepy") pose("sleepy");
      else if (event.motion !== false && s.frame === "idle" && now >= s.nextBlink) {
        pose("blink", 120); s.nextBlink = now + 4000 + random() * 3000;
      }
      break;
  }
  if (s.started && !s.speech && s.pending.length && s.spoken < 6 && now >= s.feedbackUntil && now - s.lastSpoken >= 20000) {
    const next = s.pending.shift()!;
    const lines = LINES[next.line];
    s.speech = lines[Math.min(lines.length - 1, Math.floor(random() * lines.length))];
    s.seen.push(next.key); s.spoken++; s.lastSpoken = now; s.speechUntil = now + 2400;
  }
  return s;
}

/** Tiny per-page store keeps the speech budget across word/mixed-card remounts without rerendering the card on every blink. */
export function createStudyBuddy(now = Date.now(), random = Math.random) {
  let state = initialStudyBuddy(now);
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    send: (event: BuddyEvent) => { state = studyBuddyStep(state, event, Date.now(), random); listeners.forEach((listener) => listener()); }
  };
}
export type StudyBuddySession = ReturnType<typeof createStudyBuddy>;

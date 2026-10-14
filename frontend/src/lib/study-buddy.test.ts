import { describe, expect, it } from "vitest";
import { initialStudyBuddy, studyBuddyStep, type BuddyEvent } from "./study-buddy";

const session = () => {
  let state = initialStudyBuddy(0);
  let now = 0;
  const send = (event: BuddyEvent) => (state = studyBuddyStep(state, event, now, () => 0));
  return {
    send, get: () => state,
    at: (time: number, motion = false) => { now = time; return send({ type: "tick", now, motion }); },
    answers: (correct: boolean, n: number) => { for (let i = 0; i < n; i++) send({ type: "answer", correct }); }
  };
};
const focus = (id: string, remainingSeconds: number): BuddyEvent => ({
  type: "focus", snapshot: { status: "running", focusWindowId: id, remainingSeconds, activeMs: 600000 - remainingSeconds * 1000 }
});

describe("study buddy", () => {
  it("starts once and dismisses its exact opening line after 2.4 seconds", () => {
    const s = session();
    expect(s.send({ type: "start" }).speech).toBe("今天也一起。");
    expect(s.at(2399).speech).toBeTruthy();
    expect(s.at(2400).speech).toBeNull();
    expect(s.send({ type: "start" }).spoken).toBe(1);
  });
  it("waits at least twenty seconds between lines", () => {
    const s = session(); s.send({ type: "start" }); s.send({ type: "remaining", n: 5 });
    expect(s.at(19999).spoken).toBe(1);
    expect(s.at(20000).speech).toBe("还剩最后几个。");
  });
  it("never speaks a seventh line in a session", () => {
    const s = session(); s.send({ type: "start" });
    for (let i = 1; i <= 7; i++) { s.at(i * 21000); s.send(focus(`window-${i}`, 300)); }
    expect(s.get().spoken).toBe(6);
    expect(s.get().speech).toBeNull();
  });
  it("does not judge low accuracy before ten answers", () => {
    const s = session(); s.send({ type: "start" }); s.answers(false, 9); s.at(21000);
    expect(s.get().pending.some((cue) => cue.line === "low")).toBe(false);
    s.answers(false, 1); s.at(42000);
    expect(s.get().speech).toBe("慢一点也没关系。");
  });
  it("uses the last ten answers, requires fewer than five correct, and says low accuracy once", () => {
    const s = session(); s.send({ type: "start" }); s.answers(true, 5); s.answers(false, 5); s.at(21000);
    expect(s.get().pending.some((cue) => cue.line === "low")).toBe(false);
    s.answers(false, 1); s.at(42000);
    expect(s.get().speech).toBe("慢一点也没关系。");
    s.answers(false, 20); s.at(64000);
    expect(s.get().pending.some((cue) => cue.line === "low")).toBe(false);
    expect(s.get().seen.filter((key) => key === "low")).toHaveLength(1);
  });
  it("cheers silently at five and speaks for ten and twenty correct answers", () => {
    const s = session(); s.send({ type: "start" }); s.answers(true, 5);
    expect(s.get().frame).toBe("cheer"); expect(s.get().pending).toHaveLength(0);
    s.at(21000); s.answers(true, 5);
    expect(s.get().speech).toBeNull();
    expect(s.at(22200).speech).toBe("十连对！");
    s.at(44000); s.answers(true, 10);
    expect(s.at(45200).speech).toBe("二十连对，厉害。");
  });
  it("stays sad from three wrong answers until a correct answer and speaks once per losing run", () => {
    const s = session(); s.send({ type: "start" }); s.answers(false, 3);
    expect(s.get().frame).toBe("sad");
    expect(s.at(21000).speech).toBe("这几个难缠，标个收藏？");
    s.answers(false, 2); s.send({ type: "reveal" }); s.at(42000);
    expect(s.get().frame).toBe("sad"); expect(s.get().speech).toBeNull();
    s.answers(true, 1); expect(s.get().frame).toBe("happy");
    s.answers(false, 3); expect(s.at(43000).speech).toBe("这几个难缠，标个收藏？");
  });
  it("announces five or fewer remaining once, excluding empty plans", () => {
    const s = session(); s.send({ type: "start" }); s.send({ type: "remaining", n: 0 }); s.send({ type: "remaining", n: 6 });
    expect(s.get().pending).toHaveLength(0);
    s.send({ type: "remaining", n: 5 }); expect(s.at(20000).speech).toBe("还剩最后几个。");
    s.send({ type: "remaining", n: 4 }); s.at(40000); expect(s.get().spoken).toBe(2);
  });
  it("announces halfway and the last minute once in each focus window", () => {
    const s = session(); s.send({ type: "start" }); s.at(21000);
    s.send(focus("a", 301)); expect(s.get().spoken).toBe(1);
    expect(s.send(focus("a", 300)).speech).toBe("过半了。");
    s.at(42000); s.send(focus("a", 299)); expect(s.get().speech).toBeNull();
    s.send(focus("a", 61)); expect(s.get().speech).toBeNull();
    expect(s.send(focus("a", 60)).speech).toBe("最后一分钟。");
    s.at(63000); s.send(focus("a", 59)); expect(s.get().speech).toBeNull();
    expect(s.send(focus("b", 300)).speech).toBe("过半了。");
    s.at(84000); expect(s.send(focus("b", 60)).speech).toBe("最后一分钟。");
  });
  it("defers every line while answer feedback is playing and hides an existing bubble", () => {
    const s = session(); s.send({ type: "start" }); s.at(21000); s.answers(true, 10);
    s.send({ type: "remaining", n: 5 }); s.send(focus("a", 300));
    expect(s.at(22199).speech).toBeNull();
    expect(s.at(22200).speech).toBe("十连对！");
    expect(s.send({ type: "answer", correct: true }).speech).toBeNull();
  });
  it("shows reveal and answer frames for their specified durations", () => {
    const s = session(); expect(s.send({ type: "reveal" }).frame).toBe("think");
    expect(s.at(300).frame).toBe("idle");
    expect(s.send({ type: "answer", correct: true }).frame).toBe("happy");
    expect(s.at(620).frame).toBe("idle");
    s.send({ type: "answer", correct: false }); expect(s.at(1519).frame).toBe("worried");
    expect(s.at(1520).frame).toBe("idle");
  });
  it("sleeps after sixty seconds of inactivity and wakes on ordinary interaction", () => {
    const s = session(); expect(s.at(59999).frame).toBe("idle");
    expect(s.at(60000).frame).toBe("sleepy");
    expect(s.send({ type: "interaction" }).frame).toBe("surprised");
    expect(s.at(60300).frame).toBe("idle");
  });
  it("blinks for 120ms, with no blinking under reduced motion", () => {
    const s = session(); expect(s.at(4000, false).frame).toBe("idle");
    expect(s.at(4001, true).frame).toBe("blink");
    expect(s.at(4121).frame).toBe("idle");
  });
  it("does not repeat a random tap reaction; five taps in two seconds take priority", () => {
    const s = session(); s.send({ type: "tap" }); expect(s.get().action).toBe("hop");
    s.send({ type: "tap" }); expect(s.get().action).toBe("spin");
    s.send({ type: "tap" }); s.send({ type: "tap" });
    expect(s.send({ type: "tap" }).frame).toBe("dizzy");
    expect(s.at(1999).frame).toBe("dizzy"); expect(s.at(2000).frame).toBe("idle");
  });
  it("injects randomness for all five ordinary tap choices and exact copy variants", () => {
    const actions = ["hop", "spin", "shy", "wave", "eat"];
    actions.forEach((action, index) => {
      expect(studyBuddyStep(initialStudyBuddy(0), { type: "tap" }, 0, () => (index + .1) / 5).action).toBe(action);
    });
    expect(studyBuddyStep(initialStudyBuddy(0), { type: "start" }, 0, () => .9).speech).toBe("来了来了。");
  });
  it("undo clears both streaks and any delayed streak cue", () => {
    const s = session(); s.answers(false, 3); s.send({ type: "undo" });
    expect(s.get().wrongStreak).toBe(0); expect(s.get().pending).toHaveLength(0);
    s.answers(true, 10); s.send({ type: "undo" });
    expect(s.get().correctStreak).toBe(0); expect(s.get().frame).toBe("idle");
    expect(s.get().pending).toHaveLength(0);
  });
});

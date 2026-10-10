import { describe, expect, it } from "vitest";
import { canTakeTeamLeave, compareDuelScores, deriveTeamPeriod, scoreDuel, shiftTeamDay, teamDayPassed, teamIsoWeek, teamPeriod, teamPeriodAmount, teamStudyDay, type DuelQuestion, type TeamPeriodMember } from "./team-rules";

const start = "2026-10-10";
const member = (userId = "a", joinedDay = start): TeamPeriodMember => ({ userId, joinedDay, leaves: [], activity: Array.from({ length: 14 }, (_, index) => ({ studyDay: shiftTeamDay(start, index), wordCount: 30, activeMinutes: 10 })) });
const question: DuelQuestion = { id: 1, level: "N3", kind: "meaning", prompt: "学ぶ", options: ["学习", "睡觉", "吃", "走"], answer: "学习", answerIndex: 0, limitMs: 10_000 };

describe("team rules", () => {
  it("requires thirty distinct words", () => { expect(teamDayPassed(29, 10)).toBe(false); });
  it("requires ten active minutes", () => { expect(teamDayPassed(30, 9)).toBe(false); });
  it("passes at both thresholds", () => { expect(teamDayPassed(30, 10)).toBe(true); });
  it("allows yesterday's leave", () => { expect(canTakeTeamLeave(start, "2026-10-11", false)).toBe(true); });
  it("rejects expired leave", () => { expect(canTakeTeamLeave(start, "2026-10-12", false)).toBe(false); });
  it("rejects today's advance leave", () => { expect(canTakeTeamLeave(start, start, false)).toBe(false); });
  it("allows leave only once per period", () => { expect(canTakeTeamLeave(start, "2026-10-11", true)).toBe(false); });
  it("derives all fourteen cell states including not-joined", () => {
    const person = member("a", "2026-10-11"); person.activity = [{ studyDay: "2026-10-11", wordCount: 30, activeMinutes: 10 }]; person.leaves = ["2026-10-12"];
    expect(deriveTeamPeriod(start, "2026-10-16", [person]).members[0].cells.slice(0, 8)).toEqual(["not-joined", "passed", "leave", "failed", "failed", "today", "today", "future"]);
  });
  it("does not break a repairable day", () => { const person = member(); person.activity = []; expect(deriveTeamPeriod(start, "2026-10-11", [person]).broken).toBe(false); });
  it("counts leave as a passed day", () => { const person = member(); person.activity.shift(); person.leaves = [start]; expect(deriveTeamPeriod(start, "2026-10-25", [person]).members[0].amount).toBe(1400); });
  it("halves teammates' whole period, including days after the break", () => {
    const culprit = member(); culprit.activity.shift();
    const result = deriveTeamPeriod(start, "2026-10-25", [culprit, member("b")]);
    expect(result.broken).toBe(true); expect(result.members[1].amount).toBe(700); expect(result.members[1].daysPassed).toBe(14);
  });
  it("gives every culprit zero", () => { expect(teamPeriodAmount(13, true, true, false)).toBe(0); });
  it("rounds half downward", () => { expect(teamPeriodAmount(1.01, true, false, false)).toBe(50); });
  it("halves a day-two joiner's own earned days", () => { expect(deriveTeamPeriod(start, "2026-10-25", [member("a", "2026-10-11")]).members[0].amount).toBe(650); });
  it("keeps full reward for joining on the first day", () => { expect(deriveTeamPeriod(start, "2026-10-25", [member()]).members[0].amount).toBe(1400); });
  it("waits for final-day leave before freezing an incomplete period", () => {
    const person = member(); person.activity.pop();
    expect(deriveTeamPeriod(start, "2026-10-24", [person]).settleable).toBe(false);
    expect(deriveTeamPeriod(start, "2026-10-25", [person]).settleable).toBe(true);
  });
  it("continues fourteen-day periods after a break", () => { expect(teamPeriod(start, "2026-10-24")).toEqual({ start: "2026-10-24", end: "2026-11-06", next: "2026-11-07", day: 1 }); });
  it("does not count construction day as period day one", () => { expect(teamPeriod(start, "2026-10-09").day).toBe(0); });
  it("uses ISO week year across new year", () => { expect(teamIsoWeek("2021-01-01")).toBe("2020-W53"); expect(teamIsoWeek("2021-01-04")).toBe("2021-W01"); });
  it("changes the week on Monday at four", () => {
    expect(teamIsoWeek(teamStudyDay(Date.parse("2026-10-11T19:59:59Z")))).toBe("2026-W41");
    expect(teamIsoWeek(teamStudyDay(Date.parse("2026-10-11T20:00:00Z")))).toBe("2026-W42");
  });
  it("includes unknown and timeout but excludes unreached questions", () => { expect(scoreDuel([question, question, question, question], [{ selected: 0, responseMs: 1000 }, { selected: "unknown", responseMs: 2000 }, { selected: "timeout", responseMs: 10_000 }])).toEqual({ correct: 1, answered: 3, totalMs: 13_000 }); });
  it("clamps per-question response times", () => { expect(scoreDuel([question, question], [{ selected: 0, responseMs: -2 }, { selected: 0, responseMs: 90_000 }]).totalMs).toBe(10_000); });
  it("compares correct counts before accuracy", () => { expect(compareDuelScores({ correct: 2, answered: 10, totalMs: 10000 }, { correct: 1, answered: 1, totalMs: 1 })).toBe("creator"); });
  it("compares accuracy before time", () => { expect(compareDuelScores({ correct: 2, answered: 10, totalMs: 1 }, { correct: 2, answered: 5, totalMs: 10000 })).toBe("opponent"); });
  it("compares time third", () => { expect(compareDuelScores({ correct: 2, answered: 5, totalMs: 1000 }, { correct: 2, answered: 5, totalMs: 999 })).toBe("opponent"); });
  it("allows an exact draw, including empty submissions", () => { const score = { correct: 0, answered: 0, totalMs: 0 }; expect(compareDuelScores(score, score)).toBe("draw"); });
});

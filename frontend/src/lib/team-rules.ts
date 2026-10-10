/** Shared by the clients and Worker. Team days use UTC+8, with a 04:00 boundary. */
export const TEAM_PERIOD_DAYS = 14;
const DAY_MS = 86_400_000;

export const teamStudyDay = (at: number | Date = Date.now(), offsetMinutes = 480): string =>
  new Date(Number(at) + (offsetMinutes - 240) * 60_000).toISOString().slice(0, 10);

export const shiftTeamDay = (day: string, days: number): string =>
  new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

export const teamIsoWeek = (day: string): string => {
  const thursday = new Date(`${day}T00:00:00Z`);
  thursday.setUTCDate(thursday.getUTCDate() + 4 - (thursday.getUTCDay() || 7));
  const year = thursday.getUTCFullYear();
  const week = Math.ceil(((thursday.getTime() - Date.UTC(year, 0, 1)) / DAY_MS + 1) / 7);
  return `${year}-W${String(week).padStart(2, "0")}`;
};

export const teamPeriod = (anchor: string, day: string) => {
  const elapsed = Math.floor((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${anchor}T00:00:00Z`)) / DAY_MS);
  const start = shiftTeamDay(anchor, Math.max(0, Math.floor(elapsed / TEAM_PERIOD_DAYS)) * TEAM_PERIOD_DAYS);
  return { start, end: shiftTeamDay(start, 13), next: shiftTeamDay(start, 14), day: elapsed < 0 ? 0 : elapsed % 14 + 1 };
};

export const teamDayPassed = (wordCount: number, activeMinutes: number): boolean => wordCount >= 30 && activeMinutes >= 10;

export const canTakeTeamLeave = (day: string, nowDay: string, leaveUsed: boolean): boolean =>
  !leaveUsed && day < nowDay && nowDay < shiftTeamDay(day, 2);

export type TeamDayStatus = "passed" | "leave" | "failed" | "today" | "future" | "not-joined";
export type TeamActivity = { studyDay: string; wordCount: number; activeMinutes: number };
export type TeamPeriodMember = { userId: string; joinedDay: string; activity: TeamActivity[]; leaves: string[] };

export const teamPeriodAmount = (daysPassed: number, broken: boolean, culprit: boolean, joinedLate: boolean): number =>
  culprit ? 0 : Math.floor(daysPassed * 100 * (broken ? 0.5 : 1) * (joinedLate ? 0.5 : 1));

export const deriveTeamPeriod = (start: string, nowDay: string, members: TeamPeriodMember[]) => {
  const days = Array.from({ length: 14 }, (_, index) => shiftTeamDay(start, index));
  const rows = members.map((member) => {
    const activity = new Map(member.activity.map((item) => [item.studyDay, item]));
    const cells = days.map((day): TeamDayStatus => {
      if (day < member.joinedDay) return "not-joined";
      if (day > nowDay) return "future";
      if (member.leaves.includes(day)) return "leave";
      const counts = activity.get(day);
      if (counts && teamDayPassed(counts.wordCount, counts.activeMinutes)) return "passed";
      // Yesterday remains repairable until the next 04:00; it cannot break the team yet.
      return day === nowDay || canTakeTeamLeave(day, nowDay, false) ? "today" : "failed";
    });
    const daysPassed = cells.filter((cell) => cell === "passed" || cell === "leave").length;
    return { userId: member.userId, cells, daysPassed, culprit: cells.includes("failed"), joinedLate: member.joinedDay > start };
  });
  const broken = rows.some((row) => row.culprit);
  return {
    start, end: days[13], days, broken,
    culprits: rows.filter((row) => row.culprit).map((row) => row.userId),
    // Final-day leave has the same grace period as every other day. Do not freeze it early.
    settleable: nowDay > days[13] && rows.every((row) => !row.cells.includes("today")),
    members: rows.map((row) => ({ ...row, amount: teamPeriodAmount(row.daysPassed, broken, row.culprit, row.joinedLate) }))
  };
};

export type DuelQuestion = {
  id: number;
  level: string;
  kind: "reading" | "meaning";
  prompt: string;
  readingScope?: string;
  options: string[];
  answerIndex: number;
  answer: string;
  limitMs: number;
};
export type DuelAnswer = { selected: number | "unknown" | "timeout"; responseMs: number };
export type DuelScore = { correct: number; answered: number; totalMs: number };
export type DuelWinner = "creator" | "opponent" | "draw";

export const scoreDuel = (questions: DuelQuestion[], answers: DuelAnswer[]): DuelScore => {
  let correct = 0;
  let totalMs = 0;
  const answered = Math.min(questions.length, answers.length);
  for (let index = 0; index < answered; index += 1) {
    const question = questions[index];
    const answer = answers[index];
    if (answer.selected === question.answerIndex) correct += 1;
    totalMs += Math.floor(Math.max(0, Math.min(question.limitMs, Number.isFinite(answer.responseMs) ? answer.responseMs : question.limitMs)));
  }
  return { correct, answered, totalMs };
};

export const compareDuelScores = (creator: DuelScore, opponent: DuelScore): DuelWinner => {
  const comparison = creator.correct - opponent.correct
    || creator.correct * Math.max(1, opponent.answered) - opponent.correct * Math.max(1, creator.answered)
    || opponent.totalMs - creator.totalMs;
  return comparison > 0 ? "creator" : comparison < 0 ? "opponent" : "draw";
};

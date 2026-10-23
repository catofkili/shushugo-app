export type RoundStatus = "pending" | "once" | "done";
export interface DailyReviewRound {
  words: { id: number; status: RoundStatus }[];
  recent: number[];
}

export function createDailyReviewRound(ids: number[], avoidFirstId?: number): DailyReviewRound {
  return { words: [...new Set(ids)].map((id) => ({ id, status: "pending" })),
    recent: avoidFirstId == null ? [] : [avoidFirstId] };
}

export function roundWritesFsrs(round: DailyReviewRound, id: number): boolean {
  return round.words.some((word) => word.id === id && word.status === "pending");
}

export function answerDailyReviewRound(round: DailyReviewRound, id: number, good: boolean): DailyReviewRound {
  if (!round.words.some((word) => word.id === id && word.status !== "done")) return round;
  return {
    words: round.words.map((word) => word.id !== id ? word : {
      id, status: !good ? "pending" : word.status === "pending" ? "once" : "done"
    }),
    recent: [...round.recent, id].slice(-2)
  };
}

export function nextDailyReviewId(round: DailyReviewRound): number | null {
  const pending = round.words.filter((word) => word.status !== "done");
  return (pending.find((word) => !round.recent.includes(word.id)) ?? pending[0])?.id ?? null;
}

export function dailyReviewRoundDone(round: DailyReviewRound): boolean {
  return round.words.every((word) => word.status === "done");
}
